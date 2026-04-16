/**
 * StatusFooter — fixed bottom gutter.
 * Height matches --footer-height CSS variable (1.5rem / 24px).
 */

import { MoonIcon, SunIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "../ThemeProvider";
import { useScatterUIState } from "./scatter/ScatterUIStateProvider";
import { useTerminalTable } from "./table/TerminalTableProvider";
import { Kbd, KbdGroup } from "./ui/kbd";

function Dot() {
    return <span className="mx-1.5 text-border-active">·</span>;
}

export function StatusFooter() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { theme, toggle: toggleTheme } = useTheme();
    const { fps, zoom, selectedCount, embeddingKey, numPoints } = useScatterUIState();
    const { toggle: toggleTable, open: tableOpen } = useTerminalTable();

    return (
        <div className="status-bar fixed right-0 bottom-0 left-0 z-50 h-[var(--footer-height,1.5rem)]">
            {/* ── Left: branding + context ── */}
            <span className="font-medium text-text-secondary">ndea</span>

            {embeddingKey && (
                <>
                    <Dot />
                    <span className="text-text-muted">{embeddingKey.replace(/^X_/, "")}</span>
                </>
            )}

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
            <KbdGroup className="gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
            </KbdGroup>

            {/* ── ⌘J table toggle ── */}
            <button
                type="button"
                onClick={toggleTable}
                className={cn(
                    "ml-2 shrink-0 rounded transition-colors",
                    tableOpen ? "text-accent-cyan" : "text-text-muted hover:text-text-secondary",
                )}
                aria-label="Toggle table (⌘J)"
            >
                <KbdGroup className="gap-0.5">
                    <Kbd className={cn(tableOpen && "bg-accent-cyan/20 text-accent-cyan")}>⌘</Kbd>
                    <Kbd className={cn(tableOpen && "bg-accent-cyan/20 text-accent-cyan")}>J</Kbd>
                </KbdGroup>
            </button>

            {/* ── Theme toggle ── */}
            <button
                type="button"
                onClick={toggleTheme}
                className="ml-1 flex size-[18px] shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-secondary"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
                {theme === "dark" ? <SunIcon size={12} /> : <MoonIcon size={12} />}
            </button>
        </div>
    );
}
