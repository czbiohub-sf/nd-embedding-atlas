/**
 * AddNodeMenu — the Tab / right-click node palette, built on the shadcn
 * (Base UI) ContextMenu. Driven CONTROLLED: the canvas owns open state via
 * ReactFlow's pane-gated `onPaneContextMenu` + the Tab key, and anchors the
 * menu to a virtual element at the cursor. Click (or Enter) spawns the node at
 * the invocation's world position, selected, embedded.
 *
 * Organization lives in CATEGORY/GROUP_ORDER below: palette nodes bucket into
 * labeled groups, Views is a submenu, and any node missing from the map falls
 * into "Other" so new palette nodes still surface.
 */

import { Fragment, useMemo } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { NdHud } from "@/components/nd/nd-primitives";
import type { AppNodeDescriptor } from "../node-defs";
import { useWorkspace } from "../workspace-context";
import type { WorkspaceNodePosition } from "../types";

/** menu invocation — pointer (for the anchor) + spawn point in world coords */
export interface AddMenuState {
  clientX: number;
  clientY: number;
  world: WorkspaceNodePosition;
}

// ── Node organization ────────────────────────────────────────────────
// Groups render top-to-bottom in GROUP_ORDER; SUBMENU groups nest behind a
// "▸" trigger. A node type absent from CATEGORY falls into "Other".
const GROUP_ORDER = ["Data", "Transform", "Views", "Output", "Other"] as const;
type Group = (typeof GROUP_ORDER)[number];
const SUBMENU: Partial<Record<Group, true>> = { Views: true };
const CATEGORY: Partial<Record<string, Group>> = {
  dataset: "Data",
  collection: "Data",
  wrangle: "Transform",
  count: "Transform",
  annotate: "Transform",
  scatter: "Views",
  table: "Views",
  gallery: "Views",
  "image-viewer": "Views",
  cache: "Output",
  export: "Output",
};

function bucketed(defs: readonly AppNodeDescriptor[]): { group: Group; defs: AppNodeDescriptor[] }[] {
  const byGroup = new Map<Group, AppNodeDescriptor[]>();
  for (const d of defs) {
    const g = CATEGORY[d.definitionRef.nodeTypeId] ?? "Other";
    const list = byGroup.get(g) ?? [];
    list.push(d);
    byGroup.set(g, list);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, defs: byGroup.get(g)! }));
}

export function AddNodeMenu({ menu, onClose }: { menu: AddMenuState | null; onClose: () => void }) {
  const ws = useWorkspace();

  // Virtual anchor: a zero-size rect at the cursor. Base UI positions the
  // popup against it and handles viewport collision (flips near edges).
  const anchor = useMemo(
    () => (menu ? { getBoundingClientRect: () => new DOMRect(menu.clientX, menu.clientY, 0, 0) } : undefined),
    [menu],
  );

  const spawn = (nodeTypeId: string) => {
    if (menu) ws.addNode(nodeTypeId, menu.world);
    onClose();
  };

  const row = (d: AppNodeDescriptor) => (
    <ContextMenuItem
      key={`${d.definitionRef.nodeTypeId}@${d.definitionRef.nodeTypeVersion}`}
      className="justify-between gap-6"
      onClick={() => spawn(d.definitionRef.nodeTypeId)}
    >
      <span>{d.label}</span>
      <ContextMenuShortcut>{d.stage}</ContextMenuShortcut>
    </ContextMenuItem>
  );

  return (
    <ContextMenu
      open={menu != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ContextMenuContent anchor={anchor} align="start" side="right" className="w-56">
        {/* header — plain row, NOT a ContextMenuLabel (GroupLabel must live inside a Group) */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <NdHud size={9}>add node</NdHud>
          <span className="font-mono text-[8.5px] text-text-muted">tab · right-click</span>
        </div>
        {bucketed(ws.nodeLibrary.paletteDescriptors()).map(({ group, defs }) => (
          <Fragment key={group}>
            <ContextMenuSeparator />
            {SUBMENU[group] ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>{group}</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">{defs.map(row)}</ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuGroup>
                <ContextMenuLabel>{group}</ContextMenuLabel>
                {defs.map(row)}
              </ContextMenuGroup>
            )}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
