/**
 * Image-viewer component body.
 *
 * Sources plate gate from host.data and injects app-owned services through the
 * package-local provider. Focus and viewer state stay instance-scoped. On the
 * server's headless render page the body always renders locally and streams.
 */

import { useState } from "react";
import { CropViewer } from "./CropViewer";
import { ImageViewerProvider } from "./context";
import type { BodyProps } from "../contracts";
import type { ImageViewerConfig, ImageViewerServices } from "./contracts";
import { capabilitiesOf } from "@ndea/sdk";

export function createImageViewerView(services: ImageViewerServices) {
  const { useSessionSnapshot } = services;
  return function ImageViewerView({ host }: BodyProps<ImageViewerConfig>) {
    const session = useSessionSnapshot();
    const datasetKey = host.config.datasetKey ?? undefined;
    // The body's own patchConfig does not restart it, so "Render locally" also flips this.
    const [render, setRender] = useState(host.config.render);

    if (!capabilitiesOf(host.data.metadata).has("plate-image")) {
      return (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground text-ui">
          No plate data available
        </div>
      );
    }

    return (
      <ImageViewerProvider host={host} services={services} session={session}>
        <div className="h-full w-full overflow-hidden">
          <CropViewer
            datasetKey={datasetKey}
            mode={services.remote.page ? "page" : render}
            onRender={(mode) => {
              host.patchConfig({ render: mode });
              setRender(mode);
            }}
          />
        </div>
      </ImageViewerProvider>
    );
  };
}
