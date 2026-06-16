import { useEffect } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import { capabilitiesOf } from "../../lib/capabilities";
import {
  registerDatasetViewerHandle,
  registerViewerPiPHandle,
  unregisterDatasetViewerHandle,
  unregisterViewerPiPHandle,
} from "../../stores/ViewerPiPStore";
import { CropViewer } from "../crops/CropViewer";
import { FloatingWindow } from "../FloatingWindow";

export function ViewerPiP() {
  const fw = useFloatingWindow({ initialWidth: 480, initialHeight: 480 });

  useEffect(() => {
    registerViewerPiPHandle(fw.open);
    return () => unregisterViewerPiPHandle();
  }, [fw.open]);

  return (
    <FloatingWindow handle={fw} title="Image Viewer">
      <ViewerContent />
    </FloatingWindow>
  );
}

function ViewerContent() {
  const { state } = useDashboard();

  if (!capabilitiesOf(state.metadata).has("plate-image")) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
        No plate data available
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-background">
      {/* Slot key must match what the galleries read for the single-dataset
          case (useGalleryChannels(datasetKey ?? "docked", …) in GalleryPane /
          TrackGallery), so viewer contrast/color/visibility flows to crops.
          It is also ViewerProvider's own default channelInstance. */}
      <CropViewer channelInstance="docked" />
    </div>
  );
}

// ── Per-dataset floating viewer ───────────────────────────────────────────────

export function DatasetViewerPiP({ datasetKey }: { datasetKey: string }) {
  const fw = useFloatingWindow({ initialWidth: 480, initialHeight: 480 });

  useEffect(() => {
    registerDatasetViewerHandle(datasetKey, fw.open);
    return () => unregisterDatasetViewerHandle(datasetKey);
  }, [datasetKey, fw.open]);

  return (
    <FloatingWindow handle={fw} title={datasetKey}>
      <div className="h-full w-full overflow-hidden">
        <CropViewer datasetKey={datasetKey} channelInstance={datasetKey} />
      </div>
    </FloatingWindow>
  );
}
