import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Maximize2, Minimize2, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
// eslint-disable-next-line import/no-unassigned-import
import "dockview-react/dist/styles/dockview.css";
import { PluginMount } from "../../core/layout/plugin-mount";
import { registerPlugins } from "../../plugins";
import { useTheme } from "../../ThemeProvider";

// Register plugin metadata once, before any panel renders. Engine code stays
// lazy (each descriptor's Component is behind `load() => import()`).
registerPlugins();

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
        "group flex h-full select-none items-center gap-2 border-border border-r px-3 font-medium text-2xs transition-colors",
        isActive ? "bg-elevated text-foreground" : "bg-card text-muted-foreground hover:text-muted-foreground",
      ].join(" ")}
    >
      <span>{api.title}</span>
      <button
        type="button"
        className="hover:!opacity-100 flex h-3.5 w-3.5 items-center justify-center rounded opacity-0 transition-opacity hover:text-foreground group-hover:opacity-60"
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
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
      {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    </button>
  );
}

// ── Panel component registry ─────────────────────────────────────────────
// Each Dockview component now routes through the unified <PluginMount>, which
// looks up the descriptor, lazy-loads the engine chunk in <Suspense>, builds the
// PluginHost, and wraps the Component in PanelErrorBoundary. The Dockview panel
// id is the instanceId; `props.api` is threaded through as the PanelContext.
const COMPONENTS = {
  scatter: (props: IDockviewPanelProps) => {
    const obsmKey = (props.params as { initialObsmKey?: string } | undefined)?.initialObsmKey ?? null;
    return (
      <PluginMount
        id="scatter"
        panel={{ id: props.api.id, title: props.api.title, panelApi: props.api }}
        config={{ obsmKey, colorByColumn: null }}
      />
    );
  },
  table: (props: IDockviewPanelProps) => (
    <PluginMount id="table" panel={{ id: props.api.id, title: props.api.title, panelApi: props.api }} />
  ),
  "image-viewer": (props: IDockviewPanelProps<{ datasetKey?: string }>) => (
    <PluginMount
      id="image-viewer"
      panel={{ id: props.api.id, title: props.api.title, panelApi: props.api }}
      config={{ datasetKey: props.params?.datasetKey ?? null }}
    />
  ),
  charts: (props: IDockviewPanelProps) => (
    <PluginMount id="charts" panel={{ id: props.api.id, title: props.api.title, panelApi: props.api }} />
  ),
};

const STORAGE_KEY = "ndea_layout_v3"; // v3: obssets panel removed (Collections lives in Mod+B sheet)

// ── Default layout ───────────────────────────────────────────────────────

function loadDefaultLayout(api: DockviewApi, hasEmbeddings: boolean) {
  // Scatter panel — only when embeddings exist
  if (hasEmbeddings) {
    api.addPanel({
      id: "scatter",
      component: "scatter",
      title: "Embedding",
    });
  }

  // Table lives in TerminalTable (fixed ⌘J panel), not in Dockview

  // Image viewer is NOT added by default — user opens it via ⌘K or BottomDock.
  // Charts panel temporarily removed from default layout (⌘K will add them later)
}

// ── DockviewShell ────────────────────────────────────────────────────────

interface Props {
  hasPlate: boolean;
  hasEmbeddings: boolean;
  onApiReady?: (api: DockviewApi) => void;
}

export function DockviewShell({ hasPlate: _hasPlate, hasEmbeddings, onApiReady }: Props) {
  const { theme } = useTheme();
  const apiRef = useRef<DockviewApi | null>(null);

  // Persist layout changes to localStorage
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return () => {};
    const disposable = api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
      } catch {
        // Silently ignore serialization errors
      }
    });
    return () => {
      disposable.dispose();
    };
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
          // Note: image-viewer is intentionally excluded — user opens it on demand.
          const basePanels = hasEmbeddings ? ["scatter"] : [];
          const expectedPanels = [...basePanels];
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

      loadDefaultLayout(event.api, hasEmbeddings);
    },
    [hasEmbeddings, onApiReady],
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
