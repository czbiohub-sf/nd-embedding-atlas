/**
 * StatusFooter — fixed bottom gutter (replaces StatusBar).
 *
 * Same metrics as StatusBar plus a ⌘J button to toggle TerminalTable.
 * Height matches --footer-height CSS variable (1.5rem / 24px).
 */

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "../providers/ThemeProvider";
import { useScatterUIState } from "../providers/ScatterUIStateProvider";
import { useTerminalTable } from "../providers/TerminalTableProvider";

function Dot() {
  return <span className="mx-1.5" style={{ color: "var(--color-border-active)" }}>·</span>;
}

export function StatusFooter() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { fps, zoom, selectedCount, embeddingKey, numPoints } = useScatterUIState();
  const { toggle: toggleTable, open: tableOpen } = useTerminalTable();

  return (
    <div
      className="status-bar fixed bottom-0 left-0 right-0 z-50"
      style={{ height: "var(--footer-height, 1.5rem)" }}
    >
      {/* ── Left: branding + context ── */}
      <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>ndea</span>

      {embeddingKey && (
        <>
          <Dot />
          <span style={{ color: "var(--color-text-muted)" }}>
            {embeddingKey.replace(/^X_/, "")}
          </span>
        </>
      )}

      {/* ── Spacer ── */}
      <span className="flex-1" />

      {/* ── Right: metrics ── */}
      {numPoints > 0 && (
        <>
          <span style={{ color: "var(--color-text-secondary)" }}>
            {numPoints.toLocaleString()} obs
          </span>
          <Dot />
        </>
      )}

      {selectedCount !== null && selectedCount > 0 && (
        <>
          <span style={{ color: "var(--color-accent-cyan)" }}>
            {selectedCount.toLocaleString()} sel
          </span>
          <Dot />
        </>
      )}

      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {zoom.toFixed(1)}×
      </span>

      {fps !== null && (
        <>
          <Dot />
          <span style={{ color: "var(--color-text-muted)" }}>
            {Math.round(fps)} fps
          </span>
        </>
      )}

      <Dot />
      <span style={{ color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>⌘K</span>

      {/* ── ⌘J table toggle ── */}
      <button
        type="button"
        onClick={toggleTable}
        className="ml-2 flex items-center gap-0.5 rounded px-1"
        style={{
          color: tableOpen ? "var(--color-accent-cyan)" : "var(--color-text-muted)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: 11,
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}
        aria-label="Toggle table (⌘J)"
      >
        ⌘J
      </button>

      {/* ── Theme toggle ── */}
      <button
        onClick={toggleTheme}
        className="ml-1 flex items-center justify-center rounded"
        style={{
          width: 18, height: 18,
          color: "var(--color-text-muted)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark"
          ? <SunIcon size={12} />
          : <MoonIcon size={12} />
        }
      </button>
    </div>
  );
}
