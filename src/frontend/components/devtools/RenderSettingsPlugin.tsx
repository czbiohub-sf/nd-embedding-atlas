/**
 * RenderSettingsPlugin — dev tools panel for global render-quality knobs.
 *
 * Houses:
 *   - Point opacity slider (per-point alpha multiplier; 0.05 → 1.0, default 0.7)
 *   - Tone mapping selector (None / Reinhard / ACES / AgX, default AgX)
 *   - Exposure slider (-3 → +3 stops)
 *   - Bloom strength + threshold sliders
 */

import { useSelector } from "@tanstack/react-store";
import {
  BLEND_MODE_DEFAULT,
  type BlendMode,
  BLOOM_STRENGTH_DEFAULT,
  BLOOM_STRENGTH_MAX,
  BLOOM_STRENGTH_MIN,
  BLOOM_THRESHOLD_DEFAULT,
  BLOOM_THRESHOLD_MAX,
  BLOOM_THRESHOLD_MIN,
  EXPOSURE_DEFAULT,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  POINT_OPACITY_DEFAULT,
  POINT_OPACITY_MAX,
  POINT_OPACITY_MIN,
  renderSettingsStore,
  setBlendMode,
  setBloomStrength,
  setBloomThreshold,
  setExposure,
  setPointOpacity,
  setToneMapping,
  TONE_MAPPING_DEFAULT,
  type ToneMapping,
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

interface SegmentedRowProps<T extends string> {
  label: string;
  description?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  defaultValue: T;
}

function SegmentedRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  defaultValue,
}: SegmentedRowProps<T>) {
  return (
    <div className="border-white/5 border-b px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-white/70 text-xs">{label}</span>
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
          title="Reset to default"
        >
          reset
        </button>
      </div>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-sm px-2 py-1 font-mono text-[11px] transition-colors ${
              value === opt.value
                ? "bg-purple-500/30 text-white"
                : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
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

const TONE_MAPPING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "reinhard", label: "Reinhard" },
  { value: "aces", label: "ACES" },
  { value: "agx", label: "AgX" },
] as const satisfies readonly { value: ToneMapping; label: string }[];

const BLEND_MODE_OPTIONS = [
  { value: "additive", label: "Additive" },
  { value: "premultiplied", label: "Premul" },
  { value: "max", label: "Max" },
] as const satisfies readonly { value: BlendMode; label: string }[];

export function RenderSettingsPlugin() {
  const settings = useSelector(renderSettingsStore, (s) => s);

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d14] text-white">
      <Section title="Point appearance">
        <SliderRow
          label="Point opacity"
          description="Alpha multiplier per point. Under additive blending: 1.0 = a single point dominates, 0.3 = ~3 overlapping points are needed to saturate. Lower values give more headroom for HDR rolloff."
          value={settings.pointOpacity}
          min={POINT_OPACITY_MIN}
          max={POINT_OPACITY_MAX}
          step={0.01}
          defaultValue={POINT_OPACITY_DEFAULT}
          onChange={setPointOpacity}
        />
      </Section>
      <Section title="Compositing">
        <SegmentedRow<BlendMode>
          label="Blend mode"
          description="Additive = order-independent, dense regions sum (recommended). Premul = preserves category color identity, order-dependent. Max = brightest-fragment-wins, useful for max-projection style views."
          value={settings.blendMode}
          options={BLEND_MODE_OPTIONS}
          onChange={setBlendMode}
          defaultValue={BLEND_MODE_DEFAULT}
        />
      </Section>
      <Section title="HDR + tone mapping">
        <SegmentedRow<ToneMapping>
          label="Tone mapping"
          description="AgX = Filament/Three.js film-curve. ACES = UE4 fit. Reinhard = simple. None = clamp."
          value={settings.toneMapping}
          options={TONE_MAPPING_OPTIONS}
          onChange={setToneMapping}
          defaultValue={TONE_MAPPING_DEFAULT}
        />
        <SliderRow
          label="Exposure"
          description="Stops (log2). +1 = 2× brighter, -1 = half brightness. Applied before tone mapping."
          value={settings.exposure}
          min={EXPOSURE_MIN}
          max={EXPOSURE_MAX}
          step={0.05}
          defaultValue={EXPOSURE_DEFAULT}
          onChange={setExposure}
          formatValue={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} EV`}
        />
        <SliderRow
          label="Bloom strength"
          description="Mix amount of the blurred bright extract. 0 = off."
          value={settings.bloomStrength}
          min={BLOOM_STRENGTH_MIN}
          max={BLOOM_STRENGTH_MAX}
          step={0.01}
          defaultValue={BLOOM_STRENGTH_DEFAULT}
          onChange={setBloomStrength}
        />
        <SliderRow
          label="Bloom threshold"
          description="HDR luminance above which bloom is extracted. Higher = only the brightest cores glow."
          value={settings.bloomThreshold}
          min={BLOOM_THRESHOLD_MIN}
          max={BLOOM_THRESHOLD_MAX}
          step={0.05}
          defaultValue={BLOOM_THRESHOLD_DEFAULT}
          onChange={setBloomThreshold}
        />
      </Section>
    </div>
  );
}
