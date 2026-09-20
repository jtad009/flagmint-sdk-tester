/**
 * Human-readable + structured summary of a config-sync wire payload
 * for the Live delta inspection panel.
 */

/**
 * @param {string} eventName
 * @param {Record<string, unknown>} payload
 * @returns {{
 *   eventName: string,
 *   ok: boolean,
 *   reason?: string,
 *   version?: number,
 *   fromVersion?: number,
 *   toVersion?: number,
 *   upsertKeys: string[],
 *   deleteKeys: string[],
 *   segmentIds: string[],
 *   flagCount?: number,
 *   steps?: number,
 *   headline: string,
 *   receivedAt: string,
 * }}
 */
export function describeConfigPatch(eventName, payload, { ok = true, reason } = {}) {
  const receivedAt = new Date().toISOString();
  const upsertKeys = [];
  const deleteKeys = [];
  const segmentIds = [];

  const collectSegments = (seg) => {
    if (!seg || typeof seg !== 'object' || Array.isArray(seg)) return;
    for (const id of Object.keys(seg)) segmentIds.push(id);
  };

  if (eventName === 'delta' && payload) {
    for (const f of Array.isArray(payload.upserts) ? payload.upserts : []) {
      if (f?.key) upsertKeys.push(String(f.key));
    }
    for (const key of Array.isArray(payload.deletes) ? payload.deletes : []) {
      deleteKeys.push(String(key));
    }
    collectSegments(payload.segments);
  }

  if (eventName === 'deltas' && payload) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const step of items) {
      for (const f of Array.isArray(step?.upserts) ? step.upserts : []) {
        if (f?.key) upsertKeys.push(String(f.key));
      }
      for (const key of Array.isArray(step?.deletes) ? step.deletes : []) {
        deleteKeys.push(String(key));
      }
      collectSegments(step?.segments);
    }
  }

  if (eventName === 'fullConfig' && payload) {
    for (const f of Array.isArray(payload.flags) ? payload.flags : []) {
      if (f?.key) upsertKeys.push(String(f.key));
    }
    collectSegments(payload.segments);
  }

  const uniqueUpserts = [...new Set(upsertKeys)];
  const uniqueDeletes = [...new Set(deleteKeys)];
  const uniqueSegments = [...new Set(segmentIds)];

  let headline = eventName;
  if (!ok) {
    headline = `${eventName} rejected${reason ? ` (${reason})` : ''}`;
  } else if (eventName === 'lease') {
    headline = `Lease renew · v${payload?.version ?? '?'}`;
  } else if (eventName === 'fullConfig') {
    headline = `Full rules · ${uniqueUpserts.length} flag(s)`;
  } else if (eventName === 'delta') {
    headline = `Live delta · +${uniqueUpserts.length} / −${uniqueDeletes.length}`;
  } else if (eventName === 'deltas') {
    const steps = Array.isArray(payload?.items) ? payload.items.length : 0;
    headline = `Catch-up · ${steps} step(s), +${uniqueUpserts.length} / −${uniqueDeletes.length}`;
  }

  return {
    eventName,
    ok,
    reason,
    version: typeof payload?.version === 'number' ? payload.version : undefined,
    fromVersion: typeof payload?.fromVersion === 'number' ? payload.fromVersion : undefined,
    toVersion: typeof payload?.toVersion === 'number' ? payload.toVersion : undefined,
    upsertKeys: uniqueUpserts,
    deleteKeys: uniqueDeletes,
    segmentIds: uniqueSegments,
    flagCount: eventName === 'fullConfig' ? uniqueUpserts.length : undefined,
    steps: eventName === 'deltas' && Array.isArray(payload?.items) ? payload.items.length : undefined,
    headline,
    receivedAt,
  };
}
