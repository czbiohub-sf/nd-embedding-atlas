import type { DockviewApi } from "dockview-react";
import { useRef, useCallback } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { DockviewShell } from "../components/layout/DockviewShell";
import { StatusFooter } from "../components/StatusFooter";
import { TerminalTable } from "../components/table/TerminalTable";
import { ExportButton } from "../components/toolbar/ExportButton";
import { FilterInfo } from "../components/toolbar/FilterInfo";
import { TimeSlider } from "../components/toolbar/TimeSlider";
import { Toolbar } from "../components/toolbar/Toolbar";
import { useDashboard } from "../hooks/useDashboard";

export function DashboardShell() {
    const { state } = useDashboard();
    const { metadata } = state;
    const hasTime = metadata.obs_columns?.includes("t") ?? false;
    const hasEmbeddings = Object.keys(metadata.obsm ?? {}).length > 0;

    const dockviewApiRef = useRef<DockviewApi | null>(null);

    const addScatterPanel = useCallback((obsmKey: string) => {
        const api = dockviewApiRef.current;
        if (!api) return;
        const id = `scatter-${Math.random().toString(36).slice(2, 10)}`;
        const label = obsmKey.replace(/^X_/, "").toUpperCase();
        // Place to the right of any existing scatter panel, otherwise free-floating
        const existingScatter = api.panels.find((p) => p.id === "scatter" || p.id.startsWith("scatter-"));
        api.addPanel({
            id,
            component: "scatter",
            title: `Scatter: ${label}`,
            params: { initialObsmKey: obsmKey },
            position: existingScatter
                ? { referencePanel: existingScatter.id, direction: "right" }
                : undefined,
        });
    }, []);

    return (
        <div
            className="flex h-full flex-col"
            style={{ background: "var(--color-base)", paddingBottom: "var(--footer-height, 1.5rem)" }}
        >
            <Toolbar>
                {hasTime && <TimeSlider />}
                <FilterInfo />
                <ExportButton />
                <span className="ml-auto" style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                    v{metadata.version}
                </span>
            </Toolbar>

            <div className="min-h-0 flex-1">
                <DockviewShell
                    hasPlate={!!metadata.plate}
                    hasEmbeddings={hasEmbeddings}
                    onApiReady={(api) => { dockviewApiRef.current = api; }}
                />
            </div>

            {/* Terminal table drawer — slides up above the fixed footer */}
            <TerminalTable />

            {/* Fixed footer — always visible */}
            <StatusFooter />

            {/* ⌘K command palette — portaled, always mounted */}
            <CommandPalette onAddScatter={addScatterPanel} />
        </div>
    );
}
