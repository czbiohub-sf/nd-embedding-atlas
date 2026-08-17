import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ThemeCommandPalette } from "./components/ThemeCommandPalette";
import { NdSpecPage } from "./components/node-workspace/NdSpecPage";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "@ndea/ui/components/tooltip";
import { WorkspaceShell } from "./core/workspace/WorkspaceShell";
import type { AppNodeLibrary } from "./core/node/library";
import { DatasetSessionProvider } from "./core/session/DatasetSessionProvider";
import { ThemeProvider } from "./ThemeProvider";
import { appQueryClient } from "./query-client";

/**
 * Routes:
 *  · `/` (and `#/graph`, a legacy alias): the Node Workspace.
 *    `#/graph` renders the same shell with the URL left untouched
 *    (no redirect), so existing links keep working.
 *  · `#/nd-spec`: living spec for the nd component layer (no data deps).
 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

export default function App({ nodeLibrary }: { nodeLibrary: AppNodeLibrary }) {
  const hash = useHashRoute();
  if (hash === "#/nd-spec") {
    // Living spec for the nd component layer: no data deps, no providers.
    return (
      <ThemeProvider>
        <NdSpecPage />
      </ThemeProvider>
    );
  }
  return (
    <QueryClientProvider client={appQueryClient}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <DatasetSessionProvider>
            <WorkspaceShell nodeLibrary={nodeLibrary} />
            <ThemeCommandPalette />
            <Toaster position="bottom-right" />
          </DatasetSessionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
