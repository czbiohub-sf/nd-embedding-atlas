/**
 * RangeBracket: the min/max instrument that replaces the label palette in the
 * Annotate node's range mode. Two number fields (authoritative) over a
 * dual-handle bracket on a generic linear axis whose domain auto-fits the
 * current values. Metric-agnostic: no log/regularization assumptions.
 *
 * Controlled: the parent owns `lo`/`hi` (numbers or null) and gets both back on
 * every edit via `onChange`. `onCommit` fires on Enter in a field. An UNSET end
 * parks its handle at the matching domain edge (min→left, max→right) so the two
 * handles never stack: you can always grab and drag either one apart.
 */

import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
  type Domain,
  clamp01,
  domainTicks,
  fmtVal,
  niceDomain,
  parseVal,
  posOf,
  valOf,
} from "@/nodes/annotate/range-scale";

export interface RangeBracketProps {
  lo: number | null;
  hi: number | null;
  onChange: (lo: number | null, hi: number | null) => void;
  onCommit?: () => void;
  disabled?: boolean;
  metric?: string;
}

/** Arrow-key nudge, as a fraction of the domain. */
const NUDGE = 0.02;

const round3 = (v: number): number => Number(v.toPrecision(3));

export function RangeBracket({ lo, hi, onChange, onCommit, disabled, metric = "value" }: RangeBracketProps) {
  const invalid = lo != null && hi != null && lo > hi;
  const trackRef = useRef<HTMLDivElement>(null);

  // Field text is local so typing (e.g. "0.00") isn't reformatted mid-entry;
  // we pull from the prop only when it diverges from what the text parses to
  // (i.e. the value changed from the slider or parent, not this keystroke).
  const [loText, setLoText] = useState(() => fmtVal(lo));
  const [hiText, setHiText] = useState(() => fmtVal(hi));
  useEffect(() => {
    if (parseVal(loText) !== lo) setLoText(fmtVal(lo));
  }, [lo, loText]);
  useEffect(() => {
    if (parseVal(hiText) !== hi) setHiText(fmtVal(hi));
  }, [hi, hiText]);

  // Domain auto-fits the values, but FREEZES while dragging so the axis doesn't
  // slide under the cursor. `drag` holds the active handle + its frozen domain.
  const [drag, setDrag] = useState<{ which: "lo" | "hi"; domain: Domain } | null>(null);
  const domain = drag?.domain ?? niceDomain(lo, hi);

  const setEnd = (which: "lo" | "hi", v: number | null) => (which === "lo" ? onChange(v, hi) : onChange(lo, v));

  // An unset end parks at its domain edge → handles never stack on each other.
  const loPct = posOf(lo ?? domain[0], domain) * 100;
  const hiPct = posOf(hi ?? domain[1], domain) * 100;

  const onDown = (which: "lo" | "hi") => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ which, domain: niceDomain(lo, hi) });
  };
  const onMove = (which: "lo" | "hi") => (e: React.PointerEvent) => {
    if (drag?.which !== which) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const t = clamp01((e.clientX - rect.left) / rect.width);
    setEnd(which, round3(valOf(t, drag.domain)));
  };
  const onUp = (which: "lo" | "hi") => (e: React.PointerEvent) => {
    if (drag?.which !== which) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  const nudge = (which: "lo" | "hi", cur: number | null) => (e: React.KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const t = clamp01(posOf(cur ?? (which === "lo" ? domain[0] : domain[1]), domain) + dir * NUDGE);
    setEnd(which, round3(valOf(t, domain)));
  };

  const onFieldKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !invalid && lo != null && hi != null) {
      e.preventDefault();
      onCommit?.();
    }
  };

  const field = (which: "lo" | "hi", label: string, text: string, setText: (s: string) => void) => (
    <label
      className={cn(
        "flex cursor-text flex-col gap-px rounded-md border bg-foreground/4 px-2 py-1 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25",
        invalid
          ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/25"
          : "border-input",
      )}
    >
      <span className="text-3xs text-text-muted uppercase tracking-[0.5px]">{label}</span>
      <input
        aria-label={`${metric} ${label}`}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEnd(which, parseVal(e.target.value));
        }}
        onKeyDown={onFieldKey}
        className={cn(
          "w-full border-0 bg-transparent p-0 font-medium text-sm tabular-nums outline-none",
          invalid ? "text-destructive" : "text-foreground",
        )}
      />
    </label>
  );

  const handle = (which: "lo" | "hi", cur: number | null, pct: number) => (
    <button
      type="button"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${metric} ${which === "lo" ? "minimum" : "maximum"}`}
      aria-valuemin={domain[0]}
      aria-valuemax={domain[1]}
      aria-valuenow={cur ?? undefined}
      aria-valuetext={fmtVal(cur) || undefined}
      onPointerDown={onDown(which)}
      onPointerMove={onMove(which)}
      onPointerUp={onUp(which)}
      onKeyDown={nudge(which, cur)}
      style={{ left: `${pct}%` }}
      className={cn(
        "absolute top-2 grid h-5 w-3 -translate-x-1/2 cursor-ew-resize touch-none place-items-center rounded-[3px] border bg-card shadow-md outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary/50",
        invalid ? "border-destructive" : "border-primary",
        cur == null && "opacity-70", // unset end parked at the edge reads dimmer
      )}
    >
      <span className={cn("h-2.5 w-0.5 rounded-full", invalid ? "bg-destructive" : "bg-primary")} />
    </button>
  );

  const span = lo != null && hi != null && !invalid ? hi - lo : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between text-3xs text-text-muted">
        <span className="truncate font-medium text-muted-foreground" title={metric}>
          {metric}
        </span>
        <span className="tabular-nums">
          {fmtVal(domain[0])} … {fmtVal(domain[1])}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {field("lo", "min", loText, setLoText)}
        {field("hi", "max", hiText, setHiText)}
      </div>

      {/* dual-handle bracket over the linear auto-domain */}
      <div ref={trackRef} className="relative mx-1 mt-0.5 h-11 touch-none select-none">
        <div className="absolute inset-x-0 top-[15px] h-1.5 rounded-full bg-foreground/5 ring-1 ring-border-subtle ring-inset" />
        <div
          className={cn("absolute top-[15px] h-1.5 rounded-[2px]", invalid ? "bg-destructive/25" : "bg-primary/30")}
          style={{ left: `${Math.min(loPct, hiPct)}%`, width: `${Math.abs(hiPct - loPct)}%` }}
        />
        {domainTicks(domain).map((tick, i, arr) => (
          <div
            key={tick}
            className="absolute top-6 h-1.5 w-px bg-border"
            style={{ left: `${(i / (arr.length - 1)) * 100}%` }}
          >
            <b className="-translate-x-1/2 absolute top-2 left-1/2 whitespace-nowrap font-normal text-[7.5px] text-text-muted">
              {fmtVal(tick)}
            </b>
          </div>
        ))}
        {handle("lo", lo, loPct)}
        {handle("hi", hi, hiPct)}
      </div>

      <div className="flex items-center gap-1.5 text-2xs">
        <span className="text-text-muted">range</span>
        <span className={cn("font-medium tabular-nums", invalid ? "text-destructive" : "text-primary")}>
          [{fmtVal(lo) || ":"}, {fmtVal(hi) || ":"}]
        </span>
        <span className="ml-auto text-3xs text-text-muted">
          {invalid ? "min > max" : span != null ? `span ${fmtVal(span)}` : "set both ends"}
        </span>
      </div>

      {onCommit && (
        <p className="text-3xs text-text-muted">
          <Kbd>↵</Kbd> writes the range to the focused obs
        </p>
      )}
    </div>
  );
}
