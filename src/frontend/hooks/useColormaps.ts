import { useQuery } from "@tanstack/react-query";
import { type ColormapList, getCategoricalPalette, getColormapList } from "../lib/ochre-palette";
import { colormapKeys } from "../scatter-gpu/hooks/queryKeys";

/**
 * Phase 8: colormap lists + palettes come from vendored ochre on the frontend,
 * not from the backend. The React Query shape is preserved so no call site
 * needs to change — we just wrap sync ochre calls in a synchronous `queryFn`,
 * which React Query stores in cache and returns with stable referential
 * identity.
 */

/** Cached list of all available colormap names. Never stale — colormaps don't change. */
export function useColormapList() {
  return useQuery<ColormapList>({
    queryKey: colormapKeys.list(),
    queryFn: () => getColormapList(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Cached palette colors for a colormap. Referentially stable per (name, n). */
export function useColormapPalette(colormap: string, n: number) {
  return useQuery<string[]>({
    queryKey: colormapKeys.palette(colormap, n),
    queryFn: () => getCategoricalPalette(colormap, n),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
