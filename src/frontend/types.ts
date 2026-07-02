export type {
  CommitAnnotationsResponse,
  CommitDatasetReport,
  DataCapability,
  Metadata,
  ObsInfo,
  ObsBbox,
} from "../protocol/index.ts";

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
  /** Per-obs Z plane, when the dataset provides one. Crops render at this Z. */
  z?: number;
}

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}
