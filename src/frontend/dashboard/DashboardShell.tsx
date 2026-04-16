import type { DockviewApi } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { DevtoolsDrawer } from "../components/devtools/DevtoolsDrawer";
import { BottomDock } from "../components/layout/BottomDock";
import { DockviewShell } from "../components/layout/DockviewShell";
import { FloatingScatterRoot } from "../components/layout/FloatingScatterWindow";
import { DatasetViewerPiP, ViewerPiP } from "../components/layout/ViewerPiP";
import { TerminalTable } from "../components/table/TerminalTable";
import { useDashboard } from "../hooks/useDashboard";
import { openViewerPiP } from "../stores/ViewerPiPStore";

export function DashboardShell() {
  const { state } = useDashboard();
  const { metadata } = state;
  const hasEmbeddings = Object.keys(metadata.obsm ?? {}).length > 0;
  const hasPlate = !!metadata.plate;

  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const cmdPaletteOpenRef = useRef<((page: "scatter") => void) | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  const prevHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    const wasNull = prevHighlightRef.current === null;
    const isNowSet = state.highlightId !== null;
    prevHighlightRef.current = state.highlightId;
    if (!wasNull || !isNowSet) return;
    if (!state.metadata.plate) return;
    const dockedExists = dockviewApi?.getPanel("image-viewer") != null;
    if (!dockedExists) openViewerPiP();
  }, [state.highlightId, state.metadata.plate, dockviewApi]);

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

  const openViewerPanel = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.id === "image-viewer");
    if (existing) {
      existing.focus();
      return;
    }
    const scatter = api.panels.find((p) => p.id === "scatter" || p.id.startsWith("scatter-"));
    api.addPanel({
      id: "image-viewer",
      component: "image-viewer",
      title: "Image Viewer",
      position: scatter ? { referencePanel: scatter.id, direction: "right" } : undefined,
    });
  }, []);

  const closeViewerPanel = useCallback(() => {
    dockviewApiRef.current?.getPanel("image-viewer")?.api.close();
  }, []);

  const openFloatViewer = useCallback(() => {
    openViewerPiP();
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
        onCloseViewer={closeViewerPanel}
        onFloatViewer={hasPlate ? openFloatViewer : undefined}
        hasPlate={hasPlate}
        devtoolsOpen={devtoolsOpen}
        onToggleDevtools={() => setDevtoolsOpen((o) => !o)}
        datasetKeys={metadata.dataset_keys ?? undefined}
      />

      {/* Floating scatter windows — outside Dockview so they survive panel close */}
      <FloatingScatterRoot />

      {/* Picture-in-picture viewer — single-dataset only */}
      {(!metadata.dataset_keys || metadata.dataset_keys.length <= 1) && <ViewerPiP />}

      {/* Per-dataset floating viewers */}
      {metadata.dataset_keys?.map((key) => (
        <DatasetViewerPiP key={key} datasetKey={key} />
      ))}

      {/* ⌘K command palette */}
      <CommandPalette
        onAddScatter={addScatterPanel}
        onOpenViewer={openViewerPanel}
        onFloatViewer={openFloatViewer}
        openRef={cmdPaletteOpenRef}
      />
    </div>
  );
}
