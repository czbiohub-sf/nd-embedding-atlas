import { useDebouncer } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { VarNamesResponseSchema, type VarNamesResponse } from "@ndea/protocol";
import { useEffect, useState } from "react";
import { ZodError } from "zod";
import { varKeys } from "@/lib/query-keys";

export interface VarSearchResult {
  names: string[];
  isLoading: boolean;
}

/**
 * Debounced var name search via TanStack Query.
 * GET /api/var/names?q=<query>&limit=50[&modality=<name>]
 * Empty query returns the first 50 var names.
 * `modality` narrows the search to one modality's var (MuData).
 */
export function useVarSearch(query: string, modality?: string): VarSearchResult {
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
    queryKey: varKeys.names(debouncedQuery, modality),
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (modality) params.set("modality", modality);
      const res = await fetch(`/api/var/names?${params}`);
      if (!res.ok) throw new Error(`var/names fetch failed: ${res.status}`);
      return VarNamesResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
    throwOnError: (error) => error instanceof ZodError,
  });

  return {
    names: data?.names ?? [],
    isLoading,
  };
}
