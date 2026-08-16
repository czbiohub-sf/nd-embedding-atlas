import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import type { Metadata, TrajectoryFrame } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";
import type { Store } from "@tanstack/store";

export interface ScatterConfig {
  obsmKey: string | null;
  colorByColumn: string | null;
}

export interface ScatterOptions {
  pointRadius: number;
  pointOpacity: number;
}

export type ScatterCapabilities =
  | "data-read"
  | "row-set-publish"
  | "focus-coordination"
  | "view-coordination"
  | "filter-coordination"
  | "schema-mutation"
  | "gpu-device"
  | "wasm-bitmap";

export interface AxisState {
  obsmKey: string;
  xDim: number;
  yDim: number;
}

export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}

export type { Metadata, TrajectoryFrame };

export type PanelId = string & { readonly __brand: "PanelId" };
export const panelId = (id: string): PanelId => id as PanelId;

export type GpuPointIndex = number & { readonly __brand: "GpuPointIndex" };
export const gpuPointIndex = (value: number): GpuPointIndex => value as GpuPointIndex;

export interface CategoryLegendItem {
  label: string;
  color: string;
  index: number;
  count: number;
}

export interface CategoryMapping {
  indexColumn: string;
  legend: CategoryLegendItem[];
}

export type ColorMode = "categorical" | "continuous";
export type ColumnType = "string" | "number" | "boolean" | "other";

export interface ColormapList {
  categorical: string[];
  continuous: string[];
}

export interface FocusedPointMeta {
  trackable: boolean;
  trackId?: number;
  fovName?: string;
  t?: number;
  datasetKey?: string;
}

export interface ScatterSession {
  readonly state: {
    readonly metadata: Metadata;
    readonly focusedRowIndex: RowIndex | null;
    readonly trajectories: Readonly<Record<string, TrajectoryData | null>>;
  };
  readonly actions: {
    setFocus(rowIndex: RowIndex | null): void;
    refreshMetadata(): Promise<void>;
    setTrajectory(data: TrajectoryData | null): void;
    setTrajectoryTIndex(key: string, t: number): void;
    clearTrajectory(datasetKey: string): void;
  };
  readonly runtime: {
    readonly coordinator: Coordinator;
    readonly brushSelection: Selection;
    readonly table: string;
  };
}

export interface RenderSettingsState {
  pointOpacity: number;
  toneMapping: "none" | "reinhard" | "aces" | "agx" | "neutral";
  blendMode: "additive" | "premultiplied" | "max";
  exposure: number;
}

export interface ScatterServices {
  useSession(): ScatterSession;
  useFocusedPointMeta(rowIndex: RowIndex | null): FocusedPointMeta;
  useColumnTypes(coordinator: Coordinator): Map<string, ColumnType> | null;
  useColormapList(): { data?: ColormapList };
  useColormapPalette(colormap: string, count: number): { data?: string[] };
  getColormapList(): ColormapList;
  categorize(coordinator: Coordinator, column: string, maxCategories: number): Promise<CategoryMapping>;
  buildColormapLut(name: string): Uint32Array;
  pickDefaultCategoricalPalette(count: number): string;
  readonly pointRadiusStore: Store<{ radius: number }>;
  readonly renderSettingsStore: Store<RenderSettingsState>;
  readonly wsClient: {
    readonly isConnected: boolean;
    subscribe(
      method: "var-column/status",
      request: { task_id: string },
      onData: (message: unknown) => void,
      onError: (error: Error) => void,
    ): { unsubscribe(): void };
  };
  isReconnectError(error: Error): boolean;
  onDeviceLost(listener: (info: GPUDeviceLostInfo) => void): () => void;
  createCheckpoint(host: unknown): string | null;
  bodyHeaderElement(host: unknown): HTMLElement;
}
