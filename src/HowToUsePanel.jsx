import { FONT } from './uiTheme';
import { Tooltip } from './Tooltip';

const STEPS = [
  {
    title: '1. Pick an environment',
    body: 'Local / Staging / Production fills API + Stream URLs. Use Custom to type your own hosts. Staging/Production split handshake (api) from SSE (stream) so you can test the Cloudflare bypass host.',
  },
  {
    title: '2. Paste an SDK key & connect',
    body: 'Use a key from that environment. Prefer SSE for JS / config-sync. WebSocket is for Go. Polling hits REST evaluate on the API host.',
  },
  {
    title: '3. Choose sync mode',
    body: 'Legacy flags = server-evaluated `flags` events. \n fullConfig / deltas = ECDH + signed rules + local eval (needs SSE). Watch lease / last payload under Config sync.',
  },
  {
    title: '4. Set evaluation context',
    body: 'Add kind/key and targeting attributes, then Send Context (or reconnect). Config-sync re-evaluates locally; legacy waits for a stream update.',
  },
  {
    title: '5. QA clock / data (staging)',
    body: 'Clock / +25h / Reset exercise lease expiry. Server state / Clear / Replay manage compiled rules on the API. Clear localCache drops browser rules so the next connect asks for fullConfig.',
  },
  {
    title: '6. Read the log',
    body: 'Handshake, stream host, lease, deltas, and errors show in the Log tab. Use Evaluate on a flag key to prove local call-site eval in config mode.',
  },
];

export function HowToUsePanel({ open, onClose, theme }) {
  if (!open) return null;
  const t = theme;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to use SDK Tester"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: t.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: t.modalBg,
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          fontFamily: FONT,
          color: t.text,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.textStrong }}>How to use SDK Tester</div>
            <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>
              Quick path for stream domains, config-sync, and QA
            </div>
          </div>
          <Tooltip content="Close this guide" position="left">
            <button
              type="button"
              onClick={onClose}
              style={{
                border: `1px solid ${t.borderStrong}`,
                background: 'transparent',
                color: t.muted,
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: 12,
              }}
            >
              Close
            </button>
          </Tooltip>
        </div>

        <div style={{ padding: '12px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {STEPS.map((step) => (
            <div key={step.title}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.accentSoft, marginBottom: 4 }}>
                {step.title}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: t.muted }}>{step.body}</div>
            </div>
          ))}

          <div
            style={{
              marginTop: 4,
              padding: '10px 12px',
              borderRadius: 6,
              background: `${t.accent}18`,
              border: `1px solid ${t.accent}44`,
              fontSize: 11,
              lineHeight: 1.45,
              color: t.accentSoft,
            }}
          >
            Tip: hover QA buttons for what each action does. Stream URL is SSE-only; API URL handles handshake, context, and QA.
          </div>
        </div>
      </div>
    </div>
  );
}
