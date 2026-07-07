/**
 * Stage — the tiled area that grants node bodies working real estate.
 * A tile is a PROJECTION of a node (header carries ◆ nodeId), not a panel:
 * it disappears when the body is pulled back to the canvas. Layout is the
 * split-tree (split-tree.ts); sashes adjust one seam's ratio; the ⠿ grip
 * drag-swaps two tiles; empty slots (from the split picker) fill with any
 * un-staged stageable node.
 */

import { useSelector } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NodeDocButton } from "@/components/nd/node-doc";
import { NdIconButton } from "@/components/nd/nd-icon-button";
import { NdBracketed, NdCaption, NdHud, NdLed, type NdLedState } from "@/components/nd/nd-primitives";
import { ThresholdFilterView } from "@/nodes/transform-filter/view";
import { BodySocket, HeaderSocket } from "../body-dock";
import { ND_STAGE, ND_TIMING } from "../constants";
import { NODE_DEFS } from "../node-defs";
import { useNodeCount } from "../use-node-count";
import { useTelemetrySelector, useWorkspace, useWsSelector } from "../workspace-context";
import { FlagButton, ScatterLassoActions } from "../canvas/node-extras";
import { WranglePane } from "../canvas/WranglePane";
import { isSlot, reconcileStageTree, treeLeaves, type TreeNode } from "./split-tree";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface TileDragState {
  id: string;
  over: string | null;
}

/* ── tile ────────────────────────────────────────────────────────── */

function StageTile({
  id,
  tileDrag,
  beginTileDrag,
}: {
  id: string;
  tileDrag: TileDragState | null;
  beginTileDrag: (id: string) => void;
}) {
  const ws = useWorkspace();
  const node = useWsSelector((s) => s.nodes[id]);
  const selected = useWsSelector((s) => s.selection === id);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const cooking = useTelemetrySelector((t) => t.cooking[id] ?? false);
  const dirty = useTelemetrySelector((t) => t.dirty[id] ?? false);
  const flipHidden = useSelector(ws.ui, (u) => u.flipHide === `stage:${id}`);
  const flagsOff = useWsSelector((s) => s.flags[id]?.off ?? false);
  const fullscreen = useSelector(ws.ui, (u) => u.fullscreen === id);

  const def = node ? NODE_DEFS[node.type] : null;
  // count policy: a tile's body is visible and says its own scale — only
  // staged transforms keep a header count
  const countActive = Boolean(def && def.kind !== "view");
  const { count } = useNodeCount(id, countActive);

  if (!node || !def) return null;

  const led: NdLedState | null = !telemetryOn
    ? null
    : flagsOff
      ? "idle"
      : cooking
        ? "cooking"
        : dirty
          ? "dirty"
          : "clean";
  const dragging = tileDrag?.id === id;
  const dropTarget = tileDrag?.over === id && tileDrag.id !== id;

  return (
    <div
      data-stage-tile={id}
      ref={(el) => ws.registerEl(`stage:${id}`, el)}
      onPointerDown={() => ws.select(id)}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col rounded-[7px] bg-card"
      style={{
        border: `1px solid ${dropTarget || selected ? "var(--primary)" : "var(--border)"}`,
        boxShadow: dropTarget
          ? "0 0 0 2px var(--primary), 0 0 18px oklch(0.554 0.236 281 / 35%)"
          : selected
            ? "0 0 0 1px var(--primary)"
            : "none",
        opacity: flipHidden ? 0 : dragging ? 0.45 : 1,
      }}
    >
      {/* header — grip · LED · title · count · ◆ id · pull. leading-none is
          inherited row-wide so mixed fonts sit on one visual line */}
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-[9px] leading-none whitespace-nowrap">
        {/* drag-to-rearrange grip — authoring (re-tile), dev-only (R4) */}
        {import.meta.env.DEV ? (
          <span
            title="drag to rearrange"
            onPointerDown={(e) => {
              e.stopPropagation();
              ws.select(id);
              beginTileDrag(id);
            }}
            className="shrink-0 cursor-grab text-[10px] tracking-[1px] text-text-muted select-none"
          >
            ⠿
          </span>
        ) : null}
        {led ? <NdLed state={led} /> : null}
        <span className="text-[11.5px] leading-none font-medium whitespace-nowrap">{node.label}</span>
        {/* plugin's compact toolbar follows the body — staged ⇒ tile header */}
        {node.pluginId && !fullscreen ? <HeaderSocket nodeId={id} /> : <span className="flex-1" />}
        {countActive && count !== null ? (
          <span className="font-mono text-[9.5px] tabular-nums text-text-muted">
            <NdBracketed>{count.toLocaleString("en-US")}</NdBracketed>
          </span>
        ) : null}
        {node.type === "scatter" ? <ScatterLassoActions nodeId={id} compactLabel /> : null}
        <span className={`font-mono text-[9.5px] whitespace-nowrap ${selected ? "text-primary" : "text-text-muted"}`}>
          ◆ {id}
        </span>
        <NodeDocButton nodeType={node.type} />
        {/* bypass / display-off mutates persisted graph state — authoring, dev-only (R4) */}
        {import.meta.env.DEV ? <FlagButton node={node} /> : null}
        {node.pluginId ? (
          <NdIconButton icon="fullscreen" title="fullscreen body" onClick={() => ws.setFullscreen(id)} />
        ) : null}
        {/* split (re-tile) + pull-to-canvas (re-placement) — authoring, dev-only (R4) */}
        {import.meta.env.DEV ? <SplitButton id={id} /> : null}
        {import.meta.env.DEV ? (
          <NdIconButton
            icon="pin-down"
            title="pull body to canvas"
            onClick={() => ws.togglePlacement(id, ND_TIMING.seamMs)}
          />
        ) : null}
      </div>
      {/* body — the ONE live body, adopted from the dock */}
      <div
        className="min-h-0 flex-1 overflow-hidden p-2"
        style={
          flagsOff ? { opacity: 0.3, filter: "grayscale(0.8)", transition: "opacity 200ms, filter 200ms" } : undefined
        }
      >
        {node.type === "threshold" ? (
          // a staged transform earns a large scrubbable body (cheap config UI — rendered in place)
          <ThresholdFilterPane id={id} />
        ) : node.type === "wrangle" ? (
          <WranglePane id={id} />
        ) : fullscreen ? (
          <div className="grid h-full place-items-center rounded border border-dashed border-border">
            <NdHud size={8.5}>body fullscreen · esc</NdHud>
          </div>
        ) : (
          <BodySocket nodeId={id} className="nowheel nodrag flex h-full min-h-0 flex-col overflow-hidden" />
        )}
      </div>
      {flagsOff ? (
        <div className="pointer-events-none absolute inset-x-0 top-[26px] bottom-0 grid place-items-center">
          <NdHud size={8.5} className="rounded border border-dashed border-border-active bg-card px-2 py-[3px]">
            display off · not cooking
          </NdHud>
        </div>
      ) : null}
    </div>
  );
}

function ThresholdFilterPane({ id }: { id: string }) {
  const ws = useWorkspace();
  const host = ws.transformHosts.get(id);
  return host ? <ThresholdFilterView host={host} /> : null;
}

/** split-direction picker (glass, 4 directions). The popover is PORTALED to
 *  document.body with fixed positioning: the tile header is `overflow-hidden`,
 *  so an in-flow absolute popover would be clipped and never show. */
function SplitButton({ id }: { id: string }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const toggle = () => {
    const next = !open;
    if (next && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-split-pop="${id}"]`)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, id]);

  return (
    <span ref={anchorRef} data-split-pop={id} className="relative inline-flex">
      <NdIconButton
        icon="split"
        title="split this tile — pick a side for the new slot"
        active={open}
        onClick={toggle}
      />
      {open && pos
        ? createPortal(
            <span
              data-split-pop={id}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-popover flex items-center gap-[3px] rounded-[5px] border glass px-1.5 py-[5px] shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
            >
              <NdHud size={8} className="mr-0.5">
                split
              </NdHud>
              {(["left", "up", "down", "right"] as const).map((d) => (
                <NdIconButton
                  key={d}
                  icon={`split-${d}`}
                  title={`empty slot ${d === "left" ? "to the left" : d === "right" ? "to the right" : d === "up" ? "above" : "below"}`}
                  onClick={() => {
                    setOpen(false);
                    ws.splitTile(id, d);
                  }}
                />
              ))}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/* ── sash ────────────────────────────────────────────────────────── */

function StageSash({
  horizontal,
  onPointerDown,
}: {
  horizontal: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div
      // resizing a seam re-tiles the stage — authoring, dev-only (R4). In a build
      // the sash stays as a passive separator with no drag / hover / cursor.
      onPointerDown={import.meta.env.DEV ? onPointerDown : undefined}
      onPointerEnter={import.meta.env.DEV ? () => setHot(true) : undefined}
      onPointerLeave={import.meta.env.DEV ? () => setHot(false) : undefined}
      title={import.meta.env.DEV ? "drag to resize" : undefined}
      className="z-[5] grid shrink-0 place-items-center touch-none"
      style={{
        width: horizontal ? "auto" : ND_STAGE.sashHitPx,
        height: horizontal ? ND_STAGE.sashHitPx : "auto",
        cursor: import.meta.env.DEV ? (horizontal ? "row-resize" : "col-resize") : "default",
      }}
    >
      <div
        className="rounded-sm transition-colors duration-100"
        style={{
          width: horizontal ? 36 : ND_STAGE.sashLinePx,
          height: horizontal ? ND_STAGE.sashLinePx : 36,
          background: hot ? "color-mix(in oklab, var(--primary) 55%, transparent)" : "var(--border)",
        }}
      />
    </div>
  );
}

/* ── empty slot ──────────────────────────────────────────────────── */

function StageEmptySlot({ slotId }: { slotId: string }) {
  const ws = useWorkspace();
  const nodes = useWsSelector((s) => s.nodes);
  useWsSelector((s) => s.explicit);
  const candidates = ws.stageCandidates();
  return (
    <div
      data-stage-tile={slotId}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden rounded-[7px] border-[1.5px] border-dashed border-border-active p-3"
    >
      {/* dismiss + fill are layout authoring — dev-only (R4). A build can't create
          slots (split is gated), so this path is normally unreachable; the gate is
          defense-in-depth against a preset doc that ships a bare slot. */}
      {import.meta.env.DEV ? (
        <button
          type="button"
          title="dismiss slot"
          onClick={() => ws.dismissSlot(slotId)}
          className="absolute top-[5px] right-[7px] cursor-pointer border-0 bg-transparent p-0 text-2xs text-text-muted"
        >
          ✕
        </button>
      ) : null}
      <NdHud size={9.5}>empty slot</NdHud>
      {import.meta.env.DEV && candidates.length ? (
        <div className="flex max-w-[260px] flex-wrap justify-center gap-[5px]">
          {candidates.map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => ws.fillSlot(slotId, id)}
              className="cursor-pointer rounded border border-border bg-muted px-2 py-[3px] font-mono text-3xs whitespace-nowrap text-muted-foreground"
            >
              + {nodes[id]?.label ?? id}
            </button>
          ))}
        </div>
      ) : (
        <NdCaption className="text-center text-[9.5px]">
          every stageable node is already on the stage — add one to the canvas first (tab)
        </NdCaption>
      )}
    </div>
  );
}

/* ── recursive renderer ──────────────────────────────────────────── */

function StageTreeView({
  node,
  path,
  vertical,
  tileDrag,
  beginTileDrag,
}: {
  node: TreeNode;
  path: string;
  vertical: boolean;
  tileDrag: TileDragState | null;
  beginTileDrag: (id: string) => void;
}) {
  const ws = useWorkspace();
  if (typeof node === "string") {
    return isSlot(node) ? (
      <StageEmptySlot slotId={node} />
    ) : (
      <StageTile id={node} tileDrag={tileDrag} beginTileDrag={beginTileDrag} />
    );
  }
  const dir = vertical ? "col" : node.dir; // the narrow side stage stacks everything
  const horizontal = dir === "col";
  const beginSash = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cont = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!cont) return;
    const mv = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientY - cont.top) / cont.height : (ev.clientX - cont.left) / cont.width;
      ws.setTreeRatio(path, clamp(r, ND_STAGE.ratioMin, ND_STAGE.ratioMax));
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${dir === "col" ? "flex-col" : "flex-row"}`}>
      <div
        className="flex"
        style={{ flex: `${node.ratio} 1 0%`, minWidth: ND_STAGE.minTilePx, minHeight: ND_STAGE.minTilePx }}
      >
        <StageTreeView
          node={node.a}
          path={`${path}a`}
          vertical={vertical}
          tileDrag={tileDrag}
          beginTileDrag={beginTileDrag}
        />
      </div>
      <StageSash horizontal={horizontal} onPointerDown={beginSash} />
      <div
        className="flex"
        style={{ flex: `${1 - node.ratio} 1 0%`, minWidth: ND_STAGE.minTilePx, minHeight: ND_STAGE.minTilePx }}
      >
        <StageTreeView
          node={node.b}
          path={`${path}b`}
          vertical={vertical}
          tileDrag={tileDrag}
          beginTileDrag={beginTileDrag}
        />
      </div>
    </div>
  );
}

/* ── pane ────────────────────────────────────────────────────────── */

export function StagePane({ vertical }: { vertical: boolean }) {
  const ws = useWorkspace();
  const stageTree = useWsSelector((s) => s.stageTree);
  useWsSelector((s) => s.explicit);
  useWsSelector((s) => s.disposition);
  useWsSelector((s) => s.nodes);
  const [tileDrag, setTileDrag] = useState<TileDragState | null>(null);
  const tileDragRef = useRef<TileDragState | null>(null);

  // reconcile layout memory with the live staged set; persist on divergence
  const stagedIds = ws.stagedIds().toSorted((a, b) => {
    const P: Record<string, number> = { scatter: 0, fov: 1, table: 2, gallery: 3 };
    const ta = ws.store.state.nodes[a]?.type ?? "";
    const tb = ws.store.state.nodes[b]?.type ?? "";
    return (P[ta] ?? 4) - (P[tb] ?? 4);
  });
  const view = reconcileStageTree(stageTree, stagedIds);
  useEffect(() => {
    // full-mode (vertical) stage is a sidebar projection: implicit nodes default
    // to embedded there, so stagedIds shrinks — persisting that would prune the
    // split layout. Render the projection, but never rewrite the memory from it.
    if (vertical) return;
    if (JSON.stringify(view) !== JSON.stringify(stageTree)) ws.setStageTree(view);
  });

  const beginTileDrag = (id: string) => {
    const st = { id, over: null };
    tileDragRef.current = st;
    setTileDrag(st);
    const mv = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const tEl = el?.closest?.("[data-stage-tile]");
      const over = tEl ? tEl.getAttribute("data-stage-tile") : null;
      const cur = tileDragRef.current;
      if (cur && cur.over !== over) {
        const w = { ...cur, over };
        tileDragRef.current = w;
        setTileDrag(w);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      const cur = tileDragRef.current;
      tileDragRef.current = null;
      setTileDrag(null);
      if (cur?.over && cur.over !== cur.id) ws.swapTiles(cur.id, cur.over);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  if (view === null) {
    return (
      <div className="grid h-full place-items-center p-5">
        <div className="max-w-[320px] text-center">
          <NdHud size={10}>stage empty</NdHud>
          <NdCaption className="mt-1.5">
            All views are embedded on the canvas. Pin a view to the stage (⇡ on a node header) or expand the wiring to
            work with embedded bodies.
          </NdCaption>
        </div>
      </div>
    );
  }
  return (
    <div className="box-border flex h-full p-2">
      <StageTreeView node={view} path="" vertical={vertical} tileDrag={tileDrag} beginTileDrag={beginTileDrag} />
    </div>
  );
}

export function stageHasContent(tree: TreeNode | null, stagedCount: number): boolean {
  return stagedCount > 0 || treeLeaves(tree).some(isSlot);
}
