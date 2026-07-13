/**
 * NdNodeFrame — THE standard node container for the nd workspace.
 * One component, three forms (chip · card · full), zero app dependencies.
 * Hosts (canvas, stage tile, future surfaces) and plugin authors both build
 * against this contract; the spec lives in
 * design_handoff_node_workspace/component-spec/.
 *
 * ── The contract in one sentence ─────────────────────────────────────
 * The HOST owns form, size, placement, and all interaction state; the
 * PLUGIN owns only the body render and its config — the frame is sacred.
 */

import type * as React from "react";

import { cn } from "@/lib/utils";
import { ND_NODE, ND_TIMING } from "@/core/workspace/constants";
import { NdFormControls } from "./nd-form-controls";
import { NdPort, type NdPortProps } from "./nd-port";
import { NdBracketed, NdHud, NdLed, type NdLedState } from "./nd-primitives";
import { NdResizeGrips, type NdResizeCorner } from "./nd-resize-grips";
import type { NdForm } from "./nd-resolve-form";

export interface NdNodeFrameProps {
  /** 'chip' | 'card' | 'full' — host-resolved (ndResolveForm) */
  form: NdForm;
  /** resolved size (canonical or per-form override); h ignored at chip */
  w: number;
  h?: number;
  label: string;
  /** mono sub-label next to the title (e.g. "umap · stage") */
  sub?: React.ReactNode;
  /** cook state — null hides the LED (telemetry off) */
  led?: NdLedState | null;
  /** bracketed row count (host decides visibility per the count policy) */
  count?: string | null;
  /** optional header chip (e.g. ◇ for selection nodes) */
  badge?: React.ReactNode;
  selected?: boolean;
  claimed?: boolean;
  /** body lives on the stage → dashed "body on stage ◆" placeholder */
  staged?: boolean;
  stale?: boolean;
  locked?: boolean;
  onCycleForm?: (() => void) | null;
  onToggleLock?: (() => void) | null;
  /** node-specific header controls (gear, pin/pull, flags) — host-rendered NdIconButtons */
  actions?: React.ReactNode;
  /** fills the header's middle gap (e.g. a plugin's compact toolbar socket);
   *  must carry flex-1 itself — when absent a plain spacer keeps the layout */
  headerSlot?: React.ReactNode;
  /** telemetry row — rendered at full form only */
  footer?: React.ReactNode;
  /** frame-edge ports; outside the morphing content so wires track the edge */
  ports?: NdPortProps[];
  /** custom port elements (e.g. xyflow Handles wearing the port glyph) —
   * rendered alongside `ports`, same frame-edge placement contract */
  portsSlot?: React.ReactNode;
  /** resize grips shown when present (card + full; chips are canonical) */
  onResize?: ((corner: NdResizeCorner, e: React.PointerEvent) => void) | null;
  /** frame drag start */
  onPointerDown?: ((e: React.PointerEvent) => void) | null;
  morphMs?: number;
  /** for data attrs + port drop targets */
  nodeId?: string | null;
  className?: string;
  style?: React.CSSProperties;
  /** body content (card thumb / full body) — never rendered at chip */
  children?: React.ReactNode;
}

export function NdNodeFrame({
  form,
  w,
  h,
  label,
  sub = null,
  led = "clean",
  count = null,
  badge = null,
  selected = false,
  claimed = false,
  staged = false,
  stale = false,
  locked = false,
  onCycleForm = null,
  onToggleLock = null,
  actions = null,
  headerSlot = null,
  footer = null,
  ports = [],
  portsSlot = null,
  onResize = null,
  onPointerDown = null,
  morphMs = ND_TIMING.morphMs,
  nodeId = null,
  className,
  style,
  children,
}: NdNodeFrameProps) {
  const chip = form === "chip";
  const borderColor =
    claimed || selected
      ? "var(--primary)"
      : stale
        ? "color-mix(in oklab, var(--color-wire-sel) 45%, transparent)"
        : "var(--color-border-active)"; // resting node outline (22% white on dark) — visible but restrained
  const shadow = claimed
    ? "0 0 0 1.5px var(--primary), 0 0 28px oklch(0.554 0.236 281 / 35%)"
    : selected
      ? "0 0 0 1px var(--primary)"
      : chip
        ? "none"
        : "0 1px 3px rgba(0, 0, 0, 0.35)";

  // ONE root element across all three forms — the form morph is a geometry
  // transition (width / height / border-radius) on this persistent node, so
  // chip ↔ card animates the same way card ↔ full always has. Content swaps
  // with a keyed crossfade while the frame morphs around it; ports, handles,
  // and grips live at root level (outside the clip) so the −6px edge offsets
  // survive and xyflow Handles never remount across a form change.
  const morph = (prop: string) => `${prop} ${morphMs}ms ${ND_TIMING.morphEase}`;
  return (
    <div
      data-nd-node={nodeId}
      data-nd-form={form}
      onPointerDown={onPointerDown ?? undefined}
      className={cn(
        "relative box-border",
        chip && selected ? "bg-emphasis" : "bg-card",
        onPointerDown ? "cursor-grab" : "cursor-default",
        className,
      )}
      style={{
        width: w,
        height: chip ? ND_NODE.chipH : h,
        // chipH/2 (not 999) so the pill radius interpolates cleanly to 7
        borderRadius: chip ? ND_NODE.chipH / 2 : ND_NODE.radius,
        border: `1px solid ${borderColor}`,
        boxShadow: shadow,
        transition: [
          morph("width"),
          morph("height"),
          morph("border-radius"),
          morph("background-color"),
          `opacity ${ND_TIMING.contentMs}ms`,
          `filter ${ND_TIMING.contentMs}ms`,
        ].join(", "),
        ...style,
      }}
    >
      {/* clip layer — keeps content inside the morphing frame */}
      <div className="flex h-full w-full flex-col overflow-hidden" style={{ borderRadius: "inherit" }}>
        {chip ? (
          // chip row — top-anchored at header height, so the morph reads as
          // the body collapsing into (or growing out of) the header
          <div
            key="chip"
            // leading-none on the ROW: every text child inherits a flat line
            // box, so flex centering puts mixed fonts/sizes on one visual line
            className="animate-nd-rs-morph flex shrink-0 items-center gap-1.5 px-2.5 leading-none whitespace-nowrap"
            style={{ height: ND_NODE.chipH - 2 }}
          >
            {led ? <NdLed state={led} size={5} /> : null}
            <span className="truncate text-[10.5px] leading-none font-medium whitespace-nowrap">{label}</span>
            <span className="flex-1" />
            {staged ? (
              <NdHud size={7} className="text-primary">
                ST
              </NdHud>
            ) : null}
            {count && w > 140 ? (
              <span className="font-mono text-[8.5px] tabular-nums text-text-muted">
                <NdBracketed>{count}</NdBracketed>
              </span>
            ) : null}
            <NdFormControls form={form} locked={locked} onCycle={onCycleForm} onToggleLock={onToggleLock} compact />
          </div>
        ) : (
          <div key="frame" className="animate-nd-rs-morph flex min-h-0 flex-1 flex-col">
            {/* header — status · identity · controls (fixed 26px, never wraps).
                leading-none is inherited row-wide: one flat line box per text
                child keeps mixed sizes (title, mono counts) aligned */}
            <div
              className="flex shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-[9px] leading-none whitespace-nowrap"
              style={{ height: ND_NODE.headerH }}
            >
              {led ? <NdLed state={led} /> : null}
              <span className="text-[11.5px] leading-none font-medium whitespace-nowrap">{label}</span>
              {badge}
              {sub ? (
                <span className="font-mono text-[9px] leading-none tabular-nums text-text-muted">{sub}</span>
              ) : null}
              {headerSlot ?? <span className="flex-1" />}
              <NdFormControls form={form} locked={locked} onCycle={onCycleForm} onToggleLock={onToggleLock} />
              {actions}
              {count ? (
                <span className="font-mono text-[9.5px] tabular-nums whitespace-nowrap text-text-muted">
                  <NdBracketed>{count}</NdBracketed>
                </span>
              ) : null}
            </div>

            {/* body — plugin territory (or the staged placeholder) */}
            <div
              className="animate-nd-rs-morph flex min-h-0 flex-1 flex-col gap-[7px] overflow-hidden p-2.5"
              key={`body-${form}`}
            >
              {staged ? (
                <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-border">
                  <NdHud size={8.5}>body on stage ◆</NdHud>
                </div>
              ) : (
                children
              )}
            </div>

            {/* footer — telemetry (full form only) */}
            {form === "full" && footer ? (
              <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-[9px] py-[3px] font-mono text-[9px] tabular-nums whitespace-nowrap text-text-muted">
                {footer}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {ports.map((p, i) => (
        <NdPort key={i} nodeId={nodeId} {...p} />
      ))}
      {portsSlot}
      {!chip && onResize ? <NdResizeGrips onResize={onResize} /> : null}
    </div>
  );
}
