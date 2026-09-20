/**
 * Lightweight Flagmint connection client.
 *
 * Speaks the Flagmint wire protocol directly — does NOT use FlagClient.
 * This is intentional: we test the server contract.
 *
 * Config-sync mode reuses the JS SDK's pure modules (ECDH, MAC, RulesStore,
 * local eval) via Vite alias `@flagmint/config-sync` so crypto/eval stay in
 * lockstep with the SDK without importing the full client.
 *
 * Transports:
 *   sse          — ASL handshake → GET /evaluator/v2/flags/stream → POST /context
 *   websocket    — GET /ws/sdk?apiKey=… (legacy evaluated; config-sync is SSE-only)
 *   long-polling — POST /evaluator/evaluate
 */

import { performAslHandshake } from '@flagmint/config-sync';
import { createConfigSyncRuntime } from './configSyncRuntime';
import { qaClientNowMs } from './qa';

export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

const TESTER_WRAPPER = { name: 'sdk-tester', version: '1.0.0' };
const MAX_RECONNECT_DELAY_MS = 15000;

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Encodes evaluation context as URL-safe base64 matching FF-EU's
 * `Buffer.from(encodedContext, 'base64').toString('utf8')` decoder.
 */
function encodeContextQueryParam(context) {
  const json = JSON.stringify(context ?? {});
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return encodeURIComponent(btoa(binary));
}

function parseJsonSafe(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isQuotaPayload(payload) {
  return (
    payload.statusCode === 429 ||
    payload.error === 'QUOTA_EXCEEDED' ||
    typeof payload.retryAfter === 'number'
  );
}

/** Wire-patch size so logs don’t look like a fullConfig when local eval lists all flags. */
function summarizeConfigPatch(eventName, payload) {
  if (eventName === 'delta') {
    return {
      upserts: Array.isArray(payload.upserts) ? payload.upserts.length : 0,
      deletes: Array.isArray(payload.deletes) ? payload.deletes.length : 0,
      fromVersion: payload.fromVersion,
      toVersion: payload.toVersion,
    };
  }
  if (eventName === 'deltas') {
    const items = Array.isArray(payload.items) ? payload.items : [];
    let upserts = 0;
    let deletes = 0;
    for (const step of items) {
      upserts += Array.isArray(step?.upserts) ? step.upserts.length : 0;
      deletes += Array.isArray(step?.deletes) ? step.deletes.length : 0;
    }
    return {
      steps: items.length,
      upserts,
      deletes,
      fromVersion: payload.fromVersion,
      toVersion: payload.toVersion,
    };
  }
  if (eventName === 'fullConfig') {
    return {
      flagsInPayload: Array.isArray(payload.flags) ? payload.flags.length : 0,
    };
  }
  return {};
}

export function createFlagmintConnection({
  url,
  /** SSE host; defaults to `url`. Use stream.flagmint.com / staging-stream when testing CF bypass. */
  streamUrl,
  apiKey,
  transport,
  onFlags,
  onState,
  onLog,
  /** 'legacy' = evaluated flags; 'config' = fullConfig/deltas + lease */
  syncMode = 'legacy',
  /** Optional hooks for config-sync events */
  onLease,
  onConfig,
  /** After a verified apply — persist RulesStore snapshot for localCache */
  onRulesSnapshot,
  /** () => number | undefined — localCache version for sinceVersion */
  getSinceVersion,
  /** () => boolean — force fullConfig=true even if cache exists */
  forceFullConfig,
  /** Optional cache blob to hydrate RulesStore before connect (warm start) */
  initialRulesSnapshot,
}) {
  const apiBaseUrl = trimSlash(url);
  const streamBaseUrl = trimSlash(streamUrl || url);
  const configRuntime = syncMode === 'config' ? createConfigSyncRuntime() : null;
  if (configRuntime && initialRulesSnapshot) {
    configRuntime.hydrateFromCache(initialRulesSnapshot);
  }

  let ws = null;
  let eventSource = null;
  let pollingInterval = null;
  let pingInterval = null;
  let reconnectTimeout = null;
  let destroyed = false;
  let currentContext = null;
  let connectionId = null;
  let reconnectAttempts = 0;
  let sawConnected = false;
  /** Avoid stacking reconnects when many Evaluate clicks hit an expired lease. */
  let leaseRenewInFlight = false;
  /** Last evaluated flag map (legacy stream / local eval). */
  let lastFlags = {};
  /** Analytics map from SSE `flags` packets; null until received. */
  let analyticsByFlag = null;

  const log = (level, msg, data) => {
    onLog?.({ ts: new Date().toISOString(), level, msg, data });
  };

  /**
   * Push a flag map to the UI and remember it for legacy call-site Evaluate.
   *
   * @param {Record<string, unknown>} flags Evaluated key → value map
   * @param {string} [source] Log label (e.g. `SSE flags event`)
   * @returns {void}
   */
  const applyFlags = (flags, source) => {
    const map = flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : {};
    lastFlags = { ...map };
    const count = Object.keys(map).length;
    log('info', `Received ${count} flag${count !== 1 ? 's' : ''}${source ? ` (${source})` : ''}`, { flags: map });
    onFlags(map);
  };

  /**
   * Resolve the visitor id used in evaluation reports from evaluation context.
   * Prefers `user.key`, then `userKey`, then top-level `key`.
   *
   * @param {Record<string, unknown>|null|undefined} ctx
   * @returns {string|undefined}
   */
  const userKeyFromContext = (ctx) => {
    if (!ctx || typeof ctx !== 'object') return undefined;
    const user = ctx.user;
    if (user && typeof user === 'object' && !Array.isArray(user) && typeof user.key === 'string' && user.key) {
      return user.key;
    }
    if (typeof ctx.userKey === 'string' && ctx.userKey) return ctx.userKey;
    if (typeof ctx.key === 'string' && ctx.key) return ctx.key;
    return undefined;
  };

  /**
   * Whether call-site analytics should be reported for this flag key.
   * Config-sync reads `analytics_enabled` from RulesStore; legacy uses the SSE analytics map
   * (or allows and lets the server drop when the map has not arrived yet).
   *
   * @param {string} key Flag key
   * @returns {boolean}
   */
  const isAnalyticsOn = (key) => {
    if (configRuntime) {
      const flag = configRuntime.getState().flags.get(key);
      return flag?.analytics_enabled === true;
    }
    if (analyticsByFlag === null) return true;
    return analyticsByFlag[key] === true;
  };

  /**
   * POST a call-site evaluation event for the Evaluations dashboard card.
   * Fire-and-forget; never throws to the caller. Skips when analytics is off for the flag.
   * Caller must ensure lease freshness before evaluating / choosing variationValue.
   *
   * @param {string} flagKey
   * @param {unknown} variationValue Served value for variation breakdown
   * @param {Record<string, unknown>} ctx Current evaluation context
   * @returns {void}
   */
  const reportCallSiteEvaluation = (flagKey, variationValue, ctx) => {
    if (!isAnalyticsOn(flagKey)) {
      log('debug', `getFlag(${flagKey}) skipped evaluation report (analytics off)`);
      return;
    }
    const body = {
      events: [{
        flagKey,
        kind: 'evaluation',
        variationValue,
        userKey: userKeyFromContext(ctx),
        count: 1,
        timestamp: new Date().toISOString(),
      }],
    };
    void fetch(`${apiBaseUrl}/evaluator/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          log('warn', `Evaluation report failed (${res.status})`, { flagKey, body: text.slice(0, 200) });
          return;
        }
        log('info', `Evaluation reported for ${flagKey}`, { flagKey, variationValue });
      })
      .catch((err) => {
        log('warn', `Evaluation report network error: ${err?.message || err}`, { flagKey });
      });
  };

  const publishLocalEval = (source) => {
    if (!configRuntime) return;
    const evaluated = configRuntime.evaluate(currentContext || {});
    applyFlags(evaluated, source || 'local eval');
  };

  const applyConfigEvent = (eventName, payload) => {
    if (!configRuntime) return;
    if (!configRuntime.store.getMacKey()) {
      log('error', `Config-sync ${eventName} ignored — no ECDH MAC key from handshake`);
      return;
    }
    const result = configRuntime.applySignedEvent(eventName, payload, currentContext || {});
    if (!result.ok) {
      log('error', `Config-sync ${eventName} rejected (${result.reason})`, {
        reason: result.reason,
        version: configRuntime.getState().version,
        needsFullConfig: result.state?.needsFullConfig,
      });
      if (eventName === 'lease') onLease?.(payload);
      else onConfig?.(payload);

      // Missed a patch while connected — tear down and come back with fullConfig
      // (same recovery reconnect uses after a stream drop).
      if (result.reason === 'version_gap' && !destroyed && sawConnected) {
        log('warn', 'Config-sync version gap — reconnecting to request fullConfig');
        closeEventSource();
        connectionId = null;
        scheduleSseReconnect();
      }
      return;
    }

    log('info', `Config-sync ${eventName} verified + applied`, {
      version: result.state.version,
      expiresAt: result.state.expiresAt,
      flagsInStore: result.state.flags.size,
      needsFullConfig: result.state.needsFullConfig,
      ...summarizeConfigPatch(eventName, payload),
    });

    if (eventName === 'lease') onLease?.(payload);
    else onConfig?.(payload);

    onRulesSnapshot?.(result.snapshot);
    leaseRenewInFlight = false;

    // Lease alone may not change flags; still re-eval when we have rules.
    if (result.state.flags.size > 0 && !result.state.needsFullConfig) {
      applyFlags(result.evaluated, `${eventName} local eval`);
    } else if (eventName === 'fullConfig' || eventName === 'deltas' || eventName === 'delta') {
      applyFlags(result.evaluated, `${eventName} local eval`);
    }
  };

  const clearTimers = () => {
    clearInterval(pingInterval);
    pingInterval = null;
    clearInterval(pollingInterval);
    pollingInterval = null;
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  };

  // ─── SSE ────────────────────────────────────────────────────

  const handshake = async () => {
    const handshakeUrl = `${apiBaseUrl}/auth/asl-handshake`;
    const withEcdh = syncMode === 'config';
    log('info', `ASL handshake POST ${handshakeUrl}`, { withEcdh });

    try {
      const result = await performAslHandshake({
        handshakeUrl,
        apiKey,
        withEcdh,
      });

      if (withEcdh) {
        if (!result.configMacKey) {
          throw new Error('ASL ECDH incomplete: MAC key missing after handshake.');
        }
        configRuntime.setMacKey(result.configMacKey);
        log('info', 'Handshake ECDH derived session MAC key', {
          sessionId: `${result.sessionId.slice(0, 16)}…`,
          keyAgreement: result.keyAgreement,
          salt: result.salt ? `${String(result.salt).slice(0, 8)}…` : undefined,
        });
      } else {
        log('info', 'Handshake issued a single-use sessionId', {
          sessionId: `${result.sessionId.slice(0, 16)}…`,
        });
      }

      return result.sessionId;
    } catch (err) {
      const code = err?.code ? ` [${err.code}]` : '';
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('network')) {
        throw new Error(
          `Handshake network error: ${err.message}. Is FF-EU running at ${apiBaseUrl}, and is CORS allowing this origin?`,
        );
      }
      throw new Error(`${err.message || 'Handshake failed'}${code}`);
    }
  };

  const closeEventSource = () => {
    if (!eventSource) return;
    eventSource.onerror = null;
    eventSource.close();
    eventSource = null;
  };

  const openStream = (sessionId, context) => {
    const params = new URLSearchParams({
      sessionId,
      sdkVersion: TESTER_WRAPPER.version,
      platform: 'browser',
      wrapperName: TESTER_WRAPPER.name,
      wrapperVersion: TESTER_WRAPPER.version,
    });

    if (syncMode === 'config') {
      const now = qaClientNowMs();
      const since = typeof getSinceVersion === 'function' ? getSinceVersion() : undefined;
      const hasSince = Number.isInteger(since);
      const storeWantsFull = configRuntime?.store?.wantsFullConfig?.(now) === true;
      const wantFull =
        storeWantsFull ||
        (typeof forceFullConfig === 'function' && forceFullConfig()) ||
        !hasSince;
      params.set('fullConfig', wantFull ? 'true' : 'false');
      if (!wantFull) {
        params.set('sinceVersion', String(since));
      }
    }

    const eventSourceUrl =
      `${streamBaseUrl}/evaluator/v2/flags/stream?${params.toString()}` +
      `&context=${encodeContextQueryParam(context)}`;

    log('info', `Opening SSE ${streamBaseUrl}/evaluator/v2/flags/stream`, {
      sessionId: `${sessionId.slice(0, 16)}…`,
      apiHost: apiBaseUrl,
      streamHost: streamBaseUrl,
      syncMode,
      fullConfig: params.get('fullConfig'),
      sinceVersion: params.get('sinceVersion'),
      context,
      note: 'Do not send x-api-key on this GET — the session token is the credential.',
    });

    const es = new EventSource(eventSourceUrl);
    eventSource = es;
    sawConnected = false;

    es.addEventListener('connected', (event) => {
      const payload = parseJsonSafe(event.data);
      if (typeof payload.connectionId !== 'string' || !payload.connectionId) {
        log('error', 'SSE `connected` event did not carry a connectionId', { raw: event.data });
        onState(CONNECTION_STATES.ERROR);
        closeEventSource();
        return;
      }
      connectionId = payload.connectionId;
      sawConnected = true;
      reconnectAttempts = 0;
      log('info', 'SSE connected', { connectionId });
      onState(CONNECTION_STATES.CONNECTED);
    });

    es.addEventListener('lease', (event) => {
      const payload = parseJsonSafe(event.data);
      if (syncMode === 'config') {
        applyConfigEvent('lease', payload);
        return;
      }
      log('info', 'SSE lease (connect renew)', payload);
      onLease?.(payload);
    });

    es.addEventListener('fullConfig', (event) => {
      const payload = parseJsonSafe(event.data);
      if (syncMode === 'config') {
        applyConfigEvent('fullConfig', payload);
        return;
      }
      log('info', 'SSE fullConfig', {
        version: payload.version,
        flags: Array.isArray(payload.flags) ? payload.flags.length : 0,
        warnings: payload.warnings,
        expiresAt: payload.expiresAt,
      });
      onConfig?.(payload);
    });

    es.addEventListener('deltas', (event) => {
      const payload = parseJsonSafe(event.data);
      if (syncMode === 'config') {
        applyConfigEvent('deltas', payload);
        return;
      }
      log('info', 'SSE deltas catch-up', {
        fromVersion: payload.fromVersion,
        toVersion: payload.toVersion,
        steps: Array.isArray(payload.items) ? payload.items.length : 0,
      });
      onConfig?.(payload);
    });

    es.addEventListener('delta', (event) => {
      const payload = parseJsonSafe(event.data);
      if (syncMode === 'config') {
        applyConfigEvent('delta', payload);
        return;
      }
      log('info', 'SSE delta (live)', {
        fromVersion: payload.fromVersion,
        toVersion: payload.toVersion,
        upserts: Array.isArray(payload.upserts) ? payload.upserts.length : 0,
        deletes: payload.deletes,
      });
      onConfig?.(payload);
    });

    es.addEventListener('flags', (event) => {
      if (syncMode === 'config') {
        // Config mode evaluates locally; ignore legacy evaluated-flag packets.
        log('debug', 'Ignoring flags event in config-sync mode (local eval)');
        return;
      }
      const payload = parseJsonSafe(event.data);
      if (!payload.flags || typeof payload.flags !== 'object' || Array.isArray(payload.flags)) {
        log('warn', 'Ignoring flags event without a flags object', { raw: event.data });
        return;
      }
      if (payload.analytics && typeof payload.analytics === 'object' && !Array.isArray(payload.analytics)) {
        analyticsByFlag = payload.analytics;
      }
      applyFlags(payload.flags, 'SSE flags event');
    });

    es.addEventListener('quota_exceeded', (event) => {
      const payload = parseJsonSafe(event.data);
      log('error', 'SSE quota_exceeded — stream will close', payload);

      const cached = payload.data;
      if (cached && typeof cached === 'object' && !Array.isArray(cached) && Object.keys(cached).length > 0) {
        applyFlags(cached, 'quota cached flags');
      }

      destroyed = true;
      closeEventSource();
      connectionId = null;
      onState(CONNECTION_STATES.ERROR);
    });

    es.addEventListener('error', (event) => {
      if (typeof event.data !== 'string' || !event.data) return;

      const payload = parseJsonSafe(event.data);
      const errorCode = typeof payload.error === 'string' ? payload.error : 'unknown';
      log('error', `SSE named error: ${errorCode}`, payload);

      const retryable = errorCode === 'session_id_missing' || errorCode === 'internal_error';
      closeEventSource();
      connectionId = null;

      if (retryable && sawConnected && !destroyed) {
        scheduleSseReconnect();
        return;
      }

      onState(CONNECTION_STATES.ERROR);
    });

    es.onerror = () => {
      if (destroyed) {
        closeEventSource();
        return;
      }

      closeEventSource();
      connectionId = null;

      if (sawConnected) {
        log('warn', 'SSE stream dropped. Handshake is single-use — reconnecting with a new session.');
        scheduleSseReconnect();
        return;
      }

      log('error', 'SSE stream failed to open. Check handshake, CORS, and API URL (Network tab).');
      onState(CONNECTION_STATES.ERROR);
    };
  };

  const scheduleSseReconnect = () => {
    if (destroyed) return;
    clearTimeout(reconnectTimeout);
    reconnectAttempts += 1;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    log('info', `SSE reconnect #${reconnectAttempts} in ${Math.round(delay)}ms (new handshake required)`);
    onState(CONNECTION_STATES.CONNECTING);

    reconnectTimeout = setTimeout(() => {
      void connectSSE(currentContext);
    }, delay);
  };

  /**
   * If config-sync lease is past expiresAt (tester QA clock): fail-closed,
   * force fullConfig reconnect.
   *
   * @returns {boolean} True when the lease is still valid
   */
  const ensureConfigSyncLeaseFresh = () => {
    if (syncMode !== 'config' || !configRuntime) return true;
    const now = qaClientNowMs();
    if (configRuntime.isLeaseReady(now)) {
      leaseRenewInFlight = false;
      return true;
    }
    configRuntime.markLeaseExpired();
    onRulesSnapshot?.(configRuntime.getSnapshot());
    if (!leaseRenewInFlight && transport === 'sse' && !destroyed) {
      leaseRenewInFlight = true;
      log('warn', 'Config-sync lease expired — fail-closed to defaults; reconnecting for fullConfig', {
        now: new Date(now).toISOString(),
        expiresAt: configRuntime.getState().expiresAt
          ? new Date(configRuntime.getState().expiresAt).toISOString()
          : null,
      });
      closeEventSource();
      connectionId = null;
      scheduleSseReconnect();
    }
    return false;
  };

  const connectSSE = async (context) => {
    if (destroyed) return;
    closeEventSource();
    connectionId = null;

    try {
      const sessionId = await handshake();
      if (destroyed) return;
      openStream(sessionId, context || {});
    } catch (err) {
      log('error', `SSE connect failed: ${err.message}`, { error: err.message });
      onState(CONNECTION_STATES.ERROR);
    }
  };

  const sendContextSSE = async (context) => {
    // Config-sync: renew lease stream if expired, then re-evaluate (defaults if fail-closed).
    if (syncMode === 'config' && configRuntime) {
      ensureConfigSyncLeaseFresh();
      publishLocalEval('local eval after context');
      if (!connectionId) {
        log('warn', 'Context evaluated locally — SSE not connected yet; skipping telemetry POST.');
        return;
      }
    } else if (!connectionId) {
      log('warn', 'Cannot send context — SSE is not connected yet (no connectionId).');
      return;
    }

    const contextUrl = `${apiBaseUrl}/evaluator/v2/flags/context`;
    log('info', `POST ${contextUrl}`, {
      connectionId,
      context,
      note: syncMode === 'config' ? 'telemetry (local eval already applied)' : undefined,
    });

    try {
      const res = await fetch(contextUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ connectionId, context }),
      });

      const body = await res.json().catch(() => ({}));

      if (res.status === 202) {
        if (syncMode === 'config') {
          log('info', 'Context telemetry accepted (202). Flags already from local eval.', body);
        } else {
          log('info', 'Context update queued (202). Flags arrive on the stream after ~400ms debounce.', body);
        }
        return;
      }

      if (res.status === 429) {
        log('error', 'Context update quota exceeded (429)', body);
        onState(CONNECTION_STATES.ERROR);
        return;
      }

      if (res.status === 401 || res.status === 403) {
        log('error', `Context update unauthorized (${res.status})`, body);
        onState(CONNECTION_STATES.ERROR);
        return;
      }

      if (res.status === 404) {
        log('warn', 'SSE connection not found (404). Reconnecting with a new handshake.');
        closeEventSource();
        connectionId = null;
        if (!destroyed) scheduleSseReconnect();
        return;
      }

      log('error', `Context update failed (${res.status})`, body);
    } catch (err) {
      log('error', 'Context update request failed', { error: err.message });
    }
  };

  // ─── WebSocket ──────────────────────────────────────────────

  const connectWS = (context) => {
    const wsUrl = apiBaseUrl.replace(/^http/, 'ws');
    const fullUrl = `${wsUrl}/ws/sdk?apiKey=${apiKey}`;
    log('info', `Connecting WebSocket to ${wsUrl}/ws/sdk`, { apiKey: '***' });

    try {
      ws = new WebSocket(fullUrl);
    } catch (err) {
      log('error', 'WebSocket creation failed', { error: err.message });
      onState(CONNECTION_STATES.ERROR);
      return;
    }

    ws.onopen = () => {
      log('info', 'WebSocket connected');
      onState(CONNECTION_STATES.CONNECTED);

      if (context && Object.keys(context).length > 0) {
        sendContext(context);
      }

      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'flags') {
          applyFlags(msg.flags || {}, 'WebSocket');
        } else if (msg.type === 'pong') {
          log('debug', 'Pong received');
        } else {
          log('debug', `Message type: ${msg.type}`, msg);
        }
      } catch {
        log('warn', 'Failed to parse message', { raw: event.data });
      }
    };

    ws.onerror = () => {
      log('error', 'WebSocket error');
      onState(CONNECTION_STATES.ERROR);
    };

    ws.onclose = (event) => {
      log('info', `WebSocket closed (code: ${event.code}${event.reason ? `, reason: ${event.reason}` : ''})`);
      if (!destroyed) onState(CONNECTION_STATES.DISCONNECTED);
      clearInterval(pingInterval);
    };
  };

  // ─── Long Polling ───────────────────────────────────────────

  const connectPolling = async (context) => {
    log('info', `Starting long-polling to ${apiBaseUrl}/evaluator/evaluate`);

    const doFetch = async () => {
      if (destroyed) return;

      try {
        const res = await fetch(`${apiBaseUrl}/evaluator/evaluate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': `${apiKey}`,
          },
          body: JSON.stringify({ context: context || {} }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          log('error', `HTTP ${res.status}: ${res.statusText}`, { body });
          onState(CONNECTION_STATES.ERROR);
          return;
        }

        const data = await res.json();
        applyFlags(data, 'long-polling');
        onState(CONNECTION_STATES.CONNECTED);
      } catch (err) {
        log('error', 'Polling fetch failed', { error: err.message });
        onState(CONNECTION_STATES.ERROR);
      }
    };

    await doFetch();
    pollingInterval = setInterval(doFetch, 10000);
  };

  // ─── Public API ─────────────────────────────────────────────

  const connect = (context) => {
    if (destroyed) return;
    currentContext = context;
    onState(CONNECTION_STATES.CONNECTING);

    if (transport === 'sse') {
      void connectSSE(context);
    } else if (transport === 'websocket') {
      if (syncMode === 'config') {
        log('warn', 'Config-sync local eval is SSE-only; WebSocket stays legacy-evaluated.');
      }
      connectWS(context);
    } else {
      if (syncMode === 'config') {
        log('warn', 'Config-sync local eval is SSE-only; long-polling stays server evaluate.');
      }
      void connectPolling(context);
    }
  };

  const sendContext = (context) => {
    currentContext = context;

    if (transport === 'sse') {
      void sendContextSSE(context);
    } else if (transport === 'websocket' && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context', context }));
      log('info', 'Sent context update via WebSocket', { context });
    } else if (transport === 'long-polling') {
      clearInterval(pollingInterval);
      void connectPolling(context);
      log('info', 'Restarted polling with new context', { context });
    }
  };

  /**
   * Call-site style request for one flag using the given (sidebar) context.
   * Config-sync: local evaluateSdkFlag. Legacy: returns last streamed value.
   * Both paths POST kind=evaluation when analytics is on for that flag.
   * Expired lease → fail-closed default + reconnect (still returns a value).
   */
  const requestFlag = (key, context) => {
    const ctx = context ?? currentContext ?? {};
    currentContext = ctx;

    if (syncMode === 'config' && configRuntime) {
      const leaseOk = ensureConfigSyncLeaseFresh();
      if (!leaseOk) {
        const value = configRuntime.failClosedDefault(key);
        lastFlags = { ...lastFlags, [key]: value };
        log('warn', `getFlag(${key}) lease expired — fail-closed default`, {
          key,
          value,
          context: ctx,
        });
        reportCallSiteEvaluation(key, value, ctx);
        return { ok: true, value, key, leaseExpired: true };
      }
      const result = configRuntime.evaluateFlag(key, ctx);
      if (!result.ok) {
        log('warn', `getFlag(${key}) failed: ${result.reason}`, { key, reason: result.reason, context: ctx });
        return { ok: false, reason: result.reason };
      }
      lastFlags = { ...lastFlags, [key]: result.value };
      log('info', `getFlag(${key}) local eval`, { key, value: result.value, context: ctx });
      reportCallSiteEvaluation(key, result.value, ctx);
      return { ok: true, value: result.value, key };
    }

    const value = Object.prototype.hasOwnProperty.call(lastFlags, key)
      ? lastFlags[key]
      : undefined;
    log('info', `getFlag(${key}) legacy (last server-evaluated snapshot)`, {
      key,
      value,
      context: ctx,
    });
    reportCallSiteEvaluation(key, value, ctx);
    return { ok: true, value, key, legacy: true };
  };

  const disconnect = () => {
    destroyed = true;
    clearTimers();
    closeEventSource();
    connectionId = null;
    configRuntime?.clearMacKey();

    if (ws) {
      ws.close(1000, 'User disconnected');
      ws = null;
    }

    onState(CONNECTION_STATES.DISCONNECTED);
    log('info', 'Disconnected');
  };

  return { connect, sendContext, requestFlag, disconnect, ensureConfigSyncLeaseFresh };
}
