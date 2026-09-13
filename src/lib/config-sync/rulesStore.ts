import {
  isConfigPayloadExpired,
  verifyConfigPayloadSignature,
} from './signPayload';
import type {
  ConfigSyncPayload,
  DeltaConfigPayload,
  DeltasCatchUpPayload,
  FullConfigPayload,
  LeasePayload,
  RulesCacheSnapshot,
  SdkFlagConfig,
  SdkSegment,
} from './types';

export type RulesState = {
  version: number;
  expiresAt: number;
  flags: Map<string, SdkFlagConfig>;
  segments: Map<string, SdkSegment>;
  /** false when lease expired offline — fail closed (defaults only). */
  ready: boolean;
  /** Set when a delta's fromVersion does not match — reconnect with fullConfig. */
  needsFullConfig: boolean;
};

export type ApplyResult =
  | { ok: true; state: RulesState }
  | {
      ok: false;
      reason: 'bad_signature' | 'version_gap' | 'stale' | 'expired' | 'invalid_payload';
      state: RulesState;
    };

export function createEmptyRulesState(): RulesState {
  return {
    version: 0,
    expiresAt: 0,
    flags: new Map(),
    segments: new Map(),
    ready: false,
    needsFullConfig: true,
  };
}

function cloneState(state: RulesState): RulesState {
  return {
    version: state.version,
    expiresAt: state.expiresAt,
    flags: new Map(state.flags),
    segments: new Map(state.segments),
    ready: state.ready,
    needsFullConfig: state.needsFullConfig,
  };
}

function segmentsFromRecord(
  record: Record<string, SdkSegment> | undefined,
): Map<string, SdkSegment> {
  const map = new Map<string, SdkSegment>();
  if (!record) return map;
  for (const [id, segment] of Object.entries(record)) {
    map.set(id, segment);
  }
  return map;
}

function applySegmentUpserts(
  segments: Map<string, SdkSegment>,
  record: Record<string, SdkSegment> | undefined,
): Map<string, SdkSegment> {
  if (!record || Object.keys(record).length === 0) return segments;
  const next = new Map(segments);
  for (const [id, segment] of Object.entries(record)) {
    next.set(id, segment);
  }
  return next;
}

function hydrateFromFull(action: FullConfigPayload): RulesState {
  const flags = new Map<string, SdkFlagConfig>();
  for (const flag of action.flags || []) {
    if (flag?.key) flags.set(flag.key, flag);
  }
  return {
    version: action.version,
    expiresAt: action.expiresAt,
    flags,
    segments: segmentsFromRecord(action.segments),
    ready: true,
    needsFullConfig: false,
  };
}

function applyPatch(state: RulesState, action: DeltaConfigPayload): RulesState {
  const flags = new Map(state.flags);
  for (const key of action.deletes || []) {
    flags.delete(key);
  }
  for (const flag of action.upserts || []) {
    if (flag?.key) flags.set(flag.key, flag);
  }
  return {
    version: action.toVersion,
    expiresAt: typeof action.expiresAt === 'number' ? action.expiresAt : state.expiresAt,
    flags,
    segments: applySegmentUpserts(state.segments, action.segments),
    ready: true,
    needsFullConfig: false,
  };
}

/**
 * Pure reducer for config-sync actions (signatures already verified).
 */
export function reduceRules(
  state: RulesState,
  action: ConfigSyncPayload,
  now: number = Date.now(),
): ApplyResult {
  if (typeof action.expiresAt === 'number' && isConfigPayloadExpired(action.expiresAt, now)) {
    return {
      ok: false,
      reason: 'expired',
      state: { ...cloneState(state), ready: false },
    };
  }

  switch (action.type) {
    case 'lease': {
      // Lease renews expiry only. Version is a bookmark for flag data.
      // If the lease disagrees with our bookmark, keep ours and ask for a
      // full refresh so we don't skip (or invent) updates.
      const versionMismatch = action.version !== state.version;
      return {
        ok: true,
        state: {
          ...cloneState(state),
          version: state.version,
          expiresAt: action.expiresAt,
          ready: true,
          needsFullConfig:
            state.flags.size === 0 || versionMismatch
              ? true
              : state.needsFullConfig,
        },
      };
    }
    case 'fullConfig': {
      return { ok: true, state: hydrateFromFull(action) };
    }
    case 'delta': {
      if (action.toVersion < state.version) {
        return { ok: false, reason: 'stale', state };
      }
      if (action.fromVersion !== state.version) {
        return {
          ok: false,
          reason: 'version_gap',
          state: { ...cloneState(state), needsFullConfig: true },
        };
      }
      return { ok: true, state: applyPatch(state, action) };
    }
    case 'deltas': {
      if (action.toVersion < state.version) {
        return { ok: false, reason: 'stale', state };
      }
      if (action.fromVersion !== state.version) {
        return {
          ok: false,
          reason: 'version_gap',
          state: { ...cloneState(state), needsFullConfig: true },
        };
      }
      let current = state;
      for (const step of action.items || []) {
        // Envelope expiry is already checked above; item TTLs are historical.
        const stepResult = reduceRules(
          current,
          { ...step, type: 'delta', expiresAt: action.expiresAt },
          now,
        );
        if (!stepResult.ok) {
          return stepResult;
        }
        current = stepResult.state;
      }
      // Envelope claims a target version — only trust it if the steps got us there.
      if (current.version !== action.toVersion) {
        return {
          ok: false,
          reason: 'version_gap',
          state: { ...cloneState(state), needsFullConfig: true },
        };
      }
      return {
        ok: true,
        state: {
          ...current,
          version: action.toVersion,
          expiresAt:
            typeof action.expiresAt === 'number' ? action.expiresAt : current.expiresAt,
          ready: true,
          needsFullConfig: false,
        },
      };
    }
    default:
      return { ok: false, reason: 'invalid_payload', state };
  }
}

/**
 * In-memory rules store: verify MAC → reduce → optional localCache snapshot.
 */
export class RulesStore {
  private state: RulesState;
  private macKey: Uint8Array | null;

  constructor(macKey: Uint8Array | null = null, initial?: RulesState) {
    this.macKey = macKey;
    this.state = initial ? cloneState(initial) : createEmptyRulesState();
  }

  setMacKey(macKey: Uint8Array | null): void {
    this.macKey = macKey;
  }

  getMacKey(): Uint8Array | null {
    return this.macKey;
  }

  getState(): RulesState {
    return this.state;
  }

  /**
   * Fail-closed readiness: lease not expired and store marked ready.
   */
  isReady(now: number = Date.now()): boolean {
    if (!this.state.ready) return false;
    if (!this.state.expiresAt) return false;
    return !isConfigPayloadExpired(this.state.expiresAt, now);
  }

  markExpired(): void {
    this.state = { ...cloneState(this.state), ready: false };
  }

  getFlag(key: string): SdkFlagConfig | undefined {
    return this.state.flags.get(key);
  }

  /**
   * Fail-closed default for a flag key (last-known `default_value` only).
   */
  getFailClosedDefault(key: string): unknown {
    return this.state.flags.get(key)?.default_value;
  }

  wantsFullConfig(now: number = Date.now()): boolean {
    if (this.state.needsFullConfig) return true;
    if (!this.isReady(now)) return true;
    if (this.state.flags.size === 0) return true;
    return false;
  }

  sinceVersion(now: number = Date.now()): number | undefined {
    if (this.wantsFullConfig(now)) return undefined;
    return this.state.version;
  }

  /**
   * Verify signature with the session MAC key, then apply the reducer.
   */
  applySigned(payload: ConfigSyncPayload, now: number = Date.now()): ApplyResult {
    if (!this.macKey) {
      return { ok: false, reason: 'bad_signature', state: this.state };
    }
    if (!verifyConfigPayloadSignature(payload, this.macKey)) {
      return { ok: false, reason: 'bad_signature', state: this.state };
    }
    const result = reduceRules(this.state, payload, now);
    if (result.ok) {
      this.state = result.state;
    } else if (result.reason === 'expired' || result.reason === 'version_gap') {
      this.state = result.state;
    }
    return result;
  }

  /** Apply without MAC (unit tests / already-verified payloads). */
  applyTrusted(payload: ConfigSyncPayload, now: number = Date.now()): ApplyResult {
    const result = reduceRules(this.state, payload, now);
    if (result.ok) {
      this.state = result.state;
    } else if (result.reason === 'expired' || result.reason === 'version_gap') {
      this.state = result.state;
    }
    return result;
  }

  toSnapshot(): RulesCacheSnapshot {
    const segments: Record<string, SdkSegment> = {};
    this.state.segments.forEach((segment, id) => {
      segments[id] = segment;
    });
    return {
      version: this.state.version,
      expiresAt: this.state.expiresAt,
      flags: Array.from(this.state.flags.values()),
      segments,
    };
  }

  hydrateFromSnapshot(snapshot: RulesCacheSnapshot, now: number = Date.now()): void {
    const flags = new Map<string, SdkFlagConfig>();
    for (const flag of snapshot.flags || []) {
      if (flag?.key) flags.set(flag.key, flag);
    }
    const expired = isConfigPayloadExpired(snapshot.expiresAt, now);
    this.state = {
      version: snapshot.version,
      expiresAt: snapshot.expiresAt,
      flags,
      segments: segmentsFromRecord(snapshot.segments),
      ready: !expired && flags.size > 0,
      needsFullConfig: expired || flags.size === 0,
    };
  }
}

export type { LeasePayload, FullConfigPayload, DeltaConfigPayload, DeltasCatchUpPayload };
