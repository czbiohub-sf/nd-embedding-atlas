import { useMemo } from "react";
import { selectTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { cn } from "../../lib/utils";
import { Panel } from "../ui/panel";
import { SliderRow } from "../ui/slider-row";
import { useViewer } from "./useViewer";

interface Props {
  cropSize: number;
  setCropSize: (size: number) => void;
  datasetKey?: string;
}

export function ViewerControls({ cropSize, setCropSize, datasetKey }: Props) {
  const { state: dashState, actions: dashActions } = useDashboard();
  const { state, actions } = useViewer();
  const { bounds, zIndex, tIndex, viewMode } = state;
  const { trajectories, metadata } = dashState;
  const trajectory = selectTrajectory(trajectories, datasetKey);
  const hasCellCoords = !!metadata.spatial?.x_col;

  const traj = trajectory?.points;
  const trajTimepoints = useMemo(() => (traj ? traj.map((p) => p.t) : null), [traj]);
  const isTrajectoryMode = trajTimepoints != null && trajTimepoints.length > 0;

  const effectiveTMax = isTrajectoryMode ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);
  const hasT = effectiveTMax > 0 || isTrajectoryMode;
  const hasZ = bounds.zMax != null && bounds.zMax > 0;
  const showModeToggle = hasZ || viewMode === "3d";
  const hasControls = hasT || hasZ || hasCellCoords || showModeToggle;

  if (!hasControls) return null;

  const tDisplayIndex = isTrajectoryMode ? Math.max(0, trajTimepoints?.indexOf(tIndex) ?? 0) : tIndex;

  function handleTChange(val: number) {
    if (isTrajectoryMode && trajTimepoints) {
      const t = trajTimepoints[val] ?? trajTimepoints[0];
      actions.setTIndex(t);
      dashActions.setTrajectoryTIndex(datasetKey ?? "", t);
    } else {
      actions.setTIndex(val);
    }
  }

  return (
    <Panel variant="glass" className="flex min-w-44 flex-col gap-1.5 p-2">
      {hasT && (
        <SliderRow
          label={isTrajectoryMode ? "T*" : "T"}
          value={tDisplayIndex}
          min={0}
          max={effectiveTMax}
          onValueChange={(v) => handleTChange(Math.round(v))}
        />
      )}

      {hasZ && viewMode === "2d" && (
        <SliderRow
          label="Z"
          value={zIndex}
          min={0}
          max={bounds.zMax ?? 0}
          onValueChange={(v) => actions.setZIndex(Math.round(v))}
        />
      )}

      {hasCellCoords && (
        <SliderRow
          label="px"
          value={cropSize}
          min={50}
          max={500}
          step={10}
          onValueChange={(v) => setCropSize(Math.round(v))}
        />
      )}

      {showModeToggle && (
        <div className="flex items-center gap-1.5">
          <span className="w-5 shrink-0 text-3xs text-muted-foreground" />
          <div className="flex overflow-hidden rounded-md border border-border/60">
            {(["2d", "3d"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => actions.setViewMode(mode)}
                className={cn(
                  "px-2 py-0.5 text-3xs transition-colors",
                  viewMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
