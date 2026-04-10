export type { Metadata, ObsInfo } from "./lib/schemas";

/** Pan/zoom state for a scatter view. */
export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface ObsmEntry {
  prefix: string;
  n_dims: number | null;
  loaded: boolean;
}

export interface AxisState {
  obsmKey: string;
  xDim: number;
  yDim: number;
}

// ── Trajectory ────────────────────────────────────────────────────────────

export interface TrajectoryFrame {
  t: number;
  /** Per-embedding coordinates keyed by column name (e.g. "pca_0": 1.23). */
  coords: Record<string, number>;
  spatial_x: number;
  spatial_y: number;
  category?: number;
  rowIndex?: number;
  datasetKey?: string;
}

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}

// ── Chart panel specs ──────────────────────────────────────────────────────

export interface CountPlotSpec {
  type: "count-plot";
  field: string;
  limit?: number;
  order?: "total-descending" | "alphabetical" | "selected-descending";
}

export interface HistogramSpec {
  type: "histogram";
  field: string;
  bins?: number;
  scaleType?: "linear" | "log" | "symlog";
}

export interface ScatterChartSpec {
  type: "scatter";
  xField: string;
  yField: string;
}

export interface BoxPlotSpec {
  type: "boxplot";
  field: string;
  groupField?: string;
}

export interface ObsSetsSpec {
  type: "obssets";
}

export type ChartSpec = CountPlotSpec | HistogramSpec | ScatterChartSpec | BoxPlotSpec | ObsSetsSpec;

export interface ChartPanelEntry {
  id: string;
  spec: ChartSpec;
  collapsed?: boolean;
}

// ── Observation info (from /api/obs/:id) ─────────────────────────────────────

export interface ObsBbox {
  y_min: number;
  x_min: number;
  y_max: number;
  x_max: number;
}
