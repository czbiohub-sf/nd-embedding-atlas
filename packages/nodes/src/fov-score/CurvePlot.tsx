/**
 * One feature's small multiple: its label-split histogram with the desirability curve drawn
 * over it, and the curve's own parameters as draggable handles.
 *
 * The two layers answer different questions and both are needed. The histogram says whether
 * the feature SEPARATES good fields from bad — a feature whose good and bad bars sit on top
 * of each other cannot help no matter how it is tuned. The curve says what the model
 * currently rewards. Tuning is dragging the second onto the first.
 *
 * Handles are dragged in data space via `dragHandle`, which owns the clamping, so a gesture
 * that would violate `fwhm > 0` or cross a band's edges deforms the curve up to its limit
 * instead of throwing `curveBounds` mid-drag and blanking the plot.
 */

import { memo, useCallback, useRef, useState } from "react";
import { GOODNESS_TEXT, type Goodness } from "../fov-label/goodness";
import { curveBounds, type CurveParams, desirability, type FeatureSpec } from "./desirability";
import { curveHandles, dragHandle } from "./handles";
import type { FeatureHistogram } from "./histogram";

/** Curve resolution. Enough that a sigmoid's knee looks like a knee at any plot width. */
const SAMPLES = 96;
const PAD_TOP = 5;
/** Room for the min/max value labels under the axis. */
const PAD_BOTTOM = 13;
/** Pointer slop for grabbing a handle, in px. */
const HANDLE_R = 4;

/**
 * Round-trip-safe short form. `toPrecision` rather than `toFixed` because feature values span
 * counts (thousands) and fractions (1e-3) in the same matrix, and a fixed 3 decimals renders
 * half of them as "0.000".
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
}

/**
 * The focused FOV's position on this axis.
 *
 * Clicking a point in the scatter or a cell in the plate grid answers "which FOV is that?";
 * this answers the question that follows — "and WHY does it score the way it does?" — by
 * showing, on every feature at once, where that one field sits relative to the population and
 * to the curve. A rule that is absent means the feature could not be measured for this FOV,
 * which is itself the answer.
 */
export interface FocusMarker {
  value: number;
  goodness: Goodness;
  /** Shown in the tooltip so the rule is identifiable without another panel. */
  label: string;
}

export interface CurvePlotProps {
  name: string;
  spec: FeatureSpec;
  histogram: FeatureHistogram;
  width: number;
  height: number;
  marker?: FocusMarker | null;
  /**
   * Every callback takes `name` rather than closing over it.
   *
   * That is what lets the parent hand all 15 plots the SAME handler instances, which is what
   * makes the `memo` below effective: an inline `onParams={(p) => set(name, p)}` allocates a new
   * function per plot per render, so every plot's props differ every frame and none of them can
   * skip. Dragging one curve re-rendered all fifteen.
   */
  onParams: (name: string, params: CurveParams) => void;
  /** Gesture finished — the parent persists here, not on every frame. */
  onCommit: () => void;
  onToggle: (name: string) => void;
}

function CurvePlotImpl({ name, spec, histogram, width, height, marker, onParams, onCommit, onToggle }: CurvePlotProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const [d0, d1] = histogram.domain;
  const span = d1 - d0 || 1;
  const plotH = Math.max(height - PAD_TOP - PAD_BOTTOM, 10);
  const toPx = (value: number) => ((value - d0) / span) * width;

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (dragging == null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const value = d0 + ((event.clientX - rect.left) / (rect.width || 1)) * span;
      onParams(name, dragHandle(spec.shape, spec.direction, spec.params, dragging, value, [d0, d1]));
    },
    [dragging, d0, d1, span, name, spec.shape, spec.direction, spec.params, onParams],
  );

  const endDrag = useCallback(() => {
    if (dragging == null) return;
    setDragging(null);
    onCommit();
  }, [dragging, onCommit]);

  // A curve whose params do not satisfy their shape's invariants has no bounds to draw. That
  // is a config the user typed, not a bug, so say so instead of rendering an empty box.
  let curve: string | null = null;
  let handles: ReturnType<typeof curveHandles> = [];
  let invalid: string | null = null;
  try {
    const bounds = curveBounds(spec.shape, spec.direction, spec.params);
    const points: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const value = d0 + (span * i) / (SAMPLES - 1);
      const d = desirability(value, spec.shape, spec.direction, bounds);
      points.push(`${((i / (SAMPLES - 1)) * width).toFixed(2)},${(PAD_TOP + plotH * (1 - d)).toFixed(2)}`);
    }
    curve = points.join(" ");
    handles = curveHandles(spec.shape, spec.direction, spec.params);
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error);
  }

  const dim = spec.enabled ? "" : " opacity-35";

  return (
    <div className="flex flex-col gap-0.5" style={{ width }}>
      <div className="flex items-baseline gap-1">
        <button
          type="button"
          onClick={() => onToggle(name)}
          aria-pressed={spec.enabled}
          title={spec.enabled ? "Exclude from the score" : "Include in the score"}
          className={`min-w-0 flex-1 truncate text-left font-mono text-2xs transition-colors ${
            spec.enabled ? "text-foreground" : "text-muted-foreground/50 line-through"
          }`}
        >
          {spec.enabled ? "✓ " : "  "}
          {name}
        </button>
        <span className="flex-none font-mono text-2xs text-muted-foreground" title="weight">
          {formatNumber(spec.weight)}
        </span>
        {histogram.missing > 0 && (
          <span
            className="flex-none font-mono text-2xs text-warning"
            title={`${histogram.missing} FOVs could not be measured; each scores 0 for this feature`}
          >
            {histogram.missing}∅
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={`block touch-none${dim}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Half-maximum guide: the width handles live on this line, so it shows what they mean. */}
        <line
          x1={0}
          y1={PAD_TOP + plotH / 2}
          x2={width}
          y2={PAD_TOP + plotH / 2}
          className="stroke-border/40"
          strokeDasharray="2 3"
        />

        {histogram.bins.map((bin) => {
          const x = toPx(bin.x0);
          const w = Math.max(toPx(bin.x1) - x - 0.5, 0.5);
          const unit = histogram.maxCount > 0 ? plotH / histogram.maxCount : 0;
          // Stacked worst-first from the axis up, so the height of the coloured band nearest
          // the axis reads directly as "how much of this bin is bad".
          let y = PAD_TOP + plotH;
          return (
            <g key={bin.x0}>
              {(
                [
                  ["bad", "fill-destructive/70"],
                  ["neutral", "fill-warning/70"],
                  ["good", "fill-success/70"],
                  ["unlabeled", "fill-muted-foreground/25"],
                ] as const
              ).map(([key, cls]) => {
                const h = bin[key] * unit;
                if (h <= 0) return null;
                y -= h;
                return <rect key={key} x={x} y={y} width={w} height={h} className={cls} />;
              })}
            </g>
          );
        })}

        {curve && <polyline points={curve} fill="none" className="stroke-primary" strokeWidth={1.5} />}

        {marker &&
          Number.isFinite(marker.value) && (
            // Drawn above the bars and the curve but below the handles, so following a focus
            // never makes a handle harder to grab. Clamped into the plot rather than hidden: a
            // FOV outside the population's range is exactly the case worth seeing, and a rule
            // pinned to the edge with the value in its tooltip says "off the end that way".
            <g className={GOODNESS_TEXT[marker.goodness]}>
              <line
                x1={Math.min(Math.max(toPx(marker.value), 0.5), width - 0.5)}
                y1={PAD_TOP}
                x2={Math.min(Math.max(toPx(marker.value), 0.5), width - 0.5)}
                y2={PAD_TOP + plotH}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="3 2"
              />
              <circle
                cx={Math.min(Math.max(toPx(marker.value), 0.5), width - 0.5)}
                cy={PAD_TOP + 2}
                r={2.5}
                fill="currentColor"
              />
              <title>{`${marker.label}: ${name} = ${formatNumber(marker.value)} (${marker.goodness})`}</title>
            </g>
          )}

        {handles.map((handle) => (
          <circle
            key={handle.key}
            cx={toPx(handle.x)}
            cy={PAD_TOP + plotH * (1 - handle.y)}
            r={dragging === handle.key ? HANDLE_R + 1.5 : HANDLE_R}
            className="cursor-ew-resize fill-background stroke-primary"
            strokeWidth={1.5}
            role="slider"
            aria-label={`${name} ${handle.label}`}
            aria-valuenow={handle.x}
            tabIndex={-1}
            onPointerDown={(event) => {
              // Capture on the SVG, not the circle: the pointer leaves a 4px dot immediately
              // and without capture the drag would end on the first move.
              svgRef.current?.setPointerCapture(event.pointerId);
              setDragging(handle.key);
            }}
          >
            <title>{`${handle.label} = ${formatNumber(handle.x)} (drag)`}</title>
          </circle>
        ))}

        <line x1={0} y1={PAD_TOP + plotH + 0.5} x2={width} y2={PAD_TOP + plotH + 0.5} className="stroke-border" />
        <text x={0} y={height - 3} className="fill-muted-foreground" fontSize={9} fontFamily="monospace">
          {formatNumber(d0)}
        </text>
        <text
          x={width}
          y={height - 3}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize={9}
          fontFamily="monospace"
        >
          {formatNumber(d1)}
        </text>
      </svg>
      {invalid && <div className="truncate font-mono text-[9px] text-destructive">✗ {invalid}</div>}
    </div>
  );
}

/**
 * Memoized: dragging one curve must not re-render the other fourteen.
 *
 * Only worthwhile because every prop is referentially stable across a drag — the parent hands
 * out shared handlers, a memoized marker map, and spec objects it preserves for untouched
 * features. Break any of those and this silently degrades to no memo at all.
 */
export const CurvePlot = memo(CurvePlotImpl);
