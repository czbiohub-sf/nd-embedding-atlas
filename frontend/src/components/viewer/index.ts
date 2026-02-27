import { ViewerCanvas } from "./ViewerCanvas";
import { ViewerProvider } from "./ViewerProvider";

export const Viewer = {
    Provider: ViewerProvider,
    Canvas: ViewerCanvas,
} as const;

export { ChannelControls } from "./ChannelControls";
export { ZRangeSlider } from "./RangeSlider";
export type { ChannelDef, ViewerActions, ViewerContextValue, ViewerMeta, ViewerState, ViewMode } from "./ViewerContext";
export { ViewerControls } from "./ViewerControls";
export { ViewerErrorBoundary } from "./ViewerErrorBoundary";
export { ViewerLoadingOverlay } from "./ViewerLoadingOverlay";
export { ViewModeToggle } from "./ViewModeToggle";
export { VolumeControls } from "./VolumeControls";
