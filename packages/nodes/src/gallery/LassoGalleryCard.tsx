/**
 * LassoGalleryCard: single crop card for the lasso gallery.
 *
 * Mirrors TrackGalleryCard's visual language and per-crop fetch pattern,
 * but takes a flat LassoObs (rowIndex/fov/t/x/y) instead of a
 * TrajectoryFrame and is decoupled from the trajectory active-frame state.
 */

import type { ChannelHash } from "./contracts";
import { cn } from "@ndea/ui/lib/utils";
import type { ChannelDef } from "./contracts";
import { useGalleryCropQuery } from "./useGalleryCropQuery";
import type { LassoObs } from "./useLassoSelectionObs";

export interface LassoGalleryCardProps {
  obs: LassoObs;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  viewerZ: number;
  enabled: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}

export function LassoGalleryCard({
  obs,
  channels,
  hash,
  viewerZ,
  enabled,
  isHighlighted,
  onClick,
}: LassoGalleryCardProps) {
  // Crops route to the plate that owns this observation: `obs.datasetKey`
  // comes from the `_dataset` column in obs_base (multi-dataset stores) and
  // is undefined for single-dataset stores (server falls back to mounts[0]).
  const datasetKey = obs.datasetKey;

  // useGalleryCropQuery expects a TrajectoryFrame-shaped object: we pass
  // through the fields it actually reads (t, rowIndex). spatial_x/y are
  // unused by the query (it reads cached obs coords) but typed as required.
  const frame = {
    t: obs.t,
    emb_x: 0,
    emb_y: 0,
    spatial_x: obs.x,
    spatial_y: obs.y,
    z: obs.z,
    rowIndex: obs.rowIndex,
    datasetKey: datasetKey ?? null,
  };

  const { data, isLoading } = useGalleryCropQuery({
    fovName: obs.fov ?? "",
    frame,
    channels,
    hash,
    viewerZ,
    datasetKey,
    enabled: enabled && !!obs.fov && channels.length > 0,
  });
  const blobUrl = data?.url;
  // True aspect from the server dims; 1 (square) until the crop resolves so the
  // skeleton doesn't jump. The image box matches this exactly, so nothing is
  // stretched or center-cropped.
  const aspect = data?.w && data?.h ? data.w / data.h : 1;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // w-full is critical: <button> defaults to intrinsic-content sizing
        // even with `flex flex-col`, so without it the card collapses to the
        // image's natural size instead of filling the virtualizer column.
        "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-md border bg-background text-left transition-all duration-150",
        isHighlighted ? "border-primary ring-2 ring-primary/30" : "border-border/40 hover:border-border/70",
      )}
    >
      <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: aspect }}>
        {(isLoading || !blobUrl) && <div className="absolute inset-0 animate-pulse bg-muted/20" />}
        {blobUrl && (
          <img
            src={blobUrl}
            alt={obs.fov ?? `obs ${obs.rowIndex}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-0.5 border-t px-2 py-1.5",
          isHighlighted ? "border-primary/30 bg-primary/5" : "border-border/30 bg-muted/10",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-2xs",
              isHighlighted ? "font-medium text-primary" : "text-foreground/85",
            )}
            title={obs.fov ?? undefined}
          >
            {obs.fov ?? `obs ${obs.rowIndex}`}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-3xs tabular-nums",
              isHighlighted ? "text-primary/70" : "text-muted-foreground/70",
            )}
          >
            {obs.trackId != null ? `#${obs.trackId} · T ${obs.t}` : `T ${obs.t}`}
          </span>
        </div>
        {obs.datasetKey && (
          // Only renders in multi-dataset mode (server omits `dataset` for
          // single-dataset stores). Helps the user trace which yaml-grouped
          // dataset a crop belongs to.
          <span className="truncate font-mono text-3xs text-muted-foreground/50" title={obs.datasetKey}>
            {obs.datasetKey}
          </span>
        )}
      </div>
    </button>
  );
}
