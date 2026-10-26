/** Services scoped to one live dashboard element. */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type {
  AnnotationColumn,
  AnnotationDtype,
  CommitAnnotationsResponse,
  FilterClause,
  Metadata,
  ObservationSet,
} from "@ndea/protocol";
import type { RowIndex } from "./component";

export interface DeviceInfo {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
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

/** Saved selections as workspace data sources. */
export interface RowSetPublishAPI {
  /**
   * Saves `where` as a workspace data source named `<baseName>-<n>` (first free n ≥ 1,
   * since source names allow no spaces) and returns that name.
   */
  saveSource(baseName: string, where: FilterClause): string;
}

/**
 * Annotation fields: editable `label` / `text` columns joined into the dataset.
 * Field operations apply on the server at once; cell values arrive in batches
 * (the table's Save). Every write refreshes the app's metadata.
 */
export interface FieldEditAPI {
  listFields(): Promise<AnnotationColumn[]>;
  createField(name: string, dtype: AnnotationDtype): Promise<void>;
  /** Rename and/or convert a field. */
  updateField(name: string, patch: { name?: string; dtype?: AnnotationDtype }): Promise<void>;
  deleteField(name: string): Promise<void>;
  /** Set cell values by row; `null` clears a cell. */
  writeFieldValues(field: string, rows: readonly { rowIndex: RowIndex; value: string | null }[]): Promise<void>;
  /**
   * Writes whole fields into each source AnnData `.obs`; obs without a value
   * become NA. Irreversible unless `dryRun`.
   */
  commitFields(options: { dryRun: boolean; columns?: string[] }): Promise<CommitAnnotationsResponse>;
}

export type DataAPI = RowSetPublishAPI & FieldEditAPI;

/** 2D pan/zoom view. */
export interface PanZoomView {
  panX: number;
  panY: number;
  zoom: number;
}

/** 3D turntable view: orbit angles (radians), eye distance, orbit center, projection. */
export interface TurntableView {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  projection: "perspective" | "orthographic";
}

/**
 * A view-sync cell: the 2D view, plus the turntable when a 3D view wrote last.
 * 2D views apply only cells without 3D fields; 3D views only cells with them.
 */
export type ViewSyncState = PanZoomView & Partial<TurntableView>;

export interface ViewCoordinationAPI {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly linked: boolean;
  /** A 2D write replaces the scope's cell; a 3D write keeps its 2D fields. */
  broadcast(state: PanZoomView | TurntableView): void;
  toggleLock(): void;
  subscribe?(callback: (state: ViewSyncState) => void): () => void;
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
  /**
   * Publishes a row selection on `facet`: persists `bits` (a bitmask over all
   * `rows` observations; bit `r & 31` of word `r >> 5` = row `r`) as a
   * content-addressed set, then publishes `{ op: "inSet", set }`, and returns
   * the set. `null` clears the facet. Aborting `signal` before the set exists
   * publishes nothing and resolves null, so a superseded selection never lands.
   */
  publishSelection(
    facet: FilterFacet,
    bits: Uint32Array<ArrayBuffer> | null,
    rows: number,
    signal?: AbortSignal,
  ): Promise<ObservationSet | null>;
  /** This element's own clause for `facet`; undefined when unset or the element is unbound. */
  facet(facet: FilterFacet): FilterClause | undefined;
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
}
