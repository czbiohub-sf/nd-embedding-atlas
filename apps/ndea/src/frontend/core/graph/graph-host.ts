/** Transform-scoped host used by the current app-local graph adapter. */

import { type Coordinator, type MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { Metadata } from "@/types";
import type { ExactNodeTypeRef, NodeDataAPI, NodeHost, NodeInstanceId } from "@ndea/sdk";

export type TransformCapabilities = "data-read" | "predicate-publish" | "compute";

export interface TransformHostInit<Config> {
  instanceId: NodeInstanceId;
  definitionRef: ExactNodeTypeRef;
  config: Config;
  coordinator: Coordinator;
  table: string;
  metadata: Metadata;
  onPublish: (sql: string | null) => void;
  onConfigPatch: () => void;
}

export interface TransformHostHandle<Config> {
  readonly host: NodeHost<Config, TransformCapabilities>;
  dispose(): void;
}

export function makeTransformHost<Config>(init: TransformHostInit<Config>): TransformHostHandle<Config> {
  const { instanceId, definitionRef, coordinator, table, metadata, onPublish, onConfigPatch } = init;
  let config = init.config;
  const controller = new AbortController();
  const disposers: (() => void)[] = [];

  const dataAPI: NodeDataAPI<TransformCapabilities> = {
    query<T = unknown>(sql: string) {
      return coordinator.query(sql) as unknown as Promise<T>;
    },
  };

  const host: NodeHost<Config, TransformCapabilities> = {
    instanceId,
    definitionRef,
    capabilities: new Set<TransformCapabilities>(["data-read", "predicate-publish", "compute"]),
    data: { coordinator, table, metadata },
    registerClient(_client: MosaicClient) {
      return () => {};
    },
    inputPredicate: Selection.crossfilter(),
    publishPredicate(_facet, sql) {
      onPublish(sql);
    },
    dataAPI,
    get config() {
      return config;
    },
    patchConfig(patch) {
      config = { ...config, ...patch };
      onConfigPatch();
    },
    notifications: {
      notify(message, level = "info") {
        if (level === "error") console.error(message);
        else if (level === "warn") console.warn(message);
        else console.info(message);
      },
    },
    onDispose(disposer) {
      disposers.push(disposer);
    },
    track(unsubscribe) {
      disposers.push(unsubscribe);
    },
    signal: controller.signal,
  };

  let disposed = false;
  return {
    host,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        disposers[index]();
      }
      disposers.length = 0;
    },
  };
}
