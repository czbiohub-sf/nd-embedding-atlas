import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { MountedNodeBody, NodeCapability, NodeHost } from "@ndea/sdk";
import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import type { AppNodeHost, NodeBodyProps } from "./app-node-host";

export function mountReactNodeBody<Config, Capabilities extends NodeCapability, Facets extends object = object>(
  Component: ComponentType<NodeBodyProps<Config, Capabilities, Facets>>,
  host: NodeHost<Config, Capabilities>,
  title: string,
): MountedNodeBody {
  const element = document.createElement("div");
  element.className = "h-full min-h-0 w-full";
  const root = createRoot(element);
  const body = createElement(Component, {
    host: host as AppNodeHost<Config, Capabilities, Facets>,
  });
  root.render(<PanelErrorBoundary panelName={title}>{body}</PanelErrorBoundary>);

  let disposed = false;
  return {
    element,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.unmount();
      element.remove();
    },
  };
}
