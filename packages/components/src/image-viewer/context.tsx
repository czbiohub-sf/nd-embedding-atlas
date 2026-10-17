import { createContext, useContext } from "react";
import type { ComponentHost } from "@ndea/sdk";
import type { ImageViewerConfig, ImageViewerServices, ImageViewerSessionSnapshot } from "./contracts";

export type ImageViewerHost = ComponentHost<ImageViewerConfig>;

const HostContext = createContext<ImageViewerHost | null>(null);
const ServicesContext = createContext<ImageViewerServices | null>(null);
const SessionContext = createContext<ImageViewerSessionSnapshot | null>(null);

export function ImageViewerProvider({
  host,
  services,
  session,
  children,
}: {
  host: ImageViewerHost;
  services: ImageViewerServices;
  session: ImageViewerSessionSnapshot;
  children: React.ReactNode;
}) {
  return (
    <HostContext value={host}>
      <ServicesContext value={services}>
        <SessionContext value={session}>{children}</SessionContext>
      </ServicesContext>
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

export function useImageViewerSession(): ImageViewerSessionSnapshot {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useImageViewerSession must be used within ImageViewerProvider");
  return session;
}
