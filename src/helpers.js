// ─── Profile Helpers ────────────────────────────────────────────

/** @import { Profile } from './types.js' */

const PROFILE_COLORS = [
  '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B',
  '#EF4444', '#EC4899', '#14B8A6', '#F97316',
];

const REQUIRED_PROFILE_FIELDS = ['id', 'name', 'apiUrl', 'apiKey', 'transport'];

/**
 * Validate a profile object, ensuring all required fields are present and
 * the transport value is one of the accepted types.
 *
 * @param {Partial<Profile>} profile
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Profile must be a non-null object'] };
  }

  for (const field of REQUIRED_PROFILE_FIELDS) {
    const val = profile[field];
    if (val == null || val === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (profile.transport && !['websocket', 'longpolling'].includes(profile.transport)) {
    errors.push(`Invalid transport "${profile.transport}": must be "websocket" or "longpolling"`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a UUID v4 string.
 *
 * Uses the Web Crypto API when available and falls back to a Math.random
 * based implementation for environments that do not support it.
 *
 * @returns {string}
 */
export function generateProfileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: RFC 4122 v4 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Return the hex color assigned to a profile at the given index,
 * cycling through the predefined palette if necessary.
 *
 * @param {number} index
 * @returns {string} Hex color string, e.g. `"#3B82F6"`
 */
export function getProfileColor(index) {
  return PROFILE_COLORS[index % PROFILE_COLORS.length];
}

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
