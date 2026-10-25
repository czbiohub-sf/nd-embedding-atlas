/**
 * The dashboard: json-render renders the document's `spec` with this registry.
 * Layout (`split`, `stack`), content (`text`), controls (`select`), empty
 * tiles (`slot`), and one tile per view component. Props resolve json-render
 * expressions against the document's coordination `state`; view tiles adopt
 * their element's live body from its dock.
 */

import { JSONUIProvider, Renderer, type ComponentRegistry, type ComponentRenderProps } from "@json-render/react";
import type { FilterClause } from "@ndea/protocol";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@ndea/ui/components/context-menu";
import { IconButton } from "@ndea/ui/components/icon-button";
import { cn } from "@ndea/ui/lib/utils";
import { Link, Maximize2 } from "lucide-react";
import { Children, createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { toRows } from "@/lib/mosaic-helpers";
import { BodySocket, BodyStatus } from "./body-dock";
import { ND_STAGE } from "./constants";
import { COMPONENTS, type Dashboard as DashboardSpec, type SplitSide } from "./dashboard";
import { EmbeddingChip } from "./EmbeddingChip";
import { LinksIndicator } from "./LinksPopover";
import { copyReference } from "./reference";
import { ViewSettingsButton } from "./ViewSettings";
import { useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "./workspace-context";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface DragState {
  id: string;
  over: string | null;
}

interface DashboardContextValue {
  drag: DragState | null;
  beginDrag: (id: string, start: React.PointerEvent) => void;
  sashCleanupRef: { current: (() => void) | null };
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

const TILE_FRAME =
  "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[7px] bg-surface shadow-(--shadow-tile)";
const TILE_HEADER = "flex h-(--tile-header) shrink-0 items-center gap-1.5 overflow-hidden px-1.5";
const SPLIT_SIDES: readonly SplitSide[] = ["left", "right", "up", "down"];

/** The header's tab strip. Until tiles hold several tabs it holds one: the view's title. */
function TileTab({ title, onPointerDown }: { title: string; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <div role="tablist" className="inline-flex min-w-0 items-center rounded-md bg-muted p-0.5">
      <span
        role="tab"
        aria-selected
        onPointerDown={onPointerDown}
        className="min-w-0 truncate rounded-sm bg-card px-2 py-0.5 font-medium text-foreground text-ui shadow-(--shadow-raised)"
      >
        {title}
      </span>
    </div>
  );
}

/** A leaf's frame: 30px header (tab · chip · actions; right-click for layout edits) over a full-bleed body. */
function Tile({
  id,
  title,
  chip,
  actions,
  children,
}: {
  id: string;
  title: string;
  chip?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ws = useWorkspace();
  const { drag, beginDrag } = useDashboard();
  const highlighted = useWorkspaceSession((s) => s.highlightedElementIds.includes(id));
  return (
    <div
      data-dashboard-tile={id}
      onPointerDown={() => ws.selectElement(id)}
      className={cn(
        TILE_FRAME,
        highlighted && "ring-[1.5px] ring-primary",
        drag?.over === id && drag.id !== id && "ring-2 ring-primary",
        drag?.id === id && "opacity-45",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger className={TILE_HEADER}>
          <TileTab title={title} onPointerDown={(e) => beginDrag(id, e)} />
          {chip}
          <span className="flex-1" />
          {actions}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {SPLIT_SIDES.map((side) => (
            <ContextMenuItem key={side} onClick={() => ws.splitElement(id, side)}>
              Split {side}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => ws.removeElement(id)}>
            Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/** The element's own `title`, else the fallback. */
const titleOr = (title: unknown, fallback: string) => (typeof title === "string" && title ? title : fallback);

/** A view's title: its own, else its component's. */
const viewTitle = (type: string, title: unknown) => titleOr(title, COMPONENTS[type]?.title ?? type);

/* ── view ──────────────────────────────────────────────────────────── */

function ViewTile(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const id = idOf(props);
  const title = viewTitle(props.element.type, props.element.props.title);
  const fullscreen = useWorkspaceSession((s) => s.fullscreen === id);
  return (
    <Tile
      id={id}
      title={title}
      chip={props.element.type === "scatter" ? <EmbeddingChip id={id} /> : null}
      actions={
        <>
          <LinksIndicator id={id} />
          <ViewSettingsButton id={id} />
          <IconButton size="md" label="Copy reference for the harness" onClick={() => void copyReference(ws, id)}>
            <Link strokeWidth={1.5} />
          </IconButton>
          <IconButton size="md" label="Fullscreen" onClick={() => ws.setFullscreen(id)}>
            <Maximize2 strokeWidth={1.5} />
          </IconButton>
        </>
      }
    >
      <BodyStatus id={id} label={title} />
      {/* The fullscreen overlay holds the body meanwhile. */}
      {fullscreen ? null : <BodySocket id={id} className="flex h-full min-h-0 flex-col overflow-hidden" />}
    </Tile>
  );
}

/* ── layout ────────────────────────────────────────────────────────── */

/** The gutter between two panes is the resize handle; its hit area overhangs both tiles. */
function Sash({ horizontal, onPointerDown }: { horizontal: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "group relative z-[5] shrink-0 touch-none",
        horizontal ? "h-(--gutter) cursor-row-resize" : "w-(--gutter) cursor-col-resize",
      )}
    >
      <div
        className="absolute grid place-items-center"
        style={
          horizontal
            ? { left: 0, right: 0, top: "50%", height: ND_STAGE.sashHitPx, translate: "0 -50%" }
            : { top: 0, bottom: 0, left: "50%", width: ND_STAGE.sashHitPx, translate: "-50% 0" }
        }
      >
        <div className={cn("rounded-full group-hover:bg-primary/55", horizontal ? "h-0.5 w-9" : "h-9 w-0.5")} />
      </div>
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
  const { sashCleanupRef } = useDashboard();
  const id = idOf(props);
  const horizontal = props.element.props.direction === "column";
  const ratio = Number(props.element.props.ratio);
  const [first, second] = Children.toArray(props.children);
  const beginSash = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    sashCleanupRef.current?.();
    const move = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      ws.setSplitRatio(id, clamp(r, ND_STAGE.ratioMin, ND_STAGE.ratioMax));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (sashCleanupRef.current === cleanup) sashCleanupRef.current = null;
    };
    sashCleanupRef.current = cleanup;
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
      style={{ gap: Number(props.element.props.gap ?? 4) }}
    >
      {Children.map(props.children, (child) => (
        <div className="flex min-h-0 min-w-0 flex-1">{child}</div>
      ))}
    </div>
  );
}

/* ── content and controls ──────────────────────────────────────────── */

const TEXT_STYLE = {
  heading: "font-medium text-foreground text-lg",
  body: "text-foreground text-ui",
  muted: "text-text-muted text-ui",
} as const;

function Text(props: ComponentRenderProps) {
  const variant = (
    typeof props.element.props.variant === "string" ? props.element.props.variant : "body"
  ) as keyof typeof TEXT_STYLE;
  return (
    <div className={`min-w-0 flex-1 px-2.5 py-1 ${TEXT_STYLE[variant] ?? TEXT_STYLE.body}`}>
      {typeof props.element.props.text === "string" ? props.element.props.text : ""}
    </div>
  );
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A column's values (with obs counts in context) as pills; the chosen set is its `in` clause. */
function Select(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const { runtime } = useDatasetSession();
  const id = idOf(props);
  const column = String(props.element.props.column);
  const predicate = useWorkspaceSelector((ws) => ws.elementPredicate(id));
  const own = useWorkspaceSelector((ws) => ws.coordination.filterFacet(id, "select"));
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
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    const clause: FilterClause | null = next.size > 0 ? { op: "in", column, values: [...next] } : null;
    ws.coordination.setFilterFacet(id, "select", clause);
  };

  return (
    <Tile
      id={id}
      title={titleOr(
        props.element.props.title,
        typeof props.element.props.label === "string" ? props.element.props.label : column,
      )}
    >
      {error ? (
        <div className="p-2.5 font-mono text-destructive text-sm">{error}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-auto p-2">
          {(options ?? []).map(({ value, n }) => {
            const on = chosen.has(value);
            return (
              <button
                type="button"
                key={value}
                aria-pressed={on}
                onClick={() => toggle(value)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-0.5 text-sm",
                  on
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-foreground hover:shadow-[inset_0_0_0_1px_var(--line-3)]",
                )}
              >
                {value}
                <span className={cn("font-mono text-xs tabular-nums", on ? "opacity-70" : "text-text-muted")}>
                  {n.toLocaleString("en-US")} obs
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Tile>
  );
}

/**
 * Components an empty tile can take as-is: not layout, and valid at their
 * defaults (`text` needs text, `select` a column; agents add those with props).
 */
const CHOICES = Object.entries(COMPONENTS)
  .filter(([type, info]) => !["split", "stack", "slot"].includes(type) && info.props.safeParse(info.defaults).success)
  .map(([type]) => type);

/** An empty tile (`slot`): pick the component that fills it. */
function Slot(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const id = idOf(props);
  return (
    <Tile id={id} title="Empty tile">
      <div className="mx-2 mb-2 flex min-h-0 flex-1 overflow-auto rounded-md border-[1.5px] border-line-2 border-dashed p-2">
        <div className="m-auto flex w-full max-w-(--popover-width) flex-col gap-1.5">
          <span className="px-2 text-sm text-text-muted">Choose a component</span>
          <div className="flex flex-col gap-px">
            {CHOICES.map((type) => (
              <button
                type="button"
                key={type}
                title={COMPONENTS[type].description}
                onClick={() => ws.fillSlot(id, type)}
                className="flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="font-medium text-foreground text-ui">{COMPONENTS[type].title}</span>
                <span className="w-full truncate text-sm text-text-muted">{COMPONENTS[type].description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Tile>
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

/** The fullscreen element's body reparents here, in the same tile chrome; esc hands it back. */
function FullscreenOverlay() {
  const ws = useWorkspace();
  const id = useWorkspaceSession((s) => s.fullscreen);
  const element = useWorkspaceSelector((ws) => (id ? ws.element(id) : undefined));

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
  return (
    <div className="absolute inset-0 z-30 flex bg-background">
      <div className={TILE_FRAME}>
        <div className={TILE_HEADER}>
          <TileTab title={viewTitle(element.type, element.props.title)} />
          <span className="flex-1" />
          <IconButton size="md" label="Exit fullscreen" pressed onClick={() => ws.setFullscreen(null)}>
            <Maximize2 strokeWidth={1.5} />
          </IconButton>
        </div>
        <BodySocket id={id} className="flex min-h-0 flex-1 flex-col overflow-hidden" />
      </div>
    </div>
  );
}

/* ── pane ──────────────────────────────────────────────────────────── */

export function DashboardPane() {
  const ws = useWorkspace();
  const spec = useWorkspaceSelector((ws) => ws.snapshot().spec);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const sashCleanupRef = useRef<(() => void) | null>(null);
  const rendered = useMemo(() => renderSpec(spec), [spec]);

  useEffect(() => () => sashCleanupRef.current?.(), []);

  /** A tab press becomes a drag-to-swap after a few px of travel, so a plain click stays a click. */
  const beginDrag = (id: string, start: React.PointerEvent) => {
    if (start.button !== 0) return;
    const { clientX, clientY } = start;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current && Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < ND_STAGE.dragStartPx) return;
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-dashboard-tile]");
      const target = over ? over.getAttribute("data-dashboard-tile") : null;
      if (dragRef.current?.over === target) return;
      dragRef.current = { id, over: target };
      setDrag(dragRef.current);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const current = dragRef.current;
      if (!current) return;
      dragRef.current = null;
      setDrag(null);
      if (ev.type === "pointerup" && current.over && current.over !== current.id) {
        ws.swapElements(current.id, current.over);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <DashboardContext value={{ drag, beginDrag, sashCleanupRef }}>
      <JSONUIProvider registry={REGISTRY} store={ws.coordination.stateStore}>
        <div className="relative flex h-full min-h-0 min-w-0">
          <Renderer spec={rendered} registry={REGISTRY} />
          <FullscreenOverlay />
        </div>
      </JSONUIProvider>
    </DashboardContext>
  );
}
