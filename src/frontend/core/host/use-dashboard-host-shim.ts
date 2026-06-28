/**
 * useDashboardHostShim (PLUGIN-ARCHITECTURE §4.3, §12) — the bridge that
 * assembles a concrete `NodeHost` from today's infrastructure: `useDashboard`
 * (coordinator / table / metadata / highlight) + the cross-view buses +
 * `deviceBroker`. It is the consumer that proves the contract types compose
 * end-to-end; `<PluginMount>` (Phase 1) uses it to build a host per instance.
 *
 * The returned factory is STABLE across volatile dashboard state (highlight now
 * lives on the HighlightBus, not in the factory's closure) so a mounted plugin's
 * host is NOT disposed/rebuilt on every highlight change — only on a genuine
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

import { useCallback } from "react";
import type { MosaicClient, Selection } from "@uwdata/mosaic-core";
import { useDashboard } from "@/hooks/useDashboard";
import { broadcastBus, highlightBus, renderBus, selectionBus, viewSyncBus } from "@/core/buses";
import { deviceBroker, type DeviceLease } from "@/core/gpu/device-broker";
import type {
  DataApi,
  HighlightApi,
  PanelContext,
  NodeHost,
  NodeInstanceId,
  RenderApi,
  UiApi,
  ViewSyncApi,
} from "@/core/node/host";
import type { MountReason, NodeMeta } from "@/core/node/types";
import type { SelectionFacet } from "@/core/buses";

export interface HostInit<Config, Options> {
  instanceId: NodeInstanceId;
  meta: NodeMeta;
  reason: MountReason;
  config: Config;
  options: Options;
  /** Container handle (Dockview panel api, float window, …) — §4.3. */
  panel: PanelContext;
  /**
   * Per-instance input Selection override (§6.1). Dockview/float mounts omit it
   * and share the dashboard `brushSelection`; a graph node passes its OWN
   * Selection so an edge predicate filters only that node, not the whole app.
   */
  inputSelection?: Selection;
}

export interface HostHandle<Config, Options> {
  host: NodeHost<Config, Options>;
  /** Owned by `<PluginMount>`. Idempotent full teardown. */
  dispose(): void;
}

const notify = (msg: string, level: "info" | "warn" | "error" = "info"): void => {
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else console.info(msg);
};

/** Build a live `NodeHost` factory bound to the current dashboard context. */
export function useDashboardHostShim() {
  const { state, meta, actions } = useDashboard();
  const { coordinator, brushSelection, table } = meta;
  const { metadata } = state;
  const { refreshMetadata } = actions;

  return useCallback(
    <Config, Options>(init: HostInit<Config, Options>): HostHandle<Config, Options> => {
      const { instanceId, meta: pluginMeta, reason, options, panel } = init;
      const inputSelection = init.inputSelection ?? brushSelection;
      const controller = new AbortController();
      const disposers: (() => void)[] = [];
      let config = init.config;
      let deviceLease: DeviceLease | null = null;
      // Memoized so `acquireDeviceLease` is idempotent (see below).
      let deviceLeasePromise: Promise<DeviceLease> | null = null;
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
        subscribe(cb) {
          return viewSyncBus.subscribe(instanceId, cb);
        },
      };

      const highlight: HighlightApi = {
        get() {
          return highlightBus.get();
        },
        set(id) {
          highlightBus.set(id);
        },
        subscribe(cb) {
          const sub = highlightBus.store.subscribe(() => cb(highlightBus.get()));
          return () => sub.unsubscribe();
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

      // "read" is universal; the selection-out methods are capability-gated —
      // ungranted → absent from the object → `undefined` at runtime (the
      // §6.5/§4.3 guardrail). The `/api/*` literal lives HERE in core, never in
      // plugins/** — a plugin only ever calls `host.api.publishSelection`.
      const canSelectionOut = pluginMeta.capabilities.has("selection-out");
      const api: DataApi = {
        query<T = unknown>(sql: string) {
          return coordinator.query(sql) as unknown as Promise<T>;
        },
        ...(canSelectionOut
          ? {
              async publishSelection(rowIds: number[]) {
                // Per-instance temp table sel_<instanceId> (§6.5).
                const res = await fetch(`/api/selection/${encodeURIComponent(instanceId)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ row_indices: rowIds }),
                });
                const { table: selTable, count } = (await res.json()) as { table: string; count: number };
                // The bus owns the tok=N cache-buster — plugins never invent it.
                return selectionBus.makeToken(selTable, count);
              },
              disposeSelection() {
                void fetch(`/api/selection/${encodeURIComponent(instanceId)}`, { method: "DELETE" }).catch(() => {});
              },
            }
          : {}),
        // "annotate" — create/list user annotation columns + stamp a label onto a
        // predicate's rows (the node-graph Annotate node). `/api/*` lives in core.
        ...(pluginMeta.capabilities.has("annotate")
          ? {
              async listAnnotationColumns() {
                const res = await fetch("/api/annotations/columns");
                const body = (await res.json()) as { columns?: { name: string; dtype: string }[] };
                return body.columns ?? [];
              },
              async createAnnotationColumn(name: string, dtype: "categorical" | "string" | "integer" = "categorical") {
                const res = await fetch("/api/annotations/columns", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, dtype }),
                });
                if (!res.ok)
                  throw new Error(((await res.json()) as { error?: string }).error ?? `create failed (${res.status})`);
                // Surface the new column in the Table + pickers (obs_columns refetch).
                await refreshMetadata();
              },
              async writeAnnotationByPredicate(column: string, label: string, predicate: string) {
                const res = await fetch("/api/annotations/values", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ column, label, predicate }),
                });
                if (!res.ok)
                  throw new Error(((await res.json()) as { error?: string }).error ?? `write failed (${res.status})`);
                const out = (await res.json()) as { n: number };
                // New columns appear in the Table (obs_columns refetch → the table's
                // query SQL changes → re-query shows the values). ponytail: re-labeling
                // an ALREADY-shown column still needs a Mosaic cache-bust — not here.
                await refreshMetadata();
                return out;
              },
            }
          : {}),
      };

      const host: NodeHost<Config, Options> = {
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

        inputSelection,
        externalRowSet() {
          // Cross-panel selection-in is the BroadcastBus side (§6.7), NOT the
          // SelectionBus (whose externalRowSet is the Phase-5 xyflow-edge stub).
          return broadcastBus.externalRowSet(instanceId);
        },
        onExternalRowSet(cb) {
          const off = broadcastBus.subscribeExternal(instanceId, cb);
          disposers.push(off);
          return off;
        },

        publishPredicate(facet, sql) {
          selectionBus.publishPredicate(instanceId, facet as SelectionFacet, sql);
        },
        publishRowSet(ids) {
          broadcastBus.publishRowSet(instanceId, ids);
        },
        clearRowSet() {
          // True clear (sync store -> "empty"), not an empty "active" set.
          broadcastBus.clear(instanceId);
        },

        viewSync,
        highlight,
        render,
        ui,

        acquireDeviceLease() {
          // Idempotent (PLUGIN-ARCHITECTURE §7.1): one lease per instance for its
          // whole lifetime. Memoizing the promise on the (frozen-for-the-mount)
          // host gives React's effects/use() a STABLE promise, so a double-render
          // (StrictMode) or two consumers can never double-increment the device
          // refcount. `host.dispose()` owns release — the React layer never does.
          deviceLeasePromise ??= deviceBroker.acquire(instanceId, controller.signal).then((lease) => {
            deviceLease = lease;
            return lease;
          });
          return deviceLeasePromise;
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
        // Drop this instance's crossfilter clause so a closed view stops
        // filtering everyone else (§6.3).
        selectionBus.disposeInstance(instanceId);
        // Drop this instance's server-side sel_<id> temp table (§6.5/§6.9).
        api.disposeSelection?.();
      }

      return { host, dispose };
    },
    [coordinator, brushSelection, table, metadata, refreshMetadata],
  );
}
