/**
 * vgplot body: imperative, non-React (see `core/node/non-react-body.fixture.ts`).
 * A React body would need a bridge for `host.filter.selection` (a Selection that
 * mutates in place) and for vgplot's own DOM ownership; both are cheaper done
 * by hand. The registry conformance test rejects a `Component` export, so this
 * module must stay framework-free.
 *
 * Control strip mirrors `charts/core/field-picker.tsx` imperatively (same
 * classes, same per-variant column kinds; `listColumns` already applies the
 * `__row_index__` skip). The host has no config-change subscription, so every
 * `patchConfig` here re-renders from its own call site.
 */

import type { MountedNodeBody } from "@ndea/sdk";
import type { AppNodeHost } from "@/core/node/app-node-host";
import type { ColumnType } from "@/hooks/useColumnTypes";
import { publishChartFilter } from "@/nodes/charts/core/routing";
import { mountPlot, type MountedPlot } from "./plot-host";
import type { VgplotCapabilities } from "./plugin";
import {
  MARK_PRESETS,
  PRESET_COLUMN_KINDS,
  buildEntries,
  describeEntries,
  listColumns,
  type MarkPreset,
  type VgplotConfig,
} from "./spec-schema";

type Host = AppNodeHost<VgplotConfig, VgplotCapabilities>;

const PRESET_LABELS: Record<MarkPreset, string> = {
  histogram: "Histogram",
  count: "Count",
};

const SELECT_CLASS =
  "w-full rounded-sm border border-border bg-card px-1.5 py-1 font-mono text-2xs text-muted-foreground";
const CLEAR_CLASS =
  "shrink-0 rounded-sm border border-border bg-card px-2 py-1 font-mono text-2xs text-muted-foreground hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-40";
const NOTE_CLASS = "px-1 py-2 text-2xs text-muted-foreground/60";
const ERROR_CLASS = "px-1 py-2 text-2xs text-destructive";

/** Coalesce a resize drag into one remount; a plot per frame would thrash DuckDB. */
const RESIZE_DEBOUNCE_MS = 150;
/** Ignore sub-pixel jitter from the dock's flex layout. */
const RESIZE_EPSILON_PX = 2;
/** Used only when the dock reports a zero content height (fullscreen transitions). */
const FALLBACK_HEIGHT_PX = 160;

export async function mountVgplotBody(host: Host): Promise<MountedNodeBody> {
  let columns: Map<string, ColumnType> | null = null;
  let columnsError: string | null = null;
  try {
    columns = await listColumns(host.data.coordinator);
  } catch (error) {
    columnsError = error instanceof Error ? error.message : String(error);
  }

  const element = document.createElement("div");
  element.className = "flex h-full min-h-0 w-full flex-col gap-1.5 bg-card p-2";

  const controls = document.createElement("div");
  controls.className = "flex shrink-0 gap-1.5";
  element.appendChild(controls);

  const fieldSelect = document.createElement("select");
  fieldSelect.className = SELECT_CLASS;
  const presetSelect = document.createElement("select");
  presetSelect.className = SELECT_CLASS;
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = CLEAR_CLASS;
  clearButton.textContent = "Clear";
  clearButton.title = "Clear selection";
  clearButton.disabled = true;
  controls.append(fieldSelect, presetSelect, clearButton);

  const plotHost = document.createElement("div");
  plotHost.className = "min-h-0 flex-1 overflow-hidden";
  element.appendChild(plotHost);

  // `host.config` is the source of truth on mount; entries are the only place
  // the picked field/preset survive a reload.
  const restored = describeEntries(host.config.entries);
  let preset: MarkPreset = restored?.preset ?? "histogram";
  let field: string | null = restored?.field ?? null;

  let activePlot: MountedPlot | null = null;
  let disposed = false;
  let renderSeq = 0;
  let resizeTimer: number | null = null;
  // -1 forces the observer's first callback through the epsilon gate.
  let lastWidth = -1;
  let lastHeight = -1;

  function eligibleColumns(): string[] {
    if (!columns) return [];
    const kinds = PRESET_COLUMN_KINDS[preset];
    return [...columns.entries()].filter(([, kind]) => kinds.includes(kind)).map(([name]) => name);
  }

  function renderControls(): void {
    fieldSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.textContent = columnsError ? "Columns unavailable" : "Pick a column…";
    fieldSelect.appendChild(placeholder);
    for (const name of eligibleColumns()) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      fieldSelect.appendChild(option);
    }
    fieldSelect.value = field ?? "";

    presetSelect.replaceChildren();
    for (const name of MARK_PRESETS) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = PRESET_LABELS[name];
      presetSelect.appendChild(option);
    }
    presetSelect.value = preset;
  }

  function showNote(text: string, className: string): void {
    const note = document.createElement("div");
    note.className = className;
    note.textContent = text;
    plotHost.replaceChildren(note);
  }

  async function render(): Promise<void> {
    if (disposed) return;
    const seq = ++renderSeq;

    activePlot?.dispose();
    activePlot = null;

    if (columnsError) {
      showNote(`Could not load columns: ${columnsError}`, ERROR_CLASS);
      return;
    }
    if (field == null) {
      showNote("Pick a column to plot.", NOTE_CLASS);
      return;
    }

    const width = Math.round(plotHost.clientWidth);
    // width=0 means the dock has not laid us out yet (or we are detached
    // mid-reparent). Bail without recording the size; the ResizeObserver fires
    // again with a real width. Rendering at 0 strands the plot at 0 forever.
    if (width <= 0) {
      plotHost.replaceChildren();
      return;
    }
    const height = Math.round(plotHost.clientHeight) || FALLBACK_HEIGHT_PX;

    try {
      const mounted = await mountPlot({
        coordinator: host.data.coordinator,
        table: host.data.table,
        entries: buildEntries(preset, field),
        attributes: host.config.attributes,
        scope: host.filter.selection,
        registerClient: (client) => host.registerClient(client),
        width,
        height,
        onSelection: (sql) => {
          if (disposed || seq !== renderSeq) return;
          clearButton.disabled = sql === null;
          publishChartFilter(host, sql);
        },
      });
      if (disposed || seq !== renderSeq) {
        // Superseded (or torn down) while awaiting: never leak the plot.
        mounted.dispose();
        return;
      }
      activePlot = mounted;
      plotHost.replaceChildren(mounted.element);
      lastWidth = width;
      lastHeight = height;
    } catch (error) {
      if (disposed || seq !== renderSeq) return;
      // No PanelErrorBoundary behind a non-React body: surface it here or the
      // node just sits blank.
      showNote(`Plot failed: ${error instanceof Error ? error.message : String(error)}`, ERROR_CLASS);
    }
  }

  function applySelection(nextPreset: MarkPreset, nextField: string | null): void {
    preset = nextPreset;
    field = nextField;
    // This body remounts the plot below, so drop the stale published filter
    // (matches HistogramBody's clear-on-field-change).
    publishChartFilter(host, null);
    host.patchConfig({ entries: field == null ? [] : buildEntries(preset, field) });
    renderControls();
    void render();
  }

  fieldSelect.addEventListener("change", () => {
    const next = fieldSelect.value;
    if (!next || next === field) return;
    applySelection(preset, next);
  });

  presetSelect.addEventListener("change", () => {
    const next = presetSelect.value as MarkPreset;
    if (next === preset) return;
    // Keep the field only if the new preset can plot that column kind.
    const kind = field == null ? undefined : columns?.get(field);
    const keep = kind !== undefined && PRESET_COLUMN_KINDS[next].includes(kind);
    applySelection(next, keep ? field : null);
  });

  function clearSelection(): void {
    activePlot?.clearSelection();
  }

  clearButton.addEventListener("click", clearSelection);

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry || disposed) return;
    const width = Math.round(entry.contentRect.width);
    const height = Math.round(entry.contentRect.height);
    if (width <= 0) return;
    if (Math.abs(width - lastWidth) < RESIZE_EPSILON_PX && Math.abs(height - lastHeight) < RESIZE_EPSILON_PX) return;
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      void render();
    }, RESIZE_DEBOUNCE_MS);
  });
  observer.observe(plotHost);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    observer.disconnect();
    activePlot?.dispose();
    activePlot = null;
    element.remove();
  }
  // Belt and braces: the observer and the plot can never outlive the node even
  // if the runtime drops this body without calling dispose().
  host.onDispose(dispose);

  renderControls();
  // The observer's first callback drives the initial plot once the dock has
  // given us a width; render now only for the states that need no layout.
  if (columnsError || field == null) void render();

  return { element, dispose };
}
