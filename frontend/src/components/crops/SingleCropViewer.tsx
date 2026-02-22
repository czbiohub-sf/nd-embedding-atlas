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

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface CellInfo {
    fov_name: string;
    store_index?: number;
    t: number;
    x: number;
    y: number;
    bbox?: { y_min: number; x_min: number; y_max: number; x_max: number };
}

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

    // ── Fetch cell info ───────────────────────────────────────────────
    const { data: cellInfo } = useSWR<CellInfo>(highlightId ? `/api/cell/${highlightId}` : null, fetcher, {
        keepPreviousData: true,
    });

    // ── Derive source URL and OME version ──────────────────────────────
    const scale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
    const storeIndex = cellInfo?.store_index ?? 0;
    const plateMount = metadata.plate_stores ? `/plate_${storeIndex}` : "/plate";
    const sourceUrl = cellInfo ? `${window.location.origin}${plateMount}/${cellInfo.fov_name}` : null;
    const omeVersion: "0.4" | "0.5" =
        metadata.plate_stores?.[storeIndex]?.ome_version === "0.4" ? "0.4" : "0.5";

    // ── Helper: frame camera around a point ───────────────────────────
    const frameAround = useCallback(
        (cx: number, cy: number) => {
            const h = CAMERA_VIEW_HALF;
            actions.setFrame((cx - h) * scale.x, (cx + h) * scale.x, (cy + h) * scale.y, (cy - h) * scale.y);
        },
        [actions, scale.x, scale.y],
    );

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
                const { y_min, x_min, y_max, x_max } = explicitBbox;
                path = [
                    [x_min * scale.x, y_min * scale.y, 0],
                    [x_max * scale.x, y_min * scale.y, 0],
                    [x_max * scale.x, y_max * scale.y, 0],
                    [x_min * scale.x, y_max * scale.y, 0],
                    [x_min * scale.x, y_min * scale.y, 0],
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
                    color: [0.13, 0.83, 0.93],
                    width: 0.005,
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
            } else if (metadata.plate_channels) {
                channelDefs = metadata.plate_channels.map(
                    (ch: { color: string; window: { start: number; end: number } }) => ({
                        color: Color.fromRgbHex(`#${ch.color}`),
                        contrastLimits: [ch.window.start, ch.window.end] as [number, number],
                    }),
                );
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

        loadLayers();

        return () => {
            cancelled = true;
        };
    }, [sourceUrl, omeVersion, viewerState.initialized, actions, metadata.plate_channels]);

    // ── Effect 2: Cell framing (bbox + camera on every cell change) ───
    useEffect(() => {
        if (!cellInfo || !viewerState.initialized) return;

        updateBbox(cellInfo.x, cellInfo.y, cropSize / 2, cellInfo.bbox);

        if (cellInfo.bbox) {
            const { y_min, x_min, y_max, x_max } = cellInfo.bbox;
            const pad = 50;
            actions.setFrame(
                (x_min - pad) * scale.x,
                (x_max + pad) * scale.x,
                (y_max + pad) * scale.y,
                (y_min - pad) * scale.y,
            );
        } else {
            frameAround(cellInfo.x, cellInfo.y);
        }
    }, [
        cellInfo?.x,
        cellInfo?.y,
        cellInfo?.bbox?.x_min,
        cellInfo?.bbox?.y_min,
        cellInfo?.bbox?.x_max,
        cellInfo?.bbox?.y_max,
        cropSize,
        viewerState.initialized,
        updateBbox,
        frameAround,
        actions,
        scale.x,
        scale.y,
        cellInfo?.bbox,
        cellInfo,
    ]);

    // ── Effect 3: Sync T index from selected cell ─────────────────────
    useEffect(() => {
        if (cellInfo) {
            actions.setTIndex(cellInfo.t ?? 0);
        }
    }, [cellInfo?.t, actions, cellInfo]);

    // ── Effect 4: Follow cell during trajectory playback ──────────────
    const { trajectory } = dashState;
    useEffect(() => {
        if (!trajectory || !cellInfo) return;
        const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
        if (!frame) return;
        updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- trajectory object excluded; tIndex + points cover all reads. cellInfo kept as guard to clear bbox on deselect.
    }, [trajectory?.tIndex, trajectory?.points, cropSize, cellInfo, updateBbox, trajectory]);

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
