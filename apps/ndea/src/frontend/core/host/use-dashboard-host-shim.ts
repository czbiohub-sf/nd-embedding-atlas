/**
 * Builds one stable host per plugin instance. Disposal aborts pending work,
 * releases resources, and runs registered cleanup functions in reverse order.
 */

import { useCallback } from "react";
import type { MosaicClient, Selection } from "@uwdata/mosaic-core";
import {
  AnnotationColumnsResponseSchema,
  AnnotationPredicateWriteResponseSchema,
  CommitAnnotationsResponseSchema,
  ErrorResponseSchema,
  SelectionPublishResponseSchema,
} from "@ndea/protocol";
import { useDashboard } from "@/hooks/useDashboard";
import { broadcastBus, highlightBus, selectionBus, viewSyncBus } from "@/core/buses";
import { deviceBroker, type DeviceLease } from "@/core/gpu/device-broker";
import type {
  NodeDataAPI,
  FocusCoordinationAPI,
  NodeDefinition,
  NodeInstanceId,
  NodeNotificationAPI,
  ViewCoordinationAPI,
} from "@ndea/sdk";
import type { SelectionFacet } from "@/core/buses";
import type { AppNodeHost } from "@/core/node/app-node-host";

export interface HostInit<Config> {
  instanceId: NodeInstanceId;
  definition: NodeDefinition;
  config: Config;
  bodyHeaderElement?: HTMLElement;
  /**
   * Per-instance input Selection override (§6.1). Dockview/float mounts omit it
   * and share the dashboard `brushSelection`; a graph node passes its OWN
   * Selection so an edge predicate filters only that node, not the whole app.
   */
  inputPredicate?: Selection;
}

export interface HostHandle<Config> {
  host: AppNodeHost<Config>;
  /** Owned by `<PluginMount>`. Idempotent full teardown. */
  dispose(): void;
}

const notify = (msg: string, level: "info" | "warn" | "error" = "info"): void => {
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else console.info(msg);
};

async function responseError(res: Response, fallback: string): Promise<Error> {
  const parsed = ErrorResponseSchema.safeParse(await res.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.error : fallback);
}

/** Build a live `NodeHost` factory bound to the current dashboard context. */
export function useDashboardHostShim() {
  const { state, meta, actions } = useDashboard();
  const { coordinator, brushSelection, table } = meta;
  const { metadata } = state;
  const { refreshMetadata } = actions;

  return useCallback(
    <Config>(init: HostInit<Config>): HostHandle<Config> => {
      const { instanceId, definition, bodyHeaderElement } = init;
      const inputPredicate = init.inputPredicate ?? brushSelection;
      const capabilities = new Set(definition.capabilities);
      const controller = new AbortController();
      const disposers: (() => void)[] = [];
      let config = init.config;
      let deviceLease: DeviceLease | null = null;
      // Memoized so `acquireDeviceLease` is idempotent (see below).
      let deviceLeasePromise: Promise<DeviceLease> | null = null;
      let disposed = false;

      const viewCoordination: ViewCoordinationAPI = {
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

      const focus: FocusCoordinationAPI = {
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

      const notifications: NodeNotificationAPI = { notify };

      // Data reads are universal here; row-set publication is capability-gated —
      // ungranted → absent from the object → `undefined` at runtime (the
      // §6.5/§4.3 guardrail). The `/api/*` literal lives HERE in core, never in
      // nodes/** — a node only ever calls `host.dataAPI.publishRowSet`.
      const canPublishRowSet = capabilities.has("row-set-publish");
      const dataAPI = {
        query<T = unknown>(sql: string) {
          return coordinator.query(sql) as unknown as Promise<T>;
        },
        ...(canPublishRowSet
          ? {
              async publishRowSet(rowIds: number[]) {
                // Per-instance temp table sel_<instanceId> (§6.5).
                const res = await fetch(`/api/selection/${encodeURIComponent(instanceId)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ row_indices: rowIds }),
                });
                if (!res.ok) throw await responseError(res, `selection failed (${res.status})`);
                const { table: selTable, count } = SelectionPublishResponseSchema.parse(await res.json());
                // The bus owns the tok=N cache-buster — plugins never invent it.
                return selectionBus.makeToken(selTable, count);
              },
              disposePublishedRowSet() {
                void fetch(`/api/selection/${encodeURIComponent(instanceId)}`, { method: "DELETE" }).catch(() => {});
              },
            }
          : {}),
        // "annotate" — create/list user annotation columns + stamp a label onto a
        // predicate's rows (the node-graph Annotate node). `/api/*` lives in core.
        ...(capabilities.has("annotation-write")
          ? {
              async listAnnotationColumns() {
                const res = await fetch("/api/annotations/columns");
                if (!res.ok) throw await responseError(res, `list failed (${res.status})`);
                return AnnotationColumnsResponseSchema.parse(await res.json()).columns;
              },
              async createAnnotationColumn(
                name: string,
                dtype: "categorical" | "string" | "integer" | "float" = "categorical",
              ) {
                const res = await fetch("/api/annotations/columns", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, dtype }),
                });
                if (!res.ok) throw await responseError(res, `create failed (${res.status})`);
                // Surface the new column in the Table + pickers (obs_columns refetch).
                await refreshMetadata();
              },
              async writeAnnotationByPredicate(column: string, label: string, predicate: string) {
                const res = await fetch("/api/annotations/values", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ column, label, predicate }),
                });
                if (!res.ok) throw await responseError(res, `write failed (${res.status})`);
                const out = AnnotationPredicateWriteResponseSchema.parse(await res.json());
                await refreshMetadata();
                return out;
              },
              async commitAnnotations(opts: { dryRun: boolean; columns?: string[] }) {
                const res = await fetch(`/api/annotations/commit${opts.dryRun ? "?dryRun=1" : ""}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(opts.columns ? { columns: opts.columns } : {}),
                });
                if (!res.ok) throw await responseError(res, `commit failed (${res.status})`);
                // No refreshMetadata: a commit writes on-disk `.obs`, not the DuckDB
                // `dataset` VIEW, so the client schema is unchanged.
                return CommitAnnotationsResponseSchema.parse(await res.json());
              },
            }
          : {}),
      } as NodeDataAPI;

      const host = {
        instanceId,
        definitionRef: definition.ref,
        capabilities,
        ...(bodyHeaderElement ? { bodyHeaderElement } : {}),

        data: { coordinator, table, metadata },
        registerClient(client: MosaicClient) {
          coordinator.connect(client);
          const unregister = () => coordinator.disconnect(client);
          disposers.push(unregister);
          return unregister;
        },

        inputPredicate,
        externalRowSet() {
          return broadcastBus.externalRowSet(instanceId);
        },
        onExternalRowSet(cb: (rowIds: readonly number[] | null) => void) {
          const off = broadcastBus.subscribeExternal(instanceId, cb);
          disposers.push(off);
          return off;
        },

        publishPredicate(facet: string, sql: string | null) {
          selectionBus.publishPredicate(instanceId, facet as SelectionFacet, sql);
        },
        publishRowSet(ids: number[]) {
          broadcastBus.publishRowSet(instanceId, ids);
        },
        clearRowSet() {
          // True clear (sync store -> "empty"), not an empty "active" set.
          broadcastBus.clear(instanceId);
        },

        viewCoordination,
        focus,
        notifications,

        acquireDeviceLease() {
          // One promise prevents StrictMode or multiple consumers from acquiring twice.
          deviceLeasePromise ??= deviceBroker.acquire(instanceId, controller.signal).then((lease) => {
            deviceLease = lease;
            return lease;
          });
          return deviceLeasePromise;
        },
        dataAPI,

        get config() {
          return config;
        },
        patchConfig(patch: Partial<Config>) {
          config = { ...config, ...patch };
        },
        onDispose(fn: () => void) {
          disposers.push(fn);
        },
        track(unsubscribe: () => void) {
          disposers.push(unsubscribe);
        },
        signal: controller.signal,
      } as unknown as AppNodeHost<Config>;

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
        dataAPI.disposePublishedRowSet();
      }

      return { host, dispose };
    },
    [coordinator, brushSelection, table, metadata, refreshMetadata],
  );
}
