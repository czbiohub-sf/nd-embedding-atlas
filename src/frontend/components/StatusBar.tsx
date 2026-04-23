/**
 * StatusBar — vim-style bottom gutter showing real-time scatter metrics.
 *
 * Layout: [app name · embedding · mode] ── spacer ── [obs · sel · zoom · fps · ⌘K]
 */
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { cn } from "../lib/utils";
import { useScatterUIState } from "./scatter/ScatterUIStateProvider";

function Dot() {
  return <span className="mx-1.5 text-border-active">·</span>;
}

export function StatusBar() {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { theme, toggle } = useTheme();
  const { fps, zoom, selectedCount, embeddingKey, numPoints } = useScatterUIState();

  return (
    <div className="status-bar">
      {/* ── Left: branding + context ── */}
      <span className="font-medium text-text-secondary">ndea</span>

      {embeddingKey && (
        <>
          <Dot />
          <span className="text-text-muted">{embeddingKey.replace(/^X_/, "")}</span>
        </>
      )}

      {/* ── Spacer ── */}
      <span className="flex-1" />

      {/* ── Right: metrics ── */}
      {numPoints > 0 && (
        <>
          <span className="text-text-secondary">{numPoints.toLocaleString()} obs</span>
          <Dot />
        </>
      )}

      {selectedCount !== null && selectedCount > 0 && (
        <>
          <span className="text-accent-cyan">{selectedCount.toLocaleString()} sel</span>
          <Dot />
        </>
      )}

      <span className="tabular-nums">{zoom.toFixed(1)}×</span>

      {fps !== null && (
        <>
          <Dot />
          <span className="text-text-muted">{Math.round(fps)} fps</span>
        </>
      )}

      <Dot />
      <span className="text-text-muted tracking-[0.05em]">⌘K</span>

      {/* ── Theme toggle ── */}
      <button
        onClick={toggle}
        className={cn(
          "ml-3 flex size-[18px] shrink-0 cursor-pointer items-center justify-center",
          "rounded border-none bg-transparent p-0 text-text-muted",
        )}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? <SunIcon size={12} /> : <MoonIcon size={12} />}
      </button>
    </div>
  );
}
