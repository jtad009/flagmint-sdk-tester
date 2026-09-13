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

    hydrateFromCache(cache) {
      if (!cache || !Array.isArray(cache.flags)) return false;
      store.hydrateFromSnapshot({
        version: cache.version ?? 0,
        expiresAt: cache.expiresAt ?? 0,
        flags: cache.flags,
        segments: cache.segments ?? {},
      });
      return store.getState().flags.size > 0;
    },

    /**
     * Verify MAC + reduce. Returns { ok, reason?, evaluated?, snapshot? }.
     */
    applySignedEvent(eventName, payload, context) {
      const typed = {
        ...payload,
        type: payload.type || eventName,
      };
      const result = store.applySigned(typed);
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
     * @returns {{ ok: true, value: unknown } | { ok: false, reason: string }}
     */
    evaluateFlag(key, context) {
      const { flags, segments, ready } = store.getState();
      if (!ready) {
        return { ok: false, reason: 'lease_not_ready' };
      }
      const flag = flags.get(key);
      if (!flag) {
        return { ok: false, reason: 'flag_not_in_store' };
      }
      const value = evaluateSdkFlag(flag, context ?? {}, segments);
      return { ok: true, value };
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
