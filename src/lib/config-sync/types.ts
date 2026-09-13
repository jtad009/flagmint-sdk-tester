/**
 * Wire types for SSE config-sync (aligned with FF-EU `modules/evaluator/config-sync.ts`).
 */

export type SdkFlagConfig = {
  key: string;
  type: 'boolean' | 'string' | 'number' | 'json';
  is_active: boolean;
  default_value: unknown;
  off_variation_id?: string | null;
  targeting_rules: unknown[];
  variations: Array<{ id: string; value: unknown; key?: string; name?: string }>;
  rollouts: Record<string, unknown>;
  analytics_enabled: boolean;
};

export type SdkSegment = {
  id: string;
  rules: unknown[];
  logical_op?: string;
  force?: boolean;
};

export type SignableConfigBody = Record<string, unknown> & { signature?: string };

export type LeasePayload = {
  type: 'lease';
  version: number;
  serverNow: number;
  expiresAt: number;
  signature: string;
};

export type FullConfigPayload = {
  type: 'fullConfig';
  version: number;
  compiledAt: number;
  expiresAt: number;
  flags: SdkFlagConfig[];
  segments: Record<string, SdkSegment>;
  warnings?: string[];
  signature: string;
};

export type DeltaConfigPayload = {
  type: 'delta';
  fromVersion: number;
  toVersion: number;
  compiledAt: number;
  expiresAt: number;
  upserts: SdkFlagConfig[];
  deletes: string[];
  segments: Record<string, SdkSegment>;
  signature: string;
};

export type DeltasCatchUpPayload = {
  type: 'deltas';
  fromVersion: number;
  toVersion: number;
  expiresAt: number;
  items: DeltaConfigPayload[];
  signature: string;
};

export type ConfigSyncPayload =
  | LeasePayload
  | FullConfigPayload
  | DeltaConfigPayload
  | DeltasCatchUpPayload;

/** Persisted cache for reconnect (`fullConfig` vs `sinceVersion`). */
export type RulesCacheSnapshot = {
  version: number;
  expiresAt: number;
  flags: SdkFlagConfig[];
  segments: Record<string, SdkSegment>;
};
