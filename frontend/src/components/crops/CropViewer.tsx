import { useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import {
    ChannelControls,
    Viewer,
    ViewerControls,
    ViewerErrorBoundary,
    ViewerLoadingOverlay,
    VolumeControls,
} from "../viewer";
import { SingleCropViewer } from "./SingleCropViewer";
import { ViewerPauseGate } from "./ViewerPauseGate";

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
                <ViewerPauseGate active={!!state.highlightId} />
                <div className="relative h-full bg-base">
                    <Viewer.Canvas className="absolute inset-0 h-full w-full" />
                    <SingleCropViewer cropSize={cropSize} />
                    <ViewerLoadingOverlay />
                    <div className="absolute right-0 bottom-0 left-0 z-10 flex flex-col gap-1 bg-surface/90 px-2 py-1.5 backdrop-blur-sm">
                        <ChannelControls />
                        <VolumeControls />
                        <ViewerControls cropSize={cropSize} setCropSize={setCropSize} />
                    </div>
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
