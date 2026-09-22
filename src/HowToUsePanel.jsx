import { FONT } from './uiTheme';
import { Tooltip } from './Tooltip';

const STEPS = [
  {
    title: '1. Pick an environment',
    body: `Local / Staging / Production fills API + Stream URLs. Use **Custom** to type your own hosts.

- **Staging / Production** split handshake (API) from SSE (Stream) so you can test the Cloudflare bypass host.`,
  },
  {
    title: '2. Paste an SDK key & connect',
    body: `Use a key from that environment.

- Prefer **SSE** for JS / config-sync
- **WebSocket** is for Go
- **Polling** hits REST evaluate on the API host`,
  },
  {
    title: '3. Choose sync mode',
    body: `- **Legacy flags** — server-evaluated \`flags\` events
- **fullConfig / deltas** — ECDH + signed rules + local eval (needs SSE)

Watch lease / last payload under Config sync.`,
  },
  {
    title: '4. Set evaluation context',
    body: `Add kind/key and targeting attributes, then **Send Context** (or reconnect).

- Config-sync re-evaluates locally
- Legacy waits for a stream update`,
  },
  {
    title: '5. QA clock / data (staging)',
    body: `- **Clock** — reads the server clock and synchronizes the tester clock (does not move server time)
- **+25h** / **Reset** — update the server clock, then sync the tester, so you can test lease expiry without waiting a day

Status shows plain English by default; open **Show technical details** for cache version / lease ISO.

- **Server state** / **Clear** / **Replay** manage compiled rules on the API
- **Clear localCache** drops browser rules so the next connect asks for a full copy`,
  },
  {
    title: '6. Tools tab',
    body: `- Live patch inspection (upserts / deletes / segments)
- Send custom / error track events
- Same-version lease check
- Bad-signature tamper demo

Coverage notes explain wire protocol vs real FlagClient.`,
  },
  {
    title: '7. Read the log',
    body: `Handshake, stream host, lease, deltas, and errors show in the **Log** tab.

Use **Evaluate** on a flag key to prove local call-site eval in config mode.`,
  },
];

const COMMON_ISSUES = [
  {
    title: 'Config-sync delta rejected (version_gap)',
    body: `A patch arrived that does not line up with your local version bookmark, so it was refused on purpose (you keep the last good flags).

The tester then reconnects and asks for \`fullConfig\` automatically.

If you are still stuck:

1. **Clear localCache**
2. **Disconnect**
3. **Connect**

Live admin updates should appear without a manual reconnect once the API build that always broadcasts on \`flag_version_changed\` is deployed.`,
  },
];

/**
 * Render a small markdown-friendly subset for How-to copy:
 * paragraphs, blank lines, `-` / `1.` lists, `code`, **bold**.
 *
 * @param {string} text
 * @param {Record<string, string>} t Theme tokens
 * @returns {import('react').ReactNode}
 */
function renderGuideBody(text, t) {
  const blocks = String(text || '').split(/\n\n+/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const isUl = lines.every((l) => !l.trim() || /^[-*]\s+/.test(l.trim()));
    const isOl = lines.every((l) => !l.trim() || /^\d+\.\s+/.test(l.trim()));

    if (isUl && lines.some((l) => l.trim())) {
      return (
        <ul key={bi} style={{ margin: '0 0 0 1.1em', padding: 0 }}>
          {lines.filter((l) => l.trim()).map((l, li) => (
            <li key={li} style={{ marginBottom: 4 }}>
              {renderInline(l.trim().replace(/^[-*]\s+/, ''), t)}
            </li>
          ))}
        </ul>
      );
    }
    if (isOl && lines.some((l) => l.trim())) {
      return (
        <ol key={bi} style={{ margin: '0 0 0 1.1em', padding: 0 }}>
          {lines.filter((l) => l.trim()).map((l, li) => (
            <li key={li} style={{ marginBottom: 4 }}>
              {renderInline(l.trim().replace(/^\d+\.\s+/, ''), t)}
            </li>
          ))}
        </ol>
      );
    }

    return (
      <p key={bi} style={{ margin: bi === 0 ? 0 : '8px 0 0' }}>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 ? <br /> : null}
            {renderInline(line, t)}
          </span>
        ))}
      </p>
    );
  });
}

/**
 * Inline `code` and **bold** only (no HTML injection).
 *
 * @param {string} text
 * @param {Record<string, string>} t
 * @returns {import('react').ReactNode[]}
 */
function renderInline(text, t) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} style={{ color: t.text, fontWeight: 600 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={key++}
          style={{
            fontSize: '0.92em',
            padding: '1px 5px',
            borderRadius: 3,
            background: `${t.border}88`,
            color: t.text,
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

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
              <div style={{ fontSize: 12, fontWeight: 600, color: t.accentSoft, marginBottom: 6 }}>
                {step.title}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.55, color: t.muted }}>
                {renderGuideBody(step.body, t)}
              </div>
            </div>
          ))}

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14, marginTop: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textStrong, marginBottom: 10 }}>
              Common issues
            </div>
            {COMMON_ISSUES.map((issue) => (
              <div key={issue.title} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.accentSoft, marginBottom: 6 }}>
                  {issue.title}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: t.muted }}>
                  {renderGuideBody(issue.body, t)}
                </div>
              </div>
            ))}
          </div>

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
