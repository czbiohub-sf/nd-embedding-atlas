import type { IDockviewPanelProps } from "dockview-react";
import { useDashboard } from "../../../hooks/useDashboard";
import { CropViewer } from "../../crops/CropViewer";

export function ImageViewerPanel(props: IDockviewPanelProps<{ datasetKey?: string }>) {
  const { state } = useDashboard();
  const datasetKey = props.params?.datasetKey;

  if (!state.metadata.plate) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
        No plate data available
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <CropViewer datasetKey={datasetKey} />
    </div>
  );
}
