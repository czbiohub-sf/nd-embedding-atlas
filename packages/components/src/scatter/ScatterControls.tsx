/**
 * Controls that float over the embedding canvas (design core/OverlayControls.jsx,
 * README §3): the control group (top-left), the axis picker (bottom-right), the
 * selection pill (top centre) and the pinned legend (bottom-left). Solid
 * overlay fill, no blur.
 */

import { useRef, type ReactNode } from "react";
import { HoverTip } from "@ndea/ui/components/hover-tip";
import { IconButton, iconButtonVariants } from "@ndea/ui/components/icon-button";
import { NdAxisSwapIcon } from "@ndea/ui/components/nd-icons";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  popoverHeading,
} from "@ndea/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@ndea/ui/components/toggle-group";
import { cn } from "@ndea/ui/lib/utils";
import type { ScatterSelectionState } from "./gpu/hooks/useScatterSelection";
import { dimLabel } from "./helpers";

const overlaySurface = "bg-overlay shadow-(--shadow-popover)";
const NESTED_POPUP = "[data-slot=popover-content], [data-slot=select-content], [data-slot=context-menu-content]";

/** The one column of 26px buttons, top-left inside the view. */
export function ControlGroup({ children }: { children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      className={cn("absolute top-2 left-2 z-20 flex flex-col gap-0.5 rounded-lg p-0.5", overlaySurface)}
    >
      {children}
    </div>
  );
}

export function ControlDivider() {
  return <span aria-hidden className="mx-[3px] my-px h-px bg-border" />;
}

export function ToolButton(props: {
  label: string;
  description: string;
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return <IconButton size="md" tooltipSide="right" {...props} />;
}

/** A control-group button that opens an @ndea/ui popover beside the group. */
export function ControlPopover({
  icon,
  label,
  description,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  title: string;
  /** Right side of the popover header, e.g. the legend's pin toggle. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // A press in, or focus moving to, a pop-up opened from this one (color-by, palette, a select) is not outside.
    <Popover
      onOpenChange={(open, details) => {
        const { event, reason } = details;
        const target = event instanceof FocusEvent ? event.relatedTarget : event.target;
        if (
          !open &&
          (reason === "outside-press" || reason === "focus-out") &&
          target instanceof Element &&
          target.closest(NESTED_POPUP)
        )
          details.cancel();
      }}
    >
      <HoverTip
        label={label}
        description={description}
        side="right"
        render={<PopoverTrigger aria-label={label} className={iconButtonVariants({ size: "md" })} />}
      >
        {icon}
      </HoverTip>
      <PopoverContent side="right" align="start" sideOffset={6} className="w-60">
        <PopoverHeader className="items-center">
          <PopoverTitle className="flex-1">{title}</PopoverTitle>
          {action}
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Labelled row inside a control popover. */
export function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[26px] items-center gap-2 px-1.5">
      <span className="w-16 shrink-0 text-sm text-text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  );
}

export function ControlHeading({ children }: { children: ReactNode }) {
  return <div className={popoverHeading}>{children}</div>;
}

/** Single-choice segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: NoInfer<T>; label: string; disabled?: boolean }[];
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <ToggleGroup
      variant="segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next: string[]) => {
        const picked = options.find((option) => option.value === next[0]);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Dimension select for one axis; the wheel over it steps through the dimensions. */
function AxisSelect({
  axis,
  obsmKey,
  nDims,
  value,
  onChange,
}: {
  axis: "x" | "y";
  obsmKey: string;
  nDims: number;
  value: number;
  onChange(dim: number): void;
}) {
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
      <Select value={value} onValueChange={(dim) => dim !== null && onChange(dim)}>
        <SelectTrigger size="sm" aria-label={`${axis} axis dimension`} className="bg-transparent font-mono">
          <SelectValue>{(dim: number) => dimLabel(obsmKey, dim)}</SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="end">
          {Array.from({ length: nDims }, (_, dim) => (
            <SelectItem key={dim} value={dim} className="font-mono">
              {dimLabel(obsmKey, dim)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** `x UMAP1 ⌄ │ y UMAP2 ⌄ │ swap`, bottom-right, shown for every embedding. */
export function AxisPicker({
  obsmKey,
  nDims,
  xDim,
  yDim,
  onChange,
}: {
  obsmKey: string;
  nDims: number;
  xDim: number;
  yDim: number;
  onChange(axes: { xDim: number; yDim: number }): void;
}) {
  const divider = <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />;
  return (
    <div className={cn("absolute right-2 bottom-2 z-20 flex items-center rounded-lg p-0.5", overlaySurface)}>
      <AxisSelect axis="x" obsmKey={obsmKey} nDims={nDims} value={xDim} onChange={(x) => onChange({ xDim: x, yDim })} />
      {divider}
      <AxisSelect axis="y" obsmKey={obsmKey} nDims={nDims} value={yDim} onChange={(y) => onChange({ xDim, yDim: y })} />
      {divider}
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
