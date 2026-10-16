/** Services scoped to one live dashboard element. */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { CommitAnnotationsResponse, FilterClause, Metadata, ObservationSet } from "@ndea/protocol";
import type { RowIndex } from "./component";

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

export type DataAPI = DataQueryAPI & RowSetPublishAPI & AnnotationWriteAPI;

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
 * One named clause slot under an element's source key in a filter scope, e.g.
 * `chart` or `lasso`. An element with several widgets uses one facet per widget.
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
 * document under this element; its `selection` carries the element's data
 * source plus every other source's clauses, never its own.
 */
export interface FilterCoordinationAPI {
  /** Stable for this element, including its data-source and current-scope predicates. */
  readonly selection: Selection;
  getResolved(): ResolvedFilter;
  subscribeResolved(callback: (filter: ResolvedFilter) => void): () => void;
  publish(facet: FilterFacet, clause: FilterClause): void;
  clear(facet: FilterFacet): void;
  materializeRowIds(signal?: AbortSignal): Promise<MaterializedFilterRows>;
}

export interface NotificationAPI {
  notify(message: string, level?: "info" | "warn" | "error"): void;
}

/** Every service one dashboard element's body sees. */
export interface ComponentHost<Config = unknown> {
  /** The dashboard element id. */
  readonly elementId: string;
  /** The component type. */
  readonly type: string;
  readonly config: Config;
  patchConfig(patch: Partial<Config>): void;
  readonly notifications: NotificationAPI;
  onDispose(disposer: () => void): void;
  track(unsubscribe: () => void): void;
  readonly signal: AbortSignal;
  readonly data: DataContext;
  registerClient(client: MosaicClient): () => void;
  /** What the element shows: its data source AND its filter scope. */
  readonly predicate: Selection;
  readonly dataAPI: DataAPI;
  readonly focus: FocusCoordinationAPI;
  readonly viewSync: ViewCoordinationAPI;
  readonly ordering: OrderingCoordinationAPI;
  readonly colorBy: ColorCoordinationAPI;
  readonly filter: FilterCoordinationAPI;
  acquireDeviceLease(): Promise<DeviceLease>;
  /** The element header's toolbar slot. */
  readonly bodyHeaderElement: HTMLElement;
}
