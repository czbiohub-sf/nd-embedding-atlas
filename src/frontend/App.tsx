import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScatterUIStateProvider } from "./components/scatter/ScatterUIStateProvider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { DashboardProvider, DashboardShell } from "./dashboard";
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <ScatterUIStateProvider>
            <DashboardProvider>
              <DashboardShell />
              <Toaster position="bottom-right" />
            </DashboardProvider>
          </ScatterUIStateProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
