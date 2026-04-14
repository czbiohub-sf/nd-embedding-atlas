/**
 * PointInfoPane — selected point metadata card.
 * Draggable overlay positioned on the scatter canvas, using the same
 * useDrag hook as FloatingWindow for consistent drag behavior.
 */

import { GripHorizontal, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { useDrag } from "../../hooks/useDrag";
import { jsonFetcher } from "../../lib/fetcher";
import { cn } from "../../lib/utils";
import { Separator } from "../ui/separator";

interface PointInfoPaneProps {
  highlightId: string | null;
  additionalFields: string[];
  trajectoryActive: boolean;
  onShowTrajectory?: (trackId: number, fovName: string, clickedT?: number, datasetKey?: string) => void;
  onClearTrajectory: () => void;
}

export function PointInfoPane({
  highlightId,
  additionalFields,
  trajectoryActive,
  onShowTrajectory,
  onClearTrajectory,
}: PointInfoPaneProps) {
  const [row, setRow] = useState<Record<string, string | null> | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const drag = useDrag<{ originX: number; originY: number }>({
    onMove: (dx, dy, origin) => setPos({ x: origin.originX + dx, y: origin.originY + dy }),
    skipInteractive: true,
  });

  useEffect(() => {
    if (!highlightId) {
      setRow(null);
      return;
    }
    let cancelled = false;
    jsonFetcher(`/api/obs/${highlightId}/detail`).then(
      (data: Record<string, string | null>) => {
        if (!cancelled) setRow(data);
      },
      (err) => console.error("PointInfoPane fetch failed:", err),
    );
    return () => {
      cancelled = true;
    };
  }, [highlightId]);

  // Reset position when a new point is selected
  useEffect(() => {
    setPos({ x: 0, y: 0 });
  }, [highlightId]);

  if (!highlightId || !row) return null;

  const fields = [...additionalFields];
  const trackId = row.track_id;
  const fovName = row.fov_name;
  const canShowTrajectory = trackId && trackId !== "—" && fovName && fovName !== "—";

  return (
    <div
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      className={cn(
        "rounded-lg border border-white/[0.07] bg-card/80 backdrop-blur-md",
        "min-w-[160px] max-w-[220px] p-2.5 shadow-md",
        "font-mono text-[11px]",
        "select-none",
      )}
    >
      {/* Drag handle + header */}
      <div
        className="mb-1.5 flex cursor-grab items-center gap-1 active:cursor-grabbing"
        onPointerDown={(e) => drag.start(e, { originX: pos.x, originY: pos.y })}
      >
        <GripHorizontal className="size-3 shrink-0 text-muted-foreground/30" />
        <p className="flex-1 font-sans font-semibold text-[9px] text-muted-foreground uppercase tracking-widest">
          Point
        </p>
      </div>
      <Separator className="mb-1.5 opacity-40" />

      {/* Key–value rows */}
      <div className="flex flex-col gap-0.5">
        {fields.map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <span className="max-w-[90px] truncate text-muted-foreground/70">{key}</span>
            <span className="text-foreground/90 tabular-nums">{row[key] ?? "—"}</span>
          </div>
        ))}
      </div>

      {/* Trajectory toggle */}
      {canShowTrajectory && (
        <>
          <Separator className="my-2 opacity-40" />
          <button
            type="button"
            onClick={() =>
              trajectoryActive
                ? onClearTrajectory()
                : onShowTrajectory?.(
                    Number(trackId),
                    String(fovName),
                    row.t ? Number(row.t) : undefined,
                    row._dataset ? String(row._dataset) : undefined,
                  )
            }
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] transition-colors",
              trajectoryActive
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Waypoints className="size-3" />
            {trajectoryActive ? "Tracking" : "Show Trajectory"}
          </button>
        </>
      )}
    </div>
  );
}
