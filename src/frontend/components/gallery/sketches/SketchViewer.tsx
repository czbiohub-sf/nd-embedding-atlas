/**
 * Sketch viewer — entry point for evaluating gallery sketches in dev.
 *
 * Mounts when `window.location.hash` starts with `#gallery-sketches`.
 * URL formats:
 *   #gallery-sketches      → defaults to sketch A
 *   #gallery-sketches/a    → bottom drawer
 *   #gallery-sketches/b    → side dock panel
 *   #gallery-sketches/c    → floating inspector
 *
 * Wired into `main.tsx` so sketches render without booting the
 * Dashboard / GPU scatter / DuckDB stack.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "../../../ThemeProvider";
import { TooltipProvider } from "../../ui/tooltip";
import { SketchA_BottomDrawer } from "./SketchA_BottomDrawer";
import { SketchB_DockPanel } from "./SketchB_DockPanel";
import { SketchC_FloatingInspector } from "./SketchC_FloatingInspector";

type SketchKey = "a" | "b" | "c";

const SKETCHES: { key: SketchKey; title: string; subtitle: string; component: React.ComponentType }[] = [
  {
    key: "a",
    title: "A — Bottom drawer",
    subtitle: "peek + dismiss",
    component: SketchA_BottomDrawer,
  },
  {
    key: "b",
    title: "B — Side dock",
    subtitle: "persistent workspace",
    component: SketchB_DockPanel,
  },
  {
    key: "c",
    title: "C — Floating inspector",
    subtitle: "FOV-grouped, glass overlay",
    component: SketchC_FloatingInspector,
  },
];

function readHashKey(): SketchKey {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("/");
  const candidate = parts[1];
  if (candidate === "a" || candidate === "b" || candidate === "c") return candidate;
  return "a";
}

export function isSketchRoute(): boolean {
  return window.location.hash.startsWith("#gallery-sketches");
}

export function SketchViewer() {
  const [active, setActive] = useState<SketchKey>(() => readHashKey());

  useEffect(() => {
    const onHashChange = () => setActive(readHashKey());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const Component = SKETCHES.find((s) => s.key === active)?.component ?? SketchA_BottomDrawer;

  return (
    <ThemeProvider>
      <TooltipProvider delay={400}>
        <div className="dark flex h-full w-full flex-col bg-base">
          <header className="flex h-9 shrink-0 items-center gap-3 border-border-subtle border-b bg-card px-3 select-none">
            <span className="font-medium text-foreground/90 text-xs">Lasso gallery sketches</span>
            <span className="font-mono text-muted-foreground/70 text-3xs">issue #62 · ui/lasso-gallery</span>
            <nav className="ml-3 flex items-center gap-0.5">
              {SKETCHES.map((s) => {
                const isActive = active === s.key;
                return (
                  <a
                    key={s.key}
                    href={`#gallery-sketches/${s.key}`}
                    className={cn(
                      "flex flex-col rounded-sm px-2 py-1 text-2xs transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "text-foreground/70 hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <span className="font-medium leading-tight">{s.title}</span>
                    <span
                      className={cn(
                        "text-3xs leading-tight",
                        isActive ? "text-primary/70" : "text-muted-foreground/60",
                      )}
                    >
                      {s.subtitle}
                    </span>
                  </a>
                );
              })}
            </nav>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = "";
                window.location.reload();
              }}
              className="ml-auto text-muted-foreground/70 text-2xs underline-offset-2 hover:text-foreground hover:underline"
            >
              ← back to app
            </a>
          </header>
          <main className="flex-1 min-h-0">
            <Component />
          </main>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
