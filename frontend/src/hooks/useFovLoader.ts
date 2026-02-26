import { ChunkedImageLayer, Color, createExplorationPolicy, loadOmeroChannels, OmeZarrImageSource } from "@idetik/core";
import { useEffect, useRef } from "react";
import type { ViewerActions, ViewerState } from "../components/viewer/ViewerContext";
import { MultiChannelLayers } from "../lib/MultiChannelLayers";
import type { Metadata } from "../types";

interface UseFovLoaderOptions {
    sourceUrl: string | null;
    viewerState: ViewerState;
    actions: ViewerActions;
    plateChannels: Metadata["plate_channels"];
}

/**
 * Loads OME-Zarr FOV layers into the current Viewer context.
 *
 * Manages z/t ref sync for reactive sliceCoords getters,
 * async layer creation with cancellation, and cleanup on unmount.
 */
export function useFovLoader({ sourceUrl, viewerState, actions, plateChannels }: UseFovLoaderOptions): void {
    // ── Refs for reactive sliceCoords getters ─────────────────────────
    // Image layers read z/t via getters so they always see the current
    // value without needing to recreate the layer.
    const zRef = useRef(0);
    const tRef = useRef(0);

    useEffect(() => {
        zRef.current = viewerState.zIndex;
    }, [viewerState.zIndex]);
    useEffect(() => {
        tRef.current = viewerState.tIndex;
    }, [viewerState.tIndex]);

    // ── FOV caching refs ──────────────────────────────────────────────
    const currentFovRef = useRef<string | null>(null);
    const multiChannelRef = useRef<MultiChannelLayers | null>(null);
    const sourceRef = useRef<OmeZarrImageSource | null>(null);

    // ── Main FOV load effect ──────────────────────────────────────────
    useEffect(() => {
        if (!sourceUrl || !viewerState.initialized) return;

        // Same FOV — skip layer recreation entirely
        if (sourceUrl === currentFovRef.current) return;

        let cancelled = false;

        const loadLayers = async () => {
            // Dispose previous MultiChannelLayers
            if (multiChannelRef.current) {
                multiChannelRef.current.dispose();
                multiChannelRef.current = null;
            }
            sourceRef.current = null;

            const source = OmeZarrImageSource.fromHttp({
                url: sourceUrl,
                version: "0.5",
            });

            // Load source dimensions and channel info in parallel
            const [loader, omeroChannels] = await Promise.all([
                source.open(),
                loadOmeroChannels(source).catch(() => null),
            ]);

            if (cancelled) return;

            // Set Z/T bounds from source dimensions
            try {
                const dims = loader.getSourceDimensionMap();
                const zMax = dims.z ? dims.z.lods[0].size - 1 : null;
                const tMax = dims.t ? dims.t.lods[0].size - 1 : null;
                actions.setBounds({ zMax, tMax });
            } catch {
                // Source doesn't support dimension probing
            }

            // Resolve channel definitions
            let channelDefs: Array<{ color: Color; contrastLimits: [number, number] }>;
            if (omeroChannels) {
                channelDefs = omeroChannels.map((ch) => ({
                    color: ch.color ? Color.fromRgbHex(`#${ch.color}`) : Color.WHITE,
                    contrastLimits: ch.window
                        ? ([ch.window.start, ch.window.end] as [number, number])
                        : ([0, 65535] as [number, number]),
                }));
            } else if (plateChannels) {
                channelDefs = plateChannels.map((ch) => ({
                    color: Color.fromRgbHex(`#${ch.color}`),
                    contrastLimits: [ch.window.start, ch.window.end] as [number, number],
                }));
            } else {
                channelDefs = [{ color: Color.WHITE, contrastLimits: [0, 65535] }];
            }

            if (cancelled) return;

            const policy = createExplorationPolicy();
            const imageLayers = channelDefs.map((ch, i) => {
                const sliceCoords = {
                    get t() {
                        return tRef.current;
                    },
                    get z() {
                        return zRef.current;
                    },
                    c: i,
                };
                return new ChunkedImageLayer({
                    source,
                    sliceCoords,
                    policy,
                    channelProps: [{ color: ch.color, contrastLimits: ch.contrastLimits }],
                    transparent: i > 0,
                    blendMode: i > 0 ? "additive" : undefined,
                });
            });

            const multiChannel = new MultiChannelLayers(imageLayers);
            const layers = imageLayers.map((layer, i) => ({ id: `ch-${i}`, layer }));

            if (cancelled) return;

            // Commit refs
            currentFovRef.current = sourceUrl;
            sourceRef.current = source;
            multiChannelRef.current = multiChannel;

            actions.setLayers(layers);
        };

        loadLayers().catch((err) => {
            if (!cancelled) {
                console.error(`[useFovLoader] Failed to load FOV layers for ${sourceUrl}:`, err);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [sourceUrl, viewerState.initialized, actions, plateChannels]);

    // ── Cleanup on unmount ─────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (multiChannelRef.current) {
                multiChannelRef.current.dispose();
                multiChannelRef.current = null;
            }
            currentFovRef.current = null;
            sourceRef.current = null;
        };
    }, []);
}
