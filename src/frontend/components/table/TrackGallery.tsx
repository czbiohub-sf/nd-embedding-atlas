/**
 * TrackGallery — scrollable grid of WebP image crops, one per trajectory frame.
 *
 * Crops are fetched via POST /api/crop/{fov_path} with live channel state from
 * the idetik viewer, so thumbnails match what the user sees in the image viewer.
 *
 * Uses @tanstack/react-virtual lanes for multi-column grid virtualization.
 * Blob URL lifecycle: gcTime=0 + cleanup revocation on gallery unmount.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { selectAnyTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { TrackGalleryCard } from "./TrackGalleryCard";
import { useGalleryChannels } from "./useGalleryChannels";
import { obsCoordKey } from "./useGalleryCropQuery";

const CARD_SIZE = 230; // px — image (200) + footer (~30)
const CARD_GAP = 10;
const MIN_COL_WIDTH = 180;

interface TrackGalleryProps {
  activeFrame: number;
  onFrameSelect: (index: number) => void;
  datasetKey?: string;
}

export function TrackGallery({ activeFrame, onFrameSelect, datasetKey }: TrackGalleryProps) {
  const { state } = useDashboard();
  const trajectory = selectAnyTrajectory(state.trajectories);
  // Use || not ?? so empty string "" (single-dataset mode) falls through to "docked"
  // Resolve per-dataset channels when available, falling back to global plate_channels
  const resolvedDatasetKey = trajectory?.datasetKey ?? datasetKey;
  const resolvedPlateChannels =
    (resolvedDatasetKey ? state.metadata.dataset_channels?.[resolvedDatasetKey] : undefined) ??
    state.metadata.plate_channels;

  const {
    channels: settledChannels,
    hash: settledHash,
    isPending,
  } = useGalleryChannels(resolvedDatasetKey ?? "docked", 300, resolvedPlateChannels);

  const queryClient = useQueryClient();

  // ── Blob URL revocation ─────────────────────────────────────────────────────
  // gcTime=0 evicts queries immediately when no subscriber → "removed" event fires.
  // Cleanup on gallery unmount handles any remaining unreleased URLs.
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsub = cache.subscribe((event) => {
      if (event.type === "removed" && Array.isArray(event.query.queryKey) && event.query.queryKey[0] === "crop") {
        const url = event.query.state.data;
        if (typeof url === "string" && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        } else if (url !== undefined) {
          console.error("[TrackGallery] crop query data is not a blob URL — possible leak", typeof url);
        }
      }
    });

    return () => {
      unsub();
      // Revoke all remaining crop blob URLs synchronously on unmount
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["crop"] })) {
        const url = query.state.data;
        if (typeof url === "string" && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [queryClient]);

  // ── Container size for column count ────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return () => {};
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, []);

  const colCount = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (MIN_COL_WIDTH + CARD_GAP)));
  const colWidth = containerWidth > 0 ? (containerWidth - CARD_GAP * (colCount - 1)) / colCount : MIN_COL_WIDTH;

  const count = trajectory?.points.length ?? 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_SIZE + CARD_GAP,
    lanes: colCount,
    overscan: colCount * 2,
  });

  // Scroll active item into view after virtualizer has settled measurements
  useEffect(() => {
    if (count === 0) return () => {};
    const id = setTimeout(() => {
      virtualizer.scrollToIndex(activeFrame, { behavior: "smooth", align: "auto" });
    }, 0);
    return () => {
      clearTimeout(id);
    };
  }, [activeFrame, virtualizer, count]);

  // ── Batch obs coordinate prefetch ─────────────────────────────────────────
  // When a trajectory loads, fetch all FOV-local x/y coords in one DuckDB query
  // and populate the cache so individual crop queries skip their obs fetch.
  useEffect(() => {
    if (!trajectory) return;
    const rowIndices = trajectory.points.map((p) => p.rowIndex).filter((id): id is number => id != null);
    if (rowIndices.length === 0) return;

    // Skip if all are already cached
    const missing = rowIndices.filter((id) => !queryClient.getQueryData(obsCoordKey(id)));
    if (missing.length === 0) return;

    void fetch(`/api/obs/batch?ids=${missing.join(",")}`)
      .then((r) => r.json())
      .then((data: Record<string, { x: number; y: number }>) => {
        for (const [idStr, coords] of Object.entries(data)) {
          queryClient.setQueryData(obsCoordKey(Number(idStr)), coords);
        }
      })
      .catch(() => {
        /* silently ignore — crop queries fall back to individual fetches */
      });
  }, [trajectory, queryClient]);

  // ── Crop prefetch for items just outside the viewport ─────────────────────
  // Prefetch crops for the next colCount*2 items beyond the visible range.
  const items = trajectory ? virtualizer.getVirtualItems() : [];
  useEffect(() => {
    if (!trajectory || isPending || settledChannels.length === 0) return;
    if (items.length === 0) return;

    const maxVisible = Math.max(...items.map((v) => v.index));
    const prefetchEnd = Math.min(maxVisible + colCount * 2, trajectory.points.length - 1);

    for (let i = maxVisible + 1; i <= prefetchEnd; i++) {
      const frame = trajectory.points[i];
      if (!frame) continue;
      const qKey = ["crop", trajectory.fovName, frame.t ?? null, settledHash];
      if (queryClient.getQueryData(qKey)) continue; // already cached

      const cachedObs =
        frame.rowIndex != null ? queryClient.getQueryData<{ x: number; y: number }>(obsCoordKey(frame.rowIndex)) : null;
      if (!cachedObs) continue; // wait for batch obs to populate first

      void queryClient.prefetchQuery({
        queryKey: qKey,
        queryFn: async ({ signal }) => {
          const body = {
            t: frame.t,
            z: 0,
            x: Math.round(cachedObs.x),
            y: Math.round(cachedObs.y),
            half: 150,
            size: 200,
            fmt: "webp",
            ...(trajectory.datasetKey ? { dataset_key: trajectory.datasetKey } : {}),
            channels: settledChannels.map((ch) => ({
              visible: ch.visible,
              lo: ch.contrastLimits[0],
              hi: ch.contrastLimits[1],
              color: ch.color,
              blend: ch.blendMode,
            })),
          };
          const res = await fetch(`/api/crop/${trajectory.fovName}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
          });
          if (!res.ok) throw new Error(`prefetch crop failed: ${res.status}`);
          const blob = await res.blob();
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          return URL.createObjectURL(blob);
        },
        staleTime: Infinity,
        gcTime: 0,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, trajectory, settledChannels, settledHash, colCount, queryClient, isPending]);

  if (!trajectory) return null;

  // Show skeleton until container is measured (avoids zero-width card flash)
  if (containerWidth === 0) {
    return <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto p-3" />;
  }

  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto p-3">
      <div style={{ height: totalSize, position: "relative" }}>
        {items.map((vItem) => {
          const frame = trajectory.points[vItem.index];
          if (!frame) return null;
          const left = vItem.lane * (colWidth + CARD_GAP);

          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: vItem.start,
                left,
                width: colWidth,
                paddingBottom: CARD_GAP,
              }}
            >
              <TrackGalleryCard
                frame={frame}
                fovName={trajectory.fovName}
                isActive={vItem.index === activeFrame}
                onClick={() => onFrameSelect(vItem.index)}
                fetchEnabled={!isPending}
                settledChannels={settledChannels}
                settledHash={settledHash}
                datasetKey={trajectory.datasetKey}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
