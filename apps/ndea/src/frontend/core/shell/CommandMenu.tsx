/**
 * The ⌘K command menu: a centered 760px window. By default it switches
 * things (layouts, and collections with their datasets as children); typing
 * ">" lists commands.
 * ↑↓ move, ↵ open, → / ← expand and collapse, esc closes.
 */

import {
  ChevronRightIcon,
  CopyIcon,
  Maximize2Icon,
  MoonIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Command, CommandGroup, CommandItem, CommandList } from "@ndea/ui/components/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ndea/ui/components/dialog";
import { Kbd } from "@ndea/ui/components/kbd";
import { cn } from "@ndea/ui/lib/utils";

import {
  activeSpec,
  COMPONENTS,
  EMPTY_TILE_CHOICES,
  tileProps,
  tileView,
  type SplitSide,
} from "@/core/workspace/dashboard";
import { copyReference } from "@/core/workspace/reference";
import {
  applyOrToast,
  useWorkspace,
  useWorkspaceSelector,
  useWorkspaceSession,
} from "@/core/workspace/workspace-context";
import { useTheme } from "@/ThemeProvider";
import { CollectionSwitchDialog } from "./CollectionSwitchDialog";
import { useCollectionsGroup } from "./collections";
import { LayoutWireframe, layoutTiles, tileTitle } from "./LayoutWireframe";

export interface MenuItem {
  /** Unique across the menu: the highlighted row's key. */
  id: string;
  label: string;
  sub?: string;
  meta?: string;
  current?: boolean;
  leading?: ReactNode;
  /** Nested rows (a collection's datasets); → expands, ← collapses. */
  children?: MenuItem[];
  onSelect?: () => void;
}

export interface MenuGroup {
  heading: string;
  meta?: string;
  items: MenuItem[];
}

interface Row {
  item: MenuItem;
  depth: number;
  parent?: string;
}

/** Visible rows: the expanded tree, or every match (at its depth) while searching. */
function rowsOf(items: MenuItem[], needle: string, collapsed: ReadonlySet<string>, depth = 0, parent?: string): Row[] {
  return items.flatMap((item) => {
    const matches = !needle || `${item.label} ${item.sub ?? ""}`.toLowerCase().includes(needle);
    const self = matches ? [{ item, depth, parent }] : [];
    if (!item.children || (!needle && collapsed.has(item.id))) return self;
    return [...self, ...rowsOf(item.children, needle, collapsed, depth + 1, item.id)];
  });
}

function MenuBody({
  groups,
  commands,
  preview,
  close,
}: {
  groups: MenuGroup[];
  commands: MenuItem[];
  /** The right-hand pane for the highlighted row's id. */
  preview?: (highlighted: string | undefined) => ReactNode;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // With nothing to switch (the recovery page) the menu holds commands only.
  const commandMode = query.startsWith(">") || groups.length === 0;
  const needle = query.replace(/^>/, "").trim().toLowerCase();
  const shown = (commandMode ? [{ heading: "Commands", items: commands }] : groups)
    .map((group) => ({ ...group, rows: rowsOf(group.items, needle, collapsed) }))
    .filter((group) => group.rows.length > 0);
  const rows = shown.flatMap((group) => group.rows);
  const current = rows.find((row) => row.item.id === highlight) ?? rows[0];

  const run = (item: MenuItem) => {
    close();
    item.onSelect?.();
  };
  const setCollapsedId = (id: string, value: boolean) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!current || needle) return;
    const { item, parent } = current;
    if (event.key === "ArrowRight" && item.children && collapsed.has(item.id)) {
      event.preventDefault();
      setCollapsedId(item.id, false);
    } else if (event.key === "ArrowLeft" && item.children && !collapsed.has(item.id)) {
      event.preventDefault();
      setCollapsedId(item.id, true);
    } else if (event.key === "ArrowLeft" && parent) {
      event.preventDefault();
      setCollapsedId(parent, true);
      setHighlight(parent);
    }
  };
  const pane = !commandMode && preview?.(current?.item.id);

  return (
    <Command
      shouldFilter={false}
      value={current?.item.id ?? ""}
      onValueChange={setHighlight}
      onKeyDown={onKeyDown}
      className="min-h-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        {commandMode && (
          <span className="rounded-xs bg-accent px-1.5 py-px font-mono text-sm text-accent-foreground">cmd</span>
        )}
        <input
          autoFocus
          data-autofocus
          aria-label="Search the command menu"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight("");
          }}
          placeholder={groups.length === 0 ? "Run a command…" : "Switch layout or dataset…  type > for commands"}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-lg outline-hidden placeholder:text-text-muted"
        />
        <Kbd>esc</Kbd>
      </div>
      <div className="flex min-h-0 flex-1">
        <CommandList className="max-h-none min-w-0 flex-1 px-1.5 pt-0.5 pb-2">
          {shown.map((group) => (
            <CommandGroup
              key={group.heading}
              heading={
                <span className="flex justify-between">
                  <span>{group.heading}</span>
                  <span className="font-normal">{group.meta}</span>
                </span>
              }
              className="**:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2.5"
            >
              {group.rows.map(({ item, depth }) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => run(item)}
                  style={{ paddingLeft: 10 + depth * 18 }}
                  className="gap-2 rounded-lg py-1.5 pr-2.5"
                >
                  {item.children && (
                    <ChevronRightIcon
                      className={cn(
                        "text-text-muted transition-transform",
                        (needle || !collapsed.has(item.id)) && "rotate-90",
                      )}
                    />
                  )}
                  {item.leading}
                  <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                    <span className="truncate">{item.label}</span>
                    {item.sub && <span className="shrink-0 text-sm text-text-muted">{item.sub}</span>}
                  </span>
                  {item.current && (
                    <span className="flex shrink-0 items-center gap-1.5 text-sm text-text-muted">
                      <span className="size-1.5 rounded-full bg-primary" />
                      current
                    </span>
                  )}
                  {item.meta && (
                    <span className="shrink-0 font-mono text-sm text-text-muted tabular-nums">{item.meta}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {rows.length === 0 && <div className="px-2.5 py-3.5 text-text-muted">Nothing matches.</div>}
        </CommandList>
        {pane && (
          <div className="flex w-60 shrink-0 flex-col gap-2 overflow-hidden border-l border-border p-3">{pane}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3.5 border-t border-border px-3 py-[7px] text-sm text-text-muted">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        {!commandMode && (
          <span className="flex items-center gap-1">
            <Kbd>→</Kbd> expand
          </span>
        )}
        {groups.length > 0 && (
          <span className="flex items-center gap-1">
            {commandMode ? (
              <>
                delete <Kbd>&gt;</Kbd> to go back
              </>
            ) : (
              <>
                <Kbd>&gt;</Kbd> for commands
              </>
            )}
          </span>
        )}
      </div>
    </Command>
  );
}

/**
 * The window, toggled by ⌘K (Ctrl+K) anywhere; its search, highlight and
 * expansion reset each time it opens. The theme commands lead `commands`.
 */
export function CommandMenu({
  open,
  onOpenChange,
  groups = [],
  commands = [],
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups?: MenuGroup[];
  commands?: MenuItem[];
  /** The right-hand pane in switch mode, for the highlighted row's id. */
  preview?: (highlighted: string | undefined) => ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);
  const allCommands: MenuItem[] = [
    {
      id: "theme:light",
      label: "Light theme",
      leading: <SunIcon />,
      current: theme === "light",
      onSelect: () => setTheme("light"),
    },
    {
      id: "theme:dark",
      label: "Dark theme",
      leading: <MoonIcon />,
      current: theme === "dark",
      onSelect: () => setTheme("dark"),
    },
    ...commands,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Centered with margins, not translate, so the open animation never shifts it sideways.
        className="top-[12%] right-0 left-0 mx-auto flex max-h-[min(520px,76%)] w-[760px] max-w-[calc(100%-32px)] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[calc(100%-32px)]"
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">Switch layout or dataset, or type &gt; for commands</DialogDescription>
        <MenuBody groups={groups} commands={allCommands} preview={preview} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/* ── content ───────────────────────────────────────────────────────── */

const SPLIT_ICON: Record<SplitSide, ReactNode> = {
  left: <SquareSplitHorizontalIcon />,
  right: <SquareSplitHorizontalIcon />,
  up: <SquareSplitVerticalIcon />,
  down: <SquareSplitVerticalIcon />,
};

/** The shell's menu: the layouts and collections to switch to; `shellCommands` (sidebar, flyouts) lead the commands. */
export function WorkspaceCommandMenu({
  open,
  onOpenChange,
  shellCommands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shellCommands: MenuItem[];
}) {
  const ws = useWorkspace();
  const layouts = useWorkspaceSelector((w) => w.snapshot().layouts);
  const currentLayout = useWorkspaceSelector((w) => w.snapshot().layout);
  const spec = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const selectedId = useWorkspaceSession((s) => s.selectedElementId);
  const collections = useCollectionsGroup();

  const tiles = layoutTiles(spec).map((id) => ({ id, element: spec.elements[id] }));
  const groups: MenuGroup[] = [
    {
      heading: "Layouts",
      items: Object.entries(layouts).map(([id, layout]) => ({
        id: `layout:${id}`,
        label: layout.name,
        current: id === currentLayout,
        leading: <LayoutWireframe spec={layout.spec} className="h-4 w-[26px] shrink-0" />,
        onSelect: () => ws.apply([{ op: "set_active_layout", id }]),
      })),
    },
  ];
  if (collections) groups.push(collections);

  const selected = selectedId ? spec.elements[selectedId] : undefined;
  const view = selectedId ? tileView(spec, selectedId) : undefined;
  const slot = tiles.find((tile) => tile.element.type === "slot");
  const commands: MenuItem[] = [...shellCommands];
  if (selectedId && selected) {
    const sub = tileTitle(spec, selectedId);
    if (view) {
      commands.push(
        {
          id: "view:fullscreen",
          label: "Fullscreen",
          sub,
          leading: <Maximize2Icon />,
          onSelect: () => ws.setFullscreen(view),
        },
        {
          id: "view:reference",
          label: "Copy reference",
          sub,
          leading: <CopyIcon />,
          onSelect: () => void copyReference(ws, view),
        },
      );
    }
    commands.push(
      ...(["left", "right", "up", "down"] as const).map((side) => ({
        id: `tile:split-${side}`,
        label: `Split tile ${side}`,
        sub,
        leading: SPLIT_ICON[side],
        onSelect: () => applyOrToast(ws, [{ op: "split", id: selectedId, side }]),
      })),
      {
        id: "tile:remove",
        label: "Remove tile",
        sub,
        leading: <Trash2Icon />,
        onSelect: () => applyOrToast(ws, [{ op: "remove", id: selectedId }]),
      },
    );
  }
  if (slot) {
    for (const type of EMPTY_TILE_CHOICES) {
      const title = COMPONENTS[type].title;
      commands.push({
        id: `add:${type}`,
        label: `Add ${title}`,
        sub: "to the first empty tile",
        leading: <PlusIcon />,
        onSelect: () => applyOrToast(ws, [{ op: "add", type, props: tileProps(type), at: { slot: slot.id } }]),
      });
    }
  }

  // The highlighted layout row's layout; any other row previews the active one.
  const preview = (highlighted: string | undefined) => {
    const id = highlighted?.startsWith("layout:") ? highlighted.slice("layout:".length) : currentLayout;
    const layout = layouts[id] ?? layouts[currentLayout];
    const shown = layoutTiles(layout.spec);
    return (
      <>
        <div className="rounded-md bg-muted p-1.5">
          <LayoutWireframe spec={layout.spec} labeled className="aspect-[16/10] w-full" />
        </div>
        <div className="text-md font-semibold">{layout.name}</div>
        <div className="text-sm text-text-muted">
          {shown.length} {shown.length === 1 ? "tile" : "tiles"} ·{" "}
          {shown.map((tile) => tileTitle(layout.spec, tile)).join(" · ")}
        </div>
      </>
    );
  };

  return (
    <>
      <CommandMenu open={open} onOpenChange={onOpenChange} groups={groups} commands={commands} preview={preview} />
      <CollectionSwitchDialog />
    </>
  );
}
