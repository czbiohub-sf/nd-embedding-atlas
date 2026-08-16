import { createContext, useContext } from "react";
import type { NodeHost } from "@ndea/sdk";
import type { ImageViewerCapabilities, ImageViewerConfig, ImageViewerServices } from "./contracts";

export type ImageViewerHost = NodeHost<ImageViewerConfig, ImageViewerCapabilities>;

const HostContext = createContext<ImageViewerHost | null>(null);
const ServicesContext = createContext<ImageViewerServices | null>(null);

export function ImageViewerProvider({
  host,
  services,
  children,
}: {
  host: ImageViewerHost;
  services: ImageViewerServices;
  children: React.ReactNode;
}) {
  return (
    <HostContext value={host}>
      <ServicesContext value={services}>{children}</ServicesContext>
    </HostContext>
  );
}

export function useImageViewerHost(): ImageViewerHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useImageViewerHost must be used within ImageViewerProvider");
  return host;
}

export function useImageViewerServices(): ImageViewerServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useImageViewerServices must be used within ImageViewerProvider");
  return services;
}
