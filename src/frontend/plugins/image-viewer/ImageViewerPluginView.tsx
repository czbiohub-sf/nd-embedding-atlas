/**
 * Image-viewer plugin view (PLUGIN-ARCHITECTURE §10.2).
 *
 * Phase 1: replicates `ImageViewerPanel` (CropViewer + plate gate) using
 * `useDashboard` for the reactive metadata/highlight reads. Phase 3 moves the
 * Idetik runtime to be per-instance and routes obs/crop through `host.api`.
 */

import { CropViewer } from "@/components/crops/CropViewer";
import { useDashboard } from "@/hooks/useDashboard";
import type { PluginViewProps } from "@/core/plugin/types";

export interface ViewerConfig {
  datasetKey: string | null;
}

export type ViewerOptions = Record<string, never>;

export function ImageViewerPluginView({ host }: PluginViewProps<ViewerConfig, ViewerOptions>) {
  const { state } = useDashboard();
  const datasetKey = host.config.datasetKey ?? undefined;

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
