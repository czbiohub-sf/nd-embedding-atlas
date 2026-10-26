/**
 * Tile chrome: the frame, the 30px header (tab strip · chip · actions;
 * right-click for split and remove), and the tiles the dashboard renders: a
 * bare view (one tab), a `tabs` element (several), and an empty tile
 * (`slot`). A view tile adopts its active view's live body from its dock.
 * Every write is a named edit.
 */

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
import { useState, type ReactNode } from "react";

import { BodySocket, BodyStatus } from "./body-dock";
import { COMPONENTS, elementTitle, EMPTY_TILE_CHOICES, tileProps, type SplitSide } from "./dashboard";
import type { ElementProps } from "./dashboard-registry";
import { EmbeddingChip } from "./EmbeddingChip";
import { LinksIndicator } from "./LinksPopover";
import { copyReference } from "./reference";
import { useTileDrag } from "./tile-drag";
import { ViewSettingsButton } from "./ViewSettings";
import { applyOrToast, useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "./workspace-context";

export const TILE_FRAME =
  "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[7px] bg-surface shadow-(--shadow-tile)";
export const TILE_HEADER = "flex h-(--tile-header) shrink-0 items-center gap-1.5 overflow-hidden px-1.5";
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
        <Plus className="size-3" strokeWidth={1.75} />
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
              applyOrToast(ws, [{ op: "add_tab", tile, type, props: tileProps(type) }]);
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
  const { drag, beginDrag } = useTileDrag();
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
              onClick={() => !on && applyOrToast(ws, [{ op: "set_active_tab", tile, id }])}
              className={cn(
                "group/tab flex cursor-default items-center gap-1 rounded-sm px-2 py-0.5 text-ui",
                // The active tab keeps a few letters in a narrow tile ("Emb…"), like the design's narrow headers.
                on
                  ? "min-w-10 bg-card font-medium text-foreground shadow-(--shadow-raised)"
                  : "min-w-0 text-text-muted hover:text-foreground",
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
                    applyOrToast(ws, [{ op: "close_tab", id }]);
                  }}
                  className={cn(
                    "-mr-1 flex rounded-xs text-text-muted hover:text-foreground",
                    !on && "invisible group-hover/tab:visible",
                  )}
                >
                  <X className="size-[11px]" strokeWidth={1.75} />
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
  const { drag } = useTileDrag();
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
            <ContextMenuItem key={side} onClick={() => applyOrToast(ws, [{ op: "split", id, side }])}>
              Split {side}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => applyOrToast(ws, [{ op: "remove", id }])}>
            Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/** A tile of views: every tab in the strip; the chip, actions, and body belong to the active one. */
function ViewsTile({ tile, tabIds, active }: { tile: string; tabIds: readonly string[]; active: string }) {
  const ws = useWorkspace();
  // A primitive, so the strip re-renders only when a title changes.
  const titles = useWorkspaceSelector((w) =>
    tabIds
      .map((id) => {
        const element = w.element(id);
        return element ? elementTitle(element) : id;
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
            <Link strokeWidth={1.75} />
          </IconButton>
          <IconButton size="md" label="Fullscreen" onClick={() => ws.setFullscreen(active)}>
            <Maximize2 strokeWidth={1.75} />
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
export function ViewTile({ id }: ElementProps) {
  return <ViewsTile tile={id} tabIds={[id]} active={id} />;
}

/** A `tabs` element: its children are the tabs (the renderer's rendered children go unused); `active` is a child id, validated. */
export function TabsTile({ id, element }: ElementProps) {
  return <ViewsTile tile={id} tabIds={element.children} active={element.props.active as string} />;
}

/** An empty tile (`slot`): pick the view that fills it. It drags as a whole and never takes tabs. */
export function SlotTile({ id }: ElementProps) {
  const ws = useWorkspace();
  return (
    <Tile id={id} strip={<TabStrip tile={id} tabs={[{ id, title: COMPONENTS.slot.title }]} active={id} />}>
      <div className="mx-2 mb-2 flex min-h-0 flex-1 overflow-auto rounded-md border-[1.5px] border-line-2 border-dashed p-2">
        <div className="m-auto flex w-full max-w-(--popover-width) flex-col gap-1.5">
          <span className="px-2 text-sm text-text-muted">Choose a component</span>
          <div className="flex flex-col gap-px">
            {EMPTY_TILE_CHOICES.map((type) => (
              <button
                type="button"
                key={type}
                title={COMPONENTS[type].description}
                onClick={() => applyOrToast(ws, [{ op: "add", type, props: tileProps(type), at: { slot: id } }])}
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
