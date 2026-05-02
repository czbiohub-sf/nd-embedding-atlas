import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";
import { ScatterUIStateProvider } from "./components/scatter/ScatterUIStateProvider";
import { TerminalTableProvider } from "./components/table/TerminalTableProvider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./ThemeProvider";

// Persist embedding-heavy queries (scatter positions, continuous values,
// var columns) into IndexedDB so a page reload hits the cache instead
// of re-fetching. Typed arrays round-trip natively through idb-keyval.
const DAY_MS = 1000 * 60 * 60 * 24;

// Disable persistence in dev. Stale IDB entries from prior sessions
// survive HMR + backend restarts and can serve data whose shape has
// drifted from the current wire format, making it look like "queries
// aren't firing" when they're actually cache-hitting ghost data. In
// production the cache is a pure reload-perf win; in dev it's a source
// of ghosts.
const PERSIST_ENABLED = import.meta.env.PROD;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Embedding coords + raw values are immutable for a given dataset;
      // never refetch in the background. Routes that need freshness
      // override per-query.
      staleTime: Infinity,
      gcTime: DAY_MS,
      networkMode: "offlineFirst",
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: "ndea-query-cache",
  throttleTime: 1000,
});

function Providers({ children }: { children: React.ReactNode }) {
  if (!PERSIST_ENABLED) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY_MS,
        // Only persist expensive keys. Cheap metadata/config queries are
        // re-fetched on mount anyway; writing them to IDB is pure waste.
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => {
            const head = q.queryKey[0];
            return (
              head === "scatter" || // positions + categories + continuous values
              head === "var-column" ||
              head === "gallery-crop"
            );
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

export default function App() {
  return (
    <Providers>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <ScatterUIStateProvider>
            <DashboardProvider>
              <TerminalTableProvider>
                <DashboardShell />
                <Toaster position="bottom-right" />
              </TerminalTableProvider>
            </DashboardProvider>
          </ScatterUIStateProvider>
        </TooltipProvider>
      </ThemeProvider>
    </Providers>
  );
}
