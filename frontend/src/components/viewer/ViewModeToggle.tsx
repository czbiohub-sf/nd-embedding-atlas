import { useViewer } from "../../hooks/useViewer";

export function ViewModeToggle() {
    const { state, actions } = useViewer();
    const { bounds, viewMode } = state;

    // Only show toggle if dataset has Z dimension
    if (bounds.zMax === null || bounds.zMax === 0) return null;

    return (
        <div className="flex h-5 overflow-hidden rounded border border-border-subtle text-[10px]">
            <button
                type="button"
                aria-pressed={viewMode === "2d"}
                className={`px-2 transition-colors ${viewMode === "2d" ? "bg-accent-cyan/20 text-accent-cyan" : "bg-surface text-text-muted hover:text-text-primary"}`}
                onClick={() => actions.setViewMode("2d")}
            >
                2D
            </button>
            <button
                type="button"
                aria-pressed={viewMode === "3d"}
                className={`px-2 transition-colors ${viewMode === "3d" ? "bg-accent-cyan/20 text-accent-cyan" : "bg-surface text-text-muted hover:text-text-primary"}`}
                onClick={() => actions.setViewMode("3d")}
            >
                3D
            </button>
        </div>
    );
}
