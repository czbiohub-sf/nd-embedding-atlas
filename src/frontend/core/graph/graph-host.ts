/**
 * Transform-scoped NodeHost (node-graph tracer bullet).
 *
 * `makeTransformHost` — a `transform` node drives the GraphEngine through the REAL
 * plugin contract: the engine's cook calls the instance's `recompute(inputs, ctx)`,
 * which reads its params from `host.config` and emits its output via
 * `host.publishPredicate`. This host captures that publish synchronously
 * (`onPublish`) so the engine can return it, and routes `patchConfig` through
 * `onConfigPatch` so a param edit dirties the node. The view-only surface
 * (`inputSelection`, GPU lease, cross-view facets, row-set broadcast) is inert:
 * a graph edge, not a shared Selection, carries a transform's input.
 *
 * A `view` plugin mounted as a graph node does NOT use this host — it reuses the
 * full `useDashboardHostShim` with a per-node `inputSelection` override (§6.1),
 * so the device lease + cross-view buses come for free (see `PluginViewNode`).
 */

import { type Coordinator, type MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { Metadata } from "@/types";
import type {
  DataApi,
  HighlightApi,
  NodeHost,
  NodeInstanceId,
  NodeMeta,
  RenderApi,
  UiApi,
  ViewSyncApi,
} from "@/core/node/sdk";

export interface TransformHostInit<Config> {
  instanceId: NodeInstanceId;
  meta: NodeMeta;
  config: Config;
  coordinator: Coordinator;
  table: string;
  metadata: Metadata;
  /** Capture sink — the instance's `recompute` publishes its output predicate here. */
  onPublish: (sql: string | null) => void;
  /** Called after every config patch so the engine can dirty this node. */
  onConfigPatch: () => void;
}

const inertViewSync: ViewSyncApi = {
  panX: 0,
  panY: 0,
  zoom: 1,
  linked: false,
  broadcast() {},
  toggleLock() {},
};

const inertHighlight: HighlightApi = { get: () => null, set() {} };
const inertRender: RenderApi = { pointRadius: 0, setPointRadius() {} };

export function makeTransformHost<Config, Options>(init: TransformHostInit<Config>): NodeHost<Config, Options> {
  const { instanceId, meta, coordinator, table, metadata, onPublish, onConfigPatch } = init;
  let config = init.config;
  const controller = new AbortController();
  const disposers: (() => void)[] = [];

  const api: DataApi = {
    query<T = unknown>(sql: string) {
      return coordinator.query(sql) as unknown as Promise<T>;
    },
  };

  const ui: UiApi = {
    container: { id: instanceId as string },
    notify(msg, level = "info") {
      if (level === "error") console.error(msg);
      else if (level === "warn") console.warn(msg);
      else console.info(msg);
    },
  };

  return {
    instanceId,
    meta,
    reason: "graph-node",
    capabilities: meta.capabilities,

    data: { coordinator, table, metadata },
    registerClient(_client: MosaicClient) {
      // A transform has no Mosaic view-client; nothing to connect.
      return () => {};
    },

    // ── view-only selection surface — inert on a transform (edge-driven input) ──
    inputSelection: Selection.crossfilter(),
    externalRowSet: () => null,
    onExternalRowSet: () => () => {},
    publishPredicate(_facet, sql) {
      onPublish(sql);
    },
    publishRowSet() {},
    clearRowSet() {},

    viewSync: inertViewSync,
    highlight: inertHighlight,
    render: inertRender,
    ui,

    acquireDeviceLease: () => Promise.reject(new Error("transform host: no GPU device")),
    api,

    get config() {
      return config;
    },
    patchConfig(patch) {
      config = { ...config, ...patch };
      onConfigPatch();
    },
    options: {} as Options,

    onDispose(fn) {
      disposers.push(fn);
    },
    track(unsubscribe) {
      disposers.push(unsubscribe);
    },
    signal: controller.signal,
  };
}
