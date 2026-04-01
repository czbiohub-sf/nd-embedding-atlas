import type { OklchColor } from "@/lib/color-conversions";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface OklchColorPickerProps {
  label: string;
  color: OklchColor;
  defaultColor: OklchColor;
  onChange: (color: OklchColor) => void;
  onReset: () => void;
}

/** Swatch showing the current color */
function ColorSwatch({ color }: { color: OklchColor }) {
  const bg = `oklch(${color.l} ${color.c} ${color.h}deg)`;
  return (
    <div
      className="h-5 w-full rounded-sm border border-white/10"
      style={{ background: bg }}
    />
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  gradient: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, gradient, onChange }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[9px] text-muted-foreground/70 tabular-nums">
        <span>{label}</span>
        <span>{value.toFixed(label === "H" ? 0 : 2)}</span>
      </div>
      <div className="relative">
        {/* Gradient track behind the transparent slider track */}
        <div
          className="pointer-events-none absolute inset-y-[5px] inset-x-[6px] rounded-full"
          style={{ background: gradient }}
        />
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => {
              const next = Array.isArray(v) ? (v[0] ?? value) : v;
              onChange(next);
            }}
          className={cn(
            "relative",
            "[&_[data-slot=slider-track]]:bg-transparent",
          )}
        />
      </div>
    </div>
  );
}

export function OklchColorPicker({ label, color, defaultColor, onChange, onReset }: OklchColorPickerProps) {
  const { l, c, h } = color;

  // Live gradient computation — inline style is the only legitimate approach here
  // since values are computed from L/C/H state and cannot be expressed as static Tailwind utilities.
  const lGrad = `linear-gradient(to right, oklch(0 ${c} ${h}deg), oklch(0.5 ${c} ${h}deg), oklch(1 ${c} ${h}deg))`;
  const cGrad = `linear-gradient(to right, oklch(${l} 0 ${h}deg), oklch(${l} 0.2 ${h}deg), oklch(${l} 0.35 ${h}deg))`;
  const hGrad = [0, 60, 120, 180, 240, 300, 360]
    .map((deg) => `oklch(${l} ${c} ${deg}deg)`)
    .join(", ");
  const hGradient = `linear-gradient(to right, ${hGrad})`;

  const isDefault =
    Math.abs(l - defaultColor.l) < 0.005 &&
    Math.abs(c - defaultColor.c) < 0.005 &&
    Math.abs(h - defaultColor.h) < 1;

  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-text-secondary" title={label}>
          {label}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          className="shrink-0 rounded px-1 py-0.5 text-[9px] text-muted-foreground/70 hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30 transition-opacity"
        >
          ↺ reset
        </button>
      </div>
      <ColorSwatch color={color} />
      <SliderRow
        label="L"
        value={l}
        min={0}
        max={1}
        step={0.01}
        gradient={lGrad}
        onChange={(v) => onChange({ l: v, c, h })}
      />
      <SliderRow
        label="C"
        value={c}
        min={0}
        max={0.37}
        step={0.005}
        gradient={cGrad}
        onChange={(v) => onChange({ l, c: v, h })}
      />
      <SliderRow
        label="H"
        value={h}
        min={0}
        max={360}
        step={1}
        gradient={hGradient}
        onChange={(v) => onChange({ l, c, h: v })}
      />
    </div>
  );
}
