import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { varKeys } from "./queryKeys";

interface VarNamesResponse {
  names: string[];
}

export interface VarSearchResult {
  names: string[];
  isLoading: boolean;
}

/**
 * Debounced var name search via TanStack Query.
 * GET /api/var/names?q=<query>&limit=50
 * Empty query returns the first 50 var names.
 */
export function useVarSearch(query: string): VarSearchResult {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const varDebouncer = useDebouncer((q: string) => setDebouncedQuery(q), {
    wait: 200,
    leading: false,
    trailing: true,
  });
  useEffect(() => {
    varDebouncer.maybeExecute(query);
  }, [query, varDebouncer.maybeExecute]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery<VarNamesResponse>({
    queryKey: varKeys.names(debouncedQuery),
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await fetch(`/api/var/names?${params}`);
      if (!res.ok) throw new Error(`var/names fetch failed: ${res.status}`);
      return res.json() as Promise<VarNamesResponse>;
    },
    staleTime: 60_000,
  });

  return {
    names: data?.names ?? [],
    isLoading,
  };
}
