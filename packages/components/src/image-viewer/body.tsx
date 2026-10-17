/**
 * Image-viewer plugin view (PLUGIN-ARCHITECTURE §10.2).
 *
 * Sources plate gate from host.data and injects app-owned services through the
 * package-local provider. Focus and viewer state stay instance-scoped.
 */

import { CropViewer } from "./CropViewer";
import { ImageViewerProvider } from "./context";
import type { BodyProps } from "../contracts";
import type { ImageViewerConfig, ImageViewerServices } from "./contracts";
import { capabilitiesOf } from "@ndea/sdk";

export function createImageViewerView(services: ImageViewerServices) {
  const { useSessionSnapshot } = services;
  return function ImageViewerPluginView({ host }: BodyProps<ImageViewerConfig>) {
    const session = useSessionSnapshot();
    const datasetKey = host.config.datasetKey ?? undefined;

    if (!capabilitiesOf(host.data.metadata).has("plate-image")) {
      return (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
          No plate data available
        </div>
      );
    }

    return (
      <ImageViewerProvider host={host} services={services} session={session}>
        <div className="h-full w-full overflow-hidden">
          <CropViewer datasetKey={datasetKey} />
        </div>
      </ImageViewerProvider>
    );
  };
}
