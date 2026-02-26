import { DockviewShell } from "../components/layout/DockviewShell";
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
        <div className="flex h-full flex-col bg-base">
            <Toolbar>
                {hasTime && <TimeSlider />}
                <FilterInfo />
                <ExportButton />
                <span className="ml-auto text-text-muted">v{metadata.version}</span>
            </Toolbar>

            <div className="min-h-0 flex-1">
                <DockviewShell hasPlate={!!metadata.plate} hasEmbeddings={hasEmbeddings} />
            </div>
        </div>
    );
}
