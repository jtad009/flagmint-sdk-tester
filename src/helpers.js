// ─── Flag Type Helpers ──────────────────────────────────────────

export function flagTypeLabel(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'string') return 'string';
  if (typeof val === 'object') return 'json';
  return typeof val;
}

export function flagValueDisplay(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

export function flagValueShort(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'object') return '{…}';
  const s = String(val);
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

// ─── Type Colors ────────────────────────────────────────────────

export const TYPE_COLORS = {
  boolean: { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  string:  { bg: '#D1FAE5', text: '#065F46', dot: '#10B981' },
  number:  { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  json:    { bg: '#EDE9FE', text: '#5B21B6', dot: '#8B5CF6' },
  null:    { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
};

// ─── Log Colors ─────────────────────────────────────────────────

export function logColor(level) {
  switch (level) {
    case 'error': return '#EF4444';
    case 'warn':  return '#F59E0B';
    case 'info':  return '#C5CDD9';
    case 'debug': return '#4B5563';
    default:      return '#6B7280';
  }
}

// ─── Context Presets ────────────────────────────────────────────

let _id = 100;
const nid = () => `cf-${_id++}`;

export const CONTEXT_PRESETS = {
  simple_user: () => [
    { key: 'kind',    value: 'user',        id: nid() },
    { key: 'key',     value: 'test-user-1', id: nid() },
    { key: 'country', value: 'IE',          id: nid() },
    { key: 'plan',    value: 'pro',         id: nid() },
  ],
  multi_context: () => [
    { key: 'kind',              value: 'multi',        id: nid() },
    { key: 'user.kind',        value: 'user',         id: nid() },
    { key: 'user.key',         value: 'test-user-1',  id: nid() },
    { key: 'user.country',     value: 'IE',           id: nid() },
    { key: 'organization.kind', value: 'organization', id: nid() },
    { key: 'organization.key', value: 'test-org-1',   id: nid() },
  ],
  empty: () => [],
};

// ─── Context Builder ────────────────────────────────────────────
// Converts flat key/value fields into a nested context object.
// e.g. [{ key: 'user.key', value: 'abc' }] → { user: { key: 'abc' } }

export function buildContextFromFields(fields) {
  const root = {};

  for (const field of fields) {
    const k = field.key.trim();
    if (!k) continue;

    let val = field.value;
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (!isNaN(Number(val)) && val.trim() !== '') val = Number(val);

    const parts = k.split('.');
    if (parts.length === 1) {
      root[k] = val;
    } else {
      // Nested: user.key → { user: { key: val } }
      let target = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = val;
    }
  }

  return root;
}
