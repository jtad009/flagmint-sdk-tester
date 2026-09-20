/**
 * Thin wrapper around flagmint-js-sdk config-sync for the tester UI.
 * Wire protocol still lives in connection.js; this owns rules + eval.
 */
import {
  RulesStore,
  evaluateAllSdkFlags,
  evaluateSdkFlag,
  wipeKeyMaterial,
} from '@flagmint/config-sync';
import { qaClientNowMs } from './qa';

export function createConfigSyncRuntime() {
  const store = new RulesStore();

  return {
    store,

    setMacKey(macKey) {
      const previous = store.getMacKey();
      wipeKeyMaterial(previous);
      store.setMacKey(macKey ?? null);
    },

    clearMacKey() {
      const previous = store.getMacKey();
      wipeKeyMaterial(previous);
      store.setMacKey(null);
    },

    /**
     * Hydrate RulesStore from localCache using the tester QA clock.
     *
     * @param {{ version?: number, expiresAt?: number, flags?: unknown[], segments?: Record<string, unknown> }|null|undefined} cache
     * @param {number} [now=qaClientNowMs()]
     * @returns {boolean}
     */
    hydrateFromCache(cache, now = qaClientNowMs()) {
      if (!cache || !Array.isArray(cache.flags)) return false;
      store.hydrateFromSnapshot(
        {
          version: cache.version ?? 0,
          expiresAt: cache.expiresAt ?? 0,
          flags: cache.flags,
          segments: cache.segments ?? {},
        },
        now,
      );
      return store.getState().flags.size > 0;
    },

    /**
     * Verify MAC + reduce. Returns { ok, reason?, evaluated?, snapshot? }.
     *
     * @param {string} eventName
     * @param {Record<string, unknown>} payload
     * @param {Record<string, unknown>} context
     * @param {number} [now=qaClientNowMs()]
     */
    applySignedEvent(eventName, payload, context, now = qaClientNowMs()) {
      const typed = {
        ...payload,
        type: payload.type || eventName,
      };
      const result = store.applySigned(typed, now);
      if (!result.ok) {
        return { ok: false, reason: result.reason, state: result.state };
      }
      return {
        ok: true,
        state: result.state,
        snapshot: store.toSnapshot(),
        evaluated: evaluateLocal(store, context),
      };
    },

    evaluate(context) {
      return evaluateLocal(store, context);
    },

    /**
     * Single-flag local eval (call-site / getFlag proof).
     * Uses QA-aware lease readiness (not only the ready bit).
     *
     * @param {string} key
     * @param {Record<string, unknown>} [context]
     * @param {number} [now=qaClientNowMs()]
     * @returns {{ ok: true, value: unknown } | { ok: false, reason: string }}
     */
    evaluateFlag(key, context, now = qaClientNowMs()) {
      if (!store.isReady(now)) {
        return { ok: false, reason: 'lease_expired' };
      }
      const { flags, segments } = store.getState();
      const flag = flags.get(key);
      if (!flag) {
        return { ok: false, reason: 'flag_not_in_store' };
      }
      const value = evaluateSdkFlag(flag, context ?? {}, segments);
      return { ok: true, value };
    },

    /**
     * Fail-closed default when the lease is expired / not ready.
     *
     * @param {string} key
     * @returns {unknown}
     */
    failClosedDefault(key) {
      return store.getFailClosedDefault(key);
    },

    /**
     * Mark store expired and require fullConfig on next connect.
     */
    markLeaseExpired() {
      store.markExpired();
    },

    /**
     * @param {number} [now=qaClientNowMs()]
     * @returns {boolean}
     */
    isLeaseReady(now = qaClientNowMs()) {
      return store.isReady(now);
    },

    getSnapshot() {
      return store.toSnapshot();
    },

    getState() {
      return store.getState();
    },
  };
}

function evaluateLocal(store, context) {
  const { flags, segments, ready } = store.getState();
  if (!ready || flags.size === 0) {
    return {};
  }
  return evaluateAllSdkFlags(Array.from(flags.values()), context ?? {}, segments);
}
