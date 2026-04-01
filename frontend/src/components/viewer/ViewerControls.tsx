import { useMemo } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useViewer } from "../../hooks/useViewer";
import { cn } from "../../lib/utils";
import { Slider } from "../ui/slider";

interface Props {
  cropSize: number;
  setCropSize: (size: number) => void;
}

export function ViewerControls({ cropSize, setCropSize }: Props) {
  const { state: dashState, actions: dashActions } = useDashboard();
  const { state, actions } = useViewer();
  const { bounds, zIndex, tIndex, viewMode } = state;
  const { trajectory, metadata } = dashState;
  const hasCellCoords = !!metadata.spatial?.x_col;

  const traj = trajectory?.points;
  const trajTimepoints = useMemo(() => (traj ? traj.map((p) => p.t) : null), [traj]);
  const isTrajectoryMode = trajTimepoints != null && trajTimepoints.length > 0;

  const effectiveTMax = isTrajectoryMode ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);
  const hasT = effectiveTMax > 0 || isTrajectoryMode;
  const hasZ = bounds.zMax !== null && bounds.zMax > 0;
  const showModeToggle = hasZ || viewMode === "3d";
  const hasControls = hasT || hasZ || hasCellCoords || showModeToggle;

  if (!hasControls) return null;

  const tDisplayIndex = isTrajectoryMode ? Math.max(0, trajTimepoints?.indexOf(tIndex) ?? 0) : tIndex;

  function handleTChange(val: number) {
    if (isTrajectoryMode && trajTimepoints) {
      const t = trajTimepoints[val] ?? trajTimepoints[0];
      actions.setTIndex(t);
      dashActions.setTrajectoryTIndex(t);
    } else {
      actions.setTIndex(val);
    }
  }

  return (
    <div className="flex min-w-44 flex-col gap-1.5 rounded-lg border border-white/[0.07] bg-card/80 p-2 backdrop-blur-md">
      {hasT && (
        <SliderRow
          label={isTrajectoryMode ? "T*" : "T"}
          value={tDisplayIndex}
          min={0}
          max={effectiveTMax}
          step={1}
          onChange={(v) => handleTChange(Math.round(v))}
        />
      )}

      {hasZ && viewMode === "2d" && (
        <SliderRow
          label="Z"
          value={zIndex}
          min={0}
          max={bounds.zMax ?? 0}
          step={1}
          onChange={(v) => actions.setZIndex(Math.round(v))}
        />
      )}

      {hasCellCoords && (
        <SliderRow
          label="px"
          value={cropSize}
          min={50}
          max={500}
          step={10}
          onChange={(v) => setCropSize(Math.round(v))}
        />
      )}

      {showModeToggle && (
        <div className="flex items-center gap-1.5">
          <span className="w-5 shrink-0 text-[10px] text-muted-foreground" />
          <div className="flex overflow-hidden rounded-md border border-border/60">
            {(["2d", "3d"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => actions.setViewMode(mode)}
                className={cn(
                  "px-2 py-0.5 text-[10px] transition-colors",
                  viewMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared slider row ────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <Slider
        className="flex-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
      <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}
