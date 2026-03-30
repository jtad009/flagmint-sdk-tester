/**
 * Lightweight Flagmint connection client.
 *
 * Speaks the Flagmint wire protocol directly — does NOT use any SDK.
 * This is intentional: we test the server contract, not the SDK's
 * interpretation of it.
 */

export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

export function createFlagmintConnection({ url, apiKey, transport, onFlags, onState, onLog }) {
  let ws = null;
  let pollingInterval = null;
  let pingInterval = null;
  let destroyed = false;
  let currentContext = null;

  const log = (level, msg, data) => {
    onLog?.({ ts: new Date().toISOString(), level, msg, data });
  };

  // ─── WebSocket ──────────────────────────────────────────────

  const connectWS = (context) => {
    const wsUrl = url.replace(/^http/, 'ws');
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

      // Keep-alive ping every 25s
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
          const count = Object.keys(msg.flags || {}).length;
          log('info', `Received ${count} flag${count !== 1 ? 's' : ''}`, { flags: msg.flags });
          onFlags(msg.flags || {});
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
    log('info', `Starting long-polling to ${url}/evaluator/evaluate`);

    const doFetch = async () => {
      if (destroyed) return;

      try {
        const res = await fetch(`${url}/evaluator/evaluate`, {
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
        const count = Object.keys(data).length;
        log('info', `Received ${count} flag${count !== 1 ? 's' : ''}`, { flags: data });
        onFlags(data);
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

    if (transport === 'websocket') {
      connectWS(context);
    } else {
      connectPolling(context);
    }
  };

  const sendContext = (context) => {
    currentContext = context;

    if (transport === 'websocket' && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context', context }));
      log('info', 'Sent context update via WebSocket', { context });
    } else if (transport === 'long-polling') {
      clearInterval(pollingInterval);
      connectPolling(context);
      log('info', 'Restarted polling with new context', { context });
    }
  };

  const disconnect = () => {
    destroyed = true;
    clearInterval(pingInterval);
    clearInterval(pollingInterval);

    if (ws) {
      ws.close(1000, 'User disconnected');
      ws = null;
    }

    onState(CONNECTION_STATES.DISCONNECTED);
    log('info', 'Disconnected');
  };

  return { connect, sendContext, disconnect };
}
