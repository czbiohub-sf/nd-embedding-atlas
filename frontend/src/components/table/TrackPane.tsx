/**
 * TrackPane — trajectory scrubber + gallery for the ⌘J drawer Track tab.
 */

import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { selectAnyTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { cn } from "../../lib/utils";
import { TrackGallery } from "./TrackGallery";

const PLAY_INTERVAL_MS = 300;

export function TrackPane() {
  const { state, actions } = useDashboard();
  const trajectory = selectAnyTrajectory(state.trajectories);

  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derive active frame index ────────────────────────────────────────────
  const pts = trajectory?.points ?? [];
  const activeFrame = pts.findIndex((p) => p.t === trajectory?.tIndex);
  const safeFrame = activeFrame >= 0 ? activeFrame : 0;

  // ── Playback ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !trajectory) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      const next = (safeFrame + 1) % pts.length;
      actions.setTrajectoryTIndex(trajectory?.datasetKey ?? "", pts[next]?.t);
    }, PLAY_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, trajectory, safeFrame, pts, actions]);

  useEffect(() => {
    if (!trajectory) setPlaying(false);
  }, [trajectory]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!trajectory) return;
      const next = Math.max(0, Math.min(pts.length - 1, safeFrame + dir));
      actions.setTrajectoryTIndex(trajectory.datasetKey ?? "", pts[next]?.t);
    },
    [trajectory, pts, safeFrame, actions],
  );

  const handleFrameSelect = useCallback(
    (idx: number) => {
      if (!trajectory) return;
      const pt = pts[idx];
      if (pt) actions.setTrajectoryTIndex(trajectory.datasetKey ?? "", pt.t);
    },
    [trajectory, pts, actions],
  );

  const clearTrack = useCallback(() => {
    setPlaying(false);
    actions.clearTrajectory(trajectory?.datasetKey ?? "");
  }, [actions, trajectory]);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!trajectory) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="select-none text-[11px] text-muted-foreground/50">
          Click a point, then <span className="text-muted-foreground/70">→ Show Trajectory</span> to start tracking
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Track identity header */}
      <div className="flex shrink-0 items-center gap-2 border-border/40 border-b bg-muted/10 px-3 py-1.5 text-[10px]">
        <span className="text-foreground/60">track</span>
        <span className="font-semibold text-primary/80 tabular-nums">{trajectory.trackId}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="max-w-[180px] truncate text-muted-foreground/50">{trajectory.fovName}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-muted-foreground/50 tabular-nums">{pts.length} frames</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={clearTrack}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        >
          <XIcon className="size-3" />
          clear
        </button>
      </div>

      {/* T* scrubber */}
      <div className="flex shrink-0 items-center gap-2 border-border/30 border-b px-3 py-1.5">
        <span className="text-[10px] text-primary/70">T*</span>
        <input
          type="range"
          min={0}
          max={pts.length - 1}
          value={safeFrame}
          step={1}
          onChange={(e) => {
            const pt = pts[+e.target.value];
            if (pt) actions.setTrajectoryTIndex(trajectory.datasetKey ?? "", pt.t);
          }}
          className="flex-1 accent-primary"
          style={{ height: "3px" }}
        />
        <span className="min-w-[36px] text-right text-[10px] text-primary/70 tabular-nums">{trajectory.tIndex}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => step(-1)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <ChevronLeftIcon className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              playing ? "text-primary" : "text-muted-foreground/50 hover:text-foreground",
            )}
          >
            {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <ChevronRightIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Gallery */}
      <TrackGallery activeFrame={safeFrame} onFrameSelect={handleFrameSelect} datasetKey={trajectory.datasetKey} />
    </div>
  );
}
