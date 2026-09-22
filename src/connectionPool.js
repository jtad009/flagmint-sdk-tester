import { createFlagmintConnection } from './connection.js';

/** @import { Profile } from './types.js' */

const MAX_CONNECTIONS = 4;

/**
 * Creates a connection pool that manages up to 4 concurrent Flagmint
 * connections, each isolated by profile ID.
 *
 * Flag-update events carry the originating profile ID so listeners can
 * route updates to the correct UI panel.
 */
export function createConnectionPool() {
  /** @type {Map<string, { connection: ReturnType<typeof createFlagmintConnection>, profile: Profile }>} */
  const pool = new Map();

  /** @type {Array<(profileId: string, flags: Object) => void>} */
  const flagListeners = [];

  // ─── Listener registration ──────────────────────────────────

  /**
   * Register a callback that is invoked whenever flags are received on
   * any connection in the pool.
   *
   * @param {(profileId: string, flags: Object) => void} listener
   * @returns {() => void} Unsubscribe function
   */
  const onFlagUpdate = (listener) => {
    flagListeners.push(listener);
    return () => {
      const idx = flagListeners.indexOf(listener);
      if (idx !== -1) flagListeners.splice(idx, 1);
    };
  };

  const emitFlagUpdate = (profileId, flags) => {
    flagListeners.forEach((fn) => fn(profileId, flags));
  };

  // ─── Pool management ─────────────────────────────────────────

  /**
   * Add a connection for the given profile and immediately connect.
   *
   * @param {Profile} profile
   * @returns {{ connection: ReturnType<typeof createFlagmintConnection>, profile: Profile }}
   * @throws {Error} When the pool is at capacity or the profile ID already exists
   */
  const addConnection = (profile) => {
    if (pool.size >= MAX_CONNECTIONS) {
      throw new Error(`Connection pool is at capacity (max ${MAX_CONNECTIONS})`);
    }
    if (pool.has(profile.id)) {
      throw new Error(`Connection for profile "${profile.id}" already exists`);
    }

    const connection = createFlagmintConnection({
      url: profile.apiUrl,
      apiKey: profile.apiKey,
      transport: profile.transport,
      onFlags: (flags) => emitFlagUpdate(profile.id, flags),
      onState: () => {},
      onLog: () => {},
    });

    pool.set(profile.id, { connection, profile });
    connection.connect(profile.context ?? {});

    return { connection, profile };
  };

  /**
   * Disconnect and remove the connection associated with the given profile ID.
   *
   * @param {string} profileId
   * @returns {boolean} `true` if a connection was found and removed
   */
  const removeConnection = (profileId) => {
    const entry = pool.get(profileId);
    if (!entry) return false;

    entry.connection.disconnect();
    pool.delete(profileId);
    return true;
  };

  /**
   * Retrieve the connection entry for a specific profile ID.
   *
   * @param {string} profileId
   * @returns {{ connection: ReturnType<typeof createFlagmintConnection>, profile: Profile } | undefined}
   */
  const getConnection = (profileId) => pool.get(profileId);

  /**
   * Return an array of all active connection entries.
   *
   * @returns {Array<{ connection: ReturnType<typeof createFlagmintConnection>, profile: Profile }>}
   */
  const getAllConnections = () => Array.from(pool.values());

  return { addConnection, removeConnection, getConnection, getAllConnections, onFlagUpdate };
}
