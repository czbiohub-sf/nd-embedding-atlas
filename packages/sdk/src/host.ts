/** Host services available to one plugin instance. */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { CommitAnnotationsResponse, Metadata } from "@ndea/protocol";
import type { MountReason, NodeCapability, NodeMeta } from "./types";

export interface DeviceInfo {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly preferredWorkgroupSize: 64 | 256;
}

export interface DeviceLease {
  readonly id: string;
  readonly info: DeviceInfo;
  release(): void;
}

export type NodeInstanceId = string & { readonly __brand: "NodeInstanceId" };

export function asInstanceId(s: string): NodeInstanceId {
  return s as NodeInstanceId;
}

export interface DataContext {
  readonly coordinator: Coordinator;
  readonly table: string;
  readonly metadata: Metadata;
}

/** Selection predicate backed by an instance-scoped temporary table. */
export interface SelectionToken {
  readonly predicate: string;
  readonly token: number;
  readonly count: number;
  readonly table: string;
}

/** Optional methods appear only when the node declares the matching capability. */
export interface DataApi {
  query<T = unknown>(sql: string, signal?: AbortSignal): Promise<T>;
  publishSelection?(rowIds: number[]): Promise<SelectionToken>;
  disposeSelection?(): void;
  categorize?(col: string, max?: number): Promise<unknown>;
  loadVarColumn?(name: string, layer?: string): Promise<unknown>;
  fetchCrop?(params: unknown): Promise<Blob>;
  listAnnotationColumns?(): Promise<{ name: string; dtype: string }[]>;
  createAnnotationColumn?(name: string, dtype?: "categorical" | "string" | "integer" | "float"): Promise<void>;
  writeAnnotationByPredicate?(column: string, label: string, predicate: string): Promise<{ n: number }>;
  /**
   * Commits full columns to AnnData `.obs`; unannotated rows become NA.
   * The write is irreversible.
   */
  commitAnnotations?(opts: { dryRun: boolean; columns?: string[] }): Promise<CommitAnnotationsResponse>;
}

export interface ViewSyncApi {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly linked: boolean;
  broadcast(state: { panX: number; panY: number; zoom: number }): void;
  toggleLock(): void;
  subscribe?(cb: (state: { panX: number; panY: number; zoom: number }) => void): () => void;
}

export interface OrderingApi {
  get(): { col: string; dir: "asc" | "desc" } | null;
  set(value: { col: string; dir: "asc" | "desc" } | null): void;
  subscribe?(cb: (value: { col: string; dir: "asc" | "desc" } | null) => void): () => void;
}

export interface HighlightApi {
  get(): string | null;
  set(id: string | null): void;
  subscribe?(cb: (id: string | null) => void): () => void;
}

export interface RenderApi {
  readonly pointRadius: number;
  setPointRadius(r: number): void;
}

/**
 * Container-independent UI surface. Plugins cast `panelApi` to the native
 * container type when needed.
 */
export interface PanelContext {
  readonly id: string;
  readonly title?: string;
  readonly panelApi?: unknown;
  /** Optional portal target for a toolbar no taller than 26px. */
  readonly headerEl?: HTMLElement;
  close?(): void;
}

export interface UiApi {
  readonly container: PanelContext;
  notify(msg: string, level?: "info" | "warn" | "error"): void;
}

export interface OptionsBuilder<Options> {
  defaults(o: Options): void;
}

export type NodeSessionEvent = "start" | "switch" | "shutdown";

/** State scoped to one plugin invocation rather than the instance lifetime. */
export interface NodeContext {
  readonly signal: AbortSignal;
  readonly epoch: number;
}

export interface NodeHost<Config = unknown, Options = unknown> {
  readonly instanceId: NodeInstanceId;
  readonly meta: NodeMeta;
  readonly reason: MountReason;
  readonly capabilities: ReadonlySet<NodeCapability>;

  readonly data: DataContext;
  registerClient(client: MosaicClient): () => void;

  readonly inputSelection: Selection;
  externalRowSet(): readonly number[] | null;
  onExternalRowSet(cb: (rowIds: readonly number[] | null) => void): () => void;

  publishPredicate(facet: string, sql: string | null): void;
  publishRowSet(ids: number[]): void;
  /** Clears the broadcast; unlike `publishRowSet([])`, downstream sees no active set. */
  clearRowSet(): void;

  readonly viewSync: ViewSyncApi;
  readonly highlight: HighlightApi;
  readonly render: RenderApi;
  readonly ordering?: OrderingApi;

  readonly ui: UiApi;

  acquireDeviceLease(): Promise<DeviceLease>;
  readonly api: DataApi;

  readonly config: Config;
  patchConfig(patch: Partial<Config>): void;
  readonly options: Options;

  onDispose(fn: () => void): void;
  track(unsubscribe: () => void): void;
  readonly signal: AbortSignal;
}
