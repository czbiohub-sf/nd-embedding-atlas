/**
 * GalleryPane — predicate-driven crop gallery for the ⌘J terminal drawer.
 *
 * Renders OME-Zarr crops for whatever observations the scatter is currently
 * filtered to (lasso ∩ active collection). Toggling a collection populates
 * the gallery the same way it filters the scatter today.
 *
 * Reuses TrackGallery's lanes virtualization + blob-URL lifecycle pattern
 * (see TrackGallery.tsx:97-103, 51-74).
 */

import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SquareDashedMousePointer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../ui/badge";
import { useDashboard } from "../../hooks/useDashboard";
import { useGalleryChannels } from "../table/useGalleryChannels";
import { LassoGalleryCard } from "./LassoGalleryCard";
import { MAX_GALLERY_OBS, useLassoSelectionObs } from "./useLassoSelectionObs";

const FOOTER_HEIGHT = 50; // px — two-line footer (fov + dataset row)
const COL_GAP = 8;
const ROW_GAP = 18;
const MIN_COL_WIDTH = 220;

interface GalleryPaneProps {
  datasetKey?: string;
}

export function GalleryPane({ datasetKey }: GalleryPaneProps) {
  const { state, actions } = useDashboard();
  const queryClient = useQueryClient();

  const { obs, rowCount, isLoading, sourceKind } = useLassoSelectionObs();

  // Resolve channel state from the docked viewer instance, mirroring TrackGallery.
  const resolvedPlateChannels =
    (datasetKey ? state.metadata.dataset_channels?.[datasetKey] : undefined) ?? state.metadata.plate_channels;
  const {
    channels: settledChannels,
    hash: settledHash,
    isPending: channelsPending,
  } = useGalleryChannels(datasetKey ?? "docked", 300, resolvedPlateChannels);

  // ── Blob URL revocation (mirror TrackGallery.tsx:51-74) ──────────────────
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsub = cache.subscribe((event) => {
      if (event.type === "removed" && Array.isArray(event.query.queryKey) && event.query.queryKey[0] === "crop") {
        const url = event.query.state.data;
        if (typeof url === "string" && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    });
    return () => {
      unsub();
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["crop"] })) {
        const url = query.state.data;
        if (typeof url === "string" && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [queryClient]);

  // ── Container size for column count ──────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const colCount = Math.max(1, Math.floor((containerWidth + COL_GAP) / (MIN_COL_WIDTH + COL_GAP)));
  const colWidth = containerWidth > 0 ? (containerWidth - COL_GAP * (colCount - 1)) / colCount : MIN_COL_WIDTH;
  // Image is aspect-square at colWidth, footer is fixed → row pitch =
  // colWidth + footer + vertical gap. Recomputing from colWidth keeps the
  // virtualizer's row positions exact at any container width (no overlap
  // when columns get wide).
  const rowPitch = colWidth + FOOTER_HEIGHT + ROW_GAP;

  const count = obs.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowPitch,
    lanes: colCount,
    overscan: colCount * 2,
  });

  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();
  const truncated = rowCount > MAX_GALLERY_OBS;

  const headerCount = useMemo(() => {
    if (rowCount === 0) return null;
    return truncated ? `${MAX_GALLERY_OBS}/${rowCount}` : `${rowCount}`;
  }, [rowCount, truncated]);

  const fetchEnabled = !channelsPending && settledChannels.length > 0 && !!state.metadata.plate;

  return (
    <div className="flex h-full w-full flex-col bg-card">
      {/* Header */}
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-border/60 border-b px-2 select-none">
        <span className="font-medium text-foreground/90 text-2xs">Gallery</span>
        {headerCount && (
          <Badge variant="outline" className="font-mono text-3xs">
            {headerCount}
          </Badge>
        )}
        {sourceKind === "external" && <span className="text-3xs text-muted-foreground">· active collection</span>}
        {sourceKind === "panel" && <span className="text-3xs text-muted-foreground">· lasso</span>}
        {truncated && (
          <span className="ml-auto font-mono text-3xs text-warning-hue/80">showing top {MAX_GALLERY_OBS}</span>
        )}
      </div>

      {/* Body — always the same div so ResizeObserver stays attached to a
          stable element. Swapping refs across renders caused the observer
          to fire with width=0 once the prior div detached, ping-ponging
          containerWidth back to 0 and stranding the gallery in its
          loading-skeleton branch. */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {rowCount === 0 ? (
          <EmptyState />
        ) : !state.metadata.plate ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            No plate data available
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">Loading…</div>
        ) : containerWidth === 0 ? null : (
          <div style={{ height: totalSize, position: "relative" }}>
            {items.map((vItem) => {
              const o = obs[vItem.index];
              if (!o) return null;
              const left = vItem.lane * (colWidth + COL_GAP);
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  style={{
                    position: "absolute",
                    top: vItem.start,
                    left,
                    width: colWidth,
                    paddingBottom: ROW_GAP,
                  }}
                >
                  <LassoGalleryCard
                    obs={o}
                    channels={settledChannels}
                    hash={settledHash}
                    enabled={fetchEnabled}
                    isHighlighted={state.highlightId === String(o.rowIndex)}
                    onClick={() => actions.setHighlight(String(o.rowIndex))}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <SquareDashedMousePointer className="size-5 text-muted-foreground/40" />
      <div className="font-medium text-foreground/70 text-xs">No selection</div>
      <div className="max-w-[260px] text-muted-foreground/60 text-2xs leading-relaxed">
        Lasso a region in the scatter or toggle a collection to populate the gallery.
      </div>
    </div>
  );
}
