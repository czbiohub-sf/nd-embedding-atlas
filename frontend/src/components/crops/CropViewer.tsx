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

  // Don't mount the viewer until the user first clicks an observation.
  // Once mounted, keep it alive to avoid WebGL teardown/recreation.
  if (!hasEverSelected.current) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface text-text-muted text-xs">
        Click an observation to view
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
          <div className="absolute left-2 top-2 z-20 flex flex-col gap-1">
            <ChannelControls />
            <VolumeControls />
          </div>
          <div className="absolute bottom-2 left-2 z-20">
            <ViewerControls cropSize={cropSize} setCropSize={setCropSize} />
          </div>
          {!state.highlightId && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface text-text-muted text-xs">
              Click an observation to view
            </div>
          )}
        </div>
      </Viewer.Provider>
    </ViewerErrorBoundary>
  );
}
