/**
 * Annotate node body: a TABLE-first labeling surface (one door, one node).
 *
 * Rows = the scoped obs (the wired predicate, delivered as `host.inputPredicate`
 * and consumed straight by `AnnotateTable`/`useTableQuery`: the same plumbing
 * the Table node uses, so it scopes off a Filter/Wrangle edge correctly).
 *
 * Two modes share the surface:
 *  - `label`: a vocabulary palette + hotkeys stamp the focused row / selection.
 *  - `range`: a min/max bracket instrument (`RangeBracket`) authors a numeric
 *    interval per obs, committed as two float columns `{metric}_min`/`_max`.
 *
 * Selection is SPREADSHEET-style (click / shift / ⌘). The focused (last-clicked)
 * row drives `host.focus.set`, so wired viewers (Idetik, Gallery) follow it.
 * A separate "all in scope" path writes server-side over the full predicate.
 *
 * Writes and reads go through `host.dataAPI` and the
 * coordinator. Stamps reflect instantly via a local overlay (`localLabels`).
 */

import type { RowIndex } from "@ndea/sdk";
import type { FilterExpr } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bracketed } from "@/components/ui/bracketed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { filterExprToExpr } from "@/lib/mosaic-helpers";
import { cn } from "@/lib/utils";
import { AnnotateTable, type CropFields, type FocusedCrop } from "@/nodes/annotate/AnnotateTable";
import { CommitPanel } from "@/nodes/annotate/CommitPanel";
import { RangeBracket } from "@/nodes/annotate/RangeBracket";
import { fmtVal } from "@/nodes/annotate/range-scale";
import { useGalleryChannels } from "@/nodes/table/useGalleryChannels";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import { useNodeFocus } from "@/core/node/use-node-focus";
import type { AnnotateCapabilities } from "./plugin";

export interface AnnotateConfig {
  column: string | null;
  labels: string[];
  /** "label" (default) = vocabulary palette; "range" = min/max bracket instrument. */
  mode?: "label" | "range";
}
export type AnnotateOptions = Record<never, never>;

const MAX_CONTEXT_COLS = 2;

/** One-key hotkey per label: first unused letter, else its 1-based digit. */
function hotkeysFor(labels: string[]): string[] {
  const used = new Set<string>();
  return labels.map((l, i) => {
    const c = l.trim()[0]?.toLowerCase();
    if (c && /[a-z]/.test(c) && !used.has(c)) {
      used.add(c);
      return c;
    }
    return String(i + 1);
  });
}

export function AnnotateView({ host }: NodeBodyProps<AnnotateConfig, AnnotateCapabilities>) {
  const { coordinator, table, metadata } = host.data;

  const [columns, setColumns] = useState<string[]>([]);
  const [column, setColumn] = useState<string | null>(host.config.column);
  const [newColumn, setNewColumn] = useState("");
  const [creating, setCreating] = useState(false);
  const [labelsText, setLabelsText] = useState((host.config.labels ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showCommit, setShowCommit] = useState(false);

  const [mode, setMode] = useState<"label" | "range">(host.config.mode ?? "label");
  const [rangeLo, setRangeLo] = useState<number | null>(null);
  const [rangeHi, setRangeHi] = useState<number | null>(null);

  // Per-obs, per-column overlay (id → column → value) so a write reflects
  // instantly. Range mode stamps BOTH `{m}_min` and `{m}_max` for the row.
  const [localLabels, setLocalLabels] = useState<Map<RowIndex, Map<string, string>>>(() => new Map());
  const [selection, setSelection] = useState<{
    selectedRowIndices: Set<RowIndex>;
    focusedRowIndex: RowIndex | null;
    focusedCrop: FocusedCrop | null;
  }>(() => ({ selectedRowIndices: new Set(), focusedRowIndex: null, focusedCrop: null }));
  const [total, setTotal] = useState(0);

  const labels = useMemo(
    () =>
      labelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [labelsText],
  );
  const hotkeys = useMemo(() => hotkeysFor(labels), [labels]);
  const targetColumn = newColumn.trim() || column;

  // range mode derives two float columns from the metric base name. `rangeReady`
  // gates on the ANNOTATION-COLUMNS list (created + server-registered into the
  // `dataset` VIEW), NOT `metadata.obs_columns`: the latter lags creation, so
  // the table never surfaced the pair until a manual re-scope.
  const rangeBase = (targetColumn ?? "").trim();
  const minCol = rangeBase ? `${rangeBase}_min` : null;
  const maxCol = rangeBase ? `${rangeBase}_max` : null;
  const rangeReady = !!(minCol && maxCol && columns.includes(minCol) && columns.includes(maxCol));
  const rangeInvalid = rangeLo != null && rangeHi != null && rangeLo > rangeHi;
  const rangeComplete = rangeLo != null && rangeHi != null && !rangeInvalid;

  // scope predicate (same path useTableQuery uses → works off Filter edges)
  const scopeExpr: FilterExpr | null = host.inputPredicate?.predicate?.(null) ?? null;
  const hasScope = scopeExpr != null;
  const contextColumns = useMemo(
    () =>
      (metadata.obs_columns ?? []).filter((c) => c !== targetColumn && !c.startsWith("__")).slice(0, MAX_CONTEXT_COLS),
    [metadata.obs_columns, targetColumn],
  );

  // gallery link: crop-locator columns + channels. Channels come from the shared
  // viewerChannelsStore (the "docked" slot), so thumbnails are contrasted/colored
  // identically to the Gallery node and the live viewer: change channels in one,
  // they change here too.
  const cropFields = useMemo<CropFields | null>(() => {
    const cols = metadata.obs_columns ?? [];
    if (!cols.includes("fov_name") || !cols.includes("t")) return null;
    return {
      fov: "fov_name",
      t: "t",
      dataset: cols.includes("_dataset") ? "_dataset" : undefined,
      x: cols.includes("x") ? "x" : undefined,
      y: cols.includes("y") ? "y" : undefined,
    };
  }, [metadata.obs_columns]);
  // Channels follow the focused obs's dataset slot: shared with the viewer/Gallery
  // via viewerChannelsStore, so live channel edits flow into the crops. Falls back
  // to "docked" (single-dataset stores) until a dataset is resolved.
  const channelSlot = selection.focusedCrop?.datasetKey ?? "docked";
  const { channels, hash } = useGalleryChannels(channelSlot, 300, metadata.plate_channels);

  // existing annotation columns
  useEffect(() => {
    let alive = true;
    void host.dataAPI
      .listAnnotationColumns?.()
      ?.then((cols) => alive && setColumns(cols.map((c) => c.name)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  // Follow an external focus (Gallery/Scatter/Idetik crop click): read the
  // group-aware host.focus reactively so the table can jump to that obs,
  // mirroring how those views already follow ours.
  const externalFocusedRowIndex = useNodeFocus(host);
  const publishUserFocus = useCallback((focusedRowIndex: RowIndex) => host.focus.set(focusedRowIndex), [host]);

  const persistLabels = useCallback(() => host.patchConfig({ labels }), [host, labels]);

  const setModePersist = useCallback(
    (m: "label" | "range") => {
      setMode(m);
      host.patchConfig({ mode: m });
    },
    [host],
  );

  const ensureColumn = useCallback(
    async (col: string) => {
      if (columns.includes(col)) return;
      await host.dataAPI.createAnnotationColumn?.(col);
      setColumns((c) => [...c, col]);
      setColumn(col);
      setNewColumn("");
      setCreating(false);
      host.patchConfig({ column: col });
    },
    [columns, host],
  );

  // stamp the current row selection (or focus row) with `value`
  const onStamp = useCallback(
    async (value: string) => {
      const ids = selection.selectedRowIndices.size
        ? [...selection.selectedRowIndices]
        : selection.focusedRowIndex != null
          ? [selection.focusedRowIndex]
          : [];
      if (!targetColumn || !value || !ids.length || busy) return;
      setBusy(true);
      try {
        await ensureColumn(targetColumn);
        await host.dataAPI.writeAnnotationByPredicate?.(targetColumn, value, `__row_index__ IN (${ids.join(", ")})`);
        setLocalLabels((m) => {
          const next = new Map(m);
          for (const id of ids) next.set(id, new Map([[targetColumn, value]]));
          return next;
        });
        persistLabels();
      } catch (err) {
        setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [selection, targetColumn, busy, ensureColumn, host, persistLabels],
  );

  // ── range mode: write {base}_min / {base}_max over a predicate ──
  const ensureRangeColumns = useCallback(
    async (base: string) => {
      const mn = `${base}_min`;
      const mx = `${base}_max`;
      if (!columns.includes(mn)) await host.dataAPI.createAnnotationColumn?.(mn, "float");
      if (!columns.includes(mx)) await host.dataAPI.createAnnotationColumn?.(mx, "float");
      setColumns((c) => [...new Set([...c, mn, mx])]);
      host.patchConfig({ column: base });
    },
    [columns, host],
  );

  const writeRange = useCallback(
    async (where: string): Promise<number | null> => {
      if (!rangeBase || rangeLo == null || rangeHi == null || rangeLo > rangeHi || busy) return null;
      setBusy(true);
      setStatus(null);
      try {
        await ensureRangeColumns(rangeBase);
        await host.dataAPI.writeAnnotationByPredicate?.(`${rangeBase}_min`, String(rangeLo), where);
        const res = await host.dataAPI.writeAnnotationByPredicate?.(`${rangeBase}_max`, String(rangeHi), where);
        return res?.n ?? 0;
      } catch (err) {
        setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [rangeBase, rangeLo, rangeHi, busy, ensureRangeColumns, host],
  );

  const onStampRange = useCallback(async () => {
    const ids = selection.selectedRowIndices.size
      ? [...selection.selectedRowIndices]
      : selection.focusedRowIndex != null
        ? [selection.focusedRowIndex]
        : [];
    if (!ids.length) return;
    const n = await writeRange(`__row_index__ IN (${ids.join(", ")})`);
    if (n == null) return;
    // Overlay BOTH the min and max cells for instant feedback (the table shows
    // `{m}_min` as a context column and `{m}_max` as the label column).
    if (minCol && maxCol) {
      setLocalLabels((m) => {
        const next = new Map(m);
        for (const id of ids)
          next.set(
            id,
            new Map([
              [minCol, String(rangeLo)],
              [maxCol, String(rangeHi)],
            ]),
          );
        return next;
      });
    }
    setStatus(`✓ ${ids.length} obs → [${fmtVal(rangeLo)}, ${fmtVal(rangeHi)}]`);
  }, [selection, writeRange, rangeLo, rangeHi, minCol, maxCol]);

  const stampRangeScope = useCallback(async () => {
    const where = scopeExpr ? String(filterExprToExpr(scopeExpr)) : "TRUE";
    const n = await writeRange(where);
    if (n != null)
      setStatus(`✓ ${n.toLocaleString()} obs → [${fmtVal(rangeLo)}, ${fmtVal(rangeHi)}] (re-scope to refresh cells)`);
  }, [scopeExpr, writeRange, rangeLo, rangeHi]);

  const onSkip = useCallback(() => setStatus(null), []);
  const stamped = localLabels.size;

  // table wiring differs by mode: range shows {base}_min (context) + {base}_max (label col)
  const tableContext = mode === "range" ? (rangeReady && minCol ? [minCol] : []) : contextColumns;
  const tableLabelCol = mode === "range" ? (rangeReady ? maxCol : null) : targetColumn;
  const tableLabels = mode === "range" ? [] : labels;
  const tableHotkeys = mode === "range" ? [] : hotkeys;

  // Range instrument lives in a toolbar popover so the table keeps the full body.
  const rangeControls = (
    <div className="flex flex-col gap-2.5">
      <RangeBracket
        lo={rangeLo}
        hi={rangeHi}
        onChange={(lo, hi) => {
          setRangeLo(lo);
          setRangeHi(hi);
        }}
        onCommit={() => void onStampRange()}
        disabled={busy}
        metric={rangeBase || "value"}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-8 flex-1 justify-between px-3"
          disabled={busy || !rangeComplete || selection.focusedRowIndex == null}
          onClick={() => void onStampRange()}
        >
          set {selection.focusedRowIndex ?? ":"} <Kbd>↵</Kbd>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3"
          disabled={busy || !rangeComplete}
          onClick={() => void stampRangeScope()}
          title={`apply bracket to all ${total.toLocaleString()} obs in scope`}
        >
          scope
        </Button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden text-xs">
      {/* palette / target bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-border-subtle border-b p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs text-text-muted">{mode === "range" ? "metric" : "col"}</span>
          {mode === "range" ? (
            <Input
              aria-label="range metric name"
              className="h-7 w-40 px-2 text-xs"
              placeholder="regularization…"
              value={column ?? ""}
              onChange={(e) => setColumn(e.target.value)}
              onBlur={() => host.patchConfig({ column })}
            />
          ) : creating ? (
            <>
              <Input
                autoFocus
                aria-label="new annotation column name"
                className="h-7 w-36 px-2 text-xs"
                placeholder="new column…"
                value={newColumn}
                onChange={(e) => setNewColumn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewColumn("");
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-text-muted"
                onClick={() => {
                  setCreating(false);
                  setNewColumn("");
                }}
              >
                ✕
              </Button>
            </>
          ) : (
            <>
              <Select
                value={column ?? undefined}
                onValueChange={(v) => {
                  setColumn(v ?? null);
                  host.patchConfig({ column: v ?? null });
                }}
              >
                <SelectTrigger aria-label="annotation column" className="h-7 w-40">
                  <SelectValue placeholder=": select :" />
                </SelectTrigger>
                <SelectContent>
                  {columns.length === 0 ? (
                    <div className="px-2 py-1.5 text-2xs text-text-muted">no columns yet: create one →</div>
                  ) : (
                    columns.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={() => setCreating(true)}>
                + new
              </Button>
            </>
          )}
        </div>

        {/* mode toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-2xs text-text-muted">mode</span>
          <div className="inline-flex h-7 overflow-hidden rounded-md border border-input">
            <button
              type="button"
              className={cn(
                "px-2.5 text-2xs transition-colors",
                mode === "label" ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-foreground",
              )}
              onClick={() => setModePersist("label")}
            >
              label
            </button>
            <button
              type="button"
              className={cn(
                "border-input border-l px-2.5 text-2xs transition-colors",
                mode === "range" ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-foreground",
              )}
              onClick={() => setModePersist("range")}
            >
              range
            </button>
          </div>
        </div>

        {mode === "range" ? (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="truncate text-2xs text-text-muted">
              {rangeBase ? (
                <>
                  writes <span className="text-primary">{`${rangeBase}_min · ${rangeBase}_max`}</span>
                </>
              ) : (
                "name a metric to begin"
              )}
            </span>
            <Popover>
              <PopoverTrigger
                disabled={!rangeBase}
                aria-label="Set annotation range"
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-input px-2 text-2xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
              >
                range [{fmtVal(rangeLo) || ":"}, {fmtVal(rangeHi) || ":"}]
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-72 p-3">
                {rangeControls}
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="text-2xs text-text-muted">labels</span>
            <Input
              aria-label="label vocabulary, comma separated"
              className="h-7 min-w-0 flex-1 px-2 text-xs"
              placeholder="infected, uninfected…"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              onBlur={persistLabels}
            />
            {labels.length > 0 && (
              <Popover>
                <PopoverTrigger
                  aria-label="Stamp annotation"
                  className="inline-flex h-7 shrink-0 items-center rounded-md border border-input px-2 text-2xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  stamp
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-52 gap-1 p-1.5">
                  <div className="max-h-64 overflow-y-auto">
                    {labels.map((label, index) => (
                      <Button
                        key={label}
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full justify-between px-2"
                        disabled={busy || selection.focusedRowIndex == null}
                        onClick={() => void onStamp(label)}
                      >
                        {label} <Kbd>{hotkeys[index]}</Kbd>
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
      </div>

      {/* no-scope caution (table still usable per-row) */}
      {!hasScope && (
        <div className="flex items-start gap-1.5 border-warning/30 border-b bg-warning/10 px-2.5 py-1.5 text-2xs text-warning">
          <span aria-hidden>⚠</span>
          <span>No scope wired: labeling the whole dataset. Connect a Filter or Selection upstream to scope it.</span>
        </div>
      )}

      {/* annotation table */}
      <div className="flex min-h-0 flex-1">
        <AnnotateTable
          coordinator={coordinator}
          table={table}
          selection={host.inputPredicate}
          contextColumns={tableContext}
          labelColumn={tableLabelCol}
          localLabels={localLabels}
          labels={tableLabels}
          hotkeys={tableHotkeys}
          numericLabel={mode === "range"}
          cropFields={cropFields}
          channels={channels}
          hash={hash}
          onChange={setSelection}
          onUserFocus={publishUserFocus}
          onStamp={mode === "range" ? () => {} : (v) => void onStamp(v)}
          onSkip={onSkip}
          onTotalCount={setTotal}
          externalFocusedRowIndex={externalFocusedRowIndex}
        />
      </div>

      {/* footer */}
      <div className="flex items-center gap-2.5 border-border-subtle border-t px-2.5 py-1.5 text-3xs">
        <span className="text-muted-foreground">
          scope <Bracketed>{total.toLocaleString()}</Bracketed>
        </span>
        <span className="text-text-muted">stamped {stamped.toLocaleString()} this session</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-3xs"
            onClick={() => setShowCommit(true)}
            title="commit staged annotation columns to the source .obs on disk"
          >
            write to .obs…
          </Button>
          {status && (
            <span
              className={cn("max-w-[260px] truncate", status.startsWith("✓") ? "text-success" : "text-destructive")}
              title={status}
            >
              {status}
            </span>
          )}
          {mode === "range" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-3xs text-text-muted"
              disabled={busy || !rangeBase || !rangeComplete}
              onClick={() => void stampRangeScope()}
              title={`bracket every obs in scope = [${fmtVal(rangeLo)}, ${fmtVal(rangeHi)}]`}
            >
              bracket all {total.toLocaleString()} = [{fmtVal(rangeLo) || "…"}, {fmtVal(rangeHi) || "…"}]
            </Button>
          )}
        </div>
      </div>
      {showCommit && (
        <div className="absolute inset-0 z-20">
          <CommitPanel host={host} onClose={() => setShowCommit(false)} />
        </div>
      )}
    </div>
  );
}
