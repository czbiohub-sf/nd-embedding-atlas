import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { capabilitiesOf } from "@ndea/sdk";
import { Checkbox } from "@ndea/ui/components/checkbox";
import { Slider } from "@ndea/ui/components/slider";
import {
  ControlDivider,
  ControlGroup,
  ControlHeading,
  ControlPopover,
  ControlRow,
} from "@ndea/ui/components/floating-controls";
import { Segmented } from "@ndea/ui/components/toggle-group";
import { useImageViewerHost, useImageViewerSession } from "../context";
import { ChannelControls } from "./ChannelControls";
import { roundLength, unitSymbol } from "./scale-bar";
import { useViewer } from "./useViewer";

export type RenderMode = "local" | "remote";

/** Views narrower than this open their panels below the button instead of beside it. */
const NARROW_VIEW = 300;

function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange(v: number): void;
}) {
  return (
    <ControlRow label={label}>
      <Slider
        aria-label={label}
        className="flex-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
      />
      <span className="w-9 shrink-0 text-right font-mono text-2xs text-text-muted">{format(value)}</span>
    </ControlRow>
  );
}

// Volume opacity slider is log-scaled: opacityMultiplier = 10^(v*4-3), so 0.75 → 1.0.
const VOLUME_DEFAULTS = { opacity: 0.75, step: 1, earlyStop: 0.99 };

/** Set a volume param on every live layer that has it (idetik layers are mutable objects). */
function setLayerParam(layers: readonly { layer: object }[], key: string, value: number) {
  for (const { layer } of layers) {
    if (key in layer) (layer as Record<string, unknown>)[key] = value;
  }
}

/** 3D ray-march parameters; written straight onto the live volume layers. */
function VolumeRows() {
  const { state } = useViewer();
  const [values, setValues] = useState(VOLUME_DEFAULTS);
  const set = (key: keyof typeof VOLUME_DEFAULTS, layerKey: string, value: number, layerValue = value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setLayerParam(state.layers, layerKey, layerValue);
  };
  return (
    <>
      <NumberSlider
        label="Opacity"
        value={values.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => set("opacity", "opacityMultiplier", v, 10 ** (v * 4 - 3))}
      />
      <NumberSlider
        label="Step"
        value={values.step}
        min={0.25}
        max={3}
        step={0.25}
        format={(v) => v.toFixed(2)}
        onChange={(v) => set("step", "relativeStepSize", v)}
      />
      <NumberSlider
        label="Early stop"
        value={values.earlyStop}
        min={0.8}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => set("earlyStop", "earlyTerminationAlpha", v)}
      />
    </>
  );
}

/** View settings that are not per channel: T/Z, 2D/3D, bounding box, volume, render mode. */
function ViewOptions({
  datasetKey,
  side,
  render,
}: {
  datasetKey?: string;
  side: "right" | "bottom";
  render?: { mode: RenderMode; onChange(mode: RenderMode): void };
}) {
  const session = useImageViewerSession();
  const host = useImageViewerHost();
  const { state, actions } = useViewer();
  const { bounds, zIndex, tIndex, viewMode, cropSize, showBbox } = state;
  const trajectory = session.trajectories[datasetKey ?? ""] ?? null;
  const hasCellCoords = capabilitiesOf(host.data.metadata).has("spatial");

  const traj = trajectory?.points;
  const trajTimepoints = useMemo(() => (traj?.length ? traj.map((p) => p.t) : null), [traj]);
  const tMax = trajTimepoints ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);
  const hasZ = bounds.zMax != null && bounds.zMax > 0;

  return (
    <ControlPopover
      icon={<SlidersHorizontal />}
      label="View"
      description="Time, Z plane, 2D/3D, bounding box"
      title="View"
      side={side}
      className="w-64"
    >
      {(tMax > 0 || trajTimepoints) && (
        <NumberSlider
          label={trajTimepoints ? "T (track)" : "T"}
          value={trajTimepoints ? Math.max(0, trajTimepoints.indexOf(tIndex)) : tIndex}
          min={0}
          max={tMax}
          onChange={(v) => {
            const t = trajTimepoints ? (trajTimepoints[v] ?? trajTimepoints[0]) : v;
            actions.setTIndex(t);
            if (trajTimepoints) session.setTrajectoryTIndex(datasetKey ?? "", t);
          }}
        />
      )}
      {hasZ && viewMode === "2d" && (
        <NumberSlider label="Z" value={zIndex} min={0} max={bounds.zMax ?? 0} onChange={actions.setZIndex} />
      )}
      {(hasZ || viewMode === "3d") && (
        <ControlRow label="Mode">
          <Segmented
            label="View mode"
            value={viewMode}
            options={[
              { value: "2d", label: "2D" },
              { value: "3d", label: "3D" },
            ]}
            onChange={actions.setViewMode}
          />
        </ControlRow>
      )}
      {viewMode === "3d" && <VolumeRows />}
      {hasCellCoords && viewMode === "2d" && (
        <>
          <ControlHeading>Focus box</ControlHeading>
          <ControlRow label="Show">
            <Checkbox checked={showBbox} onCheckedChange={actions.setShowBbox} aria-label="Show focus box" />
          </ControlRow>
          {showBbox && (
            <NumberSlider
              label="Size"
              value={cropSize}
              min={50}
              max={500}
              step={10}
              format={(v) => `${v}px`}
              onChange={actions.setCropSize}
            />
          )}
        </>
      )}
      {render && (
        <ControlRow label="Render">
          <Segmented
            label="Render mode"
            value={render.mode}
            options={[
              { value: "local", label: "Local" },
              { value: "remote", label: "Remote" },
            ]}
            onChange={render.onChange}
          />
        </ControlRow>
      )}
    </ControlPopover>
  );
}

/** Bottom-right physical scale bar; hidden when the pixel scale is unknown. */
function ScaleBar() {
  const { state } = useViewer();
  const perPx = state.worldPerPixel;
  if (!state.bounds.scale || perPx == null || !(perPx > 0)) return null;
  // Aim for a bar of at most ~96px.
  const length = roundLength(96 * perPx);
  const symbol = unitSymbol(state.bounds.scale.unit);
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 z-20 flex flex-col items-end gap-1 rounded-md bg-scrim px-1.5 py-1">
      <span className="font-mono text-2xs text-foreground">
        {length.toLocaleString("en-US", { maximumSignificantDigits: 3 })} {symbol}
      </span>
      <span className="h-0.5 bg-foreground" style={{ width: length / perPx }} />
    </div>
  );
}

/**
 * The viewer's overlay chrome on the tile (never on the headless render page):
 * the top-left control group (Channels, View) and the bottom-right scale bar.
 */
export function ViewerControls({
  datasetKey,
  render,
}: {
  datasetKey?: string;
  render?: { mode: RenderMode; onChange(mode: RenderMode): void };
}) {
  const measure = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const hasChannels = useViewer().state.channels.length > 0;
  useEffect(() => {
    const el = measure.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_VIEW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const side = narrow ? "bottom" : "right";
  return (
    <>
      <div ref={measure} aria-hidden className="pointer-events-none absolute inset-0" />
      <ControlGroup>
        <ChannelControls side={side} />
        {hasChannels && <ControlDivider />}
        <ViewOptions datasetKey={datasetKey} side={side} render={render} />
      </ControlGroup>
      <ScaleBar />
    </>
  );
}
