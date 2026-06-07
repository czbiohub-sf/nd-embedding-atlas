/**
 * Image-viewer plugin view (PLUGIN-ARCHITECTURE §10.2).
 *
 * Sources the plate gate from `host.data` and wraps the viewer subtree in
 * `HostProvider` so the body can later read `host.*` without prop-drilling. The
 * reactive highlight read that drives the crop stays on core state inside the
 * host-less `SingleCropViewer` (host.highlight.get() is non-reactive), and the
 * obs/crop fetches stay direct for now — routing them through host.api.fetchCrop/
 * fetchObsInfo + per-instance SOURCE_CACHE/Idetik teardown is deferred until a
 * second concurrent viewer instance is actually exercised (premature today).
 */

import { CropViewer } from "@/components/crops/CropViewer";
import { HostProvider } from "@/core/host/host-context";
import type { PluginViewProps } from "@/core/plugin/types";

export interface ViewerConfig {
  datasetKey: string | null;
}

export type ViewerOptions = Record<string, never>;

export function ImageViewerPluginView({ host }: PluginViewProps<ViewerConfig, ViewerOptions>) {
  const datasetKey = host.config.datasetKey ?? undefined;

  // Plate presence is session-fixed (the descriptor's isAvailable already gates
  // the whole plugin on ctx.hasPlate), so the non-reactive host.data snapshot is
  // correct for this gate.
  if (!host.data.metadata.plate) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
        No plate data available
      </div>
    );
  }

  return (
    <HostProvider host={host}>
      <div className="h-full w-full overflow-hidden">
        <CropViewer datasetKey={datasetKey} />
      </div>
    </HostProvider>
  );
}
