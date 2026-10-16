import { ViewerCanvas } from "./ViewerCanvas";
import { ViewerProvider } from "./ViewerProvider";

export const Viewer = {
  Provider: ViewerProvider,
  Canvas: ViewerCanvas,
} as const;

export { ChannelControls } from "./ChannelControls";
export { ViewerControls } from "./ViewerControls";
export { ViewerErrorBoundary } from "./ViewerErrorBoundary";
export { ViewerLoadingOverlay } from "./ViewerLoadingOverlay";
export { VolumeControls } from "./VolumeControls";
