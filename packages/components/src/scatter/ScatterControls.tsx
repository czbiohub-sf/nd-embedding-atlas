/**
 * Controls that float over the embedding canvas (design core/OverlayControls.jsx,
 * README §3): the axis picker (bottom-right), the selection pill (top centre)
 * and the pinned legend (bottom-left). The control group and its popovers are
 * `@ndea/ui/components/floating-controls`.
 */

import { useRef, type ReactNode } from "react";
import { overlaySurface } from "@ndea/ui/components/floating-controls";
import { IconButton } from "@ndea/ui/components/icon-button";
import { NdAxisSwapIcon } from "@ndea/ui/components/nd-icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { cn } from "@ndea/ui/lib/utils";
import type { ScatterSelectionState } from "./gpu/hooks/useScatterSelection";
import { dimLabel } from "./helpers";

export function ToolButton(props: {
  label: string;
  description: string;
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return <IconButton size="md" tooltipSide="right" {...props} />;
}

type Axis = "x" | "y" | "z";

/** One axis's embedding dimension. */
export function DimSelect({
  axis,
  obsmKey,
  nDims,
  value,
  onChange,
  bar = false,
}: {
  axis: Axis;
  obsmKey: string;
  nDims: number;
  value: number;
  onChange(dim: number): void;
  /** In the bottom-right bar: no fill, list opens upward. Otherwise a full-width filled select. */
  bar?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(dim) => dim !== null && onChange(dim)}>
      <SelectTrigger
        size="sm"
        aria-label={`${axis} axis dimension`}
        className={bar ? "bg-transparent font-mono" : "w-full font-mono"}
      >
        <SelectValue>{(dim: number) => dimLabel(obsmKey, dim)}</SelectValue>
      </SelectTrigger>
      <SelectContent side={bar ? "top" : "bottom"} align="end">
        {Array.from({ length: nDims }, (_, dim) => (
          <SelectItem key={dim} value={dim} className="font-mono">
            {dimLabel(obsmKey, dim)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A labelled dimension select; the wheel over it steps through the dimensions. */
function AxisSelect(props: { axis: Axis; obsmKey: string; nDims: number; value: number; onChange(dim: number): void }) {
  const { axis, nDims, value, onChange } = props;
  // Trackpads send many small deltas: step once per ~40px of scroll.
  const wheel = useRef(0);
  return (
    <div
      className="flex items-center gap-1"
      onWheel={(e) => {
        wheel.current += e.deltaY;
        if (Math.abs(wheel.current) < 40) return;
        const next = Math.min(nDims - 1, Math.max(0, value + Math.sign(wheel.current)));
        wheel.current = 0;
        if (next !== value) onChange(next);
      }}
    >
      <span className="pl-1.5 font-mono text-sm text-text-muted">{axis}</span>
      <DimSelect {...props} bar />
    </div>
  );
}

export interface AxisDims {
  xDim: number;
  yDim: number;
  /** null = 2D. */
  zDim: number | null;
}

/** `x UMAP1 ⌄ │ y UMAP2 ⌄ │ z UMAP3 ⌄ │ swap`, bottom-right, shown for every embedding; z only in 3D. */
export function AxisPicker({
  obsmKey,
  nDims,
  dims,
  onChange,
}: {
  obsmKey: string;
  nDims: number;
  dims: AxisDims;
  onChange(dims: Partial<AxisDims>): void;
}) {
  const { xDim, yDim, zDim } = dims;
  const divider = <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />;
  return (
    <div className={cn("absolute right-2 bottom-2 z-20 flex items-center rounded-lg p-0.5", overlaySurface)}>
      <AxisSelect axis="x" obsmKey={obsmKey} nDims={nDims} value={xDim} onChange={(x) => onChange({ xDim: x })} />
      {divider}
      <AxisSelect axis="y" obsmKey={obsmKey} nDims={nDims} value={yDim} onChange={(y) => onChange({ yDim: y })} />
      {divider}
      {zDim !== null ? (
        <>
          <AxisSelect axis="z" obsmKey={obsmKey} nDims={nDims} value={zDim} onChange={(z) => onChange({ zDim: z })} />
          {divider}
        </>
      ) : null}
      <IconButton size="md" label="Swap x and y" tooltipSide="top" onClick={() => onChange({ xDim: yDim, yDim: xDim })}>
        <NdAxisSwapIcon />
      </IconButton>
    </div>
  );
}

const pillButton =
  "whitespace-nowrap rounded-md px-2 py-1 text-ui text-text-muted hover:bg-muted hover:text-foreground";

/** After a box or lasso: `1,284 obs · lasso` with Invert, Save as source and Clear (top centre). */
export function SelectionPill({
  selection,
  onInvert,
  onSave,
  onClear,
}: {
  selection: ScatterSelectionState;
  onInvert(): void;
  onSave(): void;
  onClear(): void;
}) {
  return (
    <div
      className={cn(
        "absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-0.5 pl-2.5 animate-nd-in",
        overlaySurface,
      )}
    >
      <span className="pr-1.5 text-ui whitespace-nowrap">
        <span className="font-mono tabular-nums">{selection.count.toLocaleString()} obs</span>
        <span className="text-text-muted"> · {selection.tool}</span>
      </span>
      <button type="button" className={pillButton} onClick={onInvert}>
        Invert
      </button>
      <button type="button" className={pillButton} onClick={onSave}>
        Save as source
      </button>
      <button type="button" className={pillButton} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

/** The legend pinned into the view's bottom-left; unpinned from the Legend popover only. */
export function PinnedLegend({ children }: { children: ReactNode }) {
  return (
    <div className={cn("absolute bottom-2 left-2 z-20 max-w-60 rounded-lg p-1 animate-nd-in", overlaySurface)}>
      {children}
    </div>
  );
}
