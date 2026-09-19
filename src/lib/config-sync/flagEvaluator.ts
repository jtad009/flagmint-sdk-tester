/**
 * Config-sync local evaluator — port of FF-EU `utils/flag-evaluator.ts`.
 * Spec: server streaming RuleEngine + flag-evaluator (not Go).
 * No dayjs / server schema imports. Hash = npm string-hash via ./stringHash.
 */
import { stringHash } from './stringHash';
import { flattenContext } from './flattenContext';

export type ExpectedFlagType = 'boolean' | 'string' | 'number' | 'json';
export type FlagEvaluationResult =
  | boolean
  | string
  | number
  | Record<string, any>;

export type FlatContext = Record<string, any>;

export type Condition = {
  attribute: string;
  operator: string;
  value?: unknown;
};

export type TargetingRule = {
  id?: string;
  kind: 'segment' | 'custom' | string;
  order_index: number;
  segment_id?: string | null;
  conditions?: Condition[];
  logical_op?: string;
  variation_id?: string | null;
  rollout_id?: string | null;
};

export type Variation = {
  id: string;
  value: unknown;
  key?: string;
  name?: string;
  type?: string;
  description?: string;
  [key: string]: unknown;
};

export type Rollout =
  | { strategy: 'off' }
  | { strategy: 'percentage'; percentage: number; salt: string }
  | {
      strategy: 'variant';
      salt: string;
      variants: { variation_id: string; weight: number }[];
    }
  | {
      strategy: 'gradual';
      salt: string;
      target_percentage: number;
      increment: number;
      interval_hours: number;
      start_at?: string;
    }
  | { strategy?: string; [key: string]: any };

export type Segment = {
  id?: string;
  rules?: Condition[];
  logical_op?: string;
  force?: boolean;
};

export type EvaluationDeps = {
  segmentsById?: Record<string, Segment>;
  variationsById: Record<string, Variation>;
  rolloutsById: Record<string, Rollout>;
  getHashPercent?: (input: string) => number;
};

type LogicalOperatorType = 'AND' | 'OR' | 'NOT';
type EvaluationContextT = Record<string, any>;
type TVariation = Variation;
type SegmentSchemaType = Segment;
type FlagValue = any;

function toComparableString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toComparableArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.map(toComparableString);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(toComparableString);
        }
      } catch {
        const inner = trimmed.slice(1, -1).trim();
        if (inner.length === 0) {
          return [];
        }

        return inner
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .map((item) => item.replace(/^['\"]|['\"]$/g, ""));
      }
    }
  }

  return null;
}

/**
 * Evaluate kill switch state.
 * 
 * DESIGN PURPOSE: Immediate flag override without evaluating targeting/rollouts.
 * 
 * Use cases:
 *   - Emergency shutoff: Instantly disable a feature causing issues
 *   - Override complex targeting: Kill switch takes precedence over all rules
 *   - Safe defaults: Return configured "off" variation instead of arbitrary fallback
 * 
 * HOW IT WORKS:
 *   1. If flag is inactive (`is_active=false`) AND has `off_variation_id` configured:
 *      - Return the off variation value (kill switch activated)
 *   2. Otherwise:
 *      - Return null (kill switch not active, proceed with normal evaluation)
 * 
 * EVALUATION PRIORITY:
 *   Kill switch is checked FIRST, before:
 *   - Targeting rules
 *   - Segments
 *   - Rollouts
 *   - Default values
 * 
 * NOTE:
 *   - If flag is inactive but no off_variation_id is configured, returns null
 *     (caller should fall back to default value)
 *   - Variations should be pre-validated; missing variation logs warning
 * 
 * @param isActive - Flag's active state
 * @param offVariationId - ID of the variation to serve when flag is off
 * @param variationsById - Map of variation IDs to variations
 * @param expectedType - Expected flag type for coercion
 * @returns Off variation value if kill switch active, null otherwise
 */
export function evaluateKillSwitch(
  isActive: boolean,
  offVariationId: string | null | undefined,
  variationsById: Record<string, TVariation> | undefined,
  expectedType: ExpectedFlagType
): FlagEvaluationResult | null {
  // Kill switch only activates when flag is OFF and off_variation is configured
  if (!isActive && offVariationId && variationsById?.[offVariationId]) {
    return coerceType(variationsById[offVariationId].value, expectedType);
  }

  // Kill switch not active - proceed with normal evaluation
  return null;
}

/**
 * Evaluate "on" variation for boolean kill switches.
 * 
 * DESIGN PURPOSE: Simple boolean kill switch "ON" state using variations.
 * 
 * DESIGN DECISION: Boolean-only kill switches.
 * Flagmint uses kill switches exclusively for boolean flags to maintain simplicity
 * and semantic clarity. For multi-value feature management, use targeting rules
 * or rollout strategies instead.
 * 
 * Use cases:
 *   - Boolean kill switch: Two variations (true/false), serve true when active
 *   - Simple feature flags: No targeting complexity, just on/off states
 *   - Emergency controls: Instant enable/disable without complex logic
 * 
 * HOW IT WORKS:
 *   1. For boolean flags: Find the variation with value=true
 *   2. If found, return that variation's value
 *   3. Otherwise, return null (caller should fall back to default value)
 * 
 * WHEN TO USE:
 *   - Flag is active (`is_active=true`)
 *   - Flag type is boolean
 *   - No targeting rules
 *   - No rollouts
 *   - Variations are defined
 * 
 * NOTE:
 *   - This is the complement to evaluateKillSwitch (OFF state)
 *   - Only works for boolean flags (kill switches are boolean-only in Flagmint)
 *   - For flags with targeting/rollouts, use evaluateFlagWithTargetingRules instead
 * 
 * @param variationsById - Map of variation IDs to variations
 * @param expectedType - Expected flag type (must be 'boolean' for kill switches)
 * @returns Variation with value=true if found, null otherwise
 */
export function evaluateOnVariation(
  variationsById: Record<string, TVariation> | undefined,
  expectedType: ExpectedFlagType
): FlagEvaluationResult | null {
  if (!variationsById || Object.keys(variationsById).length === 0) {
    return null;
  }

  // Kill switches are boolean-only in Flagmint
  if (expectedType !== 'boolean') {
    return null;
  }

  const variations = Object.values(variationsById);
  
  // Find the variation with value=true (the "on" variation)
  const onVariation = variations.find(v => v.value === true || v.value === 'true');

  if (onVariation) {
    return coerceType(onVariation.value, expectedType);
  }

  return null;
}

/**
 * Evaluates a single condition against a **flattened** evaluation context.
 *
 * IMPORTANT:
 * - This function expects a `FlatContext` (plain key/value map), NOT the raw `EvaluationContextT`.
 * - Callers are responsible for converting the high-level `EvaluationContextT`
 *   (user / organization / multi) into a `FlatContext` via `flattenContext(...)`
 *   before calling this function.
 *
 * Examples:
 *   const flatCtx = flattenContext(evaluationContext); // EvaluationContextT -> FlatContext
 *   const isMatch = evaluateRule(condition, flatCtx);
 *
 * @param condition - The condition to evaluate (attribute, operator, value).
 *   - `attribute` must match a key in `FlatContext` (e.g. "country", "plan", "custom.age").
 * @param context - A `FlatContext` produced by `flattenContext`, containing only
 *   primitive attributes used for targeting (no nested structures or kind metadata).
 * @returns `true` if the condition matches the context; `false` otherwise.
 */

/**
 * True when `context` is still an EvaluationContextT (has `kind`).
 * RuleEngine / SSE pass an already-flat map (`user.key`, `custom.siteids`) with no kind.
 */
function isStructuredEvaluationContext(
  context: unknown
): context is EvaluationContextT {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return false;
  }
  const kind = (context as { kind?: unknown }).kind;
  return kind === "user" || kind === "organization" || kind === "multi";
}

function toFlatEvaluationContext(
  context: EvaluationContextT | Record<string, any>
): Record<string, any> {
  if (isStructuredEvaluationContext(context)) {
    // Match FF-EU evaluator controller/service: kind-prefixed flatten for multi
    // (user.key vs organization.key). Default addKindLabel=false merges bare
    // `key`/`plan` and breaks WeSeeDo-style kind:"multi" contexts.
    return flattenContext(context, true);
  }
  return context && typeof context === "object" ? context : {};
}

/**
 * Resolve a targeting attribute against a flat context.
 *
 * SSE flattens with kind prefixes (`user.siteIds`); HTTP flatten leaves
 * user fields bare (`siteIds`) and custom fields as `custom.siteids`.
 * Dashboard custom attributes are stored as `custom.siteids`.
 */
export function getContextAttribute(
  context: FlatContext,
  attribute: string
): unknown {
  if (!context || typeof context !== "object" || !attribute) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(context, attribute)) {
    return context[attribute];
  }

  const keys = Object.keys(context);
  const lower = attribute.toLowerCase();
  const ciExact = keys.find((k) => k.toLowerCase() === lower);
  if (ciExact !== undefined) {
    return context[ciExact];
  }

  const bare = attribute.includes(".")
    ? attribute.slice(attribute.lastIndexOf(".") + 1)
    : attribute;

  const candidates = [
    bare,
    `custom.${bare}`,
    `user.${bare}`,
    `organization.${bare}`,
  ];

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(context, candidate)) {
      return context[candidate];
    }
    const ci = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (ci !== undefined) {
      return context[ci];
    }
  }

  return undefined;
}

export function evaluateRule(condition: Condition, context: FlatContext): boolean {
  const { attribute, operator, value } = condition;
  const attr = getContextAttribute(context, attribute);

  switch (operator) {
    case "exists":
      // Attribute exists if it's not undefined or null
      return attr !== undefined && attr !== null;

    case "not_exists":
      // Attribute doesn't exist if it's undefined or null
      return attr === undefined || attr === null;

    case "eq": {
      if (value === undefined) return false;

      // Special handling for booleans coming from string config
      if (typeof attr === "boolean" && typeof value === "string") {
        if (value === "true") return attr === true;
        if (value === "false") return attr === false;
      }
      // Special handling for numbers coming from string config
      if (typeof attr === "number" && typeof value === "string") {
        const num = Number(value);
        if (!Number.isNaN(num)) return attr === num;
      }

      return toComparableString(attr) === toComparableString(value);
    }

    case "neq": {
      if (value === undefined) return false;
      if (typeof attr === "boolean" && typeof value === "string") {
        if (value === "true") return attr !== true;
        if (value === "false") return attr !== false;
      }

      if (typeof attr === "number" && typeof value === "string") {
        const num = Number(value);
        if (!Number.isNaN(num)) return attr !== num;
      }

      return toComparableString(attr) !== toComparableString(value);
    }

    case "in": {
      const needles = toComparableArray(value);
      if (!needles) return false;
      const haystack = new Set(needles);
      const candidates = toComparableArray(attr);

      if (candidates) {
        return candidates.some((candidate) => haystack.has(candidate));
      }

      return haystack.has(toComparableString(attr));
    }

    case "nin": {
      const needles = toComparableArray(value);
      if (!needles) return true;
      const haystack = new Set(needles);
      const candidates = toComparableArray(attr);

      if (candidates) {
        return candidates.every((candidate) => !haystack.has(candidate));
      }

      return !haystack.has(toComparableString(attr));
    }

    case "gt": {
      if (value == null) return false;
      const left = Number(attr);
      const right = Number(value);
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      return left > right;
    }

    case "lt": {
      if (value == null) return false;
      const left = Number(attr);
      const right = Number(value);
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      return left < right;
    }

    case "endsWith": {
      if (value == null) return false;
      const str = toComparableString(attr);
      const suffix = toComparableString(value);
      return str.endsWith(suffix);
    }

    case "contains": {
      if (value == null) return false;

      const str = toComparableString(attr);
      const substring = toComparableString(value);
      return str.includes(substring);
    }

    case "not_contains": {
      if (value == null) return true;

      const str = toComparableString(attr);
      const substring = toComparableString(value);
      return !str.includes(substring);
    }

    case "startsWith": {
      if (value == null) return false;
      const str = toComparableString(attr);
      const prefix = toComparableString(value);
      return str.startsWith(prefix);
    }

    default:
      return false;
  }
}

/**
 * Coerces the evaluated flag result into its expected type.
 *
 * This helps guarantee SDK and app stability by ensuring that even if the value
 * is malformed or unexpected, the returned type will always match what's expected.
 * For JSON types, validates that the value is actually an object to prevent data corruption.
 *
 * NOTE: We DO NOT throw here to avoid crashing consumers; instead we log + return safe defaults.
 *
 * @param value - The raw value from flag config or rollout logic.
 * @param expectedType - The expected type ('boolean', 'string', 'number', 'json').
 * @returns The value coerced into the expected type.
 */
export function coerceType(
  value: unknown,
  expectedType: ExpectedFlagType
): FlagEvaluationResult {
  if (expectedType === "boolean") {
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    return Boolean(value);
  }

  if (expectedType === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      console.warn(
        `[Flag Coercion] Number flag received non-numeric value: ${String(
          value
        )}, returning 0`
      );
      return 0;
    }
    return num;
  }

  if (expectedType === "string") {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  if (expectedType === "json") {
    // Ensure value is a non-null, non-array object - don't silently corrupt JSON data
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    console.warn(
      `[Flag Coercion] JSON flag received invalid value (type=${typeof value}), returning empty object`
    );
    return {};
  }

  // If type is undefined or unexpected, return value as-is
  return value as any;
}

/**
 * Extract a stable key for rollout hashing from the evaluation context.
 * Supports Competition-style contexts (kind + key) and legacy user_id.
 */
function getStableRolloutKey(ctx: EvaluationContextT | any): string | undefined {
  if (ctx && typeof ctx === "object" && "kind" in ctx) {
    if (ctx.kind === "user") return ctx.key;
    if (ctx.kind === "multi" && ctx.user) return ctx.user.key;
  }

  if (typeof ctx?.user_id === "string") {
    return ctx.user_id;
  }

  if (typeof ctx?.["user.key"] === "string") {
    return ctx["user.key"];
  }

  // Nested SDK context without top-level kind: { user: { key } }
  if (typeof ctx?.user?.key === "string") {
    return ctx.user.key;
  }

  return undefined;
}

/**
 * @version 1.1.0
 * Evaluate flag with advanced targeting rules (segments + custom rules).
 * Supports variations and rollouts.
 * Order of operations:
 *  1. Flatten context and validate (fail fast for invalid configuration).
 *  2. Iterate through targeting rules in order_index order.
 *  3. For each rule:
 *     - Evaluate rule (segment or custom).
 *    - If rule matches:
 *      - If variation_id is set, return that variation's value.
 *     - If rollout_id is set, apply that rollout strategy.
 * 4. If no rules match, return fallback value.
 * @remarks
 * Context usage (raw vs flat):
 * - `context` (raw EvaluationContextT):
 *   - Contains identity information: kind, key, user, organization, user_id, etc.
 *  - Used for stable rollout keys and identity-based operations.
 *  - Use for:
 *   - rollout validation (`validateFlagContext`)
 *  - rollout hashing (`applyPercentageRollout`, `applyVariantRollout`)
 * - `flatCtx` = `flattenContext(context)`:
 *  - Used to make attribute matching easy (e.g., country, plan, user.country).
 * - Strips identity semantics (kind, multi structure).
 * - Use for:
 * - `evaluateRule`
 * - `evaluateTargeting` (rules + segments)
 * @param input - Input parameters including fallback value, expected type, and context.
 * @param targetingRules - Array of targeting rules to evaluate.
 * @param deps - Dependencies including segments, variations, rollouts, and hashing function.
 * @returns Evaluated flag value coerced to the expected type.
 */
export function evaluateFlagWithTargetingRules(
  input: {
    // environment default / flag fallback
    fallbackValue: unknown;
    expectedType: ExpectedFlagType;
    context: EvaluationContextT;
  },
  targetingRules: TargetingRule[],
  deps: EvaluationDeps
): FlagEvaluationResult {
  const {
    segmentsById,
    variationsById,
    rolloutsById,
    getHashPercent = defaultHash,
  } = deps;
  const { fallbackValue, expectedType, context } = input;

  const flatCtx = toFlatEvaluationContext(context);

  // Rules are assumed already sorted by order_index in the query,
  // but you can defensively sort here if you don't trust callers.
  const sortedRules = [...targetingRules].sort(
    (a, b) => a.order_index - b.order_index
  );
  for (const rule of sortedRules) {
    let ruleMatches = false;
    if (rule.kind === "segment") {
      if (!rule.segment_id || !segmentsById) continue;

      const segment = segmentsById[rule.segment_id];
      if (!segment || !Array.isArray(segment.rules)) continue;

      // Validate logical_op
      if (segment.logical_op && !["AND", "OR", 'NOT'].includes(segment.logical_op)) {
        console.warn(
          `[Flag Evaluation] Invalid logical_op '${segment.logical_op}' in segment ${rule.segment_id}, using AND`
        );
      }
      ruleMatches = evaluateSegment(segment, flatCtx);
    } else if (rule.kind === "custom") {
      if (!rule.conditions || rule.conditions.length === 0) continue;

      // AND semantics within the rule
      ruleMatches = evaluateCustomRule(rule as { conditions: Condition[]; logical_op?: LogicalOperatorType; id?: string }, flatCtx);
    }

    if (!ruleMatches) continue;

    // ----- Rule matched: decide what to serve -----
    // 1) Simple variation rule
    if (rule.variation_id) {
      const variation = variationsById[rule.variation_id];
      if (!variation) {
        console.warn(
          `[Flag Evaluation] Rule ${rule.id} references missing variation_id=${rule.variation_id}, falling back`
        );
        return coerceType(fallbackValue, expectedType);
      }

      // In a stricter impl, you'd assert variation.type === expectedType
      return coerceType(variation.value, expectedType);
    }

    // 2) Rollout-based rule
    if (rule.rollout_id) {
      const rollout = rolloutsById[rule.rollout_id];
      if (!rollout) {
        console.warn(
          `[Flag Evaluation] Rule ${rule.id} references missing rollout_id=${rule.rollout_id}, falling back`
        );
        return coerceType(fallbackValue, expectedType);
      }

      return applyRolloutStrategy(rollout, expectedType, fallbackValue, variationsById, context, getHashPercent);

    }

    // If we reach here, rule matched but had neither variation_id nor rollout_id.
    console.warn(
      `[Flag Evaluation] Rule ${rule.id} matched but has no variation_id or rollout_id set, falling back`
    );
    return coerceType(fallbackValue, expectedType);
  }

  // No rules matched → no rule-level rollout → just return default
  // If you *really* want a flag-level rollout, make it the last rule instead.
  return coerceType(fallbackValue, expectedType);
}


/**
 * Apply gradual (incremental) rollout strategy.
 * Works for boolean flags only (same restriction as percentage rollout).
 * 
 * DESIGN PURPOSE: Time-based progressive feature enablement.
 * 
 * Use cases:
 *   - Scheduled rollouts: Start at midnight, increase 10% every 6 hours
 *   - Automated canary releases: Gradual increase with monitoring windows
 *   - Risk mitigation: Slow rollout allows catching issues early
 * 
 * HOW IT WORKS:
 *   1. Computes current percentage based on elapsed time (computeCurrentPercentage)
 *   2. If current percentage is 0%, returns fallback (feature off)
 *   3. If current percentage >= 100%, returns true (feature fully on)
 *   4. Otherwise, uses percentage rollout logic with current percentage
 *   5. Hash bucketing ensures same user gets consistent experience across rollout
 * 
 * COMPARISON TO OTHER ROLLOUTS:
 *   - Percentage: Manual, static percentage set by operator
 *   - Gradual: Automated, percentage increases over time
 *   - Both use same hash bucketing (same user experience guarantee)
 * 
 * WHY BOOLEAN-ONLY?
 *   - Same rationale as percentage rollout (semantic clarity, simpler mental model)
 *   - "Gradual" implies "progressively enabling", not "switching between variants"
 *   - For multi-value gradual experiments, use variant rollout with manual updates
 * 
 * NOTE:
 *   - User bucketing is stable: once in, always in (until rollout completes)
 *   - Current percentage changes over time, but hash bucket stays same
 *   - Example: User in bucket 15 sees feature at 20% rollout, keeps it at 30%, 40%, etc.
 */
export function applyGradualRollout(expectedType: ExpectedFlagType,
  fallbackValue: unknown,
  rollout: Rollout,
  context: EvaluationContextT,
  getHashPercent: EvaluationDeps['getHashPercent'] = defaultHash): FlagEvaluationResult {
  const key = getStableRolloutKey(context);
  if (!key) {
    console.warn(
      "[Flag Evaluation] Missing stable key for gradual rollout, returning fallback"
    );
    return coerceType(fallbackValue, expectedType);
  }

  if (expectedType !== "boolean") {
    console.warn(
      `[Flag Evaluation] Gradual rollout used on non-boolean flag (type=${expectedType}), returning fallback. ` +
      `Use variant rollout for multi-value experiments.`
    );
    return coerceType(fallbackValue, expectedType);
  }

  // Compute current percentage based on elapsed time
  const currentPercentage = computeCurrentPercentage(rollout);

  // If rollout hasn't started or is at 0%, return fallback
  if (currentPercentage <= 0) {
    return coerceType(fallbackValue, expectedType);
  }

  // If rollout is at or above target, everyone in targeting gets the feature
  if (currentPercentage >= 100) {
    return coerceType(true, expectedType);
  }

  // Apply percentage-based bucketing with current percentage
  if (!rollout || !('salt' in rollout)) {
    console.warn(
      "[Flag Evaluation] Gradual rollout missing 'salt' property, returning fallback"
    );
    return coerceType(fallbackValue, expectedType);
  }

  // Validate current percentage is a valid finite number
  if (!Number.isFinite(currentPercentage) || currentPercentage < 0 || currentPercentage > 100) {
    console.error(
      `[Flag Evaluation] Invalid current percentage computed in gradual rollout (${currentPercentage}), returning fallback`
    );
    return coerceType(fallbackValue, expectedType);
  }

  const bucket = getHashPercent(key + rollout.salt) % 100;
  const result = bucket < currentPercentage;

  return coerceType(result, expectedType);
}

/**
 * Compute the current percentage for a gradual rollout based on elapsed time.
 * 
 * DESIGN PURPOSE: Progressive feature rollout over time.
 * 
 * Use cases:
 *   - Gradually enable a feature: 5% → 10% → 15% → ... → 100% (starts at first increment)
 *   - Controlled risk mitigation: Monitor metrics at each stage before continuing
 *   - Automated rollout schedule: Set and forget, system handles incremental increases
 * 
 * HOW IT WORKS:
 *   1. If start_at is in the future, returns 0% (rollout hasn't started)
 *   2. Once started, begins at 1× increment (not 0%) so traffic is live from hour 0
 *   3. Calculates elapsed time since start_at
 *   4. Each completed interval_hours period adds another increment%
 *   5. Caps at target_percentage
 * 
 * EXAMPLE (increment 10%, interval 24h):
 *   start_at: 2025-01-01T00:00:00Z
 * 
 *   Day 0 (2025-01-01): 10% (just started — first increment is live)
 *   Day 1 (2025-01-02): 20% (1 full interval completed → 2 steps)
 *   Day 2 (2025-01-03): 30% (2 full intervals → 3 steps)
 *   ...
 *   Day 9 (2025-01-10): 100% (reached target)
 *   Day 10+: 100% (capped at target)
 * 
 * @param rollout - Gradual rollout configuration
 * @param now - Current timestamp (dayjs object or ISO string)
 * @returns Current percentage (0-100) based on elapsed intervals
 */
export function computeCurrentPercentage(
  rollout: Rollout,
  now: Date | string | number = Date.now()
): number {
  if (
    !rollout ||
    rollout.strategy !== 'gradual' ||
    (rollout as any).interval_hours <= 0 ||
    (rollout as any).increment <= 0 ||
    (rollout as any).target_percentage <= 0
  ) {
    return 0;
  }

  const currentMs =
    now instanceof Date
      ? now.getTime()
      : typeof now === 'number'
        ? now
        : Date.parse(String(now));
  if (!Number.isFinite(currentMs)) {
    console.error(
      `[Flag Evaluation] Invalid current time provided to computeCurrentPercentage: ${String(now)}, returning 0%`,
    );
    return 0;
  }

  const startAt = (rollout as any).start_at;
  const startMs = startAt ? Date.parse(String(startAt)) : currentMs;
  if (!Number.isFinite(startMs)) {
    console.error(
      `[Flag Evaluation] Invalid start_at time in gradual rollout: ${String(startAt)}, returning 0%`,
    );
    return 0;
  }

  if (currentMs < startMs) {
    return 0;
  }

  const elapsedHours = Math.max(0, (currentMs - startMs) / 3_600_000);
  const intervalsElapsed =
    Math.floor(elapsedHours / (rollout as any).interval_hours) + 1;
  const currentPercentage = Math.min(
    intervalsElapsed * (rollout as any).increment,
    (rollout as any).target_percentage,
  );

  return Math.max(0, currentPercentage);
}

/**
 * Apply percentage (simple rollout) strategy.
 * 
 * DESIGN DECISION: Percentage rollout is boolean-only.
 * 
 * This enforces a clean separation of concerns:
 *   - Percentage Rollout (boolean-only): Progressive feature enablement
 *     Use case: Gradually enable a feature for 0%, 10%, 50%, 100% of users
 *     Result: true (feature on) or fallback value (feature off)
 * 
 *   - Variant Rollout (multivariate, any type): A/B testing and experiments
 *     Use case: Test red vs blue button, experiment with algorithm variants
 *     Result: One of N variants based on stable hash bucketing
 * 
 * WHY BOOLEAN-ONLY?
 *   1. Semantic clarity: "percentage" implies "on or off", not "variant A/B/C"
 *   2. Prevents confusion: Users won't mistakenly apply percentage to multi-value flags
 *   3. Simpler mental model: Competition convention
 *   4. Fails safely: If someone tries percentage on string/number/json, warns + returns fallback
 * 
 * IMPLEMENTATION:
 *   - bucket < percentage → true (feature enabled)
 *   - bucket >= percentage → fallback value (usually false, feature disabled)
 *   - Hash is stable (same user always gets same bucket on same salt)
 * 
 * NOTE:
 *   For non-boolean flags needing multi-value rollout, use applyVariantRollout()
 *   Example: { variants: [{ weight: 50, value: 'blue' }, { weight: 50, value: 'red' }] }
 */
export function applyPercentageRollout(
  expectedType: ExpectedFlagType,
  fallbackValue: unknown,
  rollout: { percentage: number; salt: string },
  context: EvaluationContextT,
  getHashPercent: (input: string) => number
): FlagEvaluationResult {
  const key = getStableRolloutKey(context);
  if (!key) {
    console.warn(
      "[Flag Evaluation] Missing stable key for percentage rollout, returning fallback"
    );
    return coerceType(fallbackValue, expectedType);
  }

  if (expectedType !== "boolean") {
    console.warn(
      `[Flag Evaluation] Percentage rollout used on non-boolean flag (type=${expectedType}), returning fallback. ` +
      `Use variant rollout for multi-value experiments.`
    );
    return coerceType(fallbackValue, expectedType);
  }
  // 100% is common – short-circuit
  if (rollout.percentage >= 100) {
    return coerceType(true, expectedType); // always ON for targeted users
  }

  const bucket = getHashPercent(key + rollout.salt) % 100;
  const result = bucket < rollout.percentage; // true/false

  return coerceType(result, expectedType);
}

/**
 * Apply variant (multivariate) rollout.
 * Works for ANY flag type (boolean, string, number, json).
 * 
 * DESIGN PURPOSE: Multi-value A/B testing and experiments.
 * 
 * Use cases:
 *   - Button color experiment: 50% red, 50% blue
 *   - Algorithm variant testing: 33% algorithm-a, 33% algorithm-b, 34% algorithm-c
 *   - Configuration experiments: Different JSON payloads for different user buckets
 *   - Non-boolean feature variants: Gradual rollout with specific values (not just on/off)
 * 
 * HOW IT WORKS:
 *   1. Computes stable hash bucket (0-99) for user + salt
 *   2. Iterates through variants by weight until bucket falls into range
 *   3. Returns matched variant's value, coerced to expected flag type
 * 
 * WEIGHT SEMANTICS:
 *   - Each variant has a weight (0-100+)
 *   - Weights are cumulative: bucket 0-49 → first, 50-99 → second
 *   - At WRITE time: validateFlagContext() enforces sum(weights) === 100
 *   - At READ time (defensive): If sum < 100, returns fallback; if sum > 100, truncates
 * 
 * COMPARISON TO PERCENTAGE ROLLOUT:
 *   - Percentage: Boolean-only, simple "on or off"
 *   - Variant: Any type, complex "which variant?"
 *   - Use percentage for feature flags, variant for experiments
 * 
 * NOTE:
 *   - Hash is stable per user (same user always matches same variant)
 *   - Salt allows independent rollouts of same flag version
 *   - Missing key (user_id or kind+key) returns fallback with warning
 *   - Weights validated at config save time; evaluator is defensive safety net only
 */
export function applyVariantRollout(
  expectedType: ExpectedFlagType,
  fallbackValue: unknown,
  rollout: Extract<Rollout, { strategy: "variant" }>,
  variantById: Record<string, TVariation>,
  context: EvaluationContextT,
  getHashPercent: (input: string) => number,
): FlagEvaluationResult {
  const key = getStableRolloutKey(context);
  if (!key) {
    console.warn(
      "[Flag Evaluation] Missing stable key for variant rollout, returning fallback"
    );
    return coerceType(fallbackValue, expectedType);
  }

  if (!Array.isArray(rollout.variants) || rollout.variants.length === 0) {
    console.warn(
      "[Flag Evaluation] Variant rollout misconfigured (no variants), returning fallback"
    );
    return coerceType(fallbackValue, expectedType);
  }
  const bucket = getHashPercent(key + rollout.salt) % 100;
  let cumulative = 0;
  for (const v of rollout.variants) {
    cumulative += v.weight;
    if (bucket < cumulative) {
      const variation = variantById[v.variation_id];
      if (!variation) {
        console.warn(
          `[Flag Evaluation] Variant rollout references missing variation_id=${v.variation_id}, returning fallback`
        );
        return coerceType(fallbackValue, expectedType);
      }
      return coerceType(variation.value, expectedType);
    }
  }

  // READ-TIME DEFENSIVE: If weights don't sum to 100 (or sum to less),
  // fall back. This handles edge cases:
  //   - Bypassed API validation
  //   - Old data from migrations
  //   - Partial rollout configurations
  // With validated weights at write time, this should be rare.
  return coerceType(fallbackValue, expectedType);
}

/**
 * Evaluate a segment against the provided context.
 * 
 * @version 1.1.0
 * @param segment 
 * @param context 
 * @returns 
 */
function evaluateSegment(
  segment: SegmentSchemaType,
  context: FlatContext
): boolean {
  if (segment.force) return true;
  if (!segment.rules?.length) return false;

  switch (segment.logical_op) {
    case "OR":
      return segment.rules.some(r => evaluateRule(r, context));
    case "NOT":
      return !segment.rules.every(r => evaluateRule(r, context));
    case "AND":
    default:
      return segment.rules.every(r => evaluateRule(r, context));
  }
}

export function defaultHash(input: string): number {
  return stringHash(input);
}

/**
 * Applies the appropriate rollout strategy based on rollout configuration.
 * Centralizes rollout logic and provides better error handling.
 * 
 * @param rollout - Rollout configuration
 * @param expectedType - Expected flag type
 * @param fallbackValue - Fallback value if rollout fails
 * @param variationsById - Map of variation IDs to variations
 * @param context - Raw evaluation context (for hashing)
 * @param getHashPercent - Hash function
 * @param ruleId - Rule ID for logging
 * @returns Evaluated flag value
 */
export function applyRolloutStrategy(
  rollout: Rollout,
  expectedType: ExpectedFlagType,
  fallbackValue: unknown,
  variationsById: Record<string, TVariation>,
  context: EvaluationContextT,
  getHashPercent: (input: string) => number,
  ruleId?: string
): FlagEvaluationResult {
  switch (rollout?.strategy) {
    case "off": {
      // Explicitly off → return fallback
      return coerceType(fallbackValue, expectedType);
    }

    case "percentage": {
      return applyPercentageRollout(
        expectedType,
        fallbackValue,
        rollout as { percentage: number; salt: string },
        context,
        getHashPercent
      );
    }

    case "variant": {
      return applyVariantRollout(
        expectedType,
        fallbackValue,
        rollout as Extract<Rollout, { strategy: "variant" }>,
        variationsById,
        context,
        getHashPercent
      );
    }

    case "gradual": {
      return applyGradualRollout(
        expectedType,
        fallbackValue,
        rollout,
        context,
        getHashPercent
      );
    }

    default: {
      console.warn(
        `[Flag Evaluation] Unsupported rollout strategy '${(rollout as any)?.strategy
        }'${ruleId ? ` on rule ${ruleId}` : ""}, falling back`
      );
      return coerceType(fallbackValue, expectedType);
    }
  }
}

// ==========================================
// CUSTOM RULE EVALUATION (New & Improved)
// ==========================================

/**
 * Evaluates a custom rule against a flattened context.
 * 
 * IMPROVEMENTS OVER ORIGINAL:
 *   - Supports both AND and OR logical operators (previously only AND)
 *   - Validates conditions array before evaluation
 *   - Consistent behavior with segment evaluation
 *   - Better error logging
 * 
 * Evaluation logic:
 *   1. If conditions is empty → never matches (consistent with segments)
 *   2. If logical_op === "OR" → matches if ANY condition passes
 *   3. Otherwise (AND or undefined) → matches if ALL conditions pass
 * 
 * @param rule - Custom rule with conditions and optional logical operator
 * @param context - Flattened evaluation context
 * @returns true if rule matches, false otherwise
 */
export function evaluateCustomRule(
  rule: {
    conditions: Condition[];
    logical_op?: LogicalOperatorType;
    id?: string;
  },
  context: FlatContext
): boolean {
  // Validate conditions array
  if (!rule.conditions || rule.conditions.length === 0) {
    return false;
  }

  // Validate individual conditions
  if (!Array.isArray(rule.conditions)) {
    console.warn(
      `[Flag Evaluation] Custom rule${
        rule.id ? ` ${rule.id}` : ""
      } has invalid conditions (not an array), skipping`
    );
    return false;
  }

  // Normalize logical operator
  const logicalOp = normalizeLogicalOperator(
    rule.logical_op,
    rule.id ? `custom rule ${rule.id}` : undefined
  );

  switch (logicalOp) {
    case "OR":
      return rule.conditions.some(condition => evaluateRule(condition, context));
    case "NOT":
      return !rule.conditions.every(condition => evaluateRule(condition, context));
    case "AND":
    default:
      return rule.conditions.every(condition => evaluateRule(condition, context));
  }
}

/**
 * Normalizes and validates logical operator.
 * Logs warning for invalid values and defaults to "AND".
 * 
 * @param logicalOp - Raw logical operator from config
 * @param segmentId - Segment ID for logging
 * @returns Normalized logical operator ("AND" or "OR")
 */
function normalizeLogicalOperator(
  logicalOp: string | undefined,
  segmentId?: string
): LogicalOperatorType {
  if (!logicalOp) {
    return "AND"; // Default
  }

  const normalized = logicalOp.toUpperCase();

  if (normalized !== "AND" && normalized !== "OR" && normalized !== "NOT") {
    console.warn(
      `[Flag Evaluation] Invalid logical_op '${logicalOp}'${
        segmentId ? ` in segment ${segmentId}` : ""
      }, defaulting to AND`
    );
    return "AND";
  }

  return normalized as LogicalOperatorType;
}