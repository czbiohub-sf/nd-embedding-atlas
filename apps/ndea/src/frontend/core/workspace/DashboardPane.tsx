/**
 * The dashboard: json-render renders the active layout's spec with this
 * registry. Layout (`split`, `stack`), content (`text`), controls (`select`),
 * empty tiles (`slot`), and tiles of views: a bare view is a one-tab tile, a
 * `tabs` element a tile of several. Props resolve json-render expressions
 * against the document's coordination `state`; a tile adopts its active
 * view's live body from its dock.
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
import { Popover, PopoverContent, PopoverTrigger, popoverHeading, popoverRow } from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";
import { Link, Maximize2, Plus, X } from "lucide-react";
import { Children, createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { toRows } from "@/lib/mosaic-helpers";
import { BodySocket, BodyStatus } from "./body-dock";
import { ND_STAGE } from "./constants";
import {
  activeSpec,
  COMPONENTS,
  EMPTY_TILE_CHOICES,
  tileProps,
  type Dashboard as DashboardSpec,
  type SplitSide,
} from "./dashboard";
import type { DashboardEdit } from "./edits";
import { EmbeddingChip } from "./EmbeddingChip";
import { LinksIndicator } from "./LinksPopover";
import { copyReference } from "./reference";
import { ViewSettingsButton } from "./ViewSettings";
import { useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "./workspace-context";
import type { WorkspaceStore } from "./workspace-store";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A dragged tile (by its tab strip) or one tab of it; `strip` says `over` is a tab strip, not a tile body. */
interface DragState {
  tile: string;
  tab?: string;
  over: string | null;
  strip: boolean;
}

interface DashboardContextValue {
  drag: DragState | null;
  beginDrag: (from: { tile: string; tab?: string }, start: React.PointerEvent) => void;
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

/** Named edits from the tile chrome; a refused one becomes a toast. */
function apply(ws: WorkspaceStore, edits: DashboardEdit[]): void {
  try {
    ws.apply(edits);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

/* ── tile chrome ───────────────────────────────────────────────────── */

const TILE_FRAME =
  "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[7px] bg-surface shadow-(--shadow-tile)";
const TILE_HEADER = "flex h-(--tile-header) shrink-0 items-center gap-1.5 overflow-hidden px-1.5";
const SPLIT_SIDES: readonly SplitSide[] = ["left", "right", "up", "down"];

interface Tab {
  id: string;
  title: string;
}

/** **+** on the tab strip: the empty-tile choices, added as the tile's new active tab. */
function AddTab({ tile }: { tile: string }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Add tab"
        title="Add tab"
        onPointerDown={(e) => e.stopPropagation()}
        className="flex shrink-0 rounded-sm p-[3px] text-text-muted hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <Plus className="size-3" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--popover-width) gap-0">
        <div className={popoverHeading}>Add a tab</div>
        {EMPTY_TILE_CHOICES.map((type) => (
          <button
            type="button"
            key={type}
            title={COMPONENTS[type].description}
            className={cn(popoverRow, "w-full text-left hover:bg-muted")}
            onClick={() => {
              setOpen(false);
              apply(ws, [{ op: "add_tab", tile, type, props: tileProps(type) }]);
            }}
          >
            {COMPONENTS[type].title}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The header's tab strip (segmented; the active tab on the raised thumb).
 * `editable` (view tiles): a click shows a tab, × closes it (with several tabs;
 * a one-tab tile is removed from its context menu), a drag moves it to another
 * tile's strip, and **+** adds one. Dragging onto a tile body swaps tiles.
 */
function TabStrip({
  tile,
  tabs,
  active,
  editable = false,
}: {
  tile: string;
  tabs: readonly Tab[];
  active: string;
  editable?: boolean;
}) {
  const ws = useWorkspace();
  const { drag, beginDrag } = useDashboard();
  const target = drag?.strip && drag.over === tile && drag.tile !== tile;
  return (
    <div data-tab-strip={editable ? tile : undefined} className="flex min-w-0 items-center gap-0.5">
      <div
        role="tablist"
        className={cn(
          "inline-flex min-w-0 items-center gap-px rounded-md bg-muted p-0.5",
          target && "ring-2 ring-primary",
        )}
      >
        {tabs.map(({ id, title }) => {
          const on = id === active;
          return (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={on}
              onPointerDown={(e) => beginDrag({ tile, tab: editable ? id : undefined }, e)}
              onClick={() => !on && apply(ws, [{ op: "set_active_tab", tile, id }])}
              className={cn(
                "group/tab flex min-w-0 cursor-default items-center gap-1 rounded-sm px-2 py-0.5 text-ui",
                on
                  ? "bg-card font-medium text-foreground shadow-(--shadow-raised)"
                  : "text-text-muted hover:text-foreground",
                drag?.tab === id && "opacity-45",
              )}
            >
              <span className="truncate">{title}</span>
              {editable && tabs.length > 1 && (
                <span
                  role="button"
                  aria-label={`Close ${title}`}
                  title="Close tab"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    apply(ws, [{ op: "close_tab", id }]);
                  }}
                  className={cn(
                    "-mr-1 flex rounded-xs text-text-muted hover:text-foreground",
                    !on && "invisible group-hover/tab:visible",
                  )}
                >
                  <X className="size-[11px]" strokeWidth={1.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {editable && <AddTab tile={tile} />}
    </div>
  );
}

/** A tile's frame: 30px header (tab strip · chip · actions; right-click for layout edits) over a full-bleed body. */
function Tile({
  id,
  view,
  strip,
  chip,
  actions,
  children,
}: {
  id: string;
  /** The active view, when the tile shows one: link highlights ring it. */
  view?: string;
  strip: ReactNode;
  chip?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ws = useWorkspace();
  const { drag } = useDashboard();
  const highlighted = useWorkspaceSession((s) => s.highlightedElementIds.includes(view ?? id));
  return (
    <div
      data-dashboard-tile={id}
      onPointerDown={() => ws.selectElement(id)}
      className={cn(
        TILE_FRAME,
        highlighted && "ring-[1.5px] ring-primary",
        !drag?.strip && drag?.over === id && drag.tile !== id && "ring-2 ring-primary",
        drag?.tile === id && !drag.tab && "opacity-45",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger className={TILE_HEADER}>
          {strip}
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

/** A tile's only tab: a non-view tile (select, empty tile) drags as a whole and never takes tabs. */
const soleTab = (tile: string, title: string) => <TabStrip tile={tile} tabs={[{ id: tile, title }]} active={tile} />;

/* ── view tiles ────────────────────────────────────────────────────── */

/** A tile of views: every tab in the strip; the chip, actions, and body belong to the active one. */
function ViewsTile({ tile, tabIds, active }: { tile: string; tabIds: readonly string[]; active: string }) {
  const ws = useWorkspace();
  // A primitive, so the strip re-renders only when a title changes.
  const titles = useWorkspaceSelector((w) =>
    tabIds
      .map((id) => {
        const element = w.element(id);
        return element ? viewTitle(element.type, element.props.title) : id;
      })
      .join("\n"),
  );
  const type = useWorkspaceSelector((w) => w.element(active)?.type);
  const fullscreen = useWorkspaceSession((s) => s.fullscreen === active);
  const names = titles.split("\n");
  const title = names[tabIds.indexOf(active)] ?? active;
  return (
    <Tile
      id={tile}
      view={active}
      strip={<TabStrip tile={tile} tabs={tabIds.map((id, i) => ({ id, title: names[i] }))} active={active} editable />}
      chip={type === "scatter" ? <EmbeddingChip id={active} /> : null}
      actions={
        <>
          <LinksIndicator id={active} />
          <ViewSettingsButton id={active} />
          <IconButton size="md" label="Copy reference for the harness" onClick={() => void copyReference(ws, active)}>
            <Link strokeWidth={1.5} />
          </IconButton>
          <IconButton size="md" label="Fullscreen" onClick={() => ws.setFullscreen(active)}>
            <Maximize2 strokeWidth={1.5} />
          </IconButton>
        </>
      }
    >
      {/* Keyed by tab: a switch adopts the other body; the hidden one stays alive, detached. */}
      <BodyStatus key={`status:${active}`} id={active} label={title} />
      {/* The fullscreen overlay holds the body meanwhile. */}
      {fullscreen ? null : (
        <BodySocket key={active} id={active} className="flex h-full min-h-0 flex-col overflow-hidden" />
      )}
    </Tile>
  );
}

/** A bare view leaf: a one-tab tile. */
function ViewTile(props: ComponentRenderProps) {
  const id = idOf(props);
  return <ViewsTile tile={id} tabIds={[id]} active={id} />;
}

/** A `tabs` element: its children are the tabs; json-render's rendered children are not used. */
function TabsTile(props: ComponentRenderProps) {
  return (
    <ViewsTile tile={idOf(props)} tabIds={props.element.children ?? []} active={String(props.element.props.active)} />
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
      strip={soleTab(
        id,
        titleOr(
          props.element.props.title,
          typeof props.element.props.label === "string" ? props.element.props.label : column,
        ),
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

/** An empty tile (`slot`): pick the component that fills it. */
function Slot(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const id = idOf(props);
  return (
    <Tile id={id} strip={soleTab(id, "Empty tile")}>
      <div className="mx-2 mb-2 flex min-h-0 flex-1 overflow-auto rounded-md border-[1.5px] border-line-2 border-dashed p-2">
        <div className="m-auto flex w-full max-w-(--popover-width) flex-col gap-1.5">
          <span className="px-2 text-sm text-text-muted">Choose a component</span>
          <div className="flex flex-col gap-px">
            {EMPTY_TILE_CHOICES.map((type) => (
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
  tabs: TabsTile,
  ...Object.fromEntries(
    Object.entries(COMPONENTS)
      .filter(([, info]) => info.view)
      .map(([type]) => [type, ViewTile]),
  ),
};

/** A layout's spec plus each element's id as a render-only prop. */
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
          <div role="tablist" className="inline-flex min-w-0 items-center rounded-md bg-muted p-0.5">
            <span
              role="tab"
              aria-selected
              className="min-w-0 truncate rounded-sm bg-card px-2 py-0.5 font-medium text-foreground text-ui shadow-(--shadow-raised)"
            >
              {viewTitle(element.type, element.props.title)}
            </span>
          </div>
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
  const spec = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const sashCleanupRef = useRef<(() => void) | null>(null);
  const rendered = useMemo(() => renderSpec(spec), [spec]);

  useEffect(() => () => sashCleanupRef.current?.(), []);

  /**
   * A tab press becomes a drag after a few px of travel, so a plain click stays
   * a click. A tab dropped on another tile's tab strip moves there (`move_tab`;
   * its body stays alive); anything dropped on a tile body swaps the two tiles.
   */
  const beginDrag = (from: { tile: string; tab?: string }, start: React.PointerEvent) => {
    if (start.button !== 0) return;
    const { clientX, clientY } = start;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current && Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < ND_STAGE.dragStartPx) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const strip = from.tab ? under?.closest?.("[data-tab-strip]") : null;
      const over = strip
        ? strip.getAttribute("data-tab-strip")
        : (under?.closest?.("[data-dashboard-tile]")?.getAttribute("data-dashboard-tile") ?? null);
      if (dragRef.current?.over === over && dragRef.current.strip === !!strip) return;
      dragRef.current = { ...from, over, strip: !!strip };
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
      if (ev.type !== "pointerup" || !current.over || current.over === current.tile) return;
      if (current.strip && current.tab) apply(ws, [{ op: "move_tab", id: current.tab, to: current.over }]);
      else ws.swapElements(current.tile, current.over);
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
