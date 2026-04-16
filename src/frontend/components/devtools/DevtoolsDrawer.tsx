/**
 * DevtoolsDrawer — tabbed devtools panel that slides up from the bottom dock.
 * Tabs: Query (ReactQueryDevtoolsPanel) | Scatter (live store state)
 */

import { lazy, Suspense, useState } from "react";
import { cn } from "../../lib/utils";
import { ScatterStatePlugin } from "./ScatterStatePlugin";

const ReactQueryDevtoolsPanel = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtoolsPanel })),
);

type Tab = "query" | "scatter";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DevtoolsDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("query");

  if (!open) return null;

  return (
    <div className="flex flex-col border-border border-t" style={{ height: 380, background: "oklch(0.10 0 0)" }}>
      {/* Tab bar */}
      <div className="flex h-8 shrink-0 items-center border-white/5 border-b bg-[#0d0d14] px-2">
        {(["query", "scatter"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-sm px-3 py-1 font-mono text-[11px] transition-colors",
              tab === t ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60",
            )}
          >
            {t === "query" ? "Query" : "Scatter State"}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto px-2 text-[11px] text-white/20 transition-colors hover:text-white/60"
        >
          ✕
        </button>
      </div>

      {/* Panel content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "query" && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-white/30 text-xs">Loading...</div>
            }
          >
            <ReactQueryDevtoolsPanel onClose={onClose} style={{ height: "100%", width: "100%" }} theme="dark" />
          </Suspense>
        )}
        {tab === "scatter" && <ScatterStatePlugin />}
      </div>
    </div>
  );
}
