import {
    ChunkedImageLayer,
    Color,
    createExplorationPolicy,
    type Layer,
    loadOmeroChannels,
    OmeZarrImageSource,
    ProjectedLineLayer,
} from "@idetik/core";
import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useDashboard } from "../../hooks/useDashboard";
import { useViewer } from "../../hooks/useViewer";
import { MultiChannelLayers } from "../../lib/MultiChannelLayers";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CellInfo {
    fov_name: string;
    store_index?: number;
    t: number;
    x: number;
    y: number;
    bbox?: { y_min: number; x_min: number; y_max: number; x_max: number };
}

/** Coordinates returned by /api/cell/lookup for a specific (fov_name, track_id, t). */
interface CellCoords {
    x: number;
    y: number;
    bbox?: { y_min: number; x_min: number; y_max: number; x_max: number };
}

/** Default bbox half-size in pixels when no bbox metadata is available. */
const DEFAULT_BBOX_HALF_PX = 64; // 128 / 2

interface Props {
    cropSize: number;
}

export function SingleCropViewer({ cropSize }: Props) {
    const { state: dashState } = useDashboard();
    const { state: viewerState, actions, meta } = useViewer();
    const { highlightId, metadata } = dashState;

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
    const multiChannelRef = useRef<MultiChannelLayers | null>(null);
    const sourceRef = useRef<OmeZarrImageSource | null>(null);

    // ── Bbox layer ref — managed directly via layerManager ────────────
    const bboxRef = useRef<Layer | null>(null);

    // ── Fetch cell info (initial selection) ─────────────────────────────
    const { data: cellInfo } = useSWR<CellInfo>(highlightId ? `/api/cell/${highlightId}` : null, fetcher, {
        keepPreviousData: true,
    });

    // ── Fetch updated coordinates as T changes ──────────────────────────
    // When a trajectory is active, use trajectory coords directly. Otherwise
    // look up the cell's position at the current tIndex via the lookup endpoint.
    const { trajectory } = dashState;
    const trackId = trajectory?.trackId;
    const fovName = cellInfo?.fov_name;
    const currentT = viewerState.tIndex;

    // Build lookup key: only fetch when we have the identifying info and T differs from initial
    const lookupKey =
        fovName && trackId != null ? `/api/cell/lookup?fov_name=${encodeURIComponent(fovName)}&track_id=${trackId}&t=${currentT}` : null;

    const { data: lookupCoords } = useSWR<CellCoords>(lookupKey, fetcher, {
        keepPreviousData: true,
    });

    // ── Derive source URL and OME version ──────────────────────────────
    const scale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
    const storeIndex = cellInfo?.store_index ?? 0;
    const plateMount = metadata.plate_stores ? `/plate_${storeIndex}` : "/plate";
    const sourceUrl = cellInfo ? `${window.location.origin}${plateMount}/${cellInfo.fov_name}` : null;
    const omeVersion: "0.4" | "0.5" =
        metadata.plate_stores?.[storeIndex]?.ome_version === "0.4" ? "0.4" : "0.5";

    // ── Helper: swap bbox layer without touching image layers ─────────
    const updateBbox = useCallback(
        (
            cx: number,
            cy: number,
            half: number,
            explicitBbox?: { y_min: number; x_min: number; y_max: number; x_max: number },
        ) => {
            const viewport = meta.viewport;
            if (!viewport) return;

            // Remove old bbox
            if (bboxRef.current) {
                viewport.layerManager.remove(bboxRef.current);
            }

            let path: [number, number, number][];
            if (explicitBbox) {
                // Scale the explicit bbox around its center by the crop slider value
                const bboxCx = (explicitBbox.x_min + explicitBbox.x_max) / 2;
                const bboxCy = (explicitBbox.y_min + explicitBbox.y_max) / 2;
                const bboxHalfW = (explicitBbox.x_max - explicitBbox.x_min) / 2;
                const bboxHalfH = (explicitBbox.y_max - explicitBbox.y_min) / 2;
                const scaleFactor = half / Math.max(bboxHalfW, bboxHalfH, 1);
                const hw = bboxHalfW * scaleFactor;
                const hh = bboxHalfH * scaleFactor;
                path = [
                    [(bboxCx - hw) * scale.x, (bboxCy - hh) * scale.y, 0],
                    [(bboxCx + hw) * scale.x, (bboxCy - hh) * scale.y, 0],
                    [(bboxCx + hw) * scale.x, (bboxCy + hh) * scale.y, 0],
                    [(bboxCx - hw) * scale.x, (bboxCy + hh) * scale.y, 0],
                    [(bboxCx - hw) * scale.x, (bboxCy - hh) * scale.y, 0],
                ];
            } else {
                const sx = cx * scale.x;
                const sy = cy * scale.y;
                const hx = half * scale.x;
                const hy = half * scale.y;
                path = [
                    [sx - hx, sy - hy, 0],
                    [sx + hx, sy - hy, 0],
                    [sx + hx, sy + hy, 0],
                    [sx - hx, sy + hy, 0],
                    [sx - hx, sy - hy, 0],
                ];
            }

            const bbox = new ProjectedLineLayer([
                {
                    path,
                    color: [1, 1, 1],
                    width: 0.015,
                },
            ]);

            viewport.layerManager.add(bbox);
            bboxRef.current = bbox;
        },
        [meta.viewport, scale.x, scale.y],
    );

    // ── Effect 1: FOV layers (only when source URL changes) ───────────
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
                version: omeVersion,
            });

            // Load source dimensions and channel info in parallel
            const [loader, omeroChannels] = await Promise.all([
                source.open(),
                loadOmeroChannels(source).catch(() => null),
            ]);

            if (cancelled) return;

            // Set Z/T bounds and FOV extent from source dimensions
            let fovY = 2048;
            let fovX = 2048;
            try {
                const dims = loader.getSourceDimensionMap();
                const zMax = dims.z ? dims.z.lods[0].size - 1 : null;
                const tMax = dims.t ? dims.t.lods[0].size - 1 : null;
                actions.setBounds({ zMax, tMax });
                if (dims.y) fovY = dims.y.lods[0].size;
                if (dims.x) fovX = dims.x.lods[0].size;
            } catch {
                // Source doesn't support dimension probing
            }

            // Resolve channel definitions
            // Prefer server-computed plate_channels (has auto-contrast) over
            // raw omeroChannels from the zarr store (may have default [0, 65535]).
            let channelDefs: Array<{ color: Color; contrastLimits: [number, number] }>;
            if (metadata.plate_channels) {
                channelDefs = metadata.plate_channels.map(
                    (ch: { color: string; window: { start: number; end: number } }) => ({
                        color: Color.fromRgbHex(`#${ch.color}`),
                        contrastLimits: [ch.window.start, ch.window.end] as [number, number],
                    }),
                );
            } else if (omeroChannels) {
                channelDefs = omeroChannels.map((ch) => ({
                    color: ch.color ? Color.fromRgbHex(`#${ch.color}`) : Color.WHITE,
                    contrastLimits: ch.window
                        ? ([ch.window.start, ch.window.end] as [number, number])
                        : ([0, 65535] as [number, number]),
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

            // Frame camera to show the full FOV
            actions.setFrame(0, fovX * scale.x, fovY * scale.y, 0);

            // Push channel definitions to ViewerProvider for ChannelControls
            const channelDefsForContext = channelDefs.map((ch, i) => {
                const plateCh = metadata.plate_channels?.[i];
                return {
                    label: plateCh?.label ?? `Ch ${i}`,
                    color: plateCh?.color ?? "FFFFFF",
                    visible: true,
                    contrastLimits: ch.contrastLimits as [number, number],
                    contrastRange: [
                        plateCh?.window?.min ?? 0,
                        plateCh?.window?.max ?? 65535,
                    ] as [number, number],
                };
            });
            actions.setChannels(channelDefsForContext, multiChannel);
        };

        loadLayers();

        return () => {
            cancelled = true;
        };
    }, [sourceUrl, omeVersion, viewerState.initialized, actions, metadata.plate_channels, scale.x, scale.y]);

    // ── Effect 2: Cell bbox overlay ─────────────────────────────────────
    // Resolves the best (x, y) for the current view state:
    //   - trajectory active → use trajectory frame coords
    //   - lookup endpoint returned coords for current T → use those
    //   - fallback → use initial cellInfo coords
    // Depends on aggregateState to re-add on top after image layers load.
    useEffect(() => {
        if (!viewerState.initialized) return;

        // Skip bbox when there are no per-cell spatial columns (e.g. ndimg FOV-level view)
        const hasCellCoords = !!metadata.spatial?.x_col;
        if (!hasCellCoords) return;

        let cx: number | undefined;
        let cy: number | undefined;
        let bbox: CellInfo["bbox"] | undefined;

        if (trajectory) {
            // During trajectory playback, use the frame matching current T
            const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
            if (frame) {
                cx = frame.spatial_x;
                cy = frame.spatial_y;
            }
        } else if (lookupCoords) {
            // Lookup returned coordinates for the current (fov_name, track_id, t)
            cx = lookupCoords.x;
            cy = lookupCoords.y;
            bbox = lookupCoords.bbox;
        } else if (cellInfo) {
            // Fallback to initial cell selection
            cx = cellInfo.x;
            cy = cellInfo.y;
            bbox = cellInfo.bbox;
        }

        if (cx == null || cy == null) return;

        updateBbox(cx, cy, cropSize > 0 ? cropSize / 2 : DEFAULT_BBOX_HALF_PX, bbox);
    }, [
        cellInfo,
        lookupCoords,
        trajectory,
        cropSize,
        viewerState.initialized,
        viewerState.aggregateState,
        updateBbox,
    ]);

    // ── Effect 3: Sync T index from selected cell ─────────────────────
    useEffect(() => {
        if (cellInfo) {
            actions.setTIndex(cellInfo.t ?? 0);
        }
    }, [cellInfo?.t, actions, cellInfo]);

    // ── Effect 4: Follow trajectory T changes ───────────────────────────
    useEffect(() => {
        if (!trajectory) return;
        const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
        if (frame) {
            actions.setTIndex(trajectory.tIndex);
        }
    }, [trajectory?.tIndex, trajectory?.points, actions, trajectory]);

    // ── Cleanup on unmount ────────────────────────────────────────────
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

    if (!highlightId || !cellInfo) return null;
    return null;
}
