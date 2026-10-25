import { Frame } from "lucide-react";
import { useMemo } from "react";
import { useImageViewerHost, useImageViewerSession } from "../context";
import { capabilitiesOf } from "@ndea/sdk";
import { Button } from "@ndea/ui/components/button";
import { ButtonGroup } from "@ndea/ui/components/button-group";
import { Panel } from "@ndea/ui/components/panel";
import { Separator } from "@ndea/ui/components/separator";
import { Slider } from "@ndea/ui/components/slider";
import { SliderRow } from "@ndea/ui/components/slider-row";
import { Toggle } from "@ndea/ui/components/toggle";
import { useViewer } from "./useViewer";

export function ViewerControls({ datasetKey }: { datasetKey?: string }) {
  const session = useImageViewerSession();
  const host = useImageViewerHost();
  const { state, actions } = useViewer();
  const { bounds, zIndex, tIndex, viewMode, cropSize, showBbox } = state;
  const { setCropSize, setShowBbox } = actions;
  const { trajectories } = session;
  const trajectory = trajectories[datasetKey ?? ""] ?? null;
  const metadata = host.data.metadata;
  const hasCellCoords = capabilitiesOf(metadata).has("spatial");

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
      session.setTrajectoryTIndex(datasetKey ?? "", t);
    } else {
      actions.setTIndex(val);
    }
  }

  return (
    <Panel className="flex min-w-44 flex-col gap-1.5 p-2">
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

      {showModeToggle && (
        <div className="flex items-center gap-1.5">
          <span className="w-5 shrink-0" />
          <ButtonGroup>
            {(["2d", "3d"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                variant={viewMode === mode ? "secondary" : "ghost"}
                aria-pressed={viewMode === mode}
                onClick={() => actions.setViewMode(mode)}
              >
                {mode.toUpperCase()}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      )}

      {/* Bounding box: one compact row at the slider density: a small show/hide
          toggle + the size slider (disabled, not removed, when hidden so the
          panel never reflows) + a px readout. Split from the T/Z/mode group
          above by the separator. Only shown when the dataset resolved centroids. */}
      {hasCellCoords && (
        <>
          <Separator className="my-0.5 bg-border/50" />
          <div className="flex items-center gap-1.5 text-2xs">
            <Toggle
              size="sm"
              pressed={showBbox}
              onPressedChange={setShowBbox}
              title="bounding box"
              className="h-5 shrink-0 gap-1 px-1.5 text-2xs"
            >
              <Frame />
              bbox
            </Toggle>
            <Slider
              className="flex-1"
              value={[cropSize]}
              min={50}
              max={500}
              step={10}
              disabled={!showBbox}
              onValueChange={(v) => setCropSize(Math.round(Array.isArray(v) ? v[0] : v))}
            />
            <span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">{cropSize}px</span>
          </div>
        </>
      )}
    </Panel>
  );
}
