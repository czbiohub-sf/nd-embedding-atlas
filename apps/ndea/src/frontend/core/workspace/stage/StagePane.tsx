/**
 * Stage: json-render renders the document's Stage spec. `Split`, `View`, and
 * `Slot` are this app's catalog components; a View is a PROJECTION of a node
 * (header carries ◆ nodeId) that adopts the node's one live body from its
 * dock. Props resolve json-render expressions against coordination state.
 * Sashes adjust one split's ratio; the ⠿ grip drag-swaps two tiles; empty
 * slots fill with any un-staged stageable node.
 */

import { getByPath, type StateStore } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { Children, createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { NodeDocButton } from "@/components/node-workspace/node-doc";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { NdBracketed, NdCaption, NdHud, NdLed, type NdLedState } from "@/components/node-workspace/nd-primitives";
import { isCoordinationType } from "@/core/coordination/types";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import { BodySocket, HeaderSocket } from "../body-dock";
import { ND_STAGE, ND_TIMING } from "../constants";
import { useNodeCount } from "../use-node-count";
import { useTelemetrySelector, useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "../workspace-context";
import type { Workspace } from "../workspace-store";
import { FlagButton } from "../canvas/node-extras";
import { stageCatalog, type SplitSide, type Stage } from "./stage-spec";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface TileDragState {
  id: string;
  over: string | null;
}

interface StageContextValue {
  vertical: boolean;
  editable: boolean;
  tileDrag: TileDragState | null;
  beginTileDrag: (elementId: string, nodeId: string) => void;
  sashCleanup: { current: (() => void) | null };
}

const StageContext = createContext<StageContextValue | null>(null);

function useStage(): StageContextValue {
  const value = use(StageContext);
  if (!value) throw new Error("Stage components render inside StagePane");
  return value;
}

/** Render-time element id: json-render does not pass element keys to components. */
const elementIdOf = (props: object): string => String(Reflect.get(props, "elementId"));

/* ── tile (View) ─────────────────────────────────────────────────── */

function StageTile({ elementId, nodeId, title }: { elementId: string; nodeId: string; title: unknown }) {
  const ws = useWorkspace();
  const { editable, tileDrag, beginTileDrag } = useStage();
  const node = useWorkspaceSelector((s) => s.nodes[nodeId]);
  const selected = useWorkspaceSession((s) => s.selectedNodeId === nodeId);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const cooking = useTelemetrySelector((t) => t.cooking[nodeId] ?? false);
  const dirty = useTelemetrySelector((t) => t.dirty[nodeId] ?? false);
  const flipHidden = useWorkspaceSession((u) => u.flipHide === `stage:${nodeId}`);
  const flagsOff = useWorkspaceSelector((s) => s.flags[nodeId]?.off ?? false);
  const fullscreen = useWorkspaceSession((u) => u.fullscreen === nodeId);

  const def = node ? ws.nodeLibrary.getDescriptorExact(node.definitionRef) : null;
  const hasBody = node ? ws.nodeLibrary.getSpecExact(node.definitionRef)?.definition.load !== undefined : false;
  // count policy: a tile's body is visible and says its own scale: only
  // staged transforms keep a header count
  const countActive = Boolean(def && def.role !== "view");
  const { count } = useNodeCount(nodeId, countActive);

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
  const dragging = tileDrag?.id === elementId;
  const dropTarget = tileDrag?.over === elementId && tileDrag.id !== elementId;

  return (
    <div
      data-stage-tile={elementId}
      ref={(el) => ws.registerEl(`stage:${nodeId}`, el)}
      onPointerDown={() => ws.selectNode(nodeId)}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col rounded-[7px] bg-node-surface"
      style={{
        border: `1px solid ${dropTarget || selected ? "var(--primary)" : "var(--border)"}`,
        boxShadow: dropTarget
          ? "0 0 0 2px var(--primary), 0 0 18px oklch(from var(--primary) l c h / 35%)"
          : selected
            ? "0 0 0 1px var(--primary)"
            : "none",
        opacity: flipHidden ? 0 : dragging ? 0.45 : 1,
      }}
    >
      {/* header: grip · LED · title · count · ◆ id · pull. leading-none is
          inherited row-wide so mixed fonts sit on one visual line */}
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-[9px] leading-none whitespace-nowrap">
        {/* Drag-to-rearrange is broader stage authoring and remains editor-only. */}
        {NODE_EDITOR_ENABLED ? (
          <span
            title="drag to rearrange"
            onPointerDown={(e) => {
              e.stopPropagation();
              beginTileDrag(elementId, nodeId);
            }}
            className="shrink-0 cursor-grab text-[10px] tracking-[1px] text-text-muted select-none"
          >
            ⠿
          </span>
        ) : null}
        {led ? <NdLed state={led} /> : null}
        <span className="text-[11.5px] leading-none font-medium whitespace-nowrap">
          {typeof title === "string" && title ? title : node.label}
        </span>
        {/* plugin's compact toolbar follows the body: staged ⇒ tile header */}
        {hasBody && !fullscreen ? <HeaderSocket nodeId={nodeId} /> : <span className="flex-1" />}
        {countActive && count !== null ? (
          <span className="font-mono text-[9.5px] tabular-nums text-text-muted">
            <NdBracketed>{count.toLocaleString("en-US")}</NdBracketed>
          </span>
        ) : null}
        <span className={`font-mono text-[9.5px] whitespace-nowrap ${selected ? "text-primary" : "text-text-muted"}`}>
          ◆ {nodeId}
        </span>
        <NodeDocButton definitionRef={node.definitionRef} />
        {/* bypass / display-off mutates persisted graph state: editor-only */}
        {NODE_EDITOR_ENABLED ? <FlagButton node={node} /> : null}
        {hasBody ? (
          <NdIconButton icon="fullscreen" title="fullscreen body" onClick={() => ws.setFullscreen(nodeId)} />
        ) : null}
        {editable ? <SplitButton elementId={elementId} /> : null}
        {/* Fixed-preset sessions can remove a panel and add it again through an
            empty slot; the editor additionally exposes its canvas placement. */}
        {editable ? (
          <NdIconButton
            icon="pin-down"
            title={NODE_EDITOR_ENABLED ? "pull body to canvas" : "remove panel from stage"}
            onClick={() => ws.togglePlacement(nodeId, ND_TIMING.seamMs)}
          />
        ) : null}
      </div>
      {/* body: the ONE live body, adopted from the dock */}
      <div
        className="min-h-0 flex-1 overflow-hidden p-2"
        style={
          flagsOff ? { opacity: 0.3, filter: "grayscale(0.8)", transition: "opacity 200ms, filter 200ms" } : undefined
        }
      >
        {fullscreen ? (
          <div className="grid h-full place-items-center rounded border border-dashed border-border">
            <NdHud size={8.5}>body fullscreen · esc</NdHud>
          </div>
        ) : (
          <BodySocket nodeId={nodeId} className="nowheel nodrag flex h-full min-h-0 flex-col overflow-hidden" />
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

/** split-direction picker (glass, 4 directions). The popover is PORTALED to
 *  document.body with fixed positioning: the tile header is `overflow-hidden`,
 *  so an in-flow absolute popover would be clipped and never show. */
function SplitButton({ elementId }: { elementId: string }) {
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
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-split-pop="${elementId}"]`)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, elementId]);

  const sides: SplitSide[] = ["left", "up", "down", "right"];
  return (
    <span ref={anchorRef} data-split-pop={elementId} className="relative inline-flex">
      <NdIconButton icon="split" title="split this tile: pick a side for the new slot" active={open} onClick={toggle} />
      {open && pos
        ? createPortal(
            <span
              data-split-pop={elementId}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-popover flex items-center gap-[3px] rounded-[5px] border glass px-1.5 py-[5px] shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
            >
              <NdHud size={8} className="mr-0.5">
                split
              </NdHud>
              {sides.map((side) => (
                <NdIconButton
                  key={side}
                  icon={`split-${side}`}
                  title={`empty slot ${side === "left" ? "to the left" : side === "right" ? "to the right" : side === "up" ? "above" : "below"}`}
                  onClick={() => {
                    setOpen(false);
                    ws.splitTile(elementId, side);
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

/* ── split + sash ────────────────────────────────────────────────── */

function StageSash({
  horizontal,
  onPointerDown,
}: {
  horizontal: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { editable } = useStage();
  const [hot, setHot] = useState(false);
  return (
    <div
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerEnter={editable ? () => setHot(true) : undefined}
      onPointerLeave={editable ? () => setHot(false) : undefined}
      title={editable ? "drag to resize" : undefined}
      className="z-[5] grid shrink-0 place-items-center touch-none"
      style={{
        width: horizontal ? "auto" : ND_STAGE.sashHitPx,
        height: horizontal ? ND_STAGE.sashHitPx : "auto",
        cursor: editable ? (horizontal ? "row-resize" : "col-resize") : "default",
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

function StageSplit({
  elementId,
  direction,
  ratio,
  children,
}: {
  elementId: string;
  direction: "row" | "column";
  ratio: number;
  children: ReactNode;
}) {
  const ws = useWorkspace();
  const { vertical, sashCleanup } = useStage();
  const [first, second] = Children.toArray(children);
  const horizontal = vertical || direction === "column"; // the narrow side stage stacks everything
  const beginSash = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cont = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!cont) return;
    sashCleanup.current?.();
    const mv = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientY - cont.top) / cont.height : (ev.clientX - cont.left) / cont.width;
      ws.setSplitRatio(elementId, clamp(r, ND_STAGE.ratioMin, ND_STAGE.ratioMax));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (sashCleanup.current === cleanup) sashCleanup.current = null;
    };
    sashCleanup.current = cleanup;
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? "flex-col" : "flex-row"}`}>
      <SplitPane share={ratio}>{first}</SplitPane>
      <StageSash horizontal={horizontal} onPointerDown={beginSash} />
      <SplitPane share={1 - ratio}>{second}</SplitPane>
    </div>
  );
}

function SplitPane({ share, children }: { share: number; children: ReactNode }) {
  return (
    <div
      className="flex"
      style={{ flex: `${share} 1 0%`, minWidth: ND_STAGE.minTilePx, minHeight: ND_STAGE.minTilePx }}
    >
      {children}
    </div>
  );
}

/* ── empty slot ──────────────────────────────────────────────────── */

function StageEmptySlot({ slotId }: { slotId: string }) {
  const ws = useWorkspace();
  const { editable } = useStage();
  const nodes = useWorkspaceSelector((s) => s.nodes);
  useWorkspaceSelector((s) => s.stage);
  const candidates = ws.stageCandidates();
  return (
    <div
      data-stage-tile={slotId}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden rounded-[7px] border-[1.5px] border-dashed border-border-active p-3"
    >
      {editable ? (
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
      {editable && candidates.length ? (
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
          every stageable node is already on the stage: add one to the canvas first (tab)
        </NdCaption>
      )}
    </div>
  );
}

/* ── registry + state ────────────────────────────────────────────── */

const { registry } = defineRegistry(stageCatalog, {
  components: {
    Split: ({ props, children }) => (
      <StageSplit elementId={elementIdOf(props)} direction={props.direction} ratio={props.ratio}>
        {children}
      </StageSplit>
    ),
    View: ({ props }) => <StageTile elementId={elementIdOf(props)} nodeId={props.node} title={props.title} />,
    Slot: ({ props }) => <StageEmptySlot slotId={elementIdOf(props)} />,
  },
});

/** json-render state = the document's coordination state; writes go through the type schemas. */
function coordinationStateStore(ws: Workspace): StateStore {
  const set = (path: string, value: unknown) => {
    const [, type, scope, ...rest] = path.split("/");
    if (!isCoordinationType(type) || !scope || rest.length > 0) {
      throw new Error(`Stage state writes must target /<type>/<scope>, not "${path}"`);
    }
    ws.coordination.setCoordinationValue(type, scope, value as never);
  };
  return {
    get: (path) => getByPath(ws.store.state.state, path),
    set,
    update: (updates) => {
      for (const [path, value] of Object.entries(updates)) set(path, value);
    },
    getSnapshot: () => ws.store.state.state,
    subscribe: (listener) => {
      const subscription = ws.store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
  };
}

/** The document spec plus each element's id as a render-only prop. */
function renderSpec(stage: NonNullable<Stage>) {
  return {
    root: stage.root,
    elements: Object.fromEntries(
      Object.entries(stage.elements).map(([id, element]) => [
        id,
        { ...element, props: { ...element.props, elementId: id } },
      ]),
    ),
  };
}

/* ── pane ────────────────────────────────────────────────────────── */

export function StagePane({ vertical, editable }: { vertical: boolean; editable: boolean }) {
  const ws = useWorkspace();
  const stage = useWorkspaceSelector((s) => s.stage);
  const [tileDrag, setTileDrag] = useState<TileDragState | null>(null);
  const tileDragRef = useRef<TileDragState | null>(null);
  const sashCleanup = useRef<(() => void) | null>(null);
  const store = useMemo(() => coordinationStateStore(ws), [ws]);
  const spec = useMemo(() => (stage ? renderSpec(stage) : null), [stage]);

  useEffect(() => () => sashCleanup.current?.(), []);

  const beginTileDrag = (elementId: string, nodeId: string) => {
    ws.selectNode(nodeId);
    const st = { id: elementId, over: null };
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

  if (spec === null) {
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
    <StageContext value={{ vertical, editable, tileDrag, beginTileDrag, sashCleanup }}>
      <JSONUIProvider registry={registry} store={store}>
        <div className="box-border flex h-full p-2">
          <Renderer spec={spec} registry={registry} />
        </div>
      </JSONUIProvider>
    </StageContext>
  );
}
