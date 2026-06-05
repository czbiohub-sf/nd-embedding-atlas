import { useCallback, useRef } from "react";
import { Panel } from "../ui/panel";
import { Slider } from "../ui/slider";
import { useViewer } from "./useViewer";

// Opacity stored as [0,1] log-scale; opacityMultiplier = 10^(v*4-3)
// 0 → 0.001, 0.5 → ~0.1, 0.75 → 1.0, 1.0 → 10.0
const opacityToMultiplier = (v: number) => 10 ** (v * 4 - 3);
const multiplierToOpacity = (m: number) => (Math.log10(m) + 3) / 4;

const DEFAULTS = {
  opacity: multiplierToOpacity(1.0),
  step: 1.0,
  earlyStop: 0.99,
};

export function VolumeControls() {
  const { state } = useViewer();
  const layersRef = useRef(state.layers);
  layersRef.current = state.layers;

  // Refs hold current slider values — volume params are imperative (mutate layer directly).
  // defaultValue is used on the sliders so they stay uncontrolled and don't reset on re-render.
  const opacityRef = useRef(DEFAULTS.opacity);
  const stepRef = useRef(DEFAULTS.step);
  const earlyStopRef = useRef(DEFAULTS.earlyStop);

  const handleOpacity = useCallback((vals: number[]) => {
    opacityRef.current = vals[0];
    const multiplier = opacityToMultiplier(vals[0]);
    for (const { layer } of layersRef.current) {
      if ("opacityMultiplier" in layer) {
        (layer as Record<string, unknown>).opacityMultiplier = multiplier;
      }
    }
  }, []);

  const handleStep = useCallback((vals: number[]) => {
    stepRef.current = vals[0];
    for (const { layer } of layersRef.current) {
      if ("relativeStepSize" in layer) {
        (layer as Record<string, unknown>).relativeStepSize = vals[0];
      }
    }
  }, []);

  const handleEarlyStop = useCallback((vals: number[]) => {
    earlyStopRef.current = vals[0];
    for (const { layer } of layersRef.current) {
      if ("earlyTerminationAlpha" in layer) {
        (layer as Record<string, unknown>).earlyTerminationAlpha = vals[0];
      }
    }
  }, []);

  if (state.viewMode !== "3d") return null;

  return (
    <Panel variant="glass" className="flex min-w-44 flex-col gap-1.5 p-2">
      <VolumeRow
        label="α"
        title="Opacity (log scale)"
        defaultValue={opacityRef.current}
        min={0}
        max={1}
        step={0.01}
        onValueChange={handleOpacity}
      />
      <VolumeRow
        label="stp"
        title="Step size"
        defaultValue={stepRef.current}
        min={0.25}
        max={3}
        step={0.25}
        onValueChange={handleStep}
      />
      <VolumeRow
        label="e.s."
        title="Early stop α"
        defaultValue={earlyStopRef.current}
        min={0.8}
        max={1.0}
        step={0.01}
        onValueChange={handleEarlyStop}
      />
    </Panel>
  );
}

// ── Shared row ───────────────────────────────────────────────────────────────

interface VolumeRowProps {
  label: string;
  title: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (vals: number[]) => void; // receives normalized number[] from handleChange
}

function VolumeRow({ label, title, defaultValue, min, max, step, onValueChange }: VolumeRowProps) {
  const displayRef = useRef<HTMLSpanElement>(null);

  function handleChange(v: number | readonly number[]) {
    const vals = Array.isArray(v) ? (v as number[]) : [v as number];
    onValueChange(vals);
    if (displayRef.current) displayRef.current.textContent = vals[0].toFixed(2);
  }

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="w-7 shrink-0 text-right text-3xs text-muted-foreground">{label}</span>
      <Slider
        className="flex-1"
        defaultValue={[defaultValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={handleChange}
      />
      <span ref={displayRef} className="w-8 text-right text-3xs text-muted-foreground tabular-nums">
        {defaultValue.toFixed(2)}
      </span>
    </div>
  );
}
