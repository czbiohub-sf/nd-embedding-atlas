/**
 * useDashboardHostShim (PLUGIN-ARCHITECTURE §4.3, §12) — the Phase-0 bridge that
 * assembles a concrete `PluginHost` from today's infrastructure: `useDashboard`
 * (coordinator / table / metadata / highlight) + the cross-view buses +
 * `deviceBroker`. It is the single consumer of the contract layer, so it proves
 * the types compose end-to-end before any view is converted (Phase 2).
 *
 * Nothing mounts a plugin yet, so the returned factory is intentionally unused
 * until `<PluginMount>` lands. The factory returns `{ host, dispose }`: the
 * mount will own `dispose`, which aborts `host.signal`, runs `onDispose`/tracked
 * unsubscribes, releases the device lease, and frees the broadcast bitmap.
 *
 * Phase-0 simplifications (each promoted later, noted inline):
 *   - `inputSelection` is the shared `brushSelection`; per-instance selections
 *     with stable identity arrive in Phase 4 (§6.1).
 *   - `config` is held in a closure ref with no reactive re-render wiring; the
 *     mount wires React state in Phase 2.
 *   - capability-gated `DataApi` methods beyond `query` stay `undefined` until
 *     the server grows per-instance namespacing (Phase 3, §6.5).
 */

import { useCallback } from "react";
import type { MosaicClient } from "@uwdata/mosaic-core";
import { useDashboard } from "@/hooks/useDashboard";
import { broadcastBus, renderBus, selectionBus, viewSyncBus } from "@/core/buses";
import { deviceBroker } from "@/core/gpu/device-broker";
import type { DataApi, HighlightApi, PluginHost, PluginInstanceId, RenderApi, ViewSyncApi } from "@/core/plugin/host";
import type { MountReason, PluginMeta } from "@/core/plugin/types";
import type { SelectionFacet } from "@/core/buses";

export interface HostInit<Config, Options> {
  instanceId: PluginInstanceId;
  meta: PluginMeta;
  reason: MountReason;
  config: Config;
  options: Options;
}

export interface HostHandle<Config, Options> {
  host: PluginHost<Config, Options>;
  /** Owned by `<PluginMount>` (Phase 2). Idempotent full teardown. */
  dispose(): void;
}

/** Build a live `PluginHost` factory bound to the current dashboard context. */
export function useDashboardHostShim() {
  const { state, actions, meta } = useDashboard();
  const { coordinator, brushSelection, table } = meta;
  const { metadata, highlightId } = state;
  const { setHighlight } = actions;

  return useCallback(
    <Config, Options>(init: HostInit<Config, Options>): HostHandle<Config, Options> => {
      const { instanceId, meta: pluginMeta, reason, options } = init;
      const controller = new AbortController();
      const disposers: (() => void)[] = [];
      let config = init.config;
      let deviceLease: { release(): void } | null = null;
      let disposed = false;

      const viewSync: ViewSyncApi = {
        get panX() {
          return viewSyncBus.snapshot().panX;
        },
        get panY() {
          return viewSyncBus.snapshot().panY;
        },
        get zoom() {
          return viewSyncBus.snapshot().zoom;
        },
        get linked() {
          return viewSyncBus.snapshot().lockMode === "linked";
        },
        broadcast(s) {
          viewSyncBus.broadcast(instanceId, s);
        },
        toggleLock() {
          viewSyncBus.toggleLock();
        },
      };

      // Phase 0: highlight reads the value captured at build time. The
      // mount rebuilds the host (or threads a ref) for liveness in Phase 2.
      const highlight: HighlightApi = {
        get() {
          return highlightId;
        },
        set(id) {
          setHighlight(id);
        },
      };

      const render: RenderApi = {
        get pointRadius() {
          return renderBus.pointRadius();
        },
        setPointRadius(r) {
          renderBus.setPointRadius(r);
        },
      };

      // "read" is universal; richer methods stay undefined until Phase 3.
      const api: DataApi = {
        query<T = unknown>(sql: string) {
          return coordinator.query(sql) as unknown as Promise<T>;
        },
      };

      const host: PluginHost<Config, Options> = {
        instanceId,
        meta: pluginMeta,
        reason,
        capabilities: pluginMeta.capabilities,

        data: { coordinator, table, metadata },
        registerClient(client: MosaicClient) {
          coordinator.connect(client);
          const unregister = () => coordinator.disconnect(client);
          disposers.push(unregister);
          return unregister;
        },

        inputSelection: brushSelection,
        externalRowSet() {
          return selectionBus.externalRowSet();
        },

        publishPredicate(facet, sql) {
          selectionBus.publishPredicate(instanceId, facet as SelectionFacet, sql);
        },
        publishRowSet(ids) {
          broadcastBus.publishRowSet(instanceId, ids);
        },

        viewSync,
        highlight,
        render,

        async acquireDeviceLease() {
          const lease = await deviceBroker.acquire(instanceId, controller.signal);
          deviceLease = lease;
          return lease;
        },
        api,

        get config() {
          return config;
        },
        patchConfig(patch) {
          config = { ...config, ...patch };
        },
        options,

        onDispose(fn) {
          disposers.push(fn);
        },
        track(unsubscribe) {
          disposers.push(unsubscribe);
        },
        signal: controller.signal,
      };

      function dispose() {
        if (disposed) return;
        disposed = true;
        controller.abort();
        // LIFO teardown so later-registered cleanups unwind first (§7.3).
        for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
        deviceLease?.release();
        deviceBroker.releaseFor(instanceId);
        broadcastBus.disposeFor(instanceId);
      }

      return { host, dispose };
    },
    [coordinator, brushSelection, table, metadata, highlightId, setHighlight],
  );
}
