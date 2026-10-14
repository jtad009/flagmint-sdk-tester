import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Must match FF-EU `PII_VALUE_ENCODING`. */
export const PII_VALUE_ENCODING = 'hmac-v1' as const;

const textEncoder = new TextEncoder();

/**
 * Client PII wire options from signed `fullConfig` / `delta`.
 */
export type PiiWireOptions = {
  piiAttributes: string[];
  piiSalt: string;
  piiValueEncoding?: typeof PII_VALUE_ENCODING | string;
};

/**
 * Extra apply options. Prefer plaintext context; only set `alreadyHashed`
 * when callers intentionally supply wire digests (do not infer from hex shape).
 */
export type ApplyPiiHashMode = {
  /** When true, leave PII string fields unchanged (caller supplied digests). */
  alreadyHashed?: boolean;
};

/**
 * Normalize a string before PII hashing (trim + lowercase).
 * Must match FF-EU `normalizePiiString`.
 *
 * @param value Raw attribute value
 */
export function normalizePiiString(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * HMAC-SHA256 hex digest of a normalized PII string.
 * Must match FF-EU `hashPiiValue`.
 *
 * @param value Plaintext value
 * @param salt Client-visible salt from the signed config
 */
export function hashPiiValue(value: string, salt: string): string {
  const mac = hmac(
    sha256,
    textEncoder.encode(salt),
    textEncoder.encode(normalizePiiString(value)),
  );
  return bytesToHex(mac);
}

/**
 * Whether a context / rule attribute key is PII.
 * Matches bare keys (`email`) and kind-prefixed forms (`user.email`).
 *
 * @param attribute Attribute key from context or rule
 * @param piiAttributes Keys from signed config
 */
export function isPiiAttribute(
  attribute: string | undefined | null,
  piiAttributes: readonly string[],
): boolean {
  if (!attribute || piiAttributes.length === 0) return false;
  const attr = attribute.trim();
  if (!attr) return false;
  for (const key of piiAttributes) {
    if (!key) continue;
    if (attr === key) return true;
    if (attr.endsWith(`.${key}`)) return true;
  }
  return false;
}

/** Payload fields that carry PII wire metadata. */
export type PiiWirePayloadFields = {
  piiAttributes?: unknown;
  piiSalt?: unknown;
  piiValueEncoding?: unknown;
};

/**
 * Whether a payload explicitly includes any PII wire field (vs omitting all).
 * Used so deltas that omit PII metadata keep the previous options, while
 * deltas that send unusable fields clear them.
 *
 * @param payload Signed fullConfig / delta fields
 */
export function payloadHasExplicitPiiFields(
  payload: PiiWirePayloadFields | null | undefined,
): boolean {
  if (!payload) return false;
  return (
    payload.piiSalt !== undefined ||
    payload.piiAttributes !== undefined ||
    payload.piiValueEncoding !== undefined
  );
}

/**
 * Parse PII wire options from a config-sync payload body.
 *
 * @param payload Signed fullConfig / delta fields
 * @returns Options when salt + encoding are usable; otherwise null
 */
export function piiWireOptionsFromPayload(
  payload: PiiWirePayloadFields | null | undefined,
): PiiWireOptions | null {
  if (!payload) return null;
  const salt = typeof payload.piiSalt === 'string' ? payload.piiSalt : '';
  if (!salt) return null;
  const encoding =
    typeof payload.piiValueEncoding === 'string'
      ? payload.piiValueEncoding
      : PII_VALUE_ENCODING;
  if (encoding !== PII_VALUE_ENCODING) return null;
  const attrs = Array.isArray(payload.piiAttributes)
    ? payload.piiAttributes.filter((k): k is string => typeof k === 'string')
    : [];
  return {
    piiAttributes: attrs,
    piiSalt: salt,
    piiValueEncoding: PII_VALUE_ENCODING,
  };
}

/**
 * Resolve PII wire options for a delta: keep prior when all PII fields are
 * absent; otherwise parse after merging omitted fields from `previous`.
 *
 * FF-EU `piiMetadata` always emits the full triple (or nothing). Merge is
 * defensive so a salt-only / attrs-only delta cannot wipe the other fields.
 * Explicit empty salt or unknown encoding still clears to null.
 *
 * @param previous Current store options
 * @param action Delta (or similar) payload fields
 */
export function resolvePiiWireForDelta(
  previous: PiiWireOptions | null,
  action: PiiWirePayloadFields | null | undefined,
): PiiWireOptions | null {
  if (!payloadHasExplicitPiiFields(action)) {
    return previous;
  }
  const merged: PiiWirePayloadFields = {
    piiSalt: action!.piiSalt !== undefined ? action!.piiSalt : previous?.piiSalt,
    piiAttributes:
      action!.piiAttributes !== undefined
        ? action!.piiAttributes
        : previous?.piiAttributes,
    piiValueEncoding:
      action!.piiValueEncoding !== undefined
        ? action!.piiValueEncoding
        : previous?.piiValueEncoding,
  };
  return piiWireOptionsFromPayload(merged);
}

/**
 * Hash PII string fields on a flat evaluation context so they match hashed
 * rule values on the wire.
 *
 * Always hashes plaintext strings (including values that look like 64-char hex).
 * Pass `{ alreadyHashed: true }` only when the caller already supplied digests.
 *
 * @param context Flat context map (after prepare / flatten)
 * @param options PII options from the rules store
 * @param mode Optional apply mode (`alreadyHashed` skips hashing)
 * @returns New context object with PII strings hashed (or the input if no-op)
 */
export function applyPiiHashToFlatContext(
  context: Record<string, unknown>,
  options: PiiWireOptions | null | undefined,
  mode?: ApplyPiiHashMode,
): Record<string, unknown> {
  if (
    !options ||
    !options.piiSalt ||
    !options.piiAttributes.length ||
    options.piiValueEncoding !== PII_VALUE_ENCODING
  ) {
    return context;
  }
  if (mode?.alreadyHashed) {
    return context;
  }

  let changed = false;
  const out: Record<string, unknown> = { ...context };

  for (const [key, value] of Object.entries(context)) {
    if (!isPiiAttribute(key, options.piiAttributes)) continue;
    if (typeof value === 'string') {
      out[key] = hashPiiValue(value, options.piiSalt);
      changed = true;
      continue;
    }
    if (Array.isArray(value)) {
      let arrayChanged = false;
      const next = value.map((entry) => {
        if (typeof entry !== 'string') return entry;
        arrayChanged = true;
        return hashPiiValue(entry, options.piiSalt);
      });
      if (arrayChanged) {
        out[key] = next;
        changed = true;
      }
    }
  }

  return changed ? out : context;
}
