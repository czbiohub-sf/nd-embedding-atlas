import { useQuery } from "@tanstack/react-query";
import { colormapKeys } from "../scatter-gpu/hooks/queryKeys";

export interface ColormapList {
    categorical: string[];
    continuous: string[];
}

/** Cached list of all available colormap names. Never stale — colormaps don't change. */
export function useColormapList() {
    return useQuery<ColormapList>({
        queryKey: colormapKeys.list(),
        queryFn: () =>
            fetch("/data/colormaps")
                .then((r) => r.json())
                .then((data: { categorical?: string[]; continuous?: string[]; colormaps?: string[] }) => ({
                    categorical: data.categorical ?? data.colormaps ?? [],
                    continuous: data.continuous ?? [],
                })),
        staleTime: Infinity,
        gcTime: Infinity,
    });
}

/** Cached palette colors for a colormap. Never stale — palettes don't change per session. */
export function useColormapPalette(colormap: string, n: number) {
    return useQuery<string[]>({
        queryKey: colormapKeys.palette(colormap, n),
        queryFn: () =>
            fetch(`/data/categorical-palette?colormap=${encodeURIComponent(colormap)}&n=${n}`)
                .then((r) => r.json())
                .then((data: { colors: string[] }) => data.colors),
        staleTime: Infinity,
        gcTime: Infinity,
    });
}
