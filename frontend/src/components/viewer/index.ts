import { ViewerCanvas } from "./ViewerCanvas";
import { ViewerProvider } from "./ViewerProvider";

export const Viewer = {
    Provider: ViewerProvider,
    Canvas: ViewerCanvas,
} as const;

export type { ViewerActions, ViewerContextValue, ViewerMeta, ViewerState } from "./ViewerContext";
export { ViewerControls } from "./ViewerControls";
export { ViewerErrorBoundary } from "./ViewerErrorBoundary";
export { ViewerLoadingOverlay } from "./ViewerLoadingOverlay";
