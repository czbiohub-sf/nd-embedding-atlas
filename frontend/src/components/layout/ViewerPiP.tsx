import { useEffect } from "react";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import { FloatingWindow } from "../FloatingWindow";
import { CropViewer } from "../crops/CropViewer";
import { useDashboard } from "../../hooks/useDashboard";
import { registerViewerPiPHandle, unregisterViewerPiPHandle } from "../../providers/ViewerPiPStore";

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
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
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
