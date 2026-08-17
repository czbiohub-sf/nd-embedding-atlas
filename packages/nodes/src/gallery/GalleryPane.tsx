/**
 * GalleryPane: predicate-driven crop gallery for the ⌘J terminal drawer.
 *
 * Renders OME-Zarr crops for whatever observations the scatter is currently
 * filtered to by a wired row set.
 *
 * Reuses TrackGallery's lanes virtualization + blob-URL lifecycle pattern
 * (see TrackGallery.tsx:97-103, 51-74).
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coordinator } from "@uwdata/mosaic-core";
import { SquareDashedMousePointer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@ndea/ui/components/badge";
import type { RowIndex } from "@ndea/sdk";
import { capabilitiesOf } from "@ndea/sdk";
import type { GalleryDatasetServices } from "./contracts";
import { useGalleryChannels } from "./useGalleryChannels";
import { LassoGalleryCard } from "./LassoGalleryCard";
import { usePredicateGalleryObs } from "./usePredicateGalleryObs";
import { MAX_GALLERY_OBS } from "./useLassoSelectionObs";

const FOOTER_HEIGHT = 50; // px: two-line footer (fov + dataset row)
const COL_GAP = 8;
const ROW_GAP = 18;
const MIN_COL_WIDTH = 220;

interface GalleryPaneProps {
  /** Mosaic coordinator from the gallery node's `host.data`. */
  coordinator: Coordinator;
  /** Wired-input WHERE predicate from `predicateToSql(host.inputPredicate)`. */
  predicate: string | null;
  /** Scoped, group-aware focused row from `host.focus`. */
  focusedRowIndex: RowIndex | null;
  /** Crop click → `host.focus.set` so a sync group fans it out. */
  onSelect: (rowIndex: RowIndex | null) => void;
  datasetKey?: string;
  services: GalleryDatasetServices;
}

export function GalleryPane({
  coordinator,
  predicate,
  focusedRowIndex,
  onSelect,
  datasetKey,
  services,
}: GalleryPaneProps) {
  // Dataset session is read only for metadata (channels / plate). Focus routes
  // through the host seam via props so it stays on the workspace sync group.
  const metadata = services.metadata;
  const hasPlate = metadata ? capabilitiesOf(metadata).has("plate-image") : false;

  // Scoped to THIS node's wired input predicate (not the global selection bus).
  const { obs, rowCount, isLoading, sourceKind } = usePredicateGalleryObs(coordinator, predicate);

  // Resolve channel state from the docked viewer instance, mirroring TrackGallery.
  const resolvedPlateChannels =
    (datasetKey ? metadata?.dataset_channels?.[datasetKey] : undefined) ?? metadata?.plate_channels;
  const viewerInstance = datasetKey ?? "docked";
  const {
    channels: settledChannels,
    hash: settledHash,
    isPending: channelsPending,
    viewerZ,
  } = useGalleryChannels(viewerInstance, 300, resolvedPlateChannels, services);

  // Crops are data URLs (see useGalleryCropQuery): no blob-URL revocation to
  // manage. The old findAll(["crop"]) revoke-all-on-unmount nuked every crop
  // URL globally (breaking other consumers + this pane on remount), and the
  // per-removal revoke raced keepPreviousData. Both are gone with data URLs.

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

  const count = obs.length;
  // Masonry: crops keep their true aspect, so cards have different heights.
  // `measureElement` reads each card's real height (image box + footer) and
  // `laneAssignmentMode:'measured'` packs it into the shortest column by that
  // measured size. `estimateSize` is only the pre-measure guess (assume a
  // square image at colWidth); `gap` handles the inter-row spacing so the
  // measured element itself carries no padding to double-count.
  const getItemKey = useCallback((i: number) => obs[i]?.rowIndex ?? i, [obs]);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    getItemKey,
    estimateSize: () => colWidth + FOOTER_HEIGHT,
    lanes: colCount,
    laneAssignmentMode: "measured",
    gap: ROW_GAP,
    overscan: colCount * 2,
  });

  // Auto-snap (the table-row → gallery jump): when the shared focus lands on an
  // obs we have, scroll its crop into view. align:"auto" is a no-op if it's
  // already visible (e.g. the crop you just clicked). A focus-scoped table click
  // writes the shared cell, the gallery reads it via host.focus (props), and
  // the matching crop scrolls in.
  // ponytail: obs is the windowed list (≤MAX_GALLERY_OBS); a focus outside the
  // window finds no index and doesn't scroll: fine until windowed fetch lands.
  useEffect(() => {
    if (focusedRowIndex == null || count === 0) return;
    const idx = obs.findIndex((o) => o.rowIndex === focusedRowIndex);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [focusedRowIndex, obs, count, virtualizer]);

  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();
  const truncated = rowCount > MAX_GALLERY_OBS;

  const headerCount = useMemo(() => {
    if (rowCount === 0) return null;
    return truncated ? `${MAX_GALLERY_OBS}/${rowCount}` : `${rowCount}`;
  }, [rowCount, truncated]);

  const fetchEnabled = !channelsPending && settledChannels.length > 0 && hasPlate;

  return (
    <div className="flex h-full w-full flex-col bg-node-surface">
      {/* Header */}
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-border/60 border-b px-2 select-none">
        <span className="font-medium text-foreground/90 text-2xs">Gallery</span>
        {headerCount && (
          <Badge variant="outline" className="font-mono text-3xs">
            {headerCount}
          </Badge>
        )}
        {/* node-scoped: one wired input edge */}
        {sourceKind != null && <span className="text-3xs text-muted-foreground">· wired</span>}
        {truncated && (
          <span className="ml-auto font-mono text-3xs text-warning-hue/80">showing top {MAX_GALLERY_OBS}</span>
        )}
      </div>

      {/* Body: always the same div so ResizeObserver stays attached to a
          stable element. Swapping refs across renders caused the observer
          to fire with width=0 once the prior div detached, ping-ponging
          containerWidth back to 0 and stranding the gallery in its
          loading-skeleton branch. */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto p-2 [contain:strict] [overflow-anchor:none]">
        {rowCount === 0 ? (
          <EmptyState />
        ) : !hasPlate ? (
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
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left,
                    width: colWidth,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <LassoGalleryCard
                    obs={o}
                    channels={settledChannels}
                    hash={settledHash}
                    viewerZ={viewerZ}
                    enabled={fetchEnabled}
                    isHighlighted={focusedRowIndex === o.rowIndex}
                    onClick={() => onSelect(o.rowIndex)}
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
        Wire a row selection to populate the gallery.
      </div>
    </div>
  );
}
