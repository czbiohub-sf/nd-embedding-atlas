/**
 * Image-viewer plugin view (PLUGIN-ARCHITECTURE §10.2).
 *
 * Sources the plate gate from `host.data` and wraps the viewer subtree in
 * `HostProvider` so the body can later read `host.*` without prop-drilling. The
 * reactive focus read that drives the crop stays inside `SingleCropViewer`, and
 * obs/crop fetches stay direct for now: routing them through host.dataAPI.fetchCrop/
 * fetchObsInfo + per-instance SOURCE_CACHE/Idetik teardown is deferred until a
 * second concurrent viewer instance is actually exercised (premature today).
 */

import { CropViewer } from "@/nodes/image-viewer/CropViewer";
import { HostProvider } from "@/core/host/host-context";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { ImageViewerCapabilities } from "./plugin";
import { capabilitiesOf } from "@ndea/sdk";

export interface ViewerConfig {
  datasetKey: string | null;
}

export type ViewerOptions = Record<string, never>;

export function ImageViewerPluginView({ host }: NodeBodyProps<ViewerConfig, ImageViewerCapabilities>) {
  const datasetKey = host.config.datasetKey ?? undefined;

  // Plate presence is session-fixed (the descriptor's `requires: ["plate-image"]`
  // already gates the whole plugin on the capability set), so the non-reactive
  // host.data snapshot is correct for this gate.
  if (!capabilitiesOf(host.data.metadata).has("plate-image")) {
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
