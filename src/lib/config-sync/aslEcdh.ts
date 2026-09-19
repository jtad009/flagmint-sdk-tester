import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/** Must match FF-EU `utils/config-sync/asl-ecdh.ts`. */
export const ASL_CLIENT_PUBLIC_KEY_HEX_LENGTH = 64;
export const ASL_HKDF_INFO = 'flagmint-asl-config-sync-mac-v1';
export const ASL_KEY_AGREEMENT = 'x25519-hkdf-sha256' as const;

const textEncoder = new TextEncoder();

export type AslClientKeyPair = {
  /** Raw X25519 public key — 64 lowercase hex chars. */
  publicKeyHex: string;
  /** Keep private; never send on the wire. */
  privateKey: Uint8Array;
};

export type AslDerivedMac = {
  /** 32-byte session MAC key — never sent on the wire. */
  configMacKey: Uint8Array;
};

/**
 * Generate an ephemeral X25519 keypair for the ASL handshake ECDH.
 */
export function generateAslClientKeyPair(): AslClientKeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKeyHex: bytesToHex(publicKey),
    privateKey,
  };
}

export function parsePeerPublicKeyHex(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('ASL ECDH: peer public key must be 64 hex characters (raw X25519)');
  }
  return hexToBytes(normalized);
}

/** HKDF salt from the handshake — public; must be even-length hex (FF-EU uses 16 bytes). */
export function parseSaltHex(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^([0-9a-f]{2})+$/.test(normalized)) {
    throw new Error('ASL ECDH: salt must be an even-length hex string');
  }
  return hexToBytes(normalized);
}

/**
 * Client half of X25519 ECDH + HKDF.
 * Derives the same MAC key as the server without transmitting the secret.
 */
export function deriveAslMacKey(input: {
  privateKey: Uint8Array;
  peerPublicKeyHex: string;
  saltHex: string;
}): AslDerivedMac {
  const peerPublicKey = parsePeerPublicKeyHex(input.peerPublicKeyHex);
  const salt = parseSaltHex(input.saltHex);
  const shared = x25519.getSharedSecret(input.privateKey, peerPublicKey);
  const configMacKey = hkdf(
    sha256,
    shared,
    salt,
    textEncoder.encode(ASL_HKDF_INFO),
    32,
  );
  return { configMacKey };
}

/** Zeroize a key buffer when the session ends (best-effort). */
export function wipeKeyMaterial(key: Uint8Array | null | undefined): void {
  if (!key) return;
  key.fill(0);
}
