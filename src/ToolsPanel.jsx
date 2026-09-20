import { FONT } from './uiTheme';

/**
 * Tools tab: live patch inspection, track events, REST config, tamper demo, coverage.
 *
 * @param {{
 *   theme: Record<string, string>,
 *   styles: Record<string, unknown>,
 *   lastPatch: object|null,
 *   syncMode: string,
 *   isConnected: boolean,
 *   apiKey: string,
 *   flagKeys: string[],
 *   trackFlagKey: string,
 *   setTrackFlagKey: (v: string) => void,
 *   trackEventName: string,
 *   setTrackEventName: (v: string) => void,
 *   trackKind: string,
 *   setTrackKind: (v: string) => void,
 *   onSendTrack: () => void,
 *   restSinceVersion: string,
 *   setRestSinceVersion: (v: string) => void,
 *   onFetchRestConfig: () => void,
 *   onProveTamper: () => void,
 *   restResult: object|null,
 * }} props
 */
export function ToolsPanel({
  theme: t,
  styles: S,
  lastPatch,
  syncMode,
  isConnected,
  apiKey,
  flagKeys,
  trackFlagKey,
  setTrackFlagKey,
  trackEventName,
  setTrackEventName,
  trackKind,
  setTrackKind,
  onSendTrack,
  restSinceVersion,
  setRestSinceVersion,
  onFetchRestConfig,
  onProveTamper,
  restResult,
}) {
  const section = {
    marginBottom: 20,
    padding: 14,
    borderRadius: 8,
    border: `1px solid ${t.border}`,
    background: t.panelAlt,
  };
  const h = {
    fontSize: 12,
    fontWeight: 600,
    color: t.textStrong,
    marginBottom: 8,
    fontFamily: FONT,
  };
  const hint = { fontSize: 11, color: t.muted, lineHeight: 1.45, marginBottom: 10 };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={section}>
        <div style={h}>Live patch inspection</div>
        <div style={hint}>
          After a verified <code>fullConfig</code> / <code>delta</code> / <code>deltas</code>, upserts, deletes, and segment ids show here — no log digging.
        </div>
        {!lastPatch ? (
          <div style={{ fontSize: 12, color: t.muted2 }}>No config event yet. Connect in fullConfig / deltas and wait for lease or rules.</div>
        ) : (
          <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, color: lastPatch.ok ? t.accentSoft : '#F59E0B' }}>
              {lastPatch.headline}
              {!lastPatch.ok && lastPatch.reason ? ` — ${lastPatch.reason}` : ''}
            </div>
            <div style={{ fontSize: 11, color: t.muted, marginTop: 4 }}>
              {lastPatch.receivedAt}
              {lastPatch.fromVersion != null && lastPatch.toVersion != null
                ? ` · v${lastPatch.fromVersion} → v${lastPatch.toVersion}`
                : lastPatch.version != null
                  ? ` · v${lastPatch.version}`
                  : ''}
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <PatchList label="Upserts (flags added/updated)" items={lastPatch.upsertKeys} empty="None" theme={t} />
              <PatchList label="Deletes (flags removed)" items={lastPatch.deleteKeys} empty="None" theme={t} />
              <PatchList label="Segments in payload" items={lastPatch.segmentIds} empty="None" theme={t} />
            </div>
          </div>
        )}
      </div>

      <div style={section}>
        <div style={h}>Track events (custom / error)</div>
        <div style={hint}>
          Fire application events to <code>/evaluator/events</code> (goals and app errors). Evaluate already sends <code>kind=evaluation</code> automatically.
        </div>
        <label style={S.label}>Kind</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['custom', 'error'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTrackKind(k)}
              style={{
                ...S.preset,
                borderColor: trackKind === k ? t.accent : t.borderStrong,
                color: trackKind === k ? t.accentSoft : t.muted,
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <label style={S.label}>Flag key</label>
        <input
          list="fm-track-flag-keys"
          style={S.input}
          value={trackFlagKey}
          onChange={(e) => setTrackFlagKey(e.target.value)}
          placeholder={flagKeys[0] || 'homepage_variant'}
        />
        <datalist id="fm-track-flag-keys">
          {flagKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        {trackKind === 'custom' && (
          <>
            <label style={{ ...S.label, marginTop: 10 }}>Event name</label>
            <input
              style={S.input}
              value={trackEventName}
              onChange={(e) => setTrackEventName(e.target.value)}
              placeholder="goal_clicked"
            />
          </>
        )}
        <button
          type="button"
          onClick={onSendTrack}
          disabled={!trackFlagKey.trim() || (trackKind === 'custom' && !trackEventName.trim())}
          style={{
            ...S.btnPrimary,
            marginTop: 12,
            width: '100%',
            opacity: !trackFlagKey.trim() || (trackKind === 'custom' && !trackEventName.trim()) ? 0.45 : 1,
          }}
        >
          Send {trackKind} event
        </button>
      </div>

      <div style={section}>
        <div style={h}>Same version check (REST)</div>
        <div style={hint}>
          Quick way to prove: “I already have rules version N — give me a lease only, not the whole rulebook again.”
          <br />
          <br />
          Type your current version number below (from Config sync → Show technical details, e.g. <code>v3</code> → enter <code>3</code>). Leave blank if you want a full rules download instead.
          <br />
          <br />
          You do not need to be connected to the live stream for this.
        </div>
        <label style={S.label}>Version you already have (optional)</label>
        <input
          style={S.input}
          value={restSinceVersion}
          onChange={(e) => setRestSinceVersion(e.target.value)}
          placeholder="e.g. 3"
          inputMode="numeric"
        />
        <button
          type="button"
          onClick={onFetchRestConfig}
          disabled={!apiKey}
          style={{
            ...S.btnPrimary,
            marginTop: 12,
            width: '100%',
            opacity: !apiKey ? 0.45 : 1,
          }}
        >
          Check now
        </button>
        {!apiKey && (
          <div style={{ ...hint, marginTop: 8, marginBottom: 0 }}>Paste an SDK key first.</div>
        )}
        {restResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: t.text, lineHeight: 1.5 }}>
            {restResult.ok ? (
              <>
                <div style={{ fontWeight: 600, color: t.accentSoft }}>
                  {restResult.payload?.type === 'lease'
                    ? 'Pass — server sent a lease only (you are already up to date).'
                    : restResult.payload?.type === 'fullConfig'
                      ? 'Got a full rules copy (no version typed, or server needed a refresh).'
                      : restResult.payload?.type === 'deltas'
                        ? 'Got catch-up updates (your version was behind).'
                        : `Got type: ${restResult.payload?.type ?? 'unknown'}`}
                </div>
                <div style={{ fontSize: 11, color: t.muted, marginTop: 4 }}>
                  Signature check: {restResult.verified ? 'valid' : 'not verified'}
                  {restResult.payload?.version != null ? ` · server version ${restResult.payload.version}` : ''}
                </div>
              </>
            ) : (
              <div style={{ fontWeight: 600, color: '#F59E0B' }}>
                Could not check — {restResult.error || 'see log for details'}
              </div>
            )}
          </div>
        )}
        {restResult && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11, color: t.accentSoft, cursor: 'pointer' }}>Show raw response</summary>
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                fontSize: 10,
                color: restResult.ok ? t.code : '#F59E0B',
                background: t.bg,
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 180,
              }}
            >
              {JSON.stringify(restResult, null, 2)}
            </pre>
          </details>
        )}
      </div>

      <div style={section}>
        <div style={h}>Tamper / bad-signature demo</div>
        <div style={hint}>
          Flips one character of the last signed payload’s signature and tries to apply it. A correct client must <strong>reject</strong> it.
        </div>
        <button
          type="button"
          onClick={onProveTamper}
          disabled={syncMode !== 'config' || !isConnected}
          style={{
            ...S.btnDanger,
            width: '100%',
            opacity: syncMode !== 'config' || !isConnected ? 0.45 : 1,
          }}
        >
          Prove bad signature is rejected
        </button>
      </div>

      <div style={section}>
        <div style={h}>Coverage — what this tester is (and is not)</div>
        <div style={hint}>
          This app speaks the <strong>wire protocol</strong> plus vendored config-sync modules. That is intentional: you are testing the server contract, not the published npm package wrapper.
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: t.muted, lineHeight: 1.55 }}>
          <li><strong>Covered:</strong> ASL + ECDH, SSE lease/fullConfig/delta, local Evaluate, QA clock, REST config, track events, signature reject.</li>
          <li><strong>Not covered (real FlagClient):</strong> npm packaging / <code>ready()</code>, connection sharing across tabs, SSE→long-poll automatic fallback, SDK logging adapters, production bundle size.</li>
        </ul>
        <div style={{ ...hint, marginTop: 10, marginBottom: 0 }}>
          Use the JS SDK’s own unit/integration tests (or a tiny sample app) for FlagClient-only behaviour.
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ label: string, items: string[], empty: string, theme: Record<string, string> }} props
 */
function PatchList({ label, items, empty, theme: t }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: t.muted2, marginTop: 2 }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {items.map((item) => (
            <span
              key={item}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
                fontFamily: FONT,
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
