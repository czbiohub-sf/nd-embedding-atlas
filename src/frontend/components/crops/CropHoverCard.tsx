"use client";

/**
 * CropHoverCard — wrap any element to show the FOV crop for an observation
 * on hover.
 *
 * Given a `rowIndex`, fetches the observation's fov/dataset/t, looks up the
 * live viewer channels for that dataset, and composites a WebP thumbnail via
 * POST /api/crop/{fov_path}. Uses the same `useGalleryCropQuery` pipeline
 * as TrackGallery so cache keys line up — if the gallery and a hover card
 * both want the same (fov, t, hash), only one fetch runs.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useDashboard } from "@/hooks/useDashboard";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ObsInfo } from "../../../protocol/index.ts";
import type { TrajectoryFrame } from "../../types";
import { useGalleryChannels } from "../table/useGalleryChannels";
import { useGalleryCropQuery } from "../table/useGalleryCropQuery";

interface Props {
  /** Obs row index to fetch the crop for. */
  rowIndex: number;
  /** Element that triggers the hover card. Rendered as the anchor. */
  children: React.ReactNode;
  /** Side of the trigger to anchor the card. Defaults to "right". */
  side?: "top" | "bottom" | "left" | "right";
  /** Crop size in px. Defaults to 160. */
  size?: number;
  /** Override the default ms hover delay before opening. */
  delay?: number;
}

export function CropHoverCard({ rowIndex, children, side = "right", size = 160, delay }: Props) {
  const { state } = useDashboard();

  // Obs info — enabled always; cached on server across hovers for the same row.
  const obsQuery = useQuery<ObsInfo>({
    queryKey: ["obs-info", rowIndex],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/obs/${rowIndex}`, { signal });
      if (!r.ok) throw new Error(`obs fetch failed: ${r.status}`);
      return r.json() as Promise<ObsInfo>;
    },
    staleTime: 60_000,
  });

  const datasetKey = typeof obsQuery.data?.["_dataset"] === "string" ? obsQuery.data["_dataset"] : undefined;
  const resolvedPlateChannels =
    (datasetKey ? state.metadata.dataset_channels?.[datasetKey] : undefined) ?? state.metadata.plate_channels;

  const { channels, hash } = useGalleryChannels(datasetKey ?? "docked", 300, resolvedPlateChannels);

  const fovName = obsQuery.data?.fov_name ?? "";
  const t = typeof obsQuery.data?.t === "number" ? obsQuery.data.t : 0;

  // Only rowIndex + t are consumed by useGalleryCropQuery — fill the other
  // TrajectoryFrame fields with zeroes to satisfy the type.
  const frame: TrajectoryFrame = { rowIndex, t, emb_x: 0, emb_y: 0, spatial_x: 0, spatial_y: 0 };
  const cropQuery = useGalleryCropQuery({
    fovName,
    datasetKey,
    frame,
    channels,
    hash,
    enabled: fovName.length > 0 && hash.length > 0,
  });

  // Revoke blob URL on unmount to avoid leaks when no gallery is mounted.
  useEffect(() => {
    const url = cropQuery.data;
    return () => {
      if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [cropQuery.data]);

  return (
    <HoverCard delay={delay}>
      <HoverCardTrigger render={<span>{children}</span>} />
      <HoverCardContent side={side} className="p-1">
        <div className="relative overflow-hidden rounded-sm bg-muted" style={{ width: size, height: size }}>
          {cropQuery.data ? (
            <img
              src={cropQuery.data}
              alt={`Crop for row ${rowIndex}`}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              {cropQuery.isError ? "crop unavailable" : "loading…"}
            </div>
          )}
        </div>
        <div className="mt-1 px-0.5 font-mono text-[9px] text-muted-foreground tabular-nums">
          row {rowIndex}
          {fovName ? ` · ${fovName}` : ""}
          {t != null ? ` · t=${t}` : ""}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
