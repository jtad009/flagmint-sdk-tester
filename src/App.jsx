import { useState, useEffect, useCallback, useRef } from 'react';
import { createFlagmintConnection, CONNECTION_STATES } from './connection';
import { buildContextFromFields, CONTEXT_PRESETS, flagTypeLabel, flagValueDisplay, flagValueShort, TYPE_COLORS, logColor } from './helpers';
import { ENVIRONMENTS, getEnvironment, inferEnvironmentId } from './environments';
import { Tooltip } from './Tooltip';
import { HowToUsePanel } from './HowToUsePanel';
import { CollapsibleSection } from './CollapsibleSection';
import { FONT, makeStyles, themes } from './uiTheme';
import {
  clearLocalConfigCache,
  getQaClientClockState,
  isLocalLeaseExpired,
  loadLocalConfigCache,
  qaAdvanceClock,
  qaClearConfig,
  qaGetClock,
  qaGetState,
  qaReplayCompile,
  qaResetClock,
  resetQaClientClock,
  saveLocalConfigCache,
  syncQaClientClock,
} from './qa';

// Styles come from makeStyles(theme) inside App.

const QA_ACTIONS = [
  {
    id: 'clock',
    label: 'Clock',
    tip: 'Read the server QA clock and mirror its offset onto the tester lease timer.',
    run: (apiUrl, apiKey) => ['clock', () => qaGetClock(apiUrl, apiKey)],
    syncsClientClock: true,
  },
  {
    id: 'plus25h',
    label: '+25h',
    tip: 'Advance server + tester QA clocks by 25 hours so leases expire without waiting a day.',
    run: (apiUrl, apiKey) => ['+25h', () => qaAdvanceClock(apiUrl, apiKey, { hours: 25 })],
    syncsClientClock: true,
  },
  {
    id: 'reset',
    label: 'Reset clock',
    tip: 'Clear server and tester QA clock offsets and return to real wall time.',
    run: (apiUrl, apiKey) => ['reset clock', () => qaResetClock(apiUrl, apiKey)],
    syncsClientClock: true,
  },
  {
    id: 'state',
    label: 'Server state',
    tip: 'Show compiled rules version / backlog metadata for this API key’s environment.',
    run: (apiUrl, apiKey) => ['state', () => qaGetState(apiUrl, apiKey)],
  },
  {
    id: 'clear',
    label: 'Clear server',
    tip: 'Delete compiled rules from Redis for this env. Next connect should get config_not_ready until Replay.',
    run: (apiUrl, apiKey) => ['clear Redis rules', () => qaClearConfig(apiUrl, apiKey)],
  },
  {
    id: 'replay',
    label: 'Replay',
    tip: 'Recompile flag rules from the database into Redis (cold-start / after Clear server).',
    run: (apiUrl, apiKey) => ['replay compile', () => qaReplayCompile(apiUrl, apiKey)],
  },
];

const STATE_COLORS = {
  [CONNECTION_STATES.CONNECTED]: '#10B981',
  [CONNECTION_STATES.CONNECTING]: '#F59E0B',
  [CONNECTION_STATES.DISCONNECTED]: '#6B7280',
  [CONNECTION_STATES.ERROR]: '#EF4444',
};

const TRANSPORTS = [
  { id: 'sse', label: 'SSE', tip: 'ASL handshake + EventSource stream (JS SDK path). Required for config-sync.' },
  { id: 'websocket', label: 'WebSocket', tip: 'Legacy Go SDK path on the API host (/ws/sdk). Not for config-sync.' },
  { id: 'long-polling', label: 'Polling', tip: 'Repeated POST /evaluator/evaluate on the API host.' },
];

const ENV_TIPS = {
  local: 'Local FF-EU — API and stream both use localhost:3000.',
  staging: 'Staging — handshake/QA on staging-api; SSE on staging-stream (CF bypass host).',
  production: 'Production — handshake/QA on api.flagmint.com; SSE on stream.flagmint.com.',
  custom: 'Type your own API + Stream hosts (for one-off testing).',
};

const SYNC_TIPS = {
  legacy: 'Server-evaluated flags events on the stream (classic path).',
  config: 'ECDH + signed fullConfig/deltas + local eval. Use SSE transport.',
};

const PRESET_TIPS = {
  simple_user: 'Load a simple user context preset (kind + key).',
  multi_context: 'Load a multi-context preset for targeting tests.',
  empty: 'Clear context fields to an empty object.',
};

/**
 * Format a lease expiry for non-technical readers.
 *
 * @param {number} ms Epoch ms
 * @returns {string}
 */
function formatLeaseWhen(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * Plain-English config-sync status for the sidebar (Option B — simple layer).
 *
 * @param {{
 *   cache: { version?: number, expiresAt?: number }|null,
 *   leaseExpiresAt: number|undefined,
 *   expired: boolean,
 *   transport: string,
 *   clientOffsetMs: number,
 * }} input
 * @returns {{ headline: string, detail: string|null, warn: string|null }}
 */
function configSyncPlainStatus({ cache, leaseExpiresAt, expired, transport, clientOffsetMs }) {
  if (transport !== 'sse') {
    return {
      headline: 'Switch to SSE to use this mode',
      detail: 'The live rules stream only works with the SSE transport.',
      warn: null,
    };
  }
  if (!cache || typeof cache.version !== 'number') {
    return {
      headline: 'No saved rules yet',
      detail: 'Next connect will download a full copy of the flag rules.',
      warn: null,
    };
  }
  if (expired) {
    return {
      headline: 'Rules expired — renewing',
      detail: leaseExpiresAt
        ? `This copy ran out at ${formatLeaseWhen(leaseExpiresAt)}. Safe defaults are used until a fresh copy arrives.`
        : 'Safe defaults are used until a fresh copy of the rules arrives.',
      warn: clientOffsetMs !== 0 ? 'Test clock is shifted ahead so you can practice expiry without waiting a day.' : null,
    };
  }
  return {
    headline: 'Flags ready',
    detail: leaseExpiresAt
      ? `Checking flags on your device. This copy is good until ${formatLeaseWhen(leaseExpiresAt)}.`
      : 'Checking flags on your device with a secure live connection.',
    warn: clientOffsetMs !== 0
      ? `Test clock is ahead by about ${Math.round(clientOffsetMs / 3600000)} hours (lease testing).`
      : null,
  };
}

function loadInitialUrls() {
  const storedApi = localStorage.getItem('fm_tester_url') || 'http://localhost:3000';
  const storedStream = localStorage.getItem('fm_tester_stream_url');
  const storedEnv = localStorage.getItem('fm_tester_env');
  const envId =
    storedEnv && ENVIRONMENTS.some((e) => e.id === storedEnv)
      ? storedEnv
      : inferEnvironmentId(storedApi);
  const preset = getEnvironment(envId);
  if (envId === 'custom') {
    return {
      envId: 'custom',
      apiUrl: storedApi,
      streamUrl: storedStream || storedApi,
    };
  }
  return {
    envId,
    apiUrl: preset.apiUrl,
    streamUrl: preset.streamUrl,
  };
}

// ─── App ────────────────────────────────────────────────────────

export default function App() {
  // Config
  const initial = loadInitialUrls();
  const [envId, setEnvId] = useState(initial.envId);
  const [apiUrl, setApiUrl] = useState(initial.apiUrl);
  const [streamUrl, setStreamUrl] = useState(initial.streamUrl);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('fm_tester_key') || '');
  const [transport, setTransport] = useState(() => localStorage.getItem('fm_tester_transport') || 'sse');
  const [syncMode, setSyncMode] = useState(() => localStorage.getItem('fm_tester_sync_mode') || 'legacy');
  const [leaseInfo, setLeaseInfo] = useState(null);
  const [configMeta, setConfigMeta] = useState(null);
  const [qaBusy, setQaBusy] = useState(false);
  /** Bumps when the mirrored QA client clock changes so lease UI re-renders. */
  const [qaClockEpoch, setQaClockEpoch] = useState(0);
  /** Collapsed by default so flags / log get more vertical space. */
  const [openSections, setOpenSections] = useState({
    connection: false,
    configSync: false,
    qa: false,
    context: false,
  });
  /** Collapsed technical dump under the plain-English config-sync status. */
  const [showConfigSyncDetails, setShowConfigSyncDetails] = useState(false);

  /**
   * Toggle one sidebar section open/closed.
   *
   * @param {'connection'|'configSync'|'qa'|'context'} id
   */
  const toggleSection = (id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // State
  const [connState, setConnState] = useState(CONNECTION_STATES.DISCONNECTED);
  const [flags, setFlags] = useState({});
  const [flagHistory, setFlagHistory] = useState({});
  const [logs, setLogs] = useState([]);
  const [contextFields, setContextFields] = useState([
    { key: 'kind', value: 'user', id: 'cf-1' },
    { key: 'key', value: '', id: 'cf-2' },
  ]);
  const [activeTab, setActiveTab] = useState('flags');
  const [filterText, setFilterText] = useState('');
  const [expandedFlags, setExpandedFlags] = useState(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('fm_tester_theme') || 'light');
  const t = themes[themeMode] || themes.light;
  const S = makeStyles(t);


  const connRef = useRef(null);
  const logEndRef = useRef(null);
  const nextId = useRef(10);

  const isConnected = connState === CONNECTION_STATES.CONNECTED;
  const isConnecting = connState === CONNECTION_STATES.CONNECTING;
  const flagCount = Object.keys(flags).length;
  const isCustomEnv = envId === 'custom';
  const urlsLocked = isConnected || isConnecting;

  const applyEnvironment = useCallback((nextId) => {
    setEnvId(nextId);
    const preset = getEnvironment(nextId);
    if (nextId === 'custom') return;
    setApiUrl(preset.apiUrl);
    setStreamUrl(preset.streamUrl);
  }, []);

  // Persist URL and key
  useEffect(() => { localStorage.setItem('fm_tester_env', envId); }, [envId]);
  useEffect(() => { localStorage.setItem('fm_tester_url', apiUrl); }, [apiUrl]);
  useEffect(() => { localStorage.setItem('fm_tester_stream_url', streamUrl); }, [streamUrl]);
  useEffect(() => { localStorage.setItem('fm_tester_key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('fm_tester_transport', transport); }, [transport]);
  useEffect(() => { localStorage.setItem('fm_tester_sync_mode', syncMode); }, [syncMode]);
  useEffect(() => { localStorage.setItem('fm_tester_theme', themeMode); }, [themeMode]);
  useEffect(() => { document.body.style.background = t.bg; }, [t.bg]);

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Track flag change history
  useEffect(() => {
    setFlagHistory((prev) => {
      const next = { ...prev };
      const now = new Date().toISOString();
      for (const [key, val] of Object.entries(flags)) {
        if (!next[key]) next[key] = [];
        const last = next[key][next[key].length - 1];
        if (!last || JSON.stringify(last.value) !== JSON.stringify(val)) {
          next[key] = [...next[key], { value: val, ts: now }];
        }
      }
      return next;
    });
  }, [flags]);

  const addLog = useCallback((entry) => {
    setLogs((prev) => [...prev.slice(-300), entry]);
  }, []);

  const context = buildContextFromFields(contextFields);

  // ─── Connection Handlers ────────────────────────────────────

  const handleConnect = useCallback(() => {
    connRef.current?.disconnect();
    setFlags({});
    setFlagHistory({});
    setLogs([]);
    setLeaseInfo(null);
    setConfigMeta(null);

    const cache = loadLocalConfigCache(apiKey);
    const conn = createFlagmintConnection({
      url: apiUrl,
      streamUrl,
      apiKey,
      transport,
      syncMode: syncMode === 'config' ? 'config' : 'legacy',
      onFlags: setFlags,
      onState: setConnState,
      onLog: addLog,
      initialRulesSnapshot:
        syncMode === 'config' && cache && !isLocalLeaseExpired(cache) ? cache : undefined,
      getSinceVersion: () => {
        const c = loadLocalConfigCache(apiKey);
        if (!c || isLocalLeaseExpired(c)) return undefined;
        return typeof c.version === 'number' ? c.version : undefined;
      },
      forceFullConfig: () => {
        const c = loadLocalConfigCache(apiKey);
        return !c || isLocalLeaseExpired(c) || !Array.isArray(c.flags) || c.flags.length === 0;
      },
      onLease: (lease) => {
        setLeaseInfo(lease);
        const prev = loadLocalConfigCache(apiKey) || {};
        // Version bookmark comes from RulesStore via onRulesSnapshot; lease mainly renews expiry.
        if (!saveLocalConfigCache(apiKey, {
          ...prev,
          expiresAt: lease.expiresAt ?? prev.expiresAt,
          serverNow: lease.serverNow,
          signature: lease.signature,
        })) {
          addLog({ ts: new Date().toISOString(), level: 'warn', msg: 'Failed to persist lease to localCache (storage full or disabled)' });
        }
      },
      onConfig: (payload) => {
        setConfigMeta({
          type: payload.type,
          version: payload.version ?? payload.toVersion,
          warnings: payload.warnings,
          fromVersion: payload.fromVersion,
          toVersion: payload.toVersion,
        });
      },
      onRulesSnapshot: (snapshot) => {
        const prev = loadLocalConfigCache(apiKey) || {};
        if (!saveLocalConfigCache(apiKey, {
          ...prev,
          version: snapshot.version,
          expiresAt: snapshot.expiresAt ?? prev.expiresAt,
          flags: snapshot.flags,
          segments: snapshot.segments,
          updatedAt: new Date().toISOString(),
          lastPayloadType: 'rulesSnapshot',
        })) {
          addLog({ ts: new Date().toISOString(), level: 'warn', msg: 'Failed to persist rules snapshot to localCache (storage full or disabled)' });
        }
      },
    });
    connRef.current = conn;
    conn.connect(context);
  }, [apiUrl, streamUrl, apiKey, transport, syncMode, context, addLog]);

  const runQa = useCallback(async (label, fn, { syncsClientClock = false } = {}) => {
    if (!apiKey) return;
    setQaBusy(true);
    try {
      const data = await fn();
      addLog({ ts: new Date().toISOString(), level: 'info', msg: `QA ${label}`, data });

      if (syncsClientClock) {
        const clientClock =
          label === 'reset clock'
            ? resetQaClientClock()
            : syncQaClientClock(data && typeof data === 'object' ? data : null);
        setQaClockEpoch((n) => n + 1);
        addLog({
          ts: new Date().toISOString(),
          level: 'info',
          msg: 'QA client clock mirrored for lease checks',
          data: clientClock,
        });
        const leaseStillFresh = connRef.current?.ensureConfigSyncLeaseFresh?.();
        if (leaseStillFresh === false) {
          addLog({
            ts: new Date().toISOString(),
            level: 'warn',
            msg: 'Lease past QA client now — fail-closed + reconnecting for fullConfig',
          });
        }
      }

      return data;
    } catch (err) {
      addLog({ ts: new Date().toISOString(), level: 'error', msg: `QA ${label} failed: ${err.message}` });
    } finally {
      setQaBusy(false);
    }
  }, [apiKey, addLog]);

  const handleDisconnect = useCallback(() => {
    connRef.current?.disconnect();
    connRef.current = null;
  }, []);

  const handleSendContext = useCallback(() => {
    connRef.current?.sendContext(context);
  }, [context]);

  const handleRequestFlag = useCallback(
    (key) => {
      const result = connRef.current?.requestFlag?.(key, context);
      if (!result) return;
      if (result.ok === false) {
        addLog({
          ts: new Date().toISOString(),
          level: 'warn',
          msg: `getFlag(${key}) failed: ${result.reason}`,
          data: result,
        });
        return;
      }
      // Update only the requested flag so other cards' history stays put.
      if (Object.prototype.hasOwnProperty.call(result, 'value')) {
        setFlags((prev) => ({ ...prev, [key]: result.value }));
      }
    },
    [context, addLog],
  );

  // Cleanup on unmount
  useEffect(() => () => connRef.current?.disconnect(), []);

  // ─── Context Field Handlers ─────────────────────────────────

  const addField = () => setContextFields((p) => [...p, { key: '', value: '', id: `cf-${nextId.current++}` }]);
  const removeField = (id) => setContextFields((p) => p.filter((f) => f.id !== id));
  const updateField = (id, prop, val) => setContextFields((p) => p.map((f) => f.id === id ? { ...f, [prop]: val } : f));
  const applyPreset = (key) => setContextFields(CONTEXT_PRESETS[key]());

  // ─── Flag filtering ─────────────────────────────────────────

  const flagEntries = Object.entries(flags)
    .filter(([key]) => !filterText || key.toLowerCase().includes(filterText.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const toggleExpand = (key) => {
    setExpandedFlags((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: FONT, background: t.bg, color: t.text, height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <header style={{ background: t.panel, borderBottom: `1px solid ${t.border}`, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${t.accent}, #4C1D95)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>F</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: t.textStrong, letterSpacing: '0.02em' }}>SDK Tester</span>
          <span style={{ fontSize: 11, color: t.muted, border: `1px solid ${t.borderStrong}`, borderRadius: 4, padding: '2px 8px' }}>v1.2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Tooltip
            content={themeMode === 'light' ? 'Switch the UI to dark theme' : 'Switch the UI to light theme'}
            position="bottom"
          >
            <button
              type="button"
              onClick={() => setThemeMode((m) => (m === 'light' ? 'dark' : 'light'))}
              style={S.btnGhost}
            >
              {themeMode === 'light' ? 'Dark' : 'Light'}
            </button>
          </Tooltip>
          <Tooltip content="Open a short guide for environments, stream URL, config-sync, and QA." position="bottom">
            <button
              type="button"
              onClick={() => setShowHowTo(true)}
              style={{
                ...S.btnGhost,
                color: t.accentSoft,
                borderColor: `${t.accent}66`,
                background: `${t.accent}18`,
              }}
            >
              How to use
            </button>
          </Tooltip>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATE_COLORS[connState], boxShadow: isConnected ? '0 0 8px #10B98166' : 'none', transition: 'all 0.3s' }} />
          <span style={{ fontSize: 12, color: STATE_COLORS[connState], textTransform: 'uppercase', letterSpacing: '0.08em' }}>{connState}</span>
          <span style={{ fontSize: 11, color: t.muted2, marginLeft: 4 }}>
            {ENVIRONMENTS.find((e) => e.id === envId)?.label || envId}
            {' · '}
            {TRANSPORTS.find((tr) => tr.id === transport)?.label || transport}
          </span>
          {isConnected && flagCount > 0 && (
            <span style={{ fontSize: 11, color: t.muted2, marginLeft: 8 }}>{flagCount} flag{flagCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </header>

      <HowToUsePanel open={showHowTo} onClose={() => setShowHowTo(false)} theme={t} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Panel — Config ── */}
        <aside style={{ width: 380, background: t.panel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>

          {/* Connect stays visible so collapsed sections do not bury the main action */}
          <div style={{ padding: 16, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {isConnected || isConnecting ? (
                <Tooltip multiline content={isConnecting ? 'Cancel the in-flight connect attempt.' : 'Close the stream / socket and stop reconnecting.'} fill style={{ flex: 1 }}>
                  <button onClick={handleDisconnect} style={{ ...S.btnDanger, width: '100%' }}>
                    {isConnecting ? 'Cancel' : 'Disconnect'}
                  </button>
                </Tooltip>
              ) : (
                <Tooltip multiline content="Handshake on API URL, then open SSE on Stream URL (or WS/poll on API)." fill style={{ flex: 1 }}>
                  <button onClick={handleConnect} disabled={!apiKey || !apiUrl || !streamUrl} style={{ ...S.btnPrimary, width: '100%', opacity: apiKey && apiUrl && streamUrl ? 1 : 0.4 }}>
                    Connect
                  </button>
                </Tooltip>
              )}
            </div>
            {!openSections.connection && (
              <div style={{ marginTop: 8, fontSize: 11, color: t.muted, lineHeight: 1.4 }}>
                {(ENVIRONMENTS.find((e) => e.id === envId)?.label || envId)}
                {' · '}
                {TRANSPORTS.find((tr) => tr.id === transport)?.label || transport}
                {apiKey ? ' · key set' : ' · add SDK key in Connection'}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CollapsibleSection
              title="Connection"
              summary={`${ENVIRONMENTS.find((e) => e.id === envId)?.label || envId} · ${TRANSPORTS.find((tr) => tr.id === transport)?.label || transport}`}
              open={openSections.connection}
              onToggle={() => toggleSection('connection')}
              theme={t}
            >
              <label style={S.label}>Environment</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                {ENVIRONMENTS.map(({ id, label }) => (
                  <Tooltip key={id} content={ENV_TIPS[id]} position="top" multiline fill>
                    <button
                      type="button"
                      onClick={() => !urlsLocked && applyEnvironment(id)}
                      disabled={urlsLocked}
                      style={{
                        width: '100%',
                        padding: '6px 0', fontSize: 11, borderRadius: 4,
                        border: `1px solid ${envId === id ? t.accent : t.borderStrong}`,
                        background: envId === id ? `${t.accent}22` : 'transparent',
                        color: envId === id ? t.accentSoft : t.muted,
                        cursor: urlsLocked ? 'not-allowed' : 'pointer',
                        opacity: urlsLocked ? 0.5 : 1,
                        fontFamily: FONT,
                      }}
                    >
                      {label}
                    </button>
                  </Tooltip>
                ))}
              </div>

              <label style={{ ...S.label, marginTop: 12 }}>API URL</label>
              <input
                style={{ ...S.input, opacity: isCustomEnv ? 1 : 0.75 }}
                value={apiUrl}
                onChange={(e) => {
                  setEnvId('custom');
                  setApiUrl(e.target.value);
                }}
                placeholder="https://staging-api.flagmint.com"
                disabled={urlsLocked}
                readOnly={!isCustomEnv}
              />
              <div style={{ fontSize: 10, color: t.muted2, marginTop: 4, lineHeight: 1.4 }}>
                Handshake, context, QA, REST
              </div>

              <label style={{ ...S.label, marginTop: 12 }}>Stream URL</label>
              <input
                style={{ ...S.input, opacity: isCustomEnv ? 1 : 0.75 }}
                value={streamUrl}
                onChange={(e) => {
                  setEnvId('custom');
                  setStreamUrl(e.target.value);
                }}
                placeholder="https://staging-stream.flagmint.com"
                disabled={urlsLocked}
                readOnly={!isCustomEnv}
              />
              <div style={{ fontSize: 10, color: t.muted2, marginTop: 4, lineHeight: 1.4 }}>
                SSE EventSource only (test stream host / CF bypass)
              </div>

              <label style={{ ...S.label, marginTop: 12 }}>SDK Key</label>
              <input style={S.input} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ff_your_api_key" type="password" disabled={isConnected || isConnecting} />

              <label style={{ ...S.label, marginTop: 12 }}>Transport</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {TRANSPORTS.map(({ id, label, tip }) => (
                  <Tooltip key={id} content={tip} position="top" multiline fill style={{ flex: 1 }}>
                    <button
                      type="button"
                      onClick={() => !isConnected && !isConnecting && setTransport(id)}
                      disabled={isConnected || isConnecting}
                      style={{
                        width: '100%', padding: '6px 0', fontSize: 12, borderRadius: 4,
                        border: `1px solid ${transport === id ? t.accent : t.borderStrong}`,
                        background: transport === id ? `${t.accent}22` : 'transparent',
                        color: transport === id ? t.accentSoft : t.muted,
                        cursor: isConnected || isConnecting ? 'not-allowed' : 'pointer',
                        opacity: isConnected || isConnecting ? 0.5 : 1,
                        fontFamily: FONT,
                      }}
                    >
                      {label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Config sync"
              summary={
                syncMode === 'legacy'
                  ? 'Legacy flags'
                  : syncMode === 'config' && leaseInfo
                    ? (isLocalLeaseExpired({ expiresAt: leaseInfo.expiresAt }) ? 'Rules expired' : 'Flags ready')
                    : 'fullConfig / deltas'
              }
              open={openSections.configSync}
              onToggle={() => toggleSection('configSync')}
              theme={t}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { id: 'legacy', label: 'Legacy flags' },
                  { id: 'config', label: 'fullConfig / deltas' },
                ].map(({ id, label }) => (
                  <Tooltip key={id} content={SYNC_TIPS[id]} position="top" multiline fill style={{ flex: 1 }}>
                    <button
                      type="button"
                      onClick={() => !isConnected && !isConnecting && setSyncMode(id)}
                      disabled={isConnected || isConnecting}
                      style={{
                        width: '100%', padding: '6px 0', fontSize: 11, borderRadius: 4,
                        border: `1px solid ${syncMode === id ? t.accent : t.borderStrong}`,
                        background: syncMode === id ? `${t.accent}22` : 'transparent',
                        color: syncMode === id ? t.accentSoft : t.muted,
                        cursor: isConnected || isConnecting ? 'not-allowed' : 'pointer',
                        fontFamily: FONT,
                      }}
                    >
                      {label}
                    </button>
                  </Tooltip>
                ))}
              </div>
              {syncMode === 'config' && (
                <div style={{ marginTop: 10, fontSize: 12, color: t.text, lineHeight: 1.5 }}>
                  {(() => {
                    void qaClockEpoch;
                    const cache = apiKey ? loadLocalConfigCache(apiKey) : null;
                    const leaseExpiresAt = leaseInfo?.expiresAt ?? cache?.expiresAt;
                    const expired = !leaseExpiresAt || isLocalLeaseExpired({ expiresAt: leaseExpiresAt });
                    const clientClock = getQaClientClockState();
                    const plain = configSyncPlainStatus({
                      cache,
                      leaseExpiresAt,
                      expired,
                      transport,
                      clientOffsetMs: clientClock.offsetMs,
                    });
                    return (
                      <>
                        <div style={{ fontWeight: 600, color: expired || transport !== 'sse' ? '#F59E0B' : t.accentSoft }}>
                          {plain.headline}
                        </div>
                        {plain.detail && (
                          <div style={{ marginTop: 4, fontSize: 11, color: t.muted }}>{plain.detail}</div>
                        )}
                        {plain.warn && (
                          <div style={{ marginTop: 4, fontSize: 11, color: '#F59E0B' }}>{plain.warn}</div>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowConfigSyncDetails((v) => !v)}
                          style={{
                            marginTop: 8,
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            color: t.accentSoft,
                            fontSize: 11,
                            fontFamily: FONT,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {showConfigSyncDetails ? 'Hide technical details' : 'Show technical details'}
                        </button>
                        {showConfigSyncDetails && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: 8,
                              borderRadius: 6,
                              border: `1px solid ${t.border}`,
                              background: t.panelAlt || 'transparent',
                              fontSize: 11,
                              color: t.muted,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              lineHeight: 1.45,
                            }}
                          >
                            <div>
                              localCache: {cache ? `v${cache.version}` : 'empty'}
                              {expired ? ' (expired/missing → fullConfig)' : ' → sinceVersion'}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              {expired
                                ? 'lease expired → fail-closed defaults + reconnect'
                                : 'SSE + ECDH MAC verify → local eval'}
                            </div>
                            {leaseExpiresAt != null && (
                              <div style={{ color: t.accentSoft, marginTop: 4 }}>
                                lease exp {new Date(leaseExpiresAt).toISOString()}
                              </div>
                            )}
                            {clientClock.offsetMs !== 0 && (
                              <div style={{ marginTop: 4, color: '#F59E0B' }}>
                                QA client now {clientClock.effectiveNowIso} (offset {clientClock.offsetMs}ms)
                              </div>
                            )}
                            {configMeta && (
                              <div style={{ marginTop: 4 }}>
                                last: {configMeta.type}
                                {configMeta.version != null ? ` @ v${configMeta.version}` : ''}
                                {configMeta.warnings?.length ? ` ⚠ ${configMeta.warnings.length}` : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="QA (clock / data)"
              summary="Clock · Replay · Clear"
              open={openSections.qa}
              onToggle={() => toggleSection('qa')}
              theme={t}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {QA_ACTIONS.map((action) => {
                  const disabled = !apiKey || qaBusy;
                  return (
                    <Tooltip key={action.id} content={action.tip} position="top" multiline maxWidth={240} fill>
                      <button
                        type="button"
                        disabled={disabled}
                        style={{
                          ...S.btnQa,
                          opacity: disabled ? 0.45 : 1,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => {
                          const [label, fn] = action.run(apiUrl, apiKey);
                          runQa(label, fn, { syncsClientClock: !!action.syncsClientClock });
                        }}
                      >
                        {action.label}
                      </button>
                    </Tooltip>
                  );
                })}
                <Tooltip
                  content="Remove this browser’s cached rules/lease so the next connect requests fullConfig (cold start)."
                  position="top"
                  multiline
                  maxWidth={240}
                  fill
                  style={{ gridColumn: '1 / -1' }}
                >
                  <button
                    type="button"
                    disabled={!apiKey}
                    style={{
                      ...S.btnQa,
                      opacity: !apiKey ? 0.45 : 1,
                      cursor: !apiKey ? 'not-allowed' : 'pointer',
                    }}
                    onClick={() => {
                      clearLocalConfigCache(apiKey);
                      setLeaseInfo(null);
                      setConfigMeta(null);
                      addLog({ ts: new Date().toISOString(), level: 'info', msg: 'Cleared localConfig cache' });
                    }}
                  >
                    Clear localCache
                  </button>
                </Tooltip>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Evaluation context"
              summary={
                contextFields.filter((f) => f.key).length
                  ? `${contextFields.filter((f) => f.key).length} field${contextFields.filter((f) => f.key).length === 1 ? '' : 's'}`
                  : 'Empty'
              }
              open={openSections.context}
              onToggle={() => toggleSection('context')}
              theme={t}
              flex
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['User', 'simple_user'], ['Multi', 'multi_context'], ['Empty', 'empty']].map(([label, key]) => (
                    <Tooltip key={key} content={PRESET_TIPS[key]} position="bottom">
                      <button type="button" onClick={() => applyPreset(key)} style={S.preset}>{label}</button>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {contextFields.map((field) => (
                <div key={field.id} style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <input
                    style={{ ...S.input, flex: 2, fontSize: 11, padding: '5px 8px' }}
                    value={field.key} onChange={(e) => updateField(field.id, 'key', e.target.value)} placeholder="key"
                  />
                  <input
                    style={{ ...S.input, flex: 3, fontSize: 11, padding: '5px 8px' }}
                    value={field.value} onChange={(e) => updateField(field.id, 'value', e.target.value)} placeholder="value"
                  />
                  <Tooltip content="Remove this context field" position="left">
                    <button type="button" onClick={() => removeField(field.id)} style={{ background: 'none', border: 'none', color: t.muted, cursor: 'pointer', fontSize: 16, padding: '0 4px', fontFamily: FONT }}>
                      ×
                    </button>
                  </Tooltip>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Tooltip content="Add another key/value pair to the evaluation context." fill style={{ flex: 1 }}>
                  <button type="button" onClick={addField} style={{ ...S.btnGhost, width: '100%' }}>+ Add Field</button>
                </Tooltip>
                {isConnected && (
                  <Tooltip content="Push the current context to the connection (triggers re-eval / stream update)." fill style={{ flex: 1 }}>
                    <button type="button" onClick={handleSendContext} style={{ ...S.btnPrimary, width: '100%', fontSize: 11 }}>
                      Send Context
                    </button>
                  </Tooltip>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                <span style={{ ...S.label, fontSize: 10, color: t.muted2 }}>CONTEXT PREVIEW</span>
                <pre style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 4, padding: 10, fontSize: 10, color: t.code, marginTop: 4, overflowX: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(context, null, 2)}
                </pre>
              </div>
            </CollapsibleSection>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.panel, padding: '0 16px', flexShrink: 0 }}>
            {[['flags', `Flags (${flagCount})`, 'Live flag values from the stream (or last poll).'], ['log', `Log (${logs.length})`, 'Connection, handshake, QA, and eval event log.']].map(([key, label, tip]) => (
              <Tooltip key={key} content={tip} position="bottom" multiline>
                <button
                  type="button"
                  onClick={() => setActiveTab(key)}
                  style={{
                    padding: '10px 16px', fontSize: 12, background: 'none', border: 'none',
                    borderBottom: activeTab === key ? `2px solid ${t.accent}` : '2px solid transparent',
                    color: activeTab === key ? t.textStrong : t.muted, cursor: 'pointer', marginBottom: -1, fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
              </Tooltip>
            ))}
          </div>

          {/* ── Flags Tab ── */}
          {activeTab === 'flags' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {flagCount === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: t.muted2 }}>
                  <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>⚑</div>
                  <div style={{ fontSize: 14, marginBottom: 6 }}>No flags received yet</div>
                  <div style={{ fontSize: 12 }}>
                    {isConnected
                      ? transport === 'sse'
                        ? 'Connected — waiting for a flags event on the stream. Try Send Context or toggle a flag in the dashboard.'
                        : 'Connected — waiting for flag data. Try sending a context update.'
                      : 'Enter your SDK key and connect to see flags.'}
                  </div>
                </div>
              ) : (
                <>
                  <input
                    style={{ ...S.input, maxWidth: 320, marginBottom: 12 }}
                    placeholder="Filter flags…" value={filterText} onChange={(e) => setFilterText(e.target.value)}
                  />

                  {flagEntries.length === 0 && filterText && (
                    <div style={{ color: t.muted2, fontSize: 12, padding: 20 }}>No flags matching "{filterText}"</div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {flagEntries.map(([key, val]) => {
                      const type = flagTypeLabel(val);
                      const colors = TYPE_COLORS[type] || TYPE_COLORS.null;
                      const isExp = expandedFlags.has(key);
                      const history = flagHistory[key] || [];

                      return (
                        <div key={key} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
                          {/* Flag Row */}
                          <div onClick={() => toggleExpand(key)} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', gap: 10 }}>
                            <span style={{ color: t.muted2, fontSize: 10, transform: isExp ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
                            <span style={{ fontWeight: 600, fontSize: 13, color: t.textStrong, flex: 1 }}>{key}</span>
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: `${colors.bg}22`, color: colors.text, border: `1px solid ${colors.dot}33` }}>
                              {type}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: typeof val === 'boolean' ? (val ? '#10B981' : '#EF4444') : t.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {flagValueShort(val)}
                            </span>
                          </div>

                          {/* Expanded Detail */}
                          {isExp && (
                            <div style={{ borderTop: `1px solid ${t.border}`, padding: '12px 14px', background: t.panelAlt }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: t.muted2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Value</span>
                                <Tooltip
                                  content={
                                    syncMode === 'config'
                                      ? 'Local getFlag(key) with sidebar context (call-site eval proof).'
                                      : 'Legacy: logs a call-site request; value comes from last server snapshot.'
                                  }
                                  position="left"
                                  multiline
                                >
                                  <button
                                    type="button"
                                    disabled={!isConnected}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRequestFlag(key);
                                    }}
                                    style={{
                                      ...S.preset,
                                      fontSize: 11,
                                      padding: '4px 10px',
                                      opacity: isConnected ? 1 : 0.45,
                                      cursor: isConnected ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    Evaluate
                                  </button>
                                </Tooltip>
                              </div>
                              <pre style={{ fontSize: 11, color: t.code, margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {flagValueDisplay(val)}
                              </pre>

                              {history.length > 1 && (
                                <div style={{ marginTop: 12, borderTop: `1px solid ${t.border}`, paddingTop: 10 }}>
                                  <span style={{ fontSize: 10, color: t.muted2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Change History</span>
                                  {history.map((h, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11, marginTop: 4, color: t.muted }}>
                                      <span style={{ color: t.muted2, flexShrink: 0 }}>{new Date(h.ts).toLocaleTimeString()}</span>
                                      <span style={{ color: i === history.length - 1 ? '#10B981' : t.muted, fontWeight: i === history.length - 1 ? 600 : 400 }}>
                                        {JSON.stringify(h.value)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Log Tab ── */}
          {activeTab === 'log' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
                  Show debug
                </label>
                <Tooltip content="Clear all log entries from this session." position="left">
                  <button type="button" onClick={() => setLogs([])} style={S.preset}>Clear</button>
                </Tooltip>
              </div>

              <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                {logs
                  .filter((l) => showDebug || l.level !== 'debug')
                  .map((entry, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, color: logColor(entry.level) }}>
                      <span style={{ color: t.muted2, flexShrink: 0, width: 72 }}>
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                      <span style={{ flexShrink: 0, width: 40, textTransform: 'uppercase', fontSize: 10, lineHeight: '20px' }}>
                        {entry.level}
                      </span>
                      <span style={{ flex: 1 }}>
                        {entry.msg}
                        {entry.data && (
                          <details style={{ display: 'inline', marginLeft: 6 }}>
                            <summary style={{ color: t.muted2, cursor: 'pointer', display: 'inline', fontSize: 10 }}>[data]</summary>
                            <pre style={{ fontSize: 10, color: t.muted2, marginTop: 2, whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(entry.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </span>
                    </div>
                  ))}
                <div ref={logEndRef} />
              </div>

              {logs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: t.muted2, fontSize: 12 }}>
                  No log entries yet. Connect to start seeing protocol traffic.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
