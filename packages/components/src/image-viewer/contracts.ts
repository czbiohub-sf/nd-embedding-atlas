import type { ChannelStat, ObsInfo, TrajectoryFrame } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";
import type { ChannelDef } from "./viewer/ViewerContext";

export interface ImageViewerConfig {
  datasetKey: string | null;
}

export interface ImageViewerTrajectory {
  readonly tIndex: number;
  readonly points: readonly TrajectoryFrame[];
}

export interface ImageViewerSessionSnapshot {
  readonly trajectories: Readonly<Record<string, ImageViewerTrajectory | null>>;
  setTrajectoryTIndex(datasetKey: string, tIndex: number): void;
}

export interface ImageViewerSharedStateService {
  publishChannels(elementId: string, channels: readonly ChannelDef[]): void;
  clearChannels(elementId: string): void;
  publishZ(elementId: string, zIndex: number): void;
  clearZ(elementId: string): void;
}

/** App-owned data and shared state needed beyond the ComponentHost. */
export interface ImageViewerServices {
  useSessionSnapshot(): ImageViewerSessionSnapshot;
  loadCrop(rowIndex: RowIndex, signal?: AbortSignal): Promise<ObsInfo>;
  loadChannelStats(
    fovName: string,
    datasetKey: string | undefined,
    signal?: AbortSignal,
  ): Promise<readonly ChannelStat[] | null>;
  readonly sharedState: ImageViewerSharedStateService;
}
