import {
    ChunkedImageLayer,
    Color,
    createExplorationPolicy,
    createPlaybackPolicy,
    loadOmeroChannels,
    OmeZarrImageSource,
    VolumeLayer,
} from "@idetik/core";
import { useEffect, useRef } from "react";
import type { ChannelDef, ViewMode } from "../components/viewer/ViewerContext";
import { MultiChannelLayers } from "../lib/MultiChannelLayers";
import type { Metadata } from "../types";
import { useViewer } from "./useViewer";

interface UseFovLoaderOptions {
    sourceUrl: string | null;
    plateChannels: Metadata["plate_channels"];
}

/**
 * Loads OME-Zarr FOV layers into the current Viewer context.
 *
 * In 2D mode, creates one ChunkedImageLayer per channel with a specific Z slice.
 * In 3D mode, creates a single VolumeLayer with all channels and z: undefined
 * (loads the full Z stack for ray marching).
 */
export function useFovLoader({ sourceUrl, plateChannels }: UseFovLoaderOptions): void {
    const { state: viewerState, actions } = useViewer();
    const { viewMode } = viewerState;
    // ── Refs for reactive sliceCoords getters ─────────────────────────
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
    const currentModeRef = useRef<ViewMode>(viewMode);
    const currentGenRef = useRef(viewerState.generation);
    const multiChannelRef = useRef<MultiChannelLayers | null>(null);
    const sourceRef = useRef<OmeZarrImageSource | null>(null);

    // ── Main FOV load effect ──────────────────────────────────────────
    useEffect(() => {
        if (!sourceUrl || !viewerState.initialized) return;

        // Skip if same FOV + same mode + same generation (runtime hasn't been recreated)
        if (
            sourceUrl === currentFovRef.current &&
            viewMode === currentModeRef.current &&
            viewerState.generation === currentGenRef.current
        ) {
            return;
        }

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

            // ── Create layers based on view mode ─────────────────────────
            let multiChannel: MultiChannelLayers;
            let layerEntries: Array<{ id: string; layer: ChunkedImageLayer | VolumeLayer }>;

            if (viewMode === "3d") {
                // 3D: single VolumeLayer with all channels
                const policy = createPlaybackPolicy({ lod: { min: 2, max: 2 } });
                const sliceCoords = {
                    get t() {
                        return tRef.current;
                    },
                    z: undefined as number | undefined,
                    c: undefined as number | undefined,
                };
                const volumeLayer = new VolumeLayer({
                    source,
                    sliceCoords,
                    policy,
                    channelProps: channelDefs.map((ch) => ({
                        color: ch.color,
                        contrastLimits: ch.contrastLimits,
                    })),
                });
                multiChannel = new MultiChannelLayers([volumeLayer]);
                layerEntries = [{ id: "volume", layer: volumeLayer }];
            } else {
                // 2D: one ChunkedImageLayer per channel
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
                multiChannel = new MultiChannelLayers(imageLayers);
                layerEntries = imageLayers.map((layer, i) => ({ id: `ch-${i}`, layer }));
            }

            if (cancelled) return;

            // Commit refs
            currentFovRef.current = sourceUrl;
            currentModeRef.current = viewMode;
            currentGenRef.current = viewerState.generation;
            sourceRef.current = source;
            multiChannelRef.current = multiChannel;

            actions.setLayers(layerEntries);

            // Build default channel state from source metadata
            const defaultChannelState: ChannelDef[] = channelDefs.map((ch, i) => {
                const label = omeroChannels?.[i]?.label ?? plateChannels?.[i]?.label ?? `Ch ${i}`;
                const hex = ch.color.rgbHex?.substring(1) ?? "FFFFFF";
                return {
                    label,
                    color: hex,
                    visible: true,
                    contrastLimits: ch.contrastLimits,
                    contrastRange: [plateChannels?.[i]?.window?.min ?? 0, plateChannels?.[i]?.window?.max ?? 65535],
                    blendMode: viewMode === "3d" ? "additive" : i > 0 ? "additive" : "normal",
                };
            });

            // Preserve user's channel settings (visibility, contrast, blend) if the
            // channel lineup hasn't changed (same count + labels). This keeps
            // user adjustments stable when clicking between observations in the same plate.
            const existing = viewerState.channels;
            const canReuse =
                existing.length === defaultChannelState.length &&
                existing.every((ch, i) => ch.label === defaultChannelState[i].label);

            const channelState = canReuse
                ? existing.map((ch, i) => ({ ...ch, contrastRange: defaultChannelState[i].contrastRange }))
                : defaultChannelState;

            actions.setChannels(channelState, multiChannel);

            // Apply existing user settings to the new layers
            if (canReuse) {
                multiChannel.setChannelProps(
                    channelState.map((ch) => ({
                        visible: ch.visible,
                        color: Color.fromRgbHex(`#${ch.color}`),
                        contrastLimits: ch.contrastLimits,
                    })),
                );
            }
        };

        loadLayers().catch((err) => {
            if (!cancelled) {
                console.error(`[useFovLoader] Failed to load FOV layers for ${sourceUrl}:`, err);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        sourceUrl,
        viewerState.initialized,
        viewerState.channels,
        actions,
        plateChannels,
        viewMode,
        viewerState.generation,
    ]);

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
