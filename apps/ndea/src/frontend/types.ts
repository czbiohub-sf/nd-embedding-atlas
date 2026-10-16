import type { TrajectoryFrame } from "@ndea/protocol";

export type { Metadata } from "@ndea/protocol";
export type { TrajectoryFrame };

export interface TrajectoryData {
  trackId: number;
  fovName: string;
  datasetKey?: string;
  tIndex: number;
  points: TrajectoryFrame[];
}
