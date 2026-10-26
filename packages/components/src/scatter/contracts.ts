import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import type { Metadata, TrajectoryFrame } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";
import type { Store } from "@tanstack/store";
import type { LinearColormap } from "@ndea/colors";

/**
 * How the density path (overviews with too many points for markers) composites categorical
 * colors per pixel: the average color, the dominant class, or classes woven by share.
 */
export type DensityMode = "mean" | "dominant" | "weave";

/** 3D lasso/marquee depth: everything projecting inside (`through`), or the nearest dense structure (`front`). */
export type SelectionDepth = "through" | "front";

/** Drag tool: pointer pans and click-focuses; box and lasso draw a selection. */
export type SelectionTool = "pointer" | "box" | "lasso";

/** How a finished box/lasso meets the current selection: replace it, add to it (shift), subtract from it (⌥). */
export type SelectionCombine = "replace" | "add" | "subtract";

export interface ScatterConfig {
  obsmKey: string | null;
  colorByColumn: string | null;
  /** Embedding dimensions (column indices into the obsm matrix) on the x and y axes. */
  xDim: number;
  yDim: number;
  /** Embedding dimension for the z axis; null = 2D. */
  zDim: number | null;
  density: { mode: DensityMode };
  /** Point radius in normalized device units. */
  pointSize: number;
  /** The legend opens from the control group (`popover`) or stays in the view's bottom-left (`pinned`). */
  legend: "popover" | "pinned";
}

export interface AxisState {
  obsmKey: string;
  xDim: number;
  yDim: number;
  /** null = 2D. */
  zDim: number | null;
}

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}

export type { Metadata, TrajectoryFrame };

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
    readonly trajectories: Readonly<Record<string, TrajectoryData | null>>;
  };
  readonly actions: {
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
  getCategoricalPalette(colormap: string, count: number): string[];
  getColormapList(): ColormapList;
  /** The continuous colormap a picker name refers to (unknown names: a gray ramp); the GPU samples it. */
  getContinuousColormap(name: string): LinearColormap;
  categorize(column: string, maxCategories: number): Promise<CategoryMapping>;
  pickDefaultCategoricalPalette(count: number): string;
  readonly renderSettingsStore: Store<RenderSettingsState>;
  onDeviceLost(listener: (info: GPUDeviceLostInfo) => void): () => void;
}
