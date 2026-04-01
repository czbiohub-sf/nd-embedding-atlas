import type { IDockviewPanelProps } from "dockview-react";
import { useDashboard } from "../../../hooks/useDashboard";
import { CropViewer } from "../../crops/CropViewer";

export function ImageViewerPanel(_props: IDockviewPanelProps) {
  const { state } = useDashboard();

  if (!state.metadata.plate) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-muted text-xs">
        No plate data available
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <CropViewer />
    </div>
  );
}
