/**
 * useDashboardHostShim (PLUGIN-ARCHITECTURE §4.3, §12) — the bridge that
 * assembles a concrete `PluginHost` from today's infrastructure: `useDashboard`
 * (coordinator / table / metadata / highlight) + the cross-view buses +
 * `deviceBroker`. It is the consumer that proves the contract types compose
 * end-to-end; `<PluginMount>` (Phase 1) uses it to build a host per instance.
 *
 * The returned factory is STABLE across volatile dashboard state (highlight is
 * read through a ref, not closed over) so a mounted plugin's host is NOT
 * disposed/rebuilt on every highlight change — only on a genuine
 * session-infrastructure swap (coordinator/table/metadata). It returns
 * `{ host, dispose }`; the mount owns `dispose`, which aborts `host.signal`,
 * runs `onDispose`/tracked unsubscribes LIFO, releases the device lease, and
 * frees the broadcast bitmap.
 *
 * Phase-1 simplifications (each promoted later, noted inline):
 *   - `inputSelection` is the shared `brushSelection`; per-instance selections
 *     with stable identity arrive in Phase 4 (§6.1).
 *   - `config` is held in a closure ref with no reactive re-render wiring; the
 *     mount wires React state in Phase 2.
 *   - capability-gated `DataApi` methods beyond `query` stay `undefined` until
 *     the server grows per-instance namespacing (Phase 3, §6.5).
 */

import { useCallback, useRef } from "react";
import type { MosaicClient } from "@uwdata/mosaic-core";
import { useDashboard } from "@/hooks/useDashboard";
import { broadcastBus, renderBus, selectionBus, viewSyncBus } from "@/core/buses";
import { deviceBroker } from "@/core/gpu/device-broker";
import type {
  DataApi,
  HighlightApi,
  PanelContext,
  PluginHost,
  PluginInstanceId,
  RenderApi,
  UiApi,
  ViewSyncApi,
} from "@/core/plugin/host";
import type { MountReason, PluginMeta } from "@/core/plugin/types";
import type { SelectionFacet } from "@/core/buses";

export interface HostInit<Config, Options> {
  instanceId: PluginInstanceId;
  meta: PluginMeta;
  reason: MountReason;
  config: Config;
  options: Options;
  /** Container handle (Dockview panel api, float window, …) — §4.3. */
  panel: PanelContext;
}

export interface HostHandle<Config, Options> {
  host: PluginHost<Config, Options>;
  /** Owned by `<PluginMount>`. Idempotent full teardown. */
  dispose(): void;
}

const notify = (msg: string, level: "info" | "warn" | "error" = "info"): void => {
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else console.info(msg);
};

/** Build a live `PluginHost` factory bound to the current dashboard context. */
export function useDashboardHostShim() {
  const { state, actions, meta } = useDashboard();
  const { coordinator, brushSelection, table } = meta;
  const { metadata } = state;
  const { setHighlight } = actions;

  // Volatile state read through refs so the factory stays stable.
  const highlightRef = useRef(state.highlightId);
  highlightRef.current = state.highlightId;
  const setHighlightRef = useRef(setHighlight);
  setHighlightRef.current = setHighlight;

  return useCallback(
    <Config, Options>(init: HostInit<Config, Options>): HostHandle<Config, Options> => {
      const { instanceId, meta: pluginMeta, reason, options, panel } = init;
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

      const highlight: HighlightApi = {
        get() {
          return highlightRef.current;
        },
        set(id) {
          setHighlightRef.current(id);
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

      const ui: UiApi = {
        container: panel,
        notify,
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
        ui,

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
    [coordinator, brushSelection, table, metadata],
  );
}
