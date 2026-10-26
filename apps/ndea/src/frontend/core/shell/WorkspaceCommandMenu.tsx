/**
 * The shell's ⌘K: switches layouts (a wireframe preview follows the
 * highlight) and collections › datasets; `>` lists the theme, shell, tile,
 * and add-view commands (`commands.tsx`), which this runs.
 */

import type { ReactNode } from "react";

import { activeSpec, layoutTiles, tileTitle } from "@/core/workspace/dashboard";
import { copyReference } from "@/core/workspace/reference";
import {
  applyOrToast,
  useWorkspace,
  useWorkspaceSelector,
  useWorkspaceSession,
} from "@/core/workspace/workspace-context";
import { useTheme } from "@/ThemeProvider";
import { CollectionSwitchDialog } from "./CollectionSwitchDialog";
import { requestSwitch, useCollections } from "./collections";
import { CommandMenu } from "./CommandMenu";
import {
  addCommands,
  collectionsGroup,
  layoutsGroup,
  shellCommands,
  themeCommands,
  tileCommands,
  type Command,
} from "./commands";
import { LayoutWireframe } from "./LayoutWireframe";
import type { Panel } from "./Shell";

export function WorkspaceCommandMenu({
  open,
  onOpenChange,
  panels,
  onPanel,
  onSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panels: Record<Panel, { title: string; icon: ReactNode }>;
  onPanel: (panel: Panel) => void;
  onSidebar: () => void;
}) {
  const ws = useWorkspace();
  const layouts = useWorkspaceSelector((w) => w.snapshot().layouts);
  const currentLayout = useWorkspaceSelector((w) => w.snapshot().layout);
  const spec = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const selected = useWorkspaceSession((s) => s.selectedElementId);
  const collections = collectionsGroup(useCollections());
  const { theme, setTheme } = useTheme();

  const groups = [layoutsGroup({ layouts, layout: currentLayout }), ...(collections ? [collections] : [])];
  const commands = [
    ...themeCommands(theme),
    ...shellCommands(panels),
    ...tileCommands(spec, selected),
    ...addCommands(spec),
  ];
  const run = (command: Command) => {
    switch (command.kind) {
      case "edits":
        return applyOrToast(ws, command.edits);
      case "fullscreen":
        return ws.setFullscreen(command.view);
      case "reference":
        return void copyReference(ws, command.view);
      case "theme":
        return setTheme(command.theme);
      case "switch-collection":
        return requestSwitch(command.name);
      case "panel":
        return onPanel(command.panel);
      case "sidebar":
        return onSidebar();
    }
  };

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
      <CommandMenu
        open={open}
        onOpenChange={onOpenChange}
        groups={groups}
        commands={commands}
        preview={preview}
        onSelect={run}
      />
      <CollectionSwitchDialog />
    </>
  );
}
