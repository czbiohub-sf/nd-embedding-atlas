import {
    type DockviewApi,
    DockviewReact,
    type DockviewReadyEvent,
    type IDockviewHeaderActionsProps,
    type IDockviewPanelHeaderProps,
} from "dockview-react";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "dockview-react/dist/styles/dockview.css";
import { useTheme } from "../../providers/ThemeProvider";

import { ChartGroupPanel } from "./panels/ChartGroupPanel";
import { ImageViewerPanel } from "./panels/ImageViewerPanel";
import { ScatterPanel } from "./panels/ScatterPanel";
import { TablePanel } from "./panels/TablePanel";

// ── Custom tab ───────────────────────────────────────────────────────────

function CustomTab({ api }: IDockviewPanelHeaderProps) {
    const [isActive, setIsActive] = useState(api.isActive);

    useEffect(() => {
        const d = api.onDidActiveChange((e) => setIsActive(e.isActive));
        return () => d.dispose();
    }, [api]);

    return (
        <div
            className={[
                "group flex h-full items-center gap-2 px-3 text-[11px] font-medium select-none border-r border-border-subtle transition-colors",
                isActive
                    ? "bg-elevated text-text-primary"
                    : "bg-surface text-text-muted hover:text-text-secondary",
            ].join(" ")}
        >
            <span>{api.title}</span>
            <button
                type="button"
                className="flex items-center justify-center w-3.5 h-3.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-text-primary transition-opacity"
                onClick={(e) => { e.stopPropagation(); api.close(); }}
                aria-label="Close panel"
            >
                <XIcon size={10} strokeWidth={2} />
            </button>
        </div>
    );
}

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

    // Table lives in TerminalTable (fixed ⌘J panel), not in Dockview

    // Reference panel for the right sidebar
    const sidebarRef = hasEmbeddings ? "scatter" : undefined;

    if (hasPlate && sidebarRef) {
        api.addPanel({
            id: "image-viewer",
            component: "image-viewer",
            title: "Image Viewer",
            position: { referencePanel: sidebarRef, direction: "right" },
        });
    }
    // Charts panel temporarily removed from default layout (⌘K will add them later)
}

// ── DockviewShell ────────────────────────────────────────────────────────

interface Props {
    hasPlate: boolean;
    hasEmbeddings: boolean;
    onApiReady?: (api: DockviewApi) => void;
}

export function DockviewShell({ hasPlate, hasEmbeddings, onApiReady }: Props) {
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
            onApiReady?.(event.api);

            // Try to restore saved layout
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    event.api.fromJSON(JSON.parse(saved));

                    // Re-add any expected panels that were closed in a previous session
                    const basePanels = hasEmbeddings ? ["scatter"] : [];
                    const expectedPanels = hasPlate
                        ? [...basePanels, "image-viewer"]
                        : [...basePanels];
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
            defaultTabComponent={CustomTab}
            rightHeaderActionsComponent={RightHeaderActions}
        />
    );
}
