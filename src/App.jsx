import { useState, useEffect, useCallback, useRef } from 'react';
import { createFlagmintConnection, CONNECTION_STATES } from './connection';
import { buildContextFromFields, CONTEXT_PRESETS, flagTypeLabel, flagValueDisplay, flagValueShort, TYPE_COLORS, logColor } from './helpers';
import {
  clearLocalConfigCache,
  isLocalLeaseExpired,
  loadLocalConfigCache,
  qaAdvanceClock,
  qaClearConfig,
  qaGetClock,
  qaGetState,
  qaReplayCompile,
  qaResetClock,
  saveLocalConfigCache,
} from './qa';

// ─── Shared Style Constants ─────────────────────────────────────

const PURPLE = '#7C3AED';
const FONT = "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

const S = {
  label: { fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 },
  input: { width: '100%', padding: '7px 10px', fontSize: 12, background: '#0B0E14', border: '1px solid #1E2533', borderRadius: 4, color: '#E5E7EB', outline: 'none', fontFamily: FONT, boxSizing: 'border-box' },
  btnPrimary: { padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 4, border: 'none', background: PURPLE, color: '#fff', cursor: 'pointer', fontFamily: FONT },
  btnDanger: { padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 4, border: '1px solid #EF4444', background: '#EF444422', color: '#EF4444', cursor: 'pointer', fontFamily: FONT },
  btnGhost: { padding: '6px 12px', fontSize: 11, borderRadius: 4, border: '1px solid #2A3040', background: 'transparent', color: '#6B7280', cursor: 'pointer', fontFamily: FONT },
  preset: { padding: '2px 8px', fontSize: 10, borderRadius: 3, border: '1px solid #2A3040', background: 'transparent', color: '#6B7280', cursor: 'pointer', fontFamily: FONT },
};

const STATE_COLORS = {
  [CONNECTION_STATES.CONNECTED]: '#10B981',
  [CONNECTION_STATES.CONNECTING]: '#F59E0B',
  [CONNECTION_STATES.DISCONNECTED]: '#6B7280',
  [CONNECTION_STATES.ERROR]: '#EF4444',
};

const TRANSPORTS = [
  { id: 'sse', label: 'SSE' },
  { id: 'websocket', label: 'WebSocket' },
  { id: 'long-polling', label: 'Polling' },
];

// ─── App ────────────────────────────────────────────────────────

export default function App() {
  // Config
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('fm_tester_url') || 'http://localhost:3000');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('fm_tester_key') || '');
  const [transport, setTransport] = useState(() => localStorage.getItem('fm_tester_transport') || 'sse');
  const [syncMode, setSyncMode] = useState(() => localStorage.getItem('fm_tester_sync_mode') || 'legacy');
  const [leaseInfo, setLeaseInfo] = useState(null);
  const [configMeta, setConfigMeta] = useState(null);
  const [qaBusy, setQaBusy] = useState(false);

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

  const connRef = useRef(null);
  const logEndRef = useRef(null);
  const nextId = useRef(10);

  const isConnected = connState === CONNECTION_STATES.CONNECTED;
  const isConnecting = connState === CONNECTION_STATES.CONNECTING;
  const flagCount = Object.keys(flags).length;

  // Persist URL and key
  useEffect(() => { localStorage.setItem('fm_tester_url', apiUrl); }, [apiUrl]);
  useEffect(() => { localStorage.setItem('fm_tester_key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('fm_tester_transport', transport); }, [transport]);
  useEffect(() => { localStorage.setItem('fm_tester_sync_mode', syncMode); }, [syncMode]);

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
        saveLocalConfigCache(apiKey, {
          ...prev,
          expiresAt: lease.expiresAt ?? prev.expiresAt,
          serverNow: lease.serverNow,
          signature: lease.signature,
        });
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
        saveLocalConfigCache(apiKey, {
          ...prev,
          version: snapshot.version,
          expiresAt: snapshot.expiresAt ?? prev.expiresAt,
          flags: snapshot.flags,
          segments: snapshot.segments,
          updatedAt: new Date().toISOString(),
          lastPayloadType: 'rulesSnapshot',
        });
      },
    });
    connRef.current = conn;
    conn.connect(context);
  }, [apiUrl, apiKey, transport, syncMode, context, addLog]);

  const runQa = useCallback(async (label, fn) => {
    if (!apiKey) return;
    setQaBusy(true);
    try {
      const data = await fn();
      addLog({ ts: new Date().toISOString(), level: 'info', msg: `QA ${label}`, data });
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
      if (result.legacy) {
        return;
      }
      // Update only the requested flag so other cards' history stays put.
      setFlags((prev) => ({ ...prev, [key]: result.value }));
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
    <div style={{ fontFamily: FONT, background: '#0B0E14', color: '#C5CDD9', height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <header style={{ background: '#111620', borderBottom: '1px solid #1E2533', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #7C3AED, #4C1D95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>F</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#E5E7EB', letterSpacing: '0.02em' }}>SDK Tester</span>
          <span style={{ fontSize: 11, color: '#6B7280', border: '1px solid #2A3040', borderRadius: 4, padding: '2px 8px' }}>v1.0</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATE_COLORS[connState], boxShadow: isConnected ? '0 0 8px #10B98166' : 'none', transition: 'all 0.3s' }} />
          <span style={{ fontSize: 12, color: STATE_COLORS[connState], textTransform: 'uppercase', letterSpacing: '0.08em' }}>{connState}</span>
          <span style={{ fontSize: 11, color: '#4B5563', marginLeft: 4 }}>
            {TRANSPORTS.find((t) => t.id === transport)?.label || transport}
          </span>
          {isConnected && flagCount > 0 && (
            <span style={{ fontSize: 11, color: '#4B5563', marginLeft: 8 }}>{flagCount} flag{flagCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Panel — Config ── */}
        <aside style={{ width: 380, background: '#111620', borderRight: '1px solid #1E2533', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* Connection */}
          <div style={{ padding: 16, borderBottom: '1px solid #1E2533' }}>
            <label style={S.label}>API URL</label>
            <input style={S.input} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:3000" disabled={isConnected || isConnecting} />

            <label style={{ ...S.label, marginTop: 12 }}>SDK Key</label>
            <input style={S.input} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ff_your_api_key" type="password" disabled={isConnected || isConnecting} />

            <label style={{ ...S.label, marginTop: 12 }}>Transport</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {TRANSPORTS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => !isConnected && !isConnecting && setTransport(id)}
                  disabled={isConnected || isConnecting}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 4,
                    border: `1px solid ${transport === id ? PURPLE : '#2A3040'}`,
                    background: transport === id ? `${PURPLE}22` : 'transparent',
                    color: transport === id ? '#A78BFA' : '#6B7280',
                    cursor: isConnected || isConnecting ? 'not-allowed' : 'pointer',
                    opacity: isConnected || isConnecting ? 0.5 : 1,
                    fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              {isConnected || isConnecting ? (
                <button onClick={handleDisconnect} style={{ ...S.btnDanger, flex: 1 }}>
                  {isConnecting ? 'Cancel' : 'Disconnect'}
                </button>
              ) : (
                <button onClick={handleConnect} disabled={!apiKey} style={{ ...S.btnPrimary, flex: 1, opacity: apiKey ? 1 : 0.4 }}>
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* Config sync + QA */}
          <div style={{ padding: 16, borderBottom: '1px solid #1E2533' }}>
            <span style={S.label}>Config sync</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {[
                { id: 'legacy', label: 'Legacy flags' },
                { id: 'config', label: 'fullConfig / deltas' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => !isConnected && !isConnecting && setSyncMode(id)}
                  disabled={isConnected || isConnecting}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 11, borderRadius: 4,
                    border: `1px solid ${syncMode === id ? PURPLE : '#2A3040'}`,
                    background: syncMode === id ? `${PURPLE}22` : 'transparent',
                    color: syncMode === id ? '#A78BFA' : '#6B7280',
                    cursor: isConnected || isConnecting ? 'not-allowed' : 'pointer',
                    fontFamily: FONT,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {syncMode === 'config' && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#6B7280', lineHeight: 1.45 }}>
                {(() => {
                  const cache = apiKey ? loadLocalConfigCache(apiKey) : null;
                  const expired = !cache || isLocalLeaseExpired(cache);
                  return (
                    <>
                      <div>localCache: {cache ? `v${cache.version}` : 'empty'}{expired ? ' (expired/missing → fullConfig)' : ' → sinceVersion'}</div>
                      <div style={{ marginTop: 4 }}>SSE + ECDH MAC verify → local eval (not defaults-only)</div>
                      {leaseInfo && (
                        <div style={{ color: '#A78BFA', marginTop: 4 }}>
                          lease exp {new Date(leaseInfo.expiresAt).toISOString()}
                        </div>
                      )}
                      {configMeta && (
                        <div style={{ marginTop: 4 }}>
                          last: {configMeta.type}
                          {configMeta.version != null ? ` @ v${configMeta.version}` : ''}
                          {configMeta.warnings?.length ? ` ⚠ ${configMeta.warnings.length}` : ''}
                        </div>
                      )}
                      {transport !== 'sse' && (
                        <div style={{ color: '#F59E0B', marginTop: 4 }}>
                          Use SSE transport for config-sync ECDH / local eval
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <span style={{ ...S.label, marginTop: 14 }}>QA (clock / data)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('clock', () => qaGetClock(apiUrl, apiKey))}
              >
                Clock
              </button>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('+25h', () => qaAdvanceClock(apiUrl, apiKey, { hours: 25 }))}
              >
                +25h
              </button>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('reset clock', () => qaResetClock(apiUrl, apiKey))}
              >
                Reset clock
              </button>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('state', () => qaGetState(apiUrl, apiKey))}
              >
                Server state
              </button>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('clear Redis rules', () => qaClearConfig(apiUrl, apiKey))}
              >
                Clear server
              </button>
              <button
                disabled={!apiKey || qaBusy}
                style={S.btnGhost}
                onClick={() => runQa('replay compile', () => qaReplayCompile(apiUrl, apiKey))}
              >
                Replay
              </button>
              <button
                disabled={!apiKey}
                style={{ ...S.btnGhost, gridColumn: '1 / -1' }}
                onClick={() => {
                  clearLocalConfigCache(apiKey);
                  setLeaseInfo(null);
                  setConfigMeta(null);
                  addLog({ ts: new Date().toISOString(), level: 'info', msg: 'Cleared localConfig cache' });
                }}
              >
                Clear localCache
              </button>
            </div>
          </div>

          {/* Context */}
          <div style={{ padding: 16, flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={S.label}>Evaluation Context</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['User', 'simple_user'], ['Multi', 'multi_context'], ['Empty', 'empty']].map(([label, key]) => (
                  <button key={key} onClick={() => applyPreset(key)} style={S.preset}>{label}</button>
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
                <button onClick={() => removeField(field.id)} style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 16, padding: '0 4px', fontFamily: FONT }}>
                  ×
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={addField} style={{ ...S.btnGhost, flex: 1 }}>+ Add Field</button>
              {isConnected && (
                <button onClick={handleSendContext} style={{ ...S.btnPrimary, flex: 1, fontSize: 11 }}>
                  Send Context
                </button>
              )}
            </div>

            {/* Preview */}
            <div style={{ marginTop: 16 }}>
              <span style={{ ...S.label, fontSize: 10, color: '#4B5563' }}>CONTEXT PREVIEW</span>
              <pre style={{ background: '#0B0E14', border: '1px solid #1E2533', borderRadius: 4, padding: 10, fontSize: 10, color: '#8B949E', marginTop: 4, overflowX: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(context, null, 2)}
              </pre>
            </div>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1E2533', background: '#111620', padding: '0 16px', flexShrink: 0 }}>
            {[['flags', `Flags (${flagCount})`], ['log', `Log (${logs.length})`]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: '10px 16px', fontSize: 12, background: 'none', border: 'none',
                  borderBottom: activeTab === key ? `2px solid ${PURPLE}` : '2px solid transparent',
                  color: activeTab === key ? '#E5E7EB' : '#6B7280', cursor: 'pointer', marginBottom: -1, fontFamily: FONT,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Flags Tab ── */}
          {activeTab === 'flags' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {flagCount === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4B5563' }}>
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
                    <div style={{ color: '#4B5563', fontSize: 12, padding: 20 }}>No flags matching "{filterText}"</div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {flagEntries.map(([key, val]) => {
                      const type = flagTypeLabel(val);
                      const colors = TYPE_COLORS[type] || TYPE_COLORS.null;
                      const isExp = expandedFlags.has(key);
                      const history = flagHistory[key] || [];

                      return (
                        <div key={key} style={{ background: '#111620', border: '1px solid #1E2533', borderRadius: 6, overflow: 'hidden' }}>
                          {/* Flag Row */}
                          <div onClick={() => toggleExpand(key)} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', gap: 10 }}>
                            <span style={{ color: '#4B5563', fontSize: 10, transform: isExp ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
                            <span style={{ fontWeight: 600, fontSize: 13, color: '#E5E7EB', flex: 1 }}>{key}</span>
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: `${colors.bg}22`, color: colors.text, border: `1px solid ${colors.dot}33` }}>
                              {type}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: typeof val === 'boolean' ? (val ? '#10B981' : '#EF4444') : '#C5CDD9', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {flagValueShort(val)}
                            </span>
                          </div>

                          {/* Expanded Detail */}
                          {isExp && (
                            <div style={{ borderTop: '1px solid #1E2533', padding: '12px 14px', background: '#0D1017' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Value</span>
                                <button
                                  type="button"
                                  title={
                                    syncMode === 'config'
                                      ? 'Local getFlag(key) with sidebar context (call-site eval proof)'
                                      : 'Legacy: logs a call-site request; value comes from last server snapshot'
                                  }
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
                              </div>
                              <pre style={{ fontSize: 11, color: '#8B949E', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {flagValueDisplay(val)}
                              </pre>

                              {history.length > 1 && (
                                <div style={{ marginTop: 12, borderTop: '1px solid #1E2533', paddingTop: 10 }}>
                                  <span style={{ fontSize: 10, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Change History</span>
                                  {history.map((h, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11, marginTop: 4, color: '#6B7280' }}>
                                      <span style={{ color: '#4B5563', flexShrink: 0 }}>{new Date(h.ts).toLocaleTimeString()}</span>
                                      <span style={{ color: i === history.length - 1 ? '#10B981' : '#6B7280', fontWeight: i === history.length - 1 ? 600 : 400 }}>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6B7280', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
                  Show debug
                </label>
                <button onClick={() => setLogs([])} style={S.preset}>Clear</button>
              </div>

              <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                {logs
                  .filter((l) => showDebug || l.level !== 'debug')
                  .map((entry, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, color: logColor(entry.level) }}>
                      <span style={{ color: '#4B5563', flexShrink: 0, width: 72 }}>
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                      <span style={{ flexShrink: 0, width: 40, textTransform: 'uppercase', fontSize: 10, lineHeight: '20px' }}>
                        {entry.level}
                      </span>
                      <span style={{ flex: 1 }}>
                        {entry.msg}
                        {entry.data && (
                          <details style={{ display: 'inline', marginLeft: 6 }}>
                            <summary style={{ color: '#4B5563', cursor: 'pointer', display: 'inline', fontSize: 10 }}>[data]</summary>
                            <pre style={{ fontSize: 10, color: '#4B5563', marginTop: 2, whiteSpace: 'pre-wrap' }}>
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
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4B5563', fontSize: 12 }}>
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
