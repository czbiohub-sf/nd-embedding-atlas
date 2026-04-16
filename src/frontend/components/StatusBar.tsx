/**
 * StatusBar — vim-style bottom gutter showing real-time scatter metrics.
 *
 * Layout: [app name · embedding · mode] ── spacer ── [obs · sel · zoom · fps · ⌘K]
 */
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useScatterUIState } from "./scatter/ScatterUIStateProvider";

function Dot() {
    return (
        <span className="mx-1.5" style={{ color: "var(--color-border-active)" }}>
            ·
        </span>
    );
}

export function StatusBar() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { theme, toggle } = useTheme();
    const { fps, zoom, selectedCount, embeddingKey, numPoints } = useScatterUIState();

    return (
        <div className="status-bar">
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

            <span style={{ fontVariantNumeric: "tabular-nums" }}>{zoom.toFixed(1)}×</span>

            {fps !== null && (
                <>
                    <Dot />
                    <span style={{ color: "var(--color-text-muted)" }}>{Math.round(fps)} fps</span>
                </>
            )}

            <Dot />
            <span style={{ color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>⌘K</span>

            {/* ── Theme toggle ── */}
            <button
                onClick={toggle}
                className="ml-3 flex items-center justify-center rounded"
                style={{
                    width: 18,
                    height: 18,
                    color: "var(--color-text-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                }}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
                {theme === "dark" ? <SunIcon size={12} /> : <MoonIcon size={12} />}
            </button>
        </div>
    );
}
