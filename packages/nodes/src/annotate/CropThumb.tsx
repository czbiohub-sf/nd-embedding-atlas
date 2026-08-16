/**
 * CropThumb: one gallery crop for a single obs, reusing the Gallery node's
 * crop query (`useGalleryCropQuery` → POST /api/crop). Channels/hash are passed
 * in from `useGalleryChannels`, so a thumbnail is contrasted/colored identically
 * to the Gallery and the live viewer (they share `viewerChannelsStore`).
 *
 * Used both as the row thumbnail in AnnotateTable and the large focused crop in
 * the annotate rail: same component, different `size`.
 */

import { cn } from "@ndea/ui/lib/utils";
import type { ChannelDef, ChannelHash } from "../gallery/contracts";
import { useGalleryCropQuery } from "../gallery/useGalleryCropQuery";

export interface CropThumbProps {
  fovName: string;
  t: number | null;
  rowIndex: number;
  z?: number | null;
  datasetKey?: string;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  className?: string;
}

export function CropThumb({ fovName, t, rowIndex, z, datasetKey, channels, hash, className }: CropThumbProps) {
  const { data, isLoading } = useGalleryCropQuery({
    fovName,
    datasetKey,
    frame: {
      t: t ?? 0,
      z: z ?? undefined,
      rowIndex,
    },
    channels,
    hash,
    enabled: !!fovName && t != null && channels.length > 0,
  });
  const url = data?.url;
  return (
    <div className={cn("relative overflow-hidden rounded bg-black", className)}>
      {(isLoading || !url) && <div className="absolute inset-0 animate-pulse bg-muted/20" />}
      {url && (
        <img src={url} alt={fovName || `obs ${rowIndex}`} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}
