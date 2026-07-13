/** Capability-gated services scoped to one live node occurrence. */

import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import type { CommitAnnotationsResponse, Metadata } from "@ndea/protocol";
import type { ExactNodeTypeRef, NodeCapability, NodeInstanceId } from "./node";

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

/** Predicate backed by an instance-scoped temporary row-set table. */
export interface RowSetPublication {
  readonly predicate: string;
  readonly token: number;
  readonly count: number;
  readonly table: string;
}

export interface DataQueryAPI {
  query<T = unknown>(sql: string, signal?: AbortSignal): Promise<T>;
  categorize?(column: string, max?: number): Promise<unknown>;
  loadVarColumn?(name: string, layer?: string): Promise<unknown>;
  fetchCrop?(params: unknown): Promise<Blob>;
}

export interface RowSetPublishAPI {
  publishRowSet(rowIds: number[]): Promise<RowSetPublication>;
  disposePublishedRowSet(): void;
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

export type NodeDataAPI<Capabilities extends NodeCapability = NodeCapability> = DataQueryAPI &
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
  get(): string | null;
  set(id: string | null): void;
  subscribe?(callback: (id: string | null) => void): () => void;
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

interface RowSetSubscribeHost {
  externalRowSet(): readonly number[] | null;
  onExternalRowSet(callback: (rowIds: readonly number[] | null) => void): () => void;
}

interface PredicatePublishHost {
  publishPredicate(facet: string, sql: string | null): void;
}

interface RowSetPublishHost {
  publishRowSet(ids: number[]): void;
  /** Clears the broadcast; publishing `[]` instead keeps an active empty set. */
  clearRowSet(): void;
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

interface GPUHost {
  acquireDeviceLease(): Promise<DeviceLease>;
}

/**
 * Optional host services exist in the type only when the definition declares
 * their capability. Using the default capability union exposes the full host to
 * app adapters; author definitions should preserve their inferred narrow union.
 */
export type NodeHost<Config = unknown, Capabilities extends NodeCapability = NodeCapability> = NodeHostBase<
  Config,
  Capabilities
> &
  CapabilityService<Capabilities, "data-read", DataReadHost<Capabilities>> &
  CapabilityService<Capabilities, "row-set-subscribe", RowSetSubscribeHost> &
  CapabilityService<Capabilities, "predicate-publish", PredicatePublishHost> &
  CapabilityService<Capabilities, "row-set-publish", RowSetPublishHost> &
  CapabilityService<Capabilities, "focus-coordination", FocusHost> &
  CapabilityService<Capabilities, "view-coordination", ViewCoordinationHost> &
  CapabilityService<Capabilities, "ordering-coordination", OrderingCoordinationHost> &
  CapabilityService<Capabilities, "gpu-device", GPUHost>;
