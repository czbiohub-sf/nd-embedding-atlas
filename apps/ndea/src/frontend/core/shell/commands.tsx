/**
 * ⌘K's workspace rows, pure: what each state offers and the `Command` each
 * row runs. `WorkspaceCommandMenu` reads the state and runs the commands.
 */

import {
  CopyIcon,
  Maximize2Icon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  COMPONENTS,
  EMPTY_TILE_CHOICES,
  tileProps,
  tileView,
  type Dashboard,
  type LayoutDocument,
  type SplitSide,
} from "@/core/workspace/dashboard";
import type { DashboardEdit } from "@/core/workspace/edits";
import { datasetFilterEdit, obs, totalObs, type Collections } from "./collections";
import type { MenuGroup, MenuItem } from "./CommandMenu";
import { LayoutWireframe, layoutTiles, tileTitle } from "./LayoutWireframe";
import type { Panel } from "./Shell";

export type Command =
  | { kind: "edits"; edits: DashboardEdit[] }
  | { kind: "fullscreen"; view: string }
  | { kind: "reference"; view: string }
  | { kind: "theme"; theme: "light" | "dark" }
  | { kind: "switch-collection"; name: string }
  | { kind: "panel"; panel: Panel }
  | { kind: "sidebar" };

export type CommandItem = MenuItem<Command>;

const SPLIT_ICON: Record<SplitSide, ReactNode> = {
  left: <SquareSplitHorizontalIcon />,
  right: <SquareSplitHorizontalIcon />,
  up: <SquareSplitVerticalIcon />,
  down: <SquareSplitVerticalIcon />,
};

/** Every layout, the active one current; a row switches to it. Row ids are `layout:<id>`. */
export function layoutsGroup({ layouts, layout: current }: LayoutDocument): MenuGroup<Command> {
  return {
    heading: "Layouts",
    items: Object.entries(layouts).map(([id, layout]) => ({
      id: `layout:${id}`,
      label: layout.name,
      current: id === current,
      leading: <LayoutWireframe spec={layout.spec} className="h-4 w-[26px] shrink-0" />,
      action: { kind: "edits", edits: [{ op: "set_active_layout", id }] },
    })),
  };
}

/** Collections › datasets: the open collection's datasets filter, any other row switches. Null with nothing to pick. */
export function collectionsGroup({ collections, open, included }: Collections): MenuGroup<Command> | null {
  if (collections.length <= 1 && (open?.datasets.length ?? 0) <= 1) return null;
  const names = open?.datasets.map((d) => d.name) ?? [];
  const include = (values: string[] | null): Command => ({ kind: "edits", edits: [datasetFilterEdit(names, values)] });
  return {
    heading: "Collections",
    meta: `${collections.length} ${collections.length === 1 ? "collection" : "collections"}`,
    items: collections.map((c) => {
      const isOpen = c === open;
      const switchTo: Command = { kind: "switch-collection", name: c.name };
      return {
        id: `collection:${c.name}`,
        label: c.name,
        sub: `${c.datasets.length} ${c.datasets.length === 1 ? "dataset" : "datasets"} · ${obs(totalObs(c))}`,
        current: isOpen,
        action: isOpen ? include(null) : switchTo,
        children: c.datasets.map((d) => ({
          id: `collection:${c.name}/${d.name}`,
          label: d.name,
          meta: obs(d.nObs),
          current: isOpen && included?.size === 1 && included.has(d.name),
          action: !isOpen ? switchTo : c.datasets.length > 1 ? include([d.name]) : undefined,
        })),
      };
    }),
  };
}

export function themeCommands(theme: "light" | "dark"): CommandItem[] {
  return [
    {
      id: "theme:light",
      label: "Light theme",
      leading: <SunIcon />,
      current: theme === "light",
      action: { kind: "theme", theme: "light" },
    },
    {
      id: "theme:dark",
      label: "Dark theme",
      leading: <MoonIcon />,
      current: theme === "dark",
      action: { kind: "theme", theme: "dark" },
    },
  ];
}

/** Toggle the sidebar, then open each rail flyout. */
export function shellCommands(panels: Record<Panel, { title: string; icon: ReactNode }>): CommandItem[] {
  return [
    {
      id: "shell:sidebar",
      label: "Toggle sidebar",
      meta: "⌘B",
      leading: <PanelLeftIcon />,
      action: { kind: "sidebar" },
    },
    ...(Object.keys(panels) as Panel[]).map((panel): CommandItem => ({
      id: `shell:${panel}`,
      label: `Open ${panels[panel].title}`,
      leading: panels[panel].icon,
      action: { kind: "panel", panel },
    })),
  ];
}

/** The selected tile's commands: fullscreen and copy reference (when it shows a view), split, remove. */
export function tileCommands(spec: Dashboard, selected: string | null): CommandItem[] {
  if (!selected || !spec.elements[selected]) return [];
  const sub = tileTitle(spec, selected);
  const view = tileView(spec, selected);
  const viewCommands: CommandItem[] = view
    ? [
        {
          id: "view:fullscreen",
          label: "Fullscreen",
          sub,
          leading: <Maximize2Icon />,
          action: { kind: "fullscreen", view },
        },
        {
          id: "view:reference",
          label: "Copy reference",
          sub,
          leading: <CopyIcon />,
          action: { kind: "reference", view },
        },
      ]
    : [];
  return [
    ...viewCommands,
    ...(["left", "right", "up", "down"] as const).map((side): CommandItem => ({
      id: `tile:split-${side}`,
      label: `Split tile ${side}`,
      sub,
      leading: SPLIT_ICON[side],
      action: { kind: "edits", edits: [{ op: "split", id: selected, side }] },
    })),
    {
      id: "tile:remove",
      label: "Remove tile",
      sub,
      leading: <Trash2Icon />,
      action: { kind: "edits", edits: [{ op: "remove", id: selected }] },
    },
  ];
}

/** One "Add <view>" per empty-tile choice, filling the first empty tile; none without an empty tile. */
export function addCommands(spec: Dashboard): CommandItem[] {
  const slot = layoutTiles(spec).find((id) => spec.elements[id].type === "slot");
  if (!slot) return [];
  return EMPTY_TILE_CHOICES.map((type) => ({
    id: `add:${type}`,
    label: `Add ${COMPONENTS[type].title}`,
    sub: "to the first empty tile",
    leading: <PlusIcon />,
    action: { kind: "edits", edits: [{ op: "add", type, props: tileProps(type), at: { slot } }] },
  }));
}
