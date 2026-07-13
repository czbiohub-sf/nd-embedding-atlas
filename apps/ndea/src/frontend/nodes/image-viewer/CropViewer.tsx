import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useHost } from "@/core/host/host-context";
import { useNodeFocus } from "@/core/node/use-node-focus";
import {
  ChannelControls,
  Viewer,
  ViewerControls,
  ViewerErrorBoundary,
  ViewerLoadingOverlay,
  VolumeControls,
} from "@/nodes/image-viewer/viewer";
import { SingleCropViewer } from "./SingleCropViewer";
import { ViewerPauseGate } from "./ViewerPauseGate";
import type { ImageViewerCapabilities } from "./plugin";
import { focusedObservationPath, formatViewerObsReadout, type ViewerObsSummary } from "./focus-behavior";

interface CropViewerProps {
  channelInstance?: string;
  datasetKey?: string;
}

/**
 * Small readout of what the viewer is actually showing — fov · track · T —
 * mirrors the gallery card label so the two can be compared at a glance.
 * Shares the ["obs", focusedRowIndex] query with SingleCropViewer.
 */
function ViewerObsReadout() {
  const host = useHost<unknown, ImageViewerCapabilities>();
  const focusedRowIndex = useNodeFocus(host);
  const { data } = useQuery({
    queryKey: ["obs", focusedRowIndex],
    queryFn: async () => {
      const r = await fetch(focusedObservationPath(focusedRowIndex!));
      return (await r.json()) as ViewerObsSummary;
    },
    enabled: focusedRowIndex != null,
    staleTime: 10_000,
  });
  const readout = formatViewerObsReadout(data);
  if (focusedRowIndex == null || readout == null) return null;
  return (
    <div className="pointer-events-none absolute top-2 right-2 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-2xs text-white/85">
      {readout}
    </div>
  );
}

export function CropViewer({ channelInstance = "docked", datasetKey }: CropViewerProps) {
  // Focus read: scoped to this instance's host (sync group / focus wire).
  const host = useHost<unknown, ImageViewerCapabilities>();
  const focusedRowIndex = useNodeFocus(host);

  const hasEverSelected = useRef(false);
  const [cropSize, setCropSize] = useState(100);
  const [showBbox, setShowBbox] = useState(true);

  if (focusedRowIndex != null) {
    hasEverSelected.current = true;
  }

  // Don't mount the viewer until the user first clicks an observation.
  // Once mounted, keep it alive to avoid WebGL teardown/recreation.
  if (!hasEverSelected.current) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
        Click an observation to view
      </div>
    );
  }

  return (
    <ViewerErrorBoundary>
      <Viewer.Provider channelInstance={channelInstance}>
        <ViewerPauseGate focusedRowIndex={focusedRowIndex} />
        <div className="relative h-full">
          <Viewer.Canvas className="absolute inset-0 h-full w-full" />
          <SingleCropViewer cropSize={cropSize} showBbox={showBbox} datasetKey={datasetKey} />
          <ViewerObsReadout />
          <ViewerLoadingOverlay />
          <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
            <ChannelControls />
            <VolumeControls />
          </div>
          <div className="absolute bottom-2 left-2 z-20">
            <ViewerControls
              cropSize={cropSize}
              setCropSize={setCropSize}
              showBbox={showBbox}
              setShowBbox={setShowBbox}
              datasetKey={datasetKey}
            />
          </div>
          {focusedRowIndex == null && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              Click an observation to view
            </div>
          )}
        </div>
      </Viewer.Provider>
    </ViewerErrorBoundary>
  );
}
