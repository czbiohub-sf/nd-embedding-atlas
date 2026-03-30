import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface VarNamesResponse {
  names: string[];
}

export interface GeneSearchResult {
  names: string[];
  isLoading: boolean;
}

/**
 * Debounced gene name search via TanStack Query.
 * GET /api/var/names?q=<query>&limit=50
 * Empty query returns the first 50 gene names.
 */
export function useGeneSearch(query: string): GeneSearchResult {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isLoading } = useQuery<VarNamesResponse>({
    queryKey: ["var", "names", debouncedQuery],
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
