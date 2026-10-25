import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useFocus } from "../query/useFocus";
import { useImageViewerHost, useImageViewerServices } from "./context";
import { Viewer, ViewerControls, ViewerErrorBoundary, ViewerLoadingOverlay } from "./viewer";
import type { RenderMode } from "./viewer/ViewerControls";
import { RemoteViewerProvider } from "./viewer/RemoteViewerProvider";
import { RenderPageBridge } from "./viewer/RenderPageBridge";
import { SingleCropViewer } from "./SingleCropViewer";
import { ViewerPauseGate } from "./ViewerPauseGate";
import { formatViewerObsReadout } from "./focus-behavior";

interface CropViewerProps {
  channelInstance?: string;
  datasetKey?: string;
  /** remote: show the server's render stream; page: be that headless render page. */
  mode: "local" | "remote" | "page";
  onRender: (mode: RenderMode) => void;
}

/**
 * Small readout of what the viewer is actually showing: fov · track · T :
 * mirrors the gallery card label so the two can be compared at a glance.
 * Shares the ["obs", focusedRowIndex] query with SingleCropViewer.
 */
function ViewerObsReadout() {
  const host = useImageViewerHost();
  const { loadCrop } = useImageViewerServices();
  const focusedRowIndex = useFocus(host);
  const { data } = useQuery({
    queryKey: ["obs", focusedRowIndex],
    queryFn: async () => {
      return await loadCrop(focusedRowIndex!);
    },
    enabled: focusedRowIndex != null,
    staleTime: 10_000,
  });
  const readout = formatViewerObsReadout(data);
  if (focusedRowIndex == null || readout == null) return null;
  return (
    <div className="pointer-events-none absolute top-2 right-2 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-sm text-white/85">
      {readout}
    </div>
  );
}

export function CropViewer({ channelInstance = "docked", datasetKey, mode, onRender }: CropViewerProps) {
  // Focus read: scoped to this element's host (coordination group).
  const host = useImageViewerHost();
  const { remote } = useImageViewerServices();
  const focusedRowIndex = useFocus(host);

  const [hasEverSelected, setHasEverSelected] = useState(false);

  if (focusedRowIndex != null && !hasEverSelected) {
    setHasEverSelected(true);
  }

  // Don't mount the viewer until the user first clicks an observation.
  // Once mounted, keep it alive to avoid WebGL teardown/recreation.
  if (focusedRowIndex == null && !hasEverSelected) {
    return <div className="h-full w-full" />;
  }

  const canvas = <Viewer.Canvas className="absolute inset-0 h-full w-full" />;
  // The render page streams the bare canvas; its controls render on the remote tile.
  if (mode === "page" && remote.page) {
    return (
      <ViewerErrorBoundary>
        <Viewer.Provider channelInstance={channelInstance}>
          <ViewerPauseGate focusedRowIndex={focusedRowIndex} />
          <div className="relative h-full">
            {canvas}
            <SingleCropViewer datasetKey={datasetKey} />
            <RenderPageBridge page={remote.page} />
          </div>
        </Viewer.Provider>
      </ViewerErrorBoundary>
    );
  }

  const overlays = (
    <>
      <ViewerObsReadout />
      <ViewerLoadingOverlay />
      <ViewerControls
        datasetKey={datasetKey}
        render={{ mode: mode === "remote" ? "remote" : "local", onChange: onRender }}
      />
    </>
  );
  return (
    <ViewerErrorBoundary>
      {mode === "remote" ? (
        <RemoteViewerProvider channelInstance={channelInstance} onRenderLocal={() => onRender("local")}>
          {canvas}
          {overlays}
        </RemoteViewerProvider>
      ) : (
        <Viewer.Provider channelInstance={channelInstance}>
          <ViewerPauseGate focusedRowIndex={focusedRowIndex} />
          <div className="relative h-full">
            {canvas}
            <SingleCropViewer datasetKey={datasetKey} />
            {overlays}
          </div>
        </Viewer.Provider>
      )}
    </ViewerErrorBoundary>
  );
}
