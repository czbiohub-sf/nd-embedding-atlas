import { useEffect } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
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

  if (!state.metadata.plate) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
        No plate data available
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-base">
      <CropViewer channelInstance="pip" />
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
