/**
 * Flatten evaluation context — intentional port of FF-EU `utils/context-flatten.ts`
 * (without observed-context hashing helpers).
 *
 * Keep behavior identical to FF-EU:
 * - `addKindLabel=false`: bare keys + `custom.*`
 * - `addKindLabel=true`: `user.key`, `organization.plan`, … (evaluate / SSE path)
 * - Nested `custom` always flattens to bare `custom.<key>` (never `user.custom.<key>`),
 *   matching dashboard attribute keys and FF-EU `flattenCustom`.
 * - `kind: 'multi'` only merges `user` + `organization`. Top-level `custom` is not in
 *   FF-EU `MultiContext` (`additionalProperties: false`) and is ignored here too.
 */

export function flattenCustom(custom: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    out[`custom.${k}`] = v;
  }
  return out;
}

function prefixKind(
  kind: string,
  obj: Record<string, any>,
  addKindLabel = false,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'kind') continue;
    // Match FF-EU: custom is never kind-prefixed (always `custom.<key>`).
    if (k === 'custom' && typeof v === 'object' && v !== null) {
      Object.assign(out, flattenCustom(v as Record<string, unknown>));
      continue;
    }
    if (addKindLabel) {
      out[`${kind}.${k}`] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Flatten a structured EvaluationContext (`kind` present).
 * Returns `{}` if `kind` is missing (callers should pass SSE-flat maps through).
 *
 * Same contract as FF-EU `flattenContext`.
 */
export function flattenContext(
  ctx: Record<string, any>,
  addKindLabel = false,
): Record<string, any> {
  if (!ctx || typeof ctx !== 'object' || !('kind' in ctx)) {
    return {};
  }
  if (ctx.kind === 'multi') {
    return {
      ...(ctx.user ? prefixKind('user', ctx.user, addKindLabel) : {}),
      ...(ctx.organization
        ? prefixKind('organization', ctx.organization, addKindLabel)
        : {}),
    };
  }
  return prefixKind(String(ctx.kind), ctx, addKindLabel);
}

/**
 * SDK convenience for non-schema shapes the client may build before eval:
 * already-flat SSE maps, or nested `{ user, organization, custom }` without `kind`.
 *
 * Structured `kind: user | organization | multi` delegates to `flattenContext(..., true)`
 * (FF-EU evaluate/SSE). Do not invent multi top-level `custom` handling here.
 */
export function flattenEvaluationContext(
  context: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!context || typeof context !== 'object') return {};

  const kind = (context as { kind?: unknown }).kind;
  if (kind === 'user' || kind === 'organization' || kind === 'multi') {
    return flattenContext(context as Record<string, any>, true);
  }

  // Already-flat SSE map (has user.key / custom.* and no structured kind)
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

  // Nested SDK shape without kind (not EvaluationContextT; kind-prefix for targeting)
  const out: Record<string, unknown> = {};
  if (context.user && typeof context.user === 'object') {
    Object.assign(out, prefixKind('user', context.user as Record<string, any>, true));
  }
  if (context.organization && typeof context.organization === 'object') {
    Object.assign(
      out,
      prefixKind('organization', context.organization as Record<string, any>, true),
    );
  }
  if (context.custom && typeof context.custom === 'object') {
    Object.assign(out, flattenCustom(context.custom as Record<string, unknown>));
  }
  for (const [key, value] of Object.entries(context)) {
    if (key === 'user' || key === 'organization' || key === 'custom' || key === 'kind') {
      continue;
    }
    if (value !== null && typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}
