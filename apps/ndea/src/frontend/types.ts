import type { TrajectoryFrame } from "@ndea/protocol";

export type {
  CommitAnnotationsResponse,
  CommitDatasetReport,
  DataCapability,
  Metadata,
  ObsInfo,
  ObsBbox,
} from "@ndea/protocol";
export type { TrajectoryFrame };

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

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}
