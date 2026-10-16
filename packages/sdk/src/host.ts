/** Capability-gated services scoped to one live node occurrence. */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { CommitAnnotationsResponse, FilterClause, Metadata, ObservationSet } from "@ndea/protocol";
import type { ExactNodeTypeRef, NodeCapability, NodeInstanceId, RowIndex } from "./node";

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

export interface DataContext {
  readonly coordinator: Coordinator;
  readonly table: string;
  readonly metadata: Metadata;
}

/** Persists observations as a content-addressed set; reference it as `{ op: "inSet", set }`. */
export interface RowSetPublishAPI {
  createObservationSet(rowIds: readonly RowIndex[]): Promise<ObservationSet>;
}

export interface DataQueryAPI {
  query(sql: string, signal?: AbortSignal): Promise<unknown>;
  categorize?(column: string, max?: number): Promise<unknown>;
  loadVarColumn?(name: string, layer?: string): Promise<unknown>;
  fetchCrop?(params: unknown): Promise<Blob>;
}

export interface AnnotationWriteAPI {
  listAnnotationColumns(): Promise<{ name: string; dtype: string }[]>;
  createAnnotationColumn(name: string, dtype?: "categorical" | "string" | "integer" | "float"): Promise<void>;
  writeAnnotationByPredicate(column: string, label: string, predicate: string): Promise<{ n: number }>;
  /**
   * Commits full columns to AnnData `.obs`; unannotated rows become NA.
   * The write is irreversible.
   */
  commitAnnotations(options: { dryRun: boolean; columns?: string[] }): Promise<CommitAnnotationsResponse>;
}

type CapabilityService<
  Capabilities extends NodeCapability,
  Required extends NodeCapability,
  Service,
> = Required extends Capabilities ? Service : object;

export type NodeDataAPI<Capabilities extends NodeCapability = never> = DataQueryAPI &
  CapabilityService<Capabilities, "row-set-publish", RowSetPublishAPI> &
  CapabilityService<Capabilities, "annotation-write", AnnotationWriteAPI>;

export interface ViewCoordinationAPI {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly linked: boolean;
  broadcast(state: { panX: number; panY: number; zoom: number }): void;
  toggleLock(): void;
  subscribe?(callback: (state: { panX: number; panY: number; zoom: number }) => void): () => void;
}

export interface OrderingCoordinationAPI {
  get(): { col: string; dir: "asc" | "desc" } | null;
  set(value: { col: string; dir: "asc" | "desc" } | null): void;
  subscribe?(callback: (value: { col: string; dir: "asc" | "desc" } | null) => void): () => void;
}

export interface FocusCoordinationAPI {
  get(): RowIndex | null;
  set(rowIndex: RowIndex | null): void;
  subscribe?(callback: (rowIndex: RowIndex | null) => void): () => void;
}

/** The color-by column shared by a `colorBy` scope; `linked` is false when unbound. */
export interface ColorCoordinationAPI {
  readonly linked: boolean;
  get(): string | null;
  set(column: string | null): void;
  subscribe(callback: (column: string | null) => void): () => void;
}

/**
 * One named clause slot under a node's source key in a filter scope, e.g.
 * `chart` or `lasso`. A node with several widgets uses one facet per widget.
 */
export type FilterFacet = string;

export interface ResolvedFilter {
  readonly predicate: string | null;
  readonly revision: number;
}

export interface MaterializedFilterRows {
  readonly rowIds: readonly RowIndex[];
  readonly revision: number;
}

/**
 * Crossfilter scope membership. A published clause lands in the workspace
 * document under this node; the node's `selection` carries the graph input plus
 * every other source's clauses, never its own.
 */
export interface FilterCoordinationAPI {
  /** Stable for this node occurrence, including graph and current-scope predicates. */
  readonly selection: Selection;
  getResolved(): ResolvedFilter;
  subscribeResolved(callback: (filter: ResolvedFilter) => void): () => void;
  publish(facet: FilterFacet, clause: FilterClause): void;
  clear(facet: FilterFacet): void;
  materializeRowIds(signal?: AbortSignal): Promise<MaterializedFilterRows>;
}

export interface NodeNotificationAPI {
  notify(message: string, level?: "info" | "warn" | "error"): void;
}

interface NodeHostBase<Config, Capabilities extends NodeCapability> {
  readonly instanceId: NodeInstanceId;
  readonly definitionRef: ExactNodeTypeRef;
  readonly capabilities: ReadonlySet<Capabilities>;
  readonly config: Config;
  patchConfig(patch: Partial<Config>): void;
  readonly notifications: NodeNotificationAPI;
  onDispose(disposer: () => void): void;
  track(unsubscribe: () => void): void;
  readonly signal: AbortSignal;
}

interface DataReadHost<Capabilities extends NodeCapability> {
  readonly data: DataContext;
  registerClient(client: MosaicClient): () => void;
  readonly inputPredicate: Selection;
  readonly dataAPI: NodeDataAPI<Capabilities>;
}

interface FocusHost {
  readonly focus: FocusCoordinationAPI;
}

interface ViewCoordinationHost {
  readonly viewCoordination: ViewCoordinationAPI;
}

interface OrderingCoordinationHost {
  readonly ordering: OrderingCoordinationAPI;
}

interface ColorCoordinationHost {
  readonly colorBy: ColorCoordinationAPI;
}

interface FilterCoordinationHost {
  readonly filter: FilterCoordinationAPI;
}

interface GPUHost {
  acquireDeviceLease(): Promise<DeviceLease>;
}

/**
 * Optional host services exist in the type only when the definition declares
 * their capability. Capability-free and erased consumers see only core fields.
 */
export type NodeHost<Config = unknown, Capabilities extends NodeCapability = never> = NodeHostBase<
  Config,
  Capabilities
> &
  CapabilityService<Capabilities, "data-read", DataReadHost<Capabilities>> &
  CapabilityService<Capabilities, "focus-coordination", FocusHost> &
  CapabilityService<Capabilities, "view-coordination", ViewCoordinationHost> &
  CapabilityService<Capabilities, "ordering-coordination", OrderingCoordinationHost> &
  CapabilityService<Capabilities, "color-coordination", ColorCoordinationHost> &
  CapabilityService<Capabilities, "filter-coordination", FilterCoordinationHost> &
  CapabilityService<Capabilities, "gpu-device", GPUHost>;
