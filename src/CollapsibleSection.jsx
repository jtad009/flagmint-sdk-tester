import { FONT } from './uiTheme';

/**
 * Sidebar block with a clickable header; body hidden when collapsed.
 *
 * @param {{
 *   title: string,
 *   summary?: string|null,
 *   open: boolean,
 *   onToggle: () => void,
 *   theme: Record<string, string>,
 *   children: import('react').ReactNode,
 *   flex?: boolean,
 * }} props
 */
export function CollapsibleSection({ title, summary, open, onToggle, theme: t, children, flex = false }) {
  return (
    <div
      style={{
        borderBottom: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        ...(flex ? { flex: 1, minHeight: 0 } : { flexShrink: 0 }),
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '10px 16px',
          margin: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: FONT,
          textAlign: 'left',
        }}
      >
        <span
          style={{
            color: t.muted,
            fontSize: 10,
            width: 12,
            flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.12s ease',
          }}
          aria-hidden
        >
          ▸
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: t.muted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            flexShrink: 0,
          }}
        >
          {title}
        </span>
        {!open && summary ? (
          <span
            style={{
              fontSize: 11,
              color: t.muted2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          style={{
            padding: '0 16px 16px',
            ...(flex ? { flex: 1, overflow: 'auto', minHeight: 0 } : null),
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
