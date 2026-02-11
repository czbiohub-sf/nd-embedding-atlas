import { useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { Viewer, ViewerControls, ViewerErrorBoundary, ViewerLoadingOverlay } from "../viewer";
import { SingleCropViewer } from "./SingleCropViewer";

export function CropViewer() {
    const { state } = useDashboard();
    const hasEverSelected = useRef(false);
    const [cropSize, setCropSize] = useState(100);

    if (state.highlightId) {
        hasEverSelected.current = true;
    }

    // Don't mount the viewer until the user first clicks a cell.
    // Once mounted, keep it alive to avoid WebGL teardown/recreation.
    if (!hasEverSelected.current) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-surface text-text-muted text-xs">
                Click a cell to view
            </div>
        );
    }

    return (
        <ViewerErrorBoundary>
            <Viewer.Provider>
                <div className="relative h-full bg-base">
                    <Viewer.Canvas className="absolute inset-0 h-full w-full" />
                    <SingleCropViewer cropSize={cropSize} />
                    <ViewerLoadingOverlay />
                    <ViewerControls cropSize={cropSize} setCropSize={setCropSize} />
                    {!state.highlightId && (
                        <div className="absolute inset-0 flex items-center justify-center bg-surface text-text-muted text-xs">
                            Click a cell to view
                        </div>
                    )}
                </div>
            </Viewer.Provider>
        </ViewerErrorBoundary>
    );
}
