import { useQuery } from "@tanstack/react-query";
import { VarLayersResponseSchema, type VarLayersResponse } from "@ndea/protocol";
import { ZodError } from "zod";

/**
 * Fetches available expression layer names once per session.
 * GET /api/var/layers → { layers: string[] }
 * Layers don't change during a session, so staleTime is Infinity.
 */
export function useLayerNames(): string[] {
  const { data } = useQuery<VarLayersResponse>({
    queryKey: ["var", "layers"],
    queryFn: async () => {
      const res = await fetch("/api/var/layers");
      if (!res.ok) throw new Error(`var/layers fetch failed: ${res.status}`);
      return VarLayersResponseSchema.parse(await res.json());
    },
    staleTime: Infinity,
    throwOnError: (error) => error instanceof ZodError,
  });

  return data?.layers ?? ["X"];
}
