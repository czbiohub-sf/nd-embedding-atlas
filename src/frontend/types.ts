export type { Metadata, ObsInfo, ObsBbox } from "../protocol/index.ts";

/** Pan/zoom state for a scatter view. */
export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface AxisState {
  obsmKey: string;
  xDim: number;
  yDim: number;
}

// ── Trajectory ────────────────────────────────────────────────────────────

export interface TrajectoryFrame {
  t: number;
  emb_x: number;
  emb_y: number;
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
