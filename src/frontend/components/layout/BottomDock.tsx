/**
 * BottomDock — 20px navigation + status bar.
 *
 * Replaces both Dockview tab headers and StatusFooter.
 * Scatter panels shown as colored dots only (no labels).
 * Table/viewer as minimal icons.
 */

import { useStore } from "@tanstack/react-store";
import type { DockviewApi } from "dockview-react";
import {
  BookmarkIcon,
  ChevronRightIcon,
  DatabaseIcon,
  LogsIcon,
  MoonIcon,
  ScanIcon,
  SunIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { POINT_RADIUS_MAX, POINT_RADIUS_MIN, pointRadiusStore, setPointRadius } from "../../stores/PointRadiusStore";
import { openDatasetViewerPiP } from "../../stores/ViewerPiPStore";
import { useTheme } from "../../ThemeProvider";
import { useScatterUIState } from "../scatter/ScatterUIStateProvider";
import { useTerminalTable } from "../table/TerminalTableProvider";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// ── Point size slider ─────────────────────────────────────────────────────
function PointSizeSlider() {
  const radius = useStore(pointRadiusStore, (s) => s.radius);
  const pct = (radius - POINT_RADIUS_MIN) / (POINT_RADIUS_MAX - POINT_RADIUS_MIN);

  return (
    <div className="flex items-center gap-1.5">
      <span className="select-none text-[9px] text-muted-foreground/50">●</span>
      <input
        type="range"
        min={POINT_RADIUS_MIN}
        max={POINT_RADIUS_MAX}
        step={0.0001}
        value={radius}
        onChange={(e) => setPointRadius(parseFloat(e.target.value))}
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:size-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground/60 [&::-webkit-slider-thumb]:transition-colors hover:[&::-webkit-slider-thumb]:bg-foreground"
        style={{
          background: `linear-gradient(to right, oklch(0.585 0.233 277.117 / 60%) ${pct * 100}%, oklch(1 0 0 / 10%) ${pct * 100}%)`,
        }}
        aria-label="Point size"
        title="Point size"
      />
    </div>
  );
}

// ── Panel color palette (scatter panels in order of creation) ────────────
const SCATTER_COLORS = [
  "oklch(0.585 0.233 277.117)", // purple — primary
  "oklch(0.65 0.18 140)", // green
  "oklch(0.75 0.18 45)", // amber
  "oklch(0.65 0.18 20)", // rose
];

function colorForIndex(i: number): string {
  return SCATTER_COLORS[i % SCATTER_COLORS.length];
}

interface PanelEntry {
  id: string;
  component: string;
  title: string;
  colorIndex?: number; // only for scatter
}

interface Props {
  dockviewApi: DockviewApi | null;
  onAddScatter: () => void;
  onCloseViewer?: () => void;
  onFloatViewer?: () => void;
  hasPlate?: boolean;
  devtoolsOpen?: boolean;
  onToggleDevtools?: () => void;
  /** Dataset keys for multi-dataset mode — renders per-dataset viewer buttons. */
  datasetKeys?: string[];
}

export function BottomDock({
  dockviewApi,
  onAddScatter,
  onCloseViewer,
  onFloatViewer,
  hasPlate,
  devtoolsOpen,
  onToggleDevtools,
  datasetKeys,
}: Props) {
  const { fps, zoom, selectedCount, numPoints, statusMsg } = useScatterUIState();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { toggle: toggleTable, open: tableOpen } = useTerminalTable();
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { theme, toggle: toggleTheme } = useTheme();

  const [panels, setPanels] = useState<PanelEntry[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const scatterColorMapRef = useRef(new Map());
  const scatterCounterRef = useRef(0);

  // Track panel additions, removals, and active changes
  useEffect(() => {
    const api = dockviewApi;
    if (!api) return;

    function buildPanels() {
      const entries: PanelEntry[] = api!.panels.map((p) => {
        const isScatter = p.id === "scatter" || p.id.startsWith("scatter-");
        let colorIndex: number | undefined;
        if (isScatter) {
          if (!scatterColorMapRef.current.has(p.id)) {
            scatterColorMapRef.current.set(p.id, scatterCounterRef.current++);
          }
          colorIndex = scatterColorMapRef.current.get(p.id);
        }
        return { id: p.id, component: p.id, title: p.title ?? p.id, colorIndex };
      });
      setPanels(entries);
    }

    buildPanels();
    setActivePanelId(api.activePanel?.id ?? null);

    const subs = [
      api.onDidAddPanel(() => buildPanels()),
      api.onDidRemovePanel((e) => {
        scatterColorMapRef.current.delete(e.id);
        buildPanels();
      }),
      api.onDidActivePanelChange((e) => setActivePanelId(e?.id ?? null)),
    ];

    return () => subs.forEach((s) => s.dispose());
  }, [dockviewApi]);

  const scatterPanels = panels.filter((p) => p.colorIndex !== undefined);
  const hasTable = panels.some((p) => p.id === "table");
  const hasViewer = panels.some((p) => p.id === "image-viewer");
  const hasObsSets = panels.some((p) => p.id === "obssets");

  function openObsSets() {
    if (hasObsSets) {
      activate("obssets");
    } else {
      dockviewApi?.addPanel({ id: "obssets", component: "obssets", title: "Obs Sets" });
    }
  }

  function activate(id: string) {
    dockviewApi?.getPanel(id)?.focus();
  }

  return (
    <div className="flex h-6 shrink-0 items-center gap-0 border-white/[0.07] border-t bg-card/80 px-2 text-[11px] text-muted-foreground backdrop-blur-md">
      {/* ── Scatter dots ── */}
      {scatterPanels.map((p) => (
        <Tooltip key={p.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => activate(p.id)}
                className="mx-0.5 flex size-4 items-center justify-center rounded-sm transition-opacity hover:opacity-100"
                style={{ opacity: activePanelId === p.id ? 1 : 0.4 }}
              />
            }
          >
            <span
              className="block rounded-full transition-all"
              style={{
                width: activePanelId === p.id ? 7 : 5,
                height: activePanelId === p.id ? 7 : 5,
                background: colorForIndex(p.colorIndex!),
                boxShadow: activePanelId === p.id ? `0 0 6px 1px ${colorForIndex(p.colorIndex!)}40` : "none",
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top">{p.title}</TooltipContent>
        </Tooltip>
      ))}

      {/* Add scatter */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onAddScatter}
              className="mx-0.5 flex size-4 items-center justify-center rounded-sm text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            />
          }
        >
          +
        </TooltipTrigger>
        <TooltipContent side="top">New scatter (⌘K)</TooltipContent>
      </Tooltip>

      {<Separator orientation="vertical" className="mx-1.5 h-3" />}

      {/* ObsSets panel toggle */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={openObsSets}
              className={cn(
                "mx-0.5 flex size-4 items-center justify-center rounded-sm transition-colors",
                hasObsSets && activePanelId === "obssets"
                  ? "text-foreground"
                  : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
            />
          }
        >
          <BookmarkIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">Obs Sets</TooltipContent>
      </Tooltip>

      {/* Table icon */}
      {hasTable && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => activate("table")}
                className={cn(
                  "mx-0.5 flex size-4 items-center justify-center rounded-sm transition-colors",
                  activePanelId === "table"
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
                )}
              />
            }
          >
            <TableIcon className="size-3" />
          </TooltipTrigger>
          <TooltipContent side="top">Table</TooltipContent>
        </Tooltip>
      )}

      {/* Single-dataset viewer button (unchanged exact-match guard) */}
      {!datasetKeys?.length && hasViewer && (
        <div className="mx-0.5 flex items-center gap-px">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => activate("image-viewer")}
                  className={cn(
                    "flex size-4 items-center justify-center rounded-sm transition-colors",
                    activePanelId === "image-viewer"
                      ? "text-foreground"
                      : "text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                />
              }
            >
              <ScanIcon className="size-3" />
            </TooltipTrigger>
            <TooltipContent side="top">Image Viewer</TooltipContent>
          </Tooltip>
          {onCloseViewer && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onCloseViewer}
                    className="flex size-3.5 items-center justify-center rounded-sm text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                  />
                }
              >
                <XIcon className="size-2.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Close viewer</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Multi-dataset viewer buttons — one per dataset key */}
      {datasetKeys &&
        datasetKeys.length > 1 &&
        datasetKeys.map((key) => {
          return (
            <Tooltip key={key}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => openDatasetViewerPiP(key)}
                    className="mx-0.5 flex size-4 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  />
                }
              >
                <ScanIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent side="top">{key}</TooltipContent>
            </Tooltip>
          );
        })}

      {hasPlate && onFloatViewer && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onFloatViewer}
                aria-label="Float Image Viewer"
                className="relative mx-0.5 flex size-4 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              />
            }
          >
            <ScanIcon className="size-3" />
            <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary/70" />
          </TooltipTrigger>
          <TooltipContent side="top">Float Image Viewer</TooltipContent>
        </Tooltip>
      )}

      {/* ── Point size slider ── */}
      <Separator orientation="vertical" className="mx-1.5 h-3" />
      <PointSizeSlider />
      {/* ── Spacer ── */}
      <span className="flex-1" />

      {/* ── Status message (e.g. materializing var column) ── */}
      {statusMsg && (
        <>
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-muted-foreground/80">{statusMsg}</span>
          <span className="mx-1 text-muted-foreground/60">·</span>
        </>
      )}

      {/* ── Metrics ── */}
      {numPoints > 0 && <span className="text-muted-foreground tabular-nums">{numPoints.toLocaleString()}</span>}
      {selectedCount !== null && selectedCount > 0 && (
        <>
          <span className="mx-1 text-muted-foreground/60">·</span>
          <span className="tabular-nums" style={{ color: "oklch(0.585 0.233 277.117 / 80%)" }}>
            {selectedCount.toLocaleString()} sel
          </span>
        </>
      )}
      {zoom !== 1 && (
        <>
          <span className="mx-1 text-muted-foreground/60">·</span>
          <span className="text-muted-foreground tabular-nums">{zoom.toFixed(1)}×</span>
        </>
      )}
      {fps !== null && (
        <>
          <span className="mx-1 text-muted-foreground/60">·</span>
          <span className="text-muted-foreground/75 tabular-nums">{Math.round(fps)}fps</span>
        </>
      )}

      <Separator orientation="vertical" className="mx-2 h-3" />

      {/* ⌘K */}
      <Tooltip>
        <TooltipTrigger render={<span className="cursor-default text-muted-foreground/75" />}>
          <ChevronRightIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">Commands ⌘K</TooltipContent>
      </Tooltip>

      {/* ⌘J table drawer */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={toggleTable}
              aria-label="Toggle table (⌘J)"
              className={cn(
                "ml-2 flex items-center gap-1 transition-colors",
                tableOpen ? "text-foreground" : "text-muted-foreground/75 hover:text-muted-foreground",
              )}
            />
          }
        >
          <DatabaseIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">Table ⌘J</TooltipContent>
      </Tooltip>

      {/* Devtools toggle */}
      {onToggleDevtools && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onToggleDevtools}
                aria-label="Toggle devtools"
                className={cn(
                  "ml-1 flex size-4 items-center justify-center transition-colors",
                  devtoolsOpen ? "text-primary" : "text-muted-foreground/75 hover:text-muted-foreground",
                )}
              />
            }
          >
            <LogsIcon className="size-3" />
          </TooltipTrigger>
          <TooltipContent side="top">Devtools</TooltipContent>
        </Tooltip>
      )}

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="ml-1 flex size-4 items-center justify-center text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <SunIcon className="size-2.5" /> : <MoonIcon className="size-2.5" />}
      </button>
    </div>
  );
}
