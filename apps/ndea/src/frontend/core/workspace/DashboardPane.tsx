/**
 * The dashboard: json-render renders the document's `spec` with this registry.
 * Layout (`split`, `stack`), content (`text`), controls (`select`), empty
 * `slot`s, and one tile per view component. Props resolve json-render
 * expressions against the document's coordination `state`; view tiles adopt
 * their element's live body from its dock.
 */

import { getByPath, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer, type ComponentRegistry, type ComponentRenderProps } from "@json-render/react";
import type { FilterClause } from "@ndea/protocol";
import { Children, createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { NdCaption, NdHud } from "@/components/node-workspace/nd-primitives";
import { isCoordinationType } from "@/core/coordination/types";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { toRows } from "@/lib/mosaic-helpers";
import { BodySocket, BodyStatus, HeaderSocket } from "./body-dock";
import { ND_STAGE } from "./constants";
import { COMPONENTS, elementData, elementScope, type Dashboard as DashboardSpec, type SplitSide } from "./dashboard";
import { elementPredicate } from "./data-sources";
import { useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "./workspace-context";
import type { Workspace } from "./workspace-store";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface DragState {
  id: string;
  over: string | null;
}

interface DashboardContextValue {
  editable: boolean;
  drag: DragState | null;
  beginDrag: (id: string) => void;
  sashCleanup: { current: (() => void) | null };
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function useDashboard(): DashboardContextValue {
  const value = use(DashboardContext);
  if (!value) throw new Error("dashboard components render inside DashboardPane");
  return value;
}

/** Render-time element id: json-render does not pass element keys to components. */
const idOf = ({ element }: ComponentRenderProps): string => String(element.props.elementId);

/* ── tile chrome ───────────────────────────────────────────────────── */

function SplitButton({ id }: { id: string }) {
  const ws = useWorkspace();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-split-pop="${id}"]`)) setPos(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [pos, id]);

  const sides: SplitSide[] = ["left", "up", "down", "right"];
  return (
    <span ref={anchorRef} data-split-pop={id} className="relative inline-flex">
      <NdIconButton
        icon="split"
        title="split this tile: pick a side for the new slot"
        active={pos !== null}
        onClick={() => {
          const r = anchorRef.current?.getBoundingClientRect();
          setPos(pos || !r ? null : { top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      />
      {pos
        ? createPortal(
            <span
              data-split-pop={id}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-popover flex items-center gap-[3px] rounded-[5px] border glass px-1.5 py-[5px] shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
            >
              {sides.map((side) => (
                <NdIconButton
                  key={side}
                  icon={`split-${side}`}
                  title={`empty slot ${side}`}
                  onClick={() => {
                    setPos(null);
                    ws.splitElement(id, side);
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

/** A leaf's frame: header (grip · title · toolbar · id · actions) over its content. */
function Tile({
  id,
  title,
  toolbar,
  children,
}: {
  id: string;
  title: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const ws = useWorkspace();
  const { editable, drag, beginDrag } = useDashboard();
  const selected = useWorkspaceSession((s) => s.selectedElementId === id);
  const dropTarget = drag?.over === id && drag.id !== id;
  return (
    <div
      data-dashboard-tile={id}
      onPointerDown={() => ws.selectElement(id)}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col rounded-[7px] bg-node-surface"
      style={{
        border: `1px solid ${dropTarget || selected ? "var(--primary)" : "var(--border)"}`,
        boxShadow: dropTarget ? "0 0 0 2px var(--primary)" : selected ? "0 0 0 1px var(--primary)" : "none",
        opacity: drag?.id === id ? 0.45 : 1,
      }}
    >
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-[9px] leading-none whitespace-nowrap">
        {editable ? (
          <span
            title="drag to rearrange"
            onPointerDown={(e) => {
              e.stopPropagation();
              beginDrag(id);
            }}
            className="shrink-0 cursor-grab text-[10px] tracking-[1px] text-text-muted select-none"
          >
            ⠿
          </span>
        ) : null}
        <span className="text-[11.5px] leading-none font-medium whitespace-nowrap">{title}</span>
        {toolbar ?? <span className="flex-1" />}
        <span className={`font-mono text-[9.5px] whitespace-nowrap ${selected ? "text-primary" : "text-text-muted"}`}>
          ◆ {id}
        </span>
        {editable ? <SplitButton id={id} /> : null}
        {editable ? (
          <NdIconButton icon="close" title="remove from dashboard" onClick={() => ws.removeElement(id)} />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">{children}</div>
    </div>
  );
}

const titleOf = (props: ComponentRenderProps, fallback: string) => {
  const title = props.element.props.title;
  return typeof title === "string" && title ? title : fallback;
};

/* ── view ──────────────────────────────────────────────────────────── */

function ViewTile(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const id = idOf(props);
  const title = titleOf(props, props.element.type);
  const fullscreen = useWorkspaceSession((s) => s.fullscreen === id);
  return (
    <Tile
      id={id}
      title={title}
      toolbar={
        <>
          {fullscreen ? <span className="flex-1" /> : <HeaderSocket id={id} />}
          <NdIconButton icon="fullscreen" title="fullscreen" onClick={() => ws.setFullscreen(id)} />
        </>
      }
    >
      <BodyStatus id={id} label={title} />
      {fullscreen ? (
        <div className="grid h-full place-items-center rounded border border-dashed border-border">
          <NdHud size={8.5}>fullscreen · esc</NdHud>
        </div>
      ) : (
        <BodySocket id={id} className="flex h-full min-h-0 flex-col overflow-hidden" />
      )}
    </Tile>
  );
}

/* ── layout ────────────────────────────────────────────────────────── */

function Sash({ horizontal, onPointerDown }: { horizontal: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const { editable } = useDashboard();
  const [hot, setHot] = useState(false);
  return (
    <div
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerEnter={editable ? () => setHot(true) : undefined}
      onPointerLeave={editable ? () => setHot(false) : undefined}
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

function Pane({ share, children }: { share: number; children: ReactNode }) {
  return (
    <div
      className="flex"
      style={{ flex: `${share} 1 0%`, minWidth: ND_STAGE.minTilePx, minHeight: ND_STAGE.minTilePx }}
    >
      {children}
    </div>
  );
}

function Split(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const { sashCleanup } = useDashboard();
  const id = idOf(props);
  const horizontal = props.element.props.direction === "column";
  const ratio = Number(props.element.props.ratio);
  const [first, second] = Children.toArray(props.children);
  const beginSash = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    sashCleanup.current?.();
    const move = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      ws.setSplitRatio(id, clamp(r, ND_STAGE.ratioMin, ND_STAGE.ratioMax));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (sashCleanup.current === cleanup) sashCleanup.current = null;
    };
    sashCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? "flex-col" : "flex-row"}`}>
      <Pane share={ratio}>{first}</Pane>
      <Sash horizontal={horizontal} onPointerDown={beginSash} />
      <Pane share={1 - ratio}>{second}</Pane>
    </div>
  );
}

function Stack(props: ComponentRenderProps) {
  const column = props.element.props.direction === "column";
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 ${column ? "flex-col" : "flex-row"}`}
      style={{ gap: Number(props.element.props.gap ?? 8) }}
    >
      {Children.map(props.children, (child) => (
        <div className="flex min-h-0 min-w-0 flex-1">{child}</div>
      ))}
    </div>
  );
}

/* ── content and controls ──────────────────────────────────────────── */

const TEXT_STYLE = {
  heading: "text-base font-semibold text-foreground",
  body: "text-sm text-foreground",
  muted: "text-xs text-text-muted",
} as const;

function Text(props: ComponentRenderProps) {
  const variant = (
    typeof props.element.props.variant === "string" ? props.element.props.variant : "body"
  ) as keyof typeof TEXT_STYLE;
  return (
    <div className={`min-w-0 flex-1 px-1 py-0.5 ${TEXT_STYLE[variant] ?? TEXT_STYLE.body}`}>
      {typeof props.element.props.text === "string" ? props.element.props.text : ""}
    </div>
  );
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A column's values (with counts in context) as toggles; the chosen set is its `in` clause. */
function Select(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const { runtime } = useDatasetSession();
  const id = idOf(props);
  const column = String(props.element.props.column);
  const element = useWorkspaceSelector((s) => s.spec.elements[id]);
  const scope = elementScope(element, "filter");
  const predicate = useWorkspaceSelector((s) =>
    elementPredicate(s.data, elementData(element), s.state.filter?.[scope ?? ""], id),
  );
  const own = useWorkspaceSelector((s) => (scope === undefined ? undefined : s.state.filter?.[scope]?.[id]?.select));
  const chosen = new Set(own?.op === "in" ? own.values.map(String) : []);
  const [options, setOptions] = useState<{ value: string; n: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const col = quoteIdent(column);
    runtime.coordinator
      .query(
        `SELECT CAST(${col} AS VARCHAR) AS value, COUNT(*)::INT AS n FROM ${runtime.table}${predicate ? ` WHERE ${predicate}` : ""} GROUP BY 1 ORDER BY 2 DESC LIMIT 200`,
      )
      .then(
        (result) => live && (setOptions(toRows<{ value: string; n: number }>(result)), setError(null)),
        (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
      );
    return () => {
      live = false;
    };
  }, [runtime, column, predicate]);

  const toggle = (value: string) => {
    if (scope === undefined) return;
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    const cell = ws.store.state.state.filter?.[scope] ?? {};
    const { [id]: mine = {}, ...others } = cell;
    const { select: _previous, ...facets } = mine;
    const clause: FilterClause | null = next.size > 0 ? { op: "in", column, values: [...next] } : null;
    const facetsNext = clause ? { ...facets, select: clause } : facets;
    ws.coordination.setCoordinationValue(
      "filter",
      scope,
      Object.keys(facetsNext).length > 0 ? { ...others, [id]: facetsNext } : others,
    );
  };

  return (
    <Tile
      id={id}
      title={titleOf(props, typeof props.element.props.label === "string" ? props.element.props.label : column)}
    >
      {error ? (
        <NdCaption className="text-destructive">{error}</NdCaption>
      ) : (
        <div className="flex h-full flex-wrap content-start gap-1 overflow-auto">
          {(options ?? []).map(({ value, n }) => (
            <button
              type="button"
              key={value}
              aria-pressed={chosen.has(value)}
              onClick={() => toggle(value)}
              className={`cursor-pointer rounded border px-2 py-[3px] font-mono text-3xs whitespace-nowrap ${chosen.has(value) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground"}`}
            >
              {value} <span className="opacity-70">{n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
      )}
    </Tile>
  );
}

function Slot(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const { editable } = useDashboard();
  const id = idOf(props);
  const choices = Object.keys(COMPONENTS).filter((type) => !["split", "stack", "slot"].includes(type));
  return (
    <div
      data-dashboard-tile={id}
      className="relative box-border flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden rounded-[7px] border-[1.5px] border-dashed border-border-active p-3"
    >
      {editable ? (
        <button
          type="button"
          title="dismiss slot"
          onClick={() => ws.removeElement(id)}
          className="absolute top-[5px] right-[7px] cursor-pointer border-0 bg-transparent p-0 text-2xs text-text-muted"
        >
          ✕
        </button>
      ) : null}
      <NdHud size={9.5}>empty slot</NdHud>
      {editable ? (
        <div className="flex max-w-[300px] flex-wrap justify-center gap-[5px]">
          {choices.map((type) => (
            <button
              type="button"
              key={type}
              title={COMPONENTS[type].description}
              onClick={() => ws.fillSlot(id, type)}
              className="cursor-pointer rounded border border-border bg-muted px-2 py-[3px] font-mono text-3xs whitespace-nowrap text-muted-foreground"
            >
              + {type}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── registry + state ──────────────────────────────────────────────── */

const REGISTRY: ComponentRegistry = {
  split: Split,
  stack: Stack,
  text: Text,
  select: Select,
  slot: Slot,
  ...Object.fromEntries(
    Object.entries(COMPONENTS)
      .filter(([, info]) => info.view)
      .map(([type]) => [type, ViewTile]),
  ),
};

/** json-render state = the document's coordination state; writes go through the type schemas. */
function coordinationStateStore(ws: Workspace): StateStore {
  const set = (path: string, value: unknown) => {
    const [, type, scope, ...rest] = path.split("/");
    if (!isCoordinationType(type) || !scope || rest.length > 0) {
      throw new Error(`dashboard state writes must target /<type>/<scope>, not "${path}"`);
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
function renderSpec(spec: DashboardSpec) {
  return {
    root: spec.root,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([id, element]) => [
        id,
        { ...element, props: { ...element.props, elementId: id } },
      ]),
    ),
  };
}

/* ── fullscreen ────────────────────────────────────────────────────── */

/** The fullscreen element's body and toolbar reparent here; esc hands them back. */
function FullscreenOverlay() {
  const ws = useWorkspace();
  const id = useWorkspaceSession((s) => s.fullscreen);
  const element = useWorkspaceSelector((s) => (id ? s.spec.elements[id] : undefined));

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      ws.setFullscreen(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, ws]);

  if (!id || !element) return null;
  const title = typeof element.props.title === "string" && element.props.title ? element.props.title : element.type;
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 border-b border-border bg-card px-[9px] leading-none whitespace-nowrap">
        <span className="text-[11.5px] font-medium whitespace-nowrap">{title}</span>
        <HeaderSocket id={id} />
        <span className="font-mono text-[9.5px] whitespace-nowrap text-text-muted">◆ {id}</span>
        <NdIconButton icon="fullscreen" active title="exit fullscreen (esc)" onClick={() => ws.setFullscreen(null)} />
      </div>
      <div className="min-h-0 flex-1 p-2">
        <BodySocket id={id} className="flex h-full min-h-0 flex-col overflow-hidden" />
      </div>
    </div>
  );
}

/* ── pane ──────────────────────────────────────────────────────────── */

export function DashboardPane({ editable }: { editable: boolean }) {
  const ws = useWorkspace();
  const spec = useWorkspaceSelector((s) => s.spec);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const sashCleanup = useRef<(() => void) | null>(null);
  const store = useMemo(() => coordinationStateStore(ws), [ws]);
  const rendered = useMemo(() => renderSpec(spec), [spec]);

  useEffect(() => () => sashCleanup.current?.(), []);

  const beginDrag = (id: string) => {
    ws.selectElement(id);
    dragRef.current = { id, over: null };
    setDrag(dragRef.current);
    const move = (ev: PointerEvent) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-dashboard-tile]");
      const target = over ? over.getAttribute("data-dashboard-tile") : null;
      const current = dragRef.current;
      if (current && current.over !== target) {
        dragRef.current = { ...current, over: target };
        setDrag(dragRef.current);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (current?.over && current.over !== current.id) ws.swapElements(current.id, current.over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <DashboardContext value={{ editable, drag, beginDrag, sashCleanup }}>
      <JSONUIProvider registry={REGISTRY} store={store}>
        <div className="relative box-border flex h-full p-2">
          <Renderer spec={rendered} registry={REGISTRY} />
          <FullscreenOverlay />
        </div>
      </JSONUIProvider>
    </DashboardContext>
  );
}
