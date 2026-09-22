import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { SignableConfigBody } from './types';

const textEncoder = new TextEncoder();

/**
 * Stable JSON for HMAC: sort object keys recursively so field order cannot
 * invalidate signatures across language runtimes.
 * Must match FF-EU `canonicalizeForSigning`.
 */
export function canonicalizeForSigning(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key]);
  }
  return sorted;
}

/** ECDH session key is raw bytes; UTF-8 string is for server-fallback secret tests only. */
function normalizeMacKey(secret: Uint8Array | string): Uint8Array {
  return typeof secret === 'string' ? textEncoder.encode(secret) : secret;
}

/**
 * HMAC-SHA256 hex digest over the payload with `signature` omitted.
 */
export function signConfigPayload(
  body: SignableConfigBody,
  secret: Uint8Array | string,
): string {
  const { signature: _ignored, ...unsigned } = body;
  const canonical = canonicalizeForSigning(unsigned);
  const mac = hmac(sha256, normalizeMacKey(secret), textEncoder.encode(canonical));
  return bytesToHex(mac);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Verify HMAC-SHA256 hex `signature` on a config-sync payload.
 * Prefer the ASL ECDH-derived session MAC key.
 */
export function verifyConfigPayloadSignature(
  body: SignableConfigBody,
  secret: Uint8Array | string,
): boolean {
  if (typeof body.signature !== 'string' || body.signature.length === 0) {
    return false;
  }
  let expected: string;
  try {
    expected = signConfigPayload(body, secret);
  } catch {
    return false;
  }
  const a = textEncoder.encode(body.signature);
  const b = textEncoder.encode(expected);
  return timingSafeEqualBytes(a, b);
}

export function isConfigPayloadExpired(
  expiresAt: number,
  now: number = Date.now(),
): boolean {
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}
