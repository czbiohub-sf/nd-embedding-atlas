import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { NodeBodyMounter, NodeBodyProps } from "@ndea/nodes";
import type { MountedNodeBody, NodeCapability, NodeHost } from "@ndea/sdk";
import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import { appQueryClient } from "@/query-client";

function mountReactNodeBody<Config, Capabilities extends NodeCapability, Facets extends object = object>(
  Component: ComponentType<NodeBodyProps<Config, Capabilities, Facets>>,
  host: NodeHost<Config, Capabilities> & Facets,
  title: string,
): MountedNodeBody {
  const element = document.createElement("div");
  element.className = "h-full min-h-0 w-full";
  const root = createRoot(element);
  const body = createElement(Component, {
    host,
  });
  root.render(
    <QueryClientProvider client={appQueryClient}>
      <PanelErrorBoundary panelName={title}>{body}</PanelErrorBoundary>
    </QueryClientProvider>,
  );

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

export const mountNodeBody: NodeBodyMounter = mountReactNodeBody;
