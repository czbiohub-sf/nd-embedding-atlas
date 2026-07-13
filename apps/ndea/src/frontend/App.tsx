import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CollectionsSheetProvider } from "./components/collections/CollectionsSheetProvider";
import { DocsProvider } from "./components/docs/DocsProvider";
import { NdSpecPage } from "./components/nd/NdSpecPage";
import { ScatterUIStateProvider } from "./nodes/scatter/ScatterUIStateProvider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { WorkspaceShell } from "./core/workspace/WorkspaceShell";
import type { AppNodeLibrary } from "./core/node/library";
import { DashboardProvider } from "./dashboard";
import { ThemeProvider } from "./ThemeProvider";

// No client-side persistence. The previous PersistQueryClientProvider
// setup cached scatter/var-column/gallery-crop results into IndexedDB so
// page reloads could skip the network — but a stale or empty result
// landing in IDB (e.g. from the embedding-registration race fixed in
// #97) would survive the reload and cement itself as the cached truth.
// The reload-perf win wasn't worth the bug class; queries refetch on
// mount now.
const DAY_MS = 1000 * 60 * 60 * 24;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Embedding coords + raw values are immutable for a given
      // dataset; never refetch in the background. Routes that need
      // freshness override per-query.
      staleTime: Infinity,
      gcTime: DAY_MS,
      networkMode: "offlineFirst",
    },
  },
});

/**
 * Routes:
 *  · `/` (and `#/graph`, a legacy alias) — the node workspace, the only
 *    dashboard. `#/graph` renders the same shell with the URL left untouched
 *    (no redirect), so existing links keep working.
 *  · `#/nd-spec` — living spec for the nd component layer (no data deps).
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
    // Living spec for the nd component layer — no data deps, no providers.
    return (
      <ThemeProvider>
        <NdSpecPage />
      </ThemeProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <ScatterUIStateProvider>
            <DashboardProvider>
              <CollectionsSheetProvider>
                <DocsProvider catalog={nodeLibrary.catalog}>
                  <WorkspaceShell nodeLibrary={nodeLibrary} />
                </DocsProvider>
              </CollectionsSheetProvider>
              <Toaster position="bottom-right" />
            </DashboardProvider>
          </ScatterUIStateProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
