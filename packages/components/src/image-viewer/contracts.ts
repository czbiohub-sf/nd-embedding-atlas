import type { ChannelStat, ObsInfo, TrajectoryFrame } from "@ndea/protocol";
import type { RowIndex } from "@ndea/sdk";
import type { ChannelDef } from "./viewer/ViewerContext";

export interface ImageViewerConfig {
  datasetKey: string | null;
  render: "local" | "remote";
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

/** Remote rendering (`render: "remote"`): the app owns the render socket route. */
export interface ImageViewerRemoteService {
  /** Opens a render socket; with `session`, as that session's headless render page. */
  connect(session?: string): WebSocket;
  /** Set on the headless render page: the session it renders for, with its frame rate and bits per pixel. */
  readonly page: { readonly session: string; readonly fps: number; readonly bpp: number } | null;
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
  readonly remote: ImageViewerRemoteService;
}
