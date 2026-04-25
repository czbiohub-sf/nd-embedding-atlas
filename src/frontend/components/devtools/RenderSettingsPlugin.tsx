/**
 * RenderSettingsPlugin — dev tools panel for global render-quality knobs.
 *
 * Currently houses:
 *   - Sharpness slider (per-point falloff exponent; 0.5 → 16, default 2.0)
 *
 * Future entries (HDR, bloom, tone mapping, exposure) land here.
 */

import { useSelector } from "@tanstack/react-store";
import {
  renderSettingsStore,
  setSharpness,
  SHARPNESS_DEFAULT,
  SHARPNESS_MAX,
  SHARPNESS_MIN,
} from "../../stores/RenderSettingsStore";

interface SliderRowProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}

function SliderRow({ label, description, value, min, max, step, defaultValue, onChange, formatValue }: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="border-white/5 border-b px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-white/70 text-xs">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-white/90 text-xs tabular-nums">
            {formatValue ? formatValue(value) : value.toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
            title="Reset to default"
          >
            reset
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:transition-colors hover:[&::-webkit-slider-thumb]:bg-white"
        style={{
          background: `linear-gradient(to right, oklch(0.585 0.233 277.117 / 60%) ${pct}%, oklch(1 0 0 / 10%) ${pct}%)`,
        }}
      />
      {description && <div className="mt-1.5 font-mono text-[10px] text-white/30 leading-snug">{description}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="sticky top-0 bg-[#0d0d14] px-4 py-1.5 font-semibold text-[10px] text-white/30 uppercase tracking-widest">
        {title}
      </div>
      {children}
    </div>
  );
}

export function RenderSettingsPlugin() {
  const sharpness = useSelector(renderSettingsStore, (s) => s.sharpness);

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d14] text-white">
      <Section title="Point appearance">
        <SliderRow
          label="Sharpness"
          description="Falloff exponent: pow(1 - r, sharpness). 2 = soft halo, 8 = hard dot. The visible disk size stays constant — the vertex shader compensates."
          value={sharpness}
          min={SHARPNESS_MIN}
          max={SHARPNESS_MAX}
          step={0.1}
          defaultValue={SHARPNESS_DEFAULT}
          onChange={setSharpness}
        />
      </Section>
    </div>
  );
}
