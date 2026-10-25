import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@ndea/ui/components/panel";
import { Slider } from "@ndea/ui/components/slider";
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

/** Imperatively set a volume param on every layer that has it. */
function setLayerParam(layers: readonly { layer: object }[], key: string, value: number) {
  for (const { layer } of layers) {
    if (key in layer) (layer as Record<string, unknown>)[key] = value;
  }
}

export function VolumeControls() {
  const { state } = useViewer();
  const layersRef = useRef<typeof state.layers>([]);
  useEffect(() => {
    layersRef.current = state.layers;
  }, [state.layers]);

  // Volume params are imperative (mutate layer directly); state only remembers the
  // last slider values so sliders (uncontrolled via defaultValue) restore on remount.
  const [values, setValues] = useState(DEFAULTS);

  const handleOpacity = useCallback((vals: number[]) => {
    setValues((v) => ({ ...v, opacity: vals[0] }));
    setLayerParam(layersRef.current, "opacityMultiplier", opacityToMultiplier(vals[0]));
  }, []);

  const handleStep = useCallback((vals: number[]) => {
    setValues((v) => ({ ...v, step: vals[0] }));
    setLayerParam(layersRef.current, "relativeStepSize", vals[0]);
  }, []);

  const handleEarlyStop = useCallback((vals: number[]) => {
    setValues((v) => ({ ...v, earlyStop: vals[0] }));
    setLayerParam(layersRef.current, "earlyTerminationAlpha", vals[0]);
  }, []);

  if (state.viewMode !== "3d") return null;

  return (
    <Panel className="flex min-w-44 flex-col gap-1.5 p-2">
      <VolumeRow
        label="α"
        title="Opacity (log scale)"
        defaultValue={values.opacity}
        min={0}
        max={1}
        step={0.01}
        onValueChange={handleOpacity}
      />
      <VolumeRow
        label="stp"
        title="Step size"
        defaultValue={values.step}
        min={0.25}
        max={3}
        step={0.25}
        onValueChange={handleStep}
      />
      <VolumeRow
        label="e.s."
        title="Early stop α"
        defaultValue={values.earlyStop}
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
      <span className="w-7 shrink-0 text-right text-2xs text-muted-foreground">{label}</span>
      <Slider
        className="flex-1"
        defaultValue={[defaultValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={handleChange}
      />
      <span ref={displayRef} className="w-8 text-right text-2xs text-muted-foreground tabular-nums">
        {defaultValue.toFixed(2)}
      </span>
    </div>
  );
}
