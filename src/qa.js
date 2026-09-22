/**
 * QA helpers for config-sync clock / clear / replay.
 * Speaks FF-EU /evaluator/v2/qa/config-sync/* with x-api-key.
 *
 * Client-side lease checks use {@link qaClientNowMs} so advancing the server
 * QA clock also advances the tester's expiry timer (production SDK stays on
 * real wall time).
 */

/** Offset applied on top of `Date.now()` for tester lease / cache expiry. */
let clientOffsetMs = 0;

/**
 * Whether an epoch ms value is representable as a JS Date (toISOString-safe).
 *
 * @param {number} ms Candidate timestamp
 * @returns {boolean}
 */
function isSafeJsDateMs(ms) {
  if (!Number.isFinite(ms)) return false;
  const t = new Date(ms).getTime();
  return Number.isFinite(t);
}

/**
 * Snapshot of the tester's mirrored QA clock.
 *
 * @returns {{ wallClockMs: number, offsetMs: number, effectiveNowMs: number, effectiveNowIso: string }}
 */
export function getQaClientClockState() {
  const wallClockMs = Date.now();
  const effectiveNowMs = wallClockMs + clientOffsetMs;
  return {
    wallClockMs,
    offsetMs: clientOffsetMs,
    effectiveNowMs,
    effectiveNowIso: isSafeJsDateMs(effectiveNowMs)
      ? new Date(effectiveNowMs).toISOString()
      : new Date(wallClockMs).toISOString(),
  };
}

/**
 * Tester "now" for lease readiness (wall clock + last synced QA offset).
 *
 * @returns {number} Epoch ms
 */
export function qaClientNowMs() {
  return Date.now() + clientOffsetMs;
}

/**
 * Mirror a server QA clock response onto the tester's client timer.
 * Ignores offsets that would produce an invalid JS Date.
 *
 * @param {{ offsetMs?: number, effectiveNowMs?: number }|null|undefined} clock
 * @returns {ReturnType<typeof getQaClientClockState>}
 */
export function syncQaClientClock(clock) {
  if (clock && typeof clock.offsetMs === 'number' && Number.isFinite(clock.offsetMs)) {
    const effectiveNowMs = Date.now() + clock.offsetMs;
    if (isSafeJsDateMs(effectiveNowMs)) {
      clientOffsetMs = clock.offsetMs;
    }
  } else if (clock && typeof clock.effectiveNowMs === 'number' && Number.isFinite(clock.effectiveNowMs)) {
    if (isSafeJsDateMs(clock.effectiveNowMs)) {
      clientOffsetMs = clock.effectiveNowMs - Date.now();
    }
  }
  return getQaClientClockState();
}

/**
 * Clear the tester QA offset (real wall time again).
 *
 * @returns {ReturnType<typeof getQaClientClockState>}
 */
export function resetQaClientClock() {
  clientOffsetMs = 0;
  return getQaClientClockState();
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function qaFetch(baseUrl, apiKey, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${trimSlash(baseUrl)}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data.data ?? data;
}

export function qaGetClock(baseUrl, apiKey) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/clock');
}

export function qaAdvanceClock(baseUrl, apiKey, body) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/clock/advance', {
    method: 'POST',
    body,
  });
}

export function qaResetClock(baseUrl, apiKey) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/clock/reset', {
    method: 'POST',
  });
}

export function qaGetState(baseUrl, apiKey) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/state');
}

export function qaClearConfig(baseUrl, apiKey) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/clear', {
    method: 'POST',
  });
}

export function qaReplayCompile(baseUrl, apiKey) {
  return qaFetch(baseUrl, apiKey, '/evaluator/v2/qa/config-sync/replay', {
    method: 'POST',
  });
}

const CACHE_PREFIX = 'fm_tester_config_cache:';

export function loadLocalConfigCache(apiKey) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + apiKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalConfigCache(apiKey, cache) {
  try {
    localStorage.setItem(CACHE_PREFIX + apiKey, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalConfigCache(apiKey) {
  localStorage.removeItem(CACHE_PREFIX + apiKey);
}

/**
 * Fail-closed helper for the tester UI / connect decisions.
 * Defaults to the mirrored QA clock when an offset is set.
 *
 * @param {{ expiresAt?: number }|null|undefined} cache
 * @param {number} [nowMs=qaClientNowMs()]
 * @returns {boolean}
 */
export function isLocalLeaseExpired(cache, nowMs = qaClientNowMs()) {
  if (!cache || typeof cache.expiresAt !== 'number') return true;
  return nowMs >= cache.expiresAt;
}
