/**
 * Top-level SdkFlagConfig evaluation — mirrors FF-EU RuleEngine.compileFlagToPredicate
 * using the ported `flagEvaluator` (spec = utils/flag-evaluator.ts).
 */
import {
  applyRolloutStrategy,
  coerceType,
  defaultHash,
  evaluateFlagWithTargetingRules,
  evaluateKillSwitch,
  evaluateOnVariation,
  type FlagEvaluationResult,
  type Rollout,
  type Segment,
  type TargetingRule,
  type Variation,
} from './flagEvaluator';
import { flattenEvaluationContext } from './flattenContext';
import type { SdkFlagConfig, SdkSegment } from './types';

/** ES2018-safe Map → record (avoids Object.fromEntries / ES2019 lib). */
export function mapToRecord<V>(map: Map<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  map.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function segmentsToRecord(
  segments: Map<string, SdkSegment> | Record<string, SdkSegment>,
): Record<string, SdkSegment> {
  if (segments instanceof Map) {
    return mapToRecord(segments);
  }
  return segments || {};
}

/**
 * Prepare context for flag-evaluator.
 *
 * - Structured `kind` contexts pass through (evaluator flattens like the server).
 * - Already-flat SSE maps pass through.
 * - Nested SDK `{ user, organization, custom }` without `kind` →
 *   `flattenEvaluationContext` (kind-prefixed) so multi-kind attrs do not collide
 *   and organization is not dropped.
 */
export function prepareContextForEvaluator(
  context: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!context || typeof context !== 'object') return {};

  const kind = (context as { kind?: unknown }).kind;
  if (kind === 'user' || kind === 'organization' || kind === 'multi') {
    return context;
  }

  if (
    Object.keys(context).some(
      (k) =>
        k.startsWith('user.') ||
        k.startsWith('organization.') ||
        k.startsWith('custom.'),
    )
  ) {
    return context;
  }

  if (context.user || context.organization || context.custom) {
    return flattenEvaluationContext(context);
  }

  return context;
}

/**
 * Evaluate one SdkFlagConfig against context (server RuleEngine order).
 */
export function evaluateSdkFlag(
  flag: SdkFlagConfig,
  context: Record<string, unknown>,
  segments: Map<string, SdkSegment> | Record<string, SdkSegment>,
): FlagEvaluationResult {
  const evalContext = prepareContextForEvaluator(context);
  const variationsById: Record<string, Variation> = {};
  for (const v of flag.variations || []) {
    if (v?.id) variationsById[v.id] = v;
  }
  const rolloutsById = (flag.rollouts || {}) as Record<string, Rollout>;
  const targetingRules = (flag.targeting_rules || []) as TargetingRule[];
  const segmentsById = segmentsToRecord(segments) as Record<string, Segment>;
  const flagType = flag.type;
  const fallbackValue = flag.default_value;
  const isActive = flag.is_active !== false;
  const offVariationId = flag.off_variation_id;
  const preCalculatedRollout = Object.values(rolloutsById)[0];

  try {
    const killSwitchResult = evaluateKillSwitch(
      isActive,
      offVariationId,
      variationsById,
      flagType,
    );
    if (killSwitchResult !== null) {
      return killSwitchResult;
    }

    if (targetingRules.length === 0) {
      if (isActive) {
        if (preCalculatedRollout) {
          return applyRolloutStrategy(
            preCalculatedRollout,
            flagType,
            fallbackValue,
            variationsById,
            evalContext,
            defaultHash,
          );
        }
        const onVariationResult = evaluateOnVariation(variationsById, flagType);
        return onVariationResult ?? coerceType(fallbackValue, flagType);
      }
      return coerceType(fallbackValue, flagType);
    }

    return evaluateFlagWithTargetingRules(
      {
        fallbackValue,
        expectedType: flagType,
        context: evalContext,
      },
      targetingRules,
      {
        segmentsById,
        variationsById,
        rolloutsById,
      },
    );
  } catch {
    return coerceType(fallbackValue, flagType);
  }
}

export function evaluateAllSdkFlags<T = unknown>(
  flags: Map<string, SdkFlagConfig> | SdkFlagConfig[],
  context: Record<string, unknown>,
  segments: Map<string, SdkSegment> | Record<string, SdkSegment>,
  options?: { failClosedDefaultsOnly?: boolean },
): Record<string, T> {
  const list = flags instanceof Map ? Array.from(flags.values()) : flags;
  const prepared = prepareContextForEvaluator(context);
  const out: Record<string, T> = {};
  for (const flag of list) {
    if (!flag?.key) continue;
    if (options?.failClosedDefaultsOnly) {
      out[flag.key] = coerceType(flag.default_value, flag.type) as T;
      continue;
    }
    // Context already prepared — pass through by using a prefixed flat map /
    // structured kind so prepareContextForEvaluator is a no-op.
    out[flag.key] = evaluateSdkFlag(flag, prepared, segments) as T;
  }
  return out;
}

export { coerceType } from './flagEvaluator';
