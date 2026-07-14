import { QueryClient } from "@tanstack/react-query";

// No client-side persistence. Cached scatter, var-column, and gallery-crop
// results could outlive their server dataset and become stale truth after reload.
const DAY_MS = 1000 * 60 * 60 * 24;

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Embedding coordinates and raw values are immutable for one dataset.
      // Routes that need freshness override this default.
      staleTime: Infinity,
      gcTime: DAY_MS,
      networkMode: "offlineFirst",
    },
  },
});
