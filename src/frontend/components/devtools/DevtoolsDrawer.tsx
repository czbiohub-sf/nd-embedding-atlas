/**
 * DevtoolsDrawer — tabbed devtools floating card. Open/size driven by the panel
 * registry (`usePanel("devtools")`); shares the bottom slot with the table.
 * Tabs: Query | Scatter (live store state) | Render (point opacity, HDR, blend mode etc.)
 */

import { LogsIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { cn } from "../../lib/utils";
import { usePanel } from "../../stores/panelRegistry";
import { useTheme } from "../../ThemeProvider";
import { SlidePanel } from "../ui/slide-panel";
import { RenderSettingsPlugin } from "./RenderSettingsPlugin";
import { ScatterStatePlugin } from "./ScatterStatePlugin";

const ReactQueryDevtoolsPanel = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtoolsPanel })),
);

type Tab = "query" | "scatter" | "render";

export function DevtoolsDrawer() {
  const [tab, setTab] = useState<Tab>("query");
  const { setOpen } = usePanel("devtools");
  const { theme } = useTheme();
  const onClose = () => setOpen(false);

  return (
    <SlidePanel id="devtools">
      <SlidePanel.Content>
        <SlidePanel.ResizeHandle />
        <SlidePanel.Header icon={LogsIcon} className="gap-0 py-1.5 pr-2 pl-3">
          <div className="flex items-center gap-0.5">
            {(["query", "scatter", "render"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-sm px-2.5 py-1 font-mono text-2xs transition-colors",
                  tab === t ? "bg-accent text-foreground" : "text-foreground/40 hover:text-foreground/70",
                )}
              >
                {t === "query" ? "Query" : t === "scatter" ? "Scatter State" : "Render"}
              </button>
            ))}
          </div>
        </SlidePanel.Header>

        <SlidePanel.Body>
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
        </SlidePanel.Body>
      </SlidePanel.Content>
    </SlidePanel>
  );
}
