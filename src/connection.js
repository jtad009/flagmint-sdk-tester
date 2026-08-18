/**
 * Lightweight Flagmint connection client.
 *
 * Speaks the Flagmint wire protocol directly — does NOT use any SDK.
 * This is intentional: we test the server contract, not the SDK's
 * interpretation of it.
 *
 * Transports:
 *   sse          — ASL handshake → GET /evaluator/v2/flags/stream → POST /context
 *   websocket    — GET /ws/sdk?apiKey=…
 *   long-polling — POST /evaluator/evaluate
 */

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

export function createFlagmintConnection({ url, apiKey, transport, onFlags, onState, onLog }) {
  const baseUrl = trimSlash(url);

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

  const log = (level, msg, data) => {
    onLog?.({ ts: new Date().toISOString(), level, msg, data });
  };

  const applyFlags = (flags, source) => {
    const map = flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : {};
    const count = Object.keys(map).length;
    log('info', `Received ${count} flag${count !== 1 ? 's' : ''}${source ? ` (${source})` : ''}`, { flags: map });
    onFlags(map);
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
    const handshakeUrl = `${baseUrl}/auth/asl-handshake`;
    log('info', `ASL handshake POST ${handshakeUrl}`);

    let res;
    try {
      res = await fetch(handshakeUrl, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
      });
    } catch (err) {
      throw new Error(
        `Handshake network error: ${err.message}. Is FF-EU running at ${baseUrl}, and is CORS allowing this origin?`
      );
    }

    const body = await res.json().catch(() => ({}));
    log(res.ok ? 'debug' : 'error', `Handshake HTTP ${res.status}`, body);

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Handshake unauthorized (${res.status}). Check the SDK key.`);
    }
    if (res.status === 404) {
      throw new Error(
        `Handshake route not found (404). Restart FF-EU so it loads POST /auth/asl-handshake (SSE). Body: ${body.message || res.statusText}`
      );
    }
    if (res.status === 429) {
      throw new Error(body.message || 'Handshake rate limited (429).');
    }
    if (!res.ok) {
      throw new Error(`Handshake failed (${res.status}): ${body.message || res.statusText}`);
    }

    const sessionId =
      (typeof body?.data?.sessionId === 'string' && body.data.sessionId) ||
      (typeof body?.sessionId === 'string' && body.sessionId) ||
      (typeof body?.data === 'string' ? body.data : null);

    if (!sessionId) {
      throw new Error(
        `Handshake response did not include a sessionId. Body: ${JSON.stringify(body)}`
      );
    }

    log('info', 'Handshake issued a single-use sessionId', {
      sessionId: `${sessionId.slice(0, 16)}…`,
    });
    return sessionId;
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
    // context is already URI-encoded base64; append raw so it is not double-encoded
    const streamUrl =
      `${baseUrl}/evaluator/v2/flags/stream?${params.toString()}` +
      `&context=${encodeContextQueryParam(context)}`;

    log('info', `Opening SSE ${baseUrl}/evaluator/v2/flags/stream`, {
      sessionId: `${sessionId.slice(0, 16)}…`,
      context,
      note: 'Do not send x-api-key on this GET — the session token is the credential.',
    });

    const es = new EventSource(streamUrl);
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

    es.addEventListener('flags', (event) => {
      const payload = parseJsonSafe(event.data);
      if (!payload.flags || typeof payload.flags !== 'object' || Array.isArray(payload.flags)) {
        log('warn', 'Ignoring flags event without a flags object', { raw: event.data });
        return;
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
      // Named `event: error` from the server has JSON data.
      // EventSource also fires a generic error Event on network drop — ignore those here.
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

      // Close immediately so the browser does not auto-reconnect with a consumed sessionId.
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
    if (!connectionId) {
      log('warn', 'Cannot send context — SSE is not connected yet (no connectionId).');
      return;
    }

    const contextUrl = `${baseUrl}/evaluator/v2/flags/context`;
    log('info', `POST ${contextUrl}`, { connectionId, context });

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
        log('info', 'Context update queued (202). Flags arrive on the stream after ~400ms debounce.', body);
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
    const wsUrl = baseUrl.replace(/^http/, 'ws');
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
    log('info', `Starting long-polling to ${baseUrl}/evaluator/evaluate`);

    const doFetch = async () => {
      if (destroyed) return;

      try {
        const res = await fetch(`${baseUrl}/evaluator/evaluate`, {
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
      connectWS(context);
    } else {
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

  const disconnect = () => {
    destroyed = true;
    clearTimers();
    closeEventSource();
    connectionId = null;

    if (ws) {
      ws.close(1000, 'User disconnected');
      ws = null;
    }

    onState(CONNECTION_STATES.DISCONNECTED);
    log('info', 'Disconnected');
  };

  return { connect, sendContext, disconnect };
}
