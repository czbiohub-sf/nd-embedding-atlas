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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface CellInfo {
    fov_name: string;
    t: number;
    x: number;
    y: number;
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

    // ── Bbox layer ref — managed directly via layerManager ────────────
    const bboxRef = useRef<Layer | null>(null);

    // Refs for values used inside layer-creation effect to avoid unnecessary re-runs
    const cropSizeRef = useRef(cropSize);
    cropSizeRef.current = cropSize;

    // ── Fetch cell info ───────────────────────────────────────────────
    const { data: cellInfo } = useSWR<CellInfo>(highlightId ? `/api/cell/${highlightId}` : null, fetcher, {
        keepPreviousData: true,
    });

    // ── Derive source URL ─────────────────────────────────────────────
    const scale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
    const sourceUrl = cellInfo ? `${window.location.origin}/plate/${cellInfo.fov_name}` : null;

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
        (cx: number, cy: number, half: number) => {
            const viewport = meta.viewport;
            if (!viewport) return;

            // Remove old bbox
            if (bboxRef.current) {
                viewport.layerManager.remove(bboxRef.current);
            }

            const sx = cx * scale.x;
            const sy = cy * scale.y;
            const hx = half * scale.x;
            const hy = half * scale.y;
            const bbox = new ProjectedLineLayer([
                {
                    path: [
                        [sx - hx, sy - hy, 0],
                        [sx + hx, sy - hy, 0],
                        [sx + hx, sy + hy, 0],
                        [sx - hx, sy + hy, 0],
                        [sx - hx, sy - hy, 0],
                    ],
                    color: [0.13, 0.83, 0.93],
                    width: 0.005,
                },
            ]);

            viewport.layerManager.add(bbox);
            bboxRef.current = bbox;
        },
        [meta.viewport, scale.x, scale.y],
    );

    const updateBboxRef = useRef(updateBbox);
    updateBboxRef.current = updateBbox;
    const frameAroundRef = useRef(frameAround);
    frameAroundRef.current = frameAround;

    // ── Layer creation effect (image channels only) ───────────────────
    useEffect(() => {
        if (!sourceUrl || !cellInfo || !viewerState.initialized) return;

        let cancelled = false;

        const loadLayers = async () => {
            const source = OmeZarrImageSource.fromHttp({
                url: sourceUrl,
                version: "0.5",
            });

            // Probe source dimensions for Z/T bounds
            try {
                const loader = await source.open();
                if (cancelled) return;
                const dims = loader.getSourceDimensionMap();
                const zMax = dims.z ? dims.z.lods[0].size - 1 : null;
                const tMax = dims.t ? dims.t.lods[0].size - 1 : null;
                actions.setBounds({ zMax, tMax });
            } catch {
                // Source doesn't support dimension probing
            }

            if (cancelled) return;

            // Load channel info
            let channelDefs: Array<{ color: Color; contrastLimits: [number, number] }>;
            try {
                const omeroChannels = await loadOmeroChannels(source);
                if (cancelled) return;
                channelDefs = omeroChannels.map((ch) => ({
                    color: ch.color ? Color.fromRgbHex(`#${ch.color}`) : Color.WHITE,
                    contrastLimits: ch.window
                        ? ([ch.window.start, ch.window.end] as [number, number])
                        : ([0, 65535] as [number, number]),
                }));
            } catch {
                if (metadata.plate_channels) {
                    channelDefs = metadata.plate_channels.map(
                        (ch: { color: string; window: { start: number; end: number } }) => ({
                            color: Color.fromRgbHex(`#${ch.color}`),
                            contrastLimits: [ch.window.start, ch.window.end] as [number, number],
                        }),
                    );
                } else {
                    channelDefs = [{ color: Color.WHITE, contrastLimits: [0, 65535] }];
                }
            }

            if (cancelled) return;

            const policy = createExplorationPolicy();
            const layers = channelDefs.map((ch, i) => {
                const sliceCoords = {
                    get t() {
                        return tRef.current;
                    },
                    get z() {
                        return zRef.current;
                    },
                    c: i,
                };
                return {
                    id: `ch-${i}`,
                    layer: new ChunkedImageLayer({
                        source,
                        sliceCoords,
                        policy,
                        channelProps: [{ color: ch.color, contrastLimits: ch.contrastLimits }],
                        transparent: i > 0,
                        blendMode: i > 0 ? "additive" : undefined,
                    }),
                };
            });

            // Set image layers via setLayers (only on cell change)
            actions.setLayers(layers);

            // Add bbox directly to viewport (not through setLayers)
            updateBboxRef.current(cellInfo.x, cellInfo.y, cropSizeRef.current / 2);

            // Frame camera around cell
            frameAroundRef.current(cellInfo.x, cellInfo.y);
        };

        loadLayers();

        return () => {
            cancelled = true;
        };
        // Only re-run when the cell or source actually changes, not on crop/bbox/frame changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        sourceUrl,
        cellInfo?.fov_name,
        cellInfo?.x,
        cellInfo?.y,
        cellInfo?.t,
        viewerState.initialized,
        actions,
        metadata.plate_channels,
        cellInfo,
    ]);

    // ── Sync T index from selected cell ──────────────────────────────
    useEffect(() => {
        if (cellInfo) {
            actions.setTIndex(cellInfo.t);
        }
    }, [cellInfo?.t, actions, cellInfo]);

    // ── Update bbox when crop size changes (no flicker) ──────────────
    useEffect(() => {
        if (!cellInfo) return;
        updateBbox(cellInfo.x, cellInfo.y, cropSize / 2);
    }, [cropSize, cellInfo?.x, cellInfo?.y, updateBbox, cellInfo]);

    // ── Follow cell during trajectory playback ──────────────────────────
    // Camera stays fixed; only the bounding box slides to the cell's position.
    const { trajectory } = dashState;
    useEffect(() => {
        if (!trajectory || !cellInfo) return;
        const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
        if (!frame) return;
        updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- trajectory?.tIndex and trajectory?.points cover all reads
    }, [trajectory?.tIndex, trajectory?.points, cropSize, cellInfo, updateBbox, trajectory]);

    if (!highlightId || !cellInfo) return null;
    return null;
}
