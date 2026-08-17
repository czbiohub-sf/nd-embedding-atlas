/**
 * Image-viewer plugin view (PLUGIN-ARCHITECTURE §10.2).
 *
 * Sources plate gate from host.data and injects app-owned services through the
 * package-local provider. Focus and viewer state stay instance-scoped.
 */

import { CropViewer } from "./CropViewer";
import { ImageViewerProvider } from "./context";
import type { NodeBodyProps } from "../contracts";
import type { ImageViewerCapabilities, ImageViewerConfig, ImageViewerServices } from "./contracts";
import { capabilitiesOf } from "@ndea/sdk";

export function createImageViewerView(services: ImageViewerServices) {
  return function ImageViewerPluginView({ host }: NodeBodyProps<ImageViewerConfig, ImageViewerCapabilities>) {
    const datasetKey = host.config.datasetKey ?? undefined;

    if (!capabilitiesOf(host.data.metadata).has("plate-image")) {
      return (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
          No plate data available
        </div>
      );
    }

    return (
      <ImageViewerProvider host={host} services={services}>
        <div className="h-full w-full overflow-hidden">
          <CropViewer datasetKey={datasetKey} />
        </div>
      </ImageViewerProvider>
    );
  };
}
