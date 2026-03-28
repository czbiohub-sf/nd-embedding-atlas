import {
    type DockviewApi,
    DockviewReact,
    type DockviewReadyEvent,
    type IDockviewHeaderActionsProps,
} from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "dockview-react/dist/styles/dockview.css";
import { useTheme } from "../../providers/ThemeProvider";

import { ChartGroupPanel } from "./panels/ChartGroupPanel";
import { ImageViewerPanel } from "./panels/ImageViewerPanel";
import { ScatterPanel } from "./panels/ScatterPanel";
import { TablePanel } from "./panels/TablePanel";

// ── Header actions (maximize toggle) ────────────────────────────────────

function RightHeaderActions({ api, containerApi }: IDockviewHeaderActionsProps) {
    const [maximized, setMaximized] = useState(api.isMaximized());

    useEffect(() => {
        const disposable = containerApi.onDidMaximizedGroupChange(() => {
            setMaximized(api.isMaximized());
        });
        return () => disposable.dispose();
    }, [api, containerApi]);

    return (
        <button
            type="button"
            className="dv-header-action"
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => (maximized ? api.exitMaximized() : api.maximize())}
        >
            {maximized ? (
                // Restore icon (collapse arrows)
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path
                        d="M5.5 2v3.5H2M9.5 13v-3.5H13M5.5 5.5L1 1M9.5 9.5L14 14"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            ) : (
                // Maximize icon (expand arrows)
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path
                        d="M2 5.5V2h3.5M13 9.5V13H9.5M5.5 5.5L1 1M9.5 9.5L14 14"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            )}
        </button>
    );
}

// ── Panel component registry ─────────────────────────────────────────────
const COMPONENTS = {
    scatter: ScatterPanel,
    table: TablePanel,
    "image-viewer": ImageViewerPanel,
    charts: ChartGroupPanel,
} as const;

const STORAGE_KEY = "ndea_layout";

// ── Default layout ───────────────────────────────────────────────────────

function loadDefaultLayout(api: DockviewApi, hasPlate: boolean, hasEmbeddings: boolean) {
    // Scatter panel — only when embeddings exist
    if (hasEmbeddings) {
        api.addPanel({
            id: "scatter",
            component: "scatter",
            title: "Embedding",
        });
    }

    // Table — first panel when no scatter
    api.addPanel({
        id: "table",
        component: "table",
        title: "Data Table",
        position: hasEmbeddings ? { referencePanel: "scatter", direction: "below" } : undefined,
    });

    // Reference panel for the right sidebar
    const sidebarRef = hasEmbeddings ? "scatter" : "table";

    if (hasPlate) {
        api.addPanel({
            id: "image-viewer",
            component: "image-viewer",
            title: "Image Viewer",
            position: { referencePanel: sidebarRef, direction: "right" },
        });

        api.addPanel({
            id: "charts",
            component: "charts",
            title: "Charts",
            position: { referencePanel: "image-viewer", direction: "below" },
        });
    } else {
        api.addPanel({
            id: "charts",
            component: "charts",
            title: "Charts",
            position: { referencePanel: sidebarRef, direction: "right" },
        });
    }
}

// ── DockviewShell ────────────────────────────────────────────────────────

interface Props {
    hasPlate: boolean;
    hasEmbeddings: boolean;
}

export function DockviewShell({ hasPlate, hasEmbeddings }: Props) {
    const { theme } = useTheme();
    const apiRef = useRef<DockviewApi | null>(null);

    // Persist layout changes to localStorage
    useEffect(() => {
        const api = apiRef.current;
        if (!api) return;
        const disposable = api.onDidLayoutChange(() => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
            } catch {
                // Silently ignore serialization errors
            }
        });
        return () => disposable.dispose();
    }, []);

    const onReady = useCallback(
        (event: DockviewReadyEvent) => {
            apiRef.current = event.api;

            // Try to restore saved layout
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    event.api.fromJSON(JSON.parse(saved));

                    // Re-add any expected panels that were closed in a previous session
                    const basePanels = hasEmbeddings ? ["scatter", "table"] : ["table"];
                    const expectedPanels = hasPlate
                        ? [...basePanels, "image-viewer", "charts"]
                        : [...basePanels, "charts"];
                    for (const id of expectedPanels) {
                        if (!event.api.getPanel(id)) {
                            const component = id as keyof typeof COMPONENTS;
                            const title = {
                                scatter: "Embedding",
                                table: "Data Table",
                                "image-viewer": "Image Viewer",
                                charts: "Charts",
                            }[id];
                            event.api.addPanel({ id, component, title });
                        }
                    }

                    return;
                } catch {
                    // Fall through to default layout
                }
            }

            loadDefaultLayout(event.api, hasPlate, hasEmbeddings);
        },
        [hasPlate, hasEmbeddings],
    );

    return (
        <DockviewReact
            className={theme === "dark" ? "dockview-theme-dark" : "dockview-theme-light"}
            components={COMPONENTS}
            onReady={onReady}
            rightHeaderActionsComponent={RightHeaderActions}
        />
    );
}
