import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { BodyMounter } from "@ndea/components";
import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import { appQueryClient } from "@/query-client";

export const mountReactBody: BodyMounter = (Component, host, title) => {
  const element = document.createElement("div");
  element.className = "h-full min-h-0 w-full";
  const root = createRoot(element);
  root.render(
    <QueryClientProvider client={appQueryClient}>
      <PanelErrorBoundary panelName={title}>{createElement(Component, { host })}</PanelErrorBoundary>
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
};
