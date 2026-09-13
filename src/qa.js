/**
 * QA helpers for config-sync clock / clear / replay.
 * Speaks FF-EU /evaluator/v2/qa/config-sync/* with x-api-key.
 */

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
  localStorage.setItem(CACHE_PREFIX + apiKey, JSON.stringify(cache));
}

export function clearLocalConfigCache(apiKey) {
  localStorage.removeItem(CACHE_PREFIX + apiKey);
}

/** Fail-closed helper for the tester UI. */
export function isLocalLeaseExpired(cache, nowMs = Date.now()) {
  if (!cache || typeof cache.expiresAt !== 'number') return true;
  return nowMs >= cache.expiresAt;
}
