import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@ndea/ui/lib/utils";
import { Slider } from "./slider";

/**
 * SliderRow: compact horizontal row: [label] [slider] [value].
 *
 * Lifts the ad-hoc pattern from ViewerControls/VolumeControls/ChannelControls
 * into a shared primitive. Handles single-thumb sliders; for dual-thumb
 * (contrast/range) the slider can be used directly.
 *
 *   <SliderRow label="X" value={x} min={0} max={100} step={1} onValueChange={setX} />
 *
 * `formatValue` lets callers show units (°, x, px) or rounded decimals
 * without duplicating Math.round boilerplate at each site.
 */

const sliderRowVariants = cva("flex items-center gap-1.5", {
  variants: {
    density: {
      sm: "text-3xs",
      md: "text-2xs",
    },
  },
  defaultVariants: { density: "sm" },
});

const labelWidth = {
  sm: "w-5",
  md: "w-6",
} as const;

const valueWidth = {
  sm: "w-6",
  md: "w-8",
} as const;

interface SliderRowProps extends VariantProps<typeof sliderRowVariants> {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  /** Format the trailing readout. Defaults to String(value). */
  formatValue?: (value: number) => string;
  /** Override label column width class (e.g. "w-12" for long labels). */
  labelClassName?: string;
  /** Override value column width class. */
  valueClassName?: string;
  className?: string;
  disabled?: boolean;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  density = "sm",
  onValueChange,
  formatValue,
  labelClassName,
  valueClassName,
  className,
  disabled,
}: SliderRowProps) {
  const display = formatValue ? formatValue(value) : String(value);
  const rung = density ?? "sm";

  return (
    <div data-slot="slider-row" className={cn(sliderRowVariants({ density }), className)}>
      <span className={cn("shrink-0 text-muted-foreground", labelWidth[rung], labelClassName)}>{label}</span>
      <Slider
        className="flex-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => {
          onValueChange(Array.isArray(v) ? v[0] : v);
        }}
      />
      <span className={cn("text-right text-muted-foreground tabular-nums", valueWidth[rung], valueClassName)}>
        {display}
      </span>
    </div>
  );
}

export { SliderRow };
export type { SliderRowProps };
