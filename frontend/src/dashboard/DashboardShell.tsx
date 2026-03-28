import { DockviewShell } from "../components/layout/DockviewShell";
import { StatusBar } from "../components/StatusBar";
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

    return (
        <div className="flex h-full flex-col" style={{ background: "var(--color-base)" }}>
            <Toolbar>
                {hasTime && <TimeSlider />}
                <FilterInfo />
                <ExportButton />
                <span className="ml-auto" style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                    v{metadata.version}
                </span>
            </Toolbar>

            <div className="min-h-0 flex-1">
                <DockviewShell hasPlate={!!metadata.plate} hasEmbeddings={hasEmbeddings} />
            </div>

            {/* Vim-style status bar — always visible, shows scatter metrics */}
            <StatusBar />
        </div>
    );
}
