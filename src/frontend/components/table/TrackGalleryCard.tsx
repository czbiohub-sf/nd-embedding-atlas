import type { ChannelHash } from "../../lib/branded-types";
import { cn } from "../../lib/utils";
import type { TrajectoryFrame } from "../../types";
import type { ChannelDef } from "../viewer/ViewerContext";
import { useGalleryCropQuery } from "./useGalleryCropQuery";

export interface TrackGalleryCardProps {
  frame: TrajectoryFrame;
  fovName: string;
  isActive: boolean;
  onClick: () => void;
  fetchEnabled: boolean;
  settledChannels: readonly ChannelDef[];
  settledHash: ChannelHash;
  datasetKey?: string;
}

export function TrackGalleryCard({
  frame,
  fovName,
  isActive,
  onClick,
  fetchEnabled,
  settledChannels,
  settledHash,
  datasetKey,
}: TrackGalleryCardProps) {
  const { data: blobUrl, isLoading } = useGalleryCropQuery({
    fovName,
    frame,
    channels: settledChannels,
    hash: settledHash,
    datasetKey,
    enabled: fetchEnabled && settledChannels.length > 0,
  });

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border-2 bg-background transition-all duration-150",
        isActive
          ? "border-primary shadow-[0_0_0_3px_oklch(0.585_0.233_277.117/0.2)]"
          : "border-border/40 hover:border-border/70",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black">
        {(isLoading || !blobUrl) && <div className="absolute inset-0 animate-pulse bg-muted/20" />}
        {blobUrl && <img src={blobUrl} alt={`T=${frame.t}`} className="absolute inset-0 h-full w-full object-cover" />}
        {isActive && (
          <div className="absolute top-1.5 right-1.5 rounded bg-primary px-1.5 py-0.5 font-semibold text-3xs text-primary-foreground">
            NOW
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-0.5 border-t px-2 py-1.5",
          isActive ? "border-primary/30 bg-primary/5" : "border-border/30 bg-muted/10",
        )}
      >
        <span className={cn("font-medium text-2xs tabular-nums", isActive ? "text-primary" : "text-foreground/70")}>
          T = {frame.t}
        </span>
        {frame.category != null && <span className="text-3xs text-muted-foreground/60">{frame.category}</span>}
        <span className="text-3xs text-muted-foreground/40 tabular-nums">
          {frame.spatial_x.toFixed(1)} · {frame.spatial_y.toFixed(1)} µm
        </span>
      </div>
    </div>
  );
}
