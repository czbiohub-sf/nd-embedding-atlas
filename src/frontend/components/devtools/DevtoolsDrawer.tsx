/**
 * DevtoolsDrawer — tabbed devtools panel that slides up from the bottom dock.
 * Tabs: Query | Scatter (live store state) | Render (point opacity, HDR, blend mode etc.)
 */

import { lazy, Suspense, useState } from "react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../ThemeProvider";
import { RenderSettingsPlugin } from "./RenderSettingsPlugin";
import { ScatterStatePlugin } from "./ScatterStatePlugin";

const ReactQueryDevtoolsPanel = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtoolsPanel })),
);

type Tab = "query" | "scatter" | "render";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DevtoolsDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("query");
  const { theme } = useTheme();

  if (!open) return null;

  return (
    <div className="flex flex-col border-border border-t bg-card" style={{ height: 380 }}>
      {/* Tab bar */}
      <div className="flex h-8 shrink-0 items-center border-glass-border border-b bg-card px-2">
        {(["query", "scatter", "render"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-sm px-3 py-1 font-mono text-2xs transition-colors",
              tab === t ? "bg-accent text-foreground" : "text-foreground/30 hover:text-foreground/60",
            )}
          >
            {t === "query" ? "Query" : t === "scatter" ? "Scatter State" : "Render"}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto px-2 text-2xs text-foreground/20 transition-colors hover:text-foreground/60"
        >
          ✕
        </button>
      </div>

      {/* Panel content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "query" && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-foreground/30 text-xs">
                Loading...
              </div>
            }
          >
            <ReactQueryDevtoolsPanel onClose={onClose} style={{ height: "100%", width: "100%" }} theme={theme} />
          </Suspense>
        )}
        {tab === "scatter" && <ScatterStatePlugin />}
        {tab === "render" && <RenderSettingsPlugin />}
      </div>
    </div>
  );
}
