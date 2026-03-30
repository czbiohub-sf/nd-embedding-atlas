import type { DockviewApi } from "dockview-react";
import { useRef, useCallback, useState } from "react";
import { DevtoolsDrawer } from "../components/devtools/DevtoolsDrawer";
import { FloatingScatterRoot } from "../components/layout/FloatingScatterWindow";
import { CommandPalette } from "../components/CommandPalette";
import { DockviewShell } from "../components/layout/DockviewShell";
import { BottomDock } from "../components/layout/BottomDock";
import { TerminalTable } from "../components/table/TerminalTable";
import { useDashboard } from "../hooks/useDashboard";

export function DashboardShell() {
  const { state } = useDashboard();
  const { metadata } = state;
  const hasEmbeddings = Object.keys(metadata.obsm ?? {}).length > 0;

  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const cmdPaletteOpenRef = useRef<((page: "scatter") => void) | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  const addScatterPanel = useCallback((obsmKey: string) => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const id = `scatter-${Math.random().toString(36).slice(2, 10)}`;
    const label = obsmKey.replace(/^X_/, "").toUpperCase();
    const existingScatter = api.panels.find((p) => p.id === "scatter" || p.id.startsWith("scatter-"));
    api.addPanel({
      id,
      component: "scatter",
      title: `Scatter: ${label}`,
      params: { initialObsmKey: obsmKey },
      position: existingScatter ? { referencePanel: existingScatter.id, direction: "right" } : undefined,
    });
  }, []);

  const openScatterPicker = useCallback(() => {
    cmdPaletteOpenRef.current?.("scatter");
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1">
        <DockviewShell
          hasPlate={!!metadata.plate}
          hasEmbeddings={hasEmbeddings}
          onApiReady={(api) => {
            dockviewApiRef.current = api;
            setDockviewApi(api);
          }}
        />
      </div>

      {/* ⌘J terminal table — slides up above the dock */}
      <TerminalTable />

      {/* Devtools drawer — sits directly above the dock */}
      <DevtoolsDrawer open={devtoolsOpen} onClose={() => setDevtoolsOpen(false)} />

      {/* Bottom dock — 20px navigation + metrics */}
      <BottomDock
        dockviewApi={dockviewApi}
        onAddScatter={openScatterPicker}
        devtoolsOpen={devtoolsOpen}
        onToggleDevtools={() => setDevtoolsOpen((o) => !o)}
      />

      {/* Floating scatter windows — outside Dockview so they survive panel close */}
      <FloatingScatterRoot />

      {/* ⌘K command palette */}
      <CommandPalette onAddScatter={addScatterPanel} openRef={cmdPaletteOpenRef} />
    </div>
  );
}
