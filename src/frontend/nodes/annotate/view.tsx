/**
 * Annotate node body — a TABLE-first labeling surface (one door, one node).
 *
 * Rows = the scoped obs (the wired predicate, delivered as `host.inputSelection`
 * and consumed straight by `AnnotateTable`/`useTableQuery` — the same plumbing
 * the Table node uses, so it scopes off a Filter/Wrangle edge correctly).
 *
 * Two modes share the surface:
 *  - `label` — a vocabulary palette + hotkeys stamp the focused row / selection.
 *  - `range` — a min/max bracket instrument (`RangeBracket`) authors a numeric
 *    interval per obs, committed as two float columns `{metric}_min`/`_max`.
 *
 * Selection is SPREADSHEET-style (click / shift / ⌘). The focused (last-clicked)
 * row drives `host.highlight.set`, so wired viewers (Idetik, Gallery) follow it.
 * A separate "all in scope" path writes server-side over the full predicate.
 *
 * Writes go through `host.api.write*`; reads through `host.api.query` / the
 * coordinator. Stamps reflect instantly via a local overlay (`localLabels`).
 */

import type { FilterExpr } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bracketed } from "@/components/ui/bracketed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { filterExprToExpr } from "@/lib/mosaic-helpers";
import { cn } from "@/lib/utils";
import { AnnotateTable, type CropFields, type FocusCrop } from "@/nodes/annotate/AnnotateTable";
import { CropThumb } from "@/nodes/annotate/CropThumb";
import { RangeBracket } from "@/nodes/annotate/RangeBracket";
import { fmtVal } from "@/nodes/annotate/range-scale";
import { useGalleryChannels } from "@/nodes/table/useGalleryChannels";
import type { NodeViewProps } from "@/core/node/sdk";

export interface AnnotateConfig {
  column: string | null;
  labels: string[];
  /** "label" (default) = vocabulary palette; "range" = min/max bracket instrument. */
  mode?: "label" | "range";
}
export type AnnotateOptions = Record<never, never>;

const RAIL_MIN_WIDTH = 520;
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

export function AnnotateView({ host }: NodeViewProps<AnnotateConfig, AnnotateOptions>) {
  const { coordinator, table, metadata } = host.data;

  const [columns, setColumns] = useState<string[]>([]);
  const [column, setColumn] = useState<string | null>(host.config.column);
  const [newColumn, setNewColumn] = useState("");
  const [creating, setCreating] = useState(false);
  const [labelsText, setLabelsText] = useState((host.config.labels ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [mode, setMode] = useState<"label" | "range">(host.config.mode ?? "label");
  const [rangeLo, setRangeLo] = useState<number | null>(null);
  const [rangeHi, setRangeHi] = useState<number | null>(null);

  // Per-obs, per-column overlay (id → column → value) so a write reflects
  // instantly. Range mode stamps BOTH `{m}_min` and `{m}_max` for the row.
  const [localLabels, setLocalLabels] = useState<Map<string, Map<string, string>>>(() => new Map());
  const [sel, setSel] = useState<{ selectedIds: Set<string>; focusId: string | null; focusCrop: FocusCrop | null }>(
    () => ({ selectedIds: new Set(), focusId: null, focusCrop: null }),
  );
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
  // `dataset` VIEW), NOT `metadata.obs_columns` — the latter lags creation, so
  // the table never surfaced the pair until a manual re-scope.
  const rangeBase = (targetColumn ?? "").trim();
  const minCol = rangeBase ? `${rangeBase}_min` : null;
  const maxCol = rangeBase ? `${rangeBase}_max` : null;
  const rangeReady = !!(minCol && maxCol && columns.includes(minCol) && columns.includes(maxCol));
  const rangeInvalid = rangeLo != null && rangeHi != null && rangeLo > rangeHi;
  const rangeComplete = rangeLo != null && rangeHi != null && !rangeInvalid;

  // scope predicate (same path useTableQuery uses → works off Filter edges)
  const scopeExpr: FilterExpr | null = host.inputSelection?.predicate?.(null) ?? null;
  const hasScope = scopeExpr != null;
  const contextColumns = useMemo(
    () =>
      (metadata.obs_columns ?? []).filter((c) => c !== targetColumn && !c.startsWith("__")).slice(0, MAX_CONTEXT_COLS),
    [metadata.obs_columns, targetColumn],
  );

  // gallery link: crop-locator columns + channels. Channels come from the shared
  // viewerChannelsStore (the "docked" slot), so thumbnails are contrasted/colored
  // identically to the Gallery node and the live viewer — change channels in one,
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
  // Channels follow the focused obs's dataset slot — shared with the viewer/Gallery
  // via viewerChannelsStore, so live channel edits flow into the crops. Falls back
  // to "docked" (single-dataset stores) until a dataset is resolved.
  const channelSlot = sel.focusCrop?.datasetKey ?? "docked";
  const { channels, hash } = useGalleryChannels(channelSlot, 300, metadata.plate_channels);

  // responsive: show the focus rail only when the body is wide enough
  const bodyRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= RAIL_MIN_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // existing annotation columns
  useEffect(() => {
    let alive = true;
    void host.api
      .listAnnotationColumns?.()
      ?.then((cols) => alive && setColumns(cols.map((c) => c.name)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  // drive the focus wire
  useEffect(() => {
    if (sel.focusId) host.highlight.set(sel.focusId);
  }, [sel.focusId, host]);

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
      await host.api.createAnnotationColumn?.(col);
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
      const ids = sel.selectedIds.size ? [...sel.selectedIds] : sel.focusId ? [sel.focusId] : [];
      if (!targetColumn || !value || !ids.length || busy) return;
      setBusy(true);
      try {
        await ensureColumn(targetColumn);
        await host.api.writeAnnotationByPredicate?.(targetColumn, value, `__row_index__ IN (${ids.join(", ")})`);
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
    [sel, targetColumn, busy, ensureColumn, host, persistLabels],
  );

  // ── range mode: write {base}_min / {base}_max over a predicate ──
  const ensureRangeColumns = useCallback(
    async (base: string) => {
      const mn = `${base}_min`;
      const mx = `${base}_max`;
      if (!columns.includes(mn)) await host.api.createAnnotationColumn?.(mn, "float");
      if (!columns.includes(mx)) await host.api.createAnnotationColumn?.(mx, "float");
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
        await host.api.writeAnnotationByPredicate?.(`${rangeBase}_min`, String(rangeLo), where);
        const res = await host.api.writeAnnotationByPredicate?.(`${rangeBase}_max`, String(rangeHi), where);
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
    const ids = sel.selectedIds.size ? [...sel.selectedIds] : sel.focusId ? [sel.focusId] : [];
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
  }, [sel, writeRange, rangeLo, rangeHi, minCol, maxCol]);

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

  // the range instrument + its commit controls (shared by both rail layouts)
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
          disabled={busy || !rangeComplete || !sel.focusId}
          onClick={() => void onStampRange()}
        >
          set {sel.focusId ?? "—"} <Kbd>↵</Kbd>
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

  // ── focus rail — vertical beside (wide) / compact strip below (narrow) ──
  const railWide = (
    <aside className="flex w-[232px] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-border-subtle border-l bg-surface-tertiary/20 p-3">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-foreground">obs {sel.focusId ?? "—"}</span>
        <span className="text-2xs text-text-muted">
          {sel.selectedIds.size > 1 ? `${sel.selectedIds.size} selected` : "1"}
        </span>
      </div>
      {cropFields && sel.focusCrop?.fovName && channels.length > 0 ? (
        <CropThumb
          fovName={sel.focusCrop.fovName}
          t={sel.focusCrop.t}
          rowIndex={sel.focusCrop.rowIndex}
          datasetKey={sel.focusCrop.datasetKey}
          channels={channels}
          hash={hash}
          className="aspect-square w-full border border-border"
        />
      ) : null}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {channels
            .filter((c) => c.visible)
            .map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1 rounded bg-surface-tertiary px-1.5 py-px text-3xs text-muted-foreground"
              >
                <span className="size-1.5 rounded-full" style={{ background: `#${c.color}` }} />
                {c.label}
              </span>
            ))}
        </div>
      )}
      {mode === "range" ? (
        rangeBase ? (
          rangeControls
        ) : (
          <p className="text-2xs text-text-muted">Name a metric above to start bracketing.</p>
        )
      ) : labels.length === 0 ? (
        <p className="text-2xs text-text-muted">Add labels above to start.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {labels.map((l, i) => (
            <Button
              key={l}
              variant="outline"
              size="sm"
              className="h-8 justify-between px-3"
              disabled={busy || !sel.focusId}
              onClick={() => void onStamp(l)}
            >
              {l} <Kbd>{hotkeys[i]}</Kbd>
            </Button>
          ))}
        </div>
      )}
      <p className="mt-auto text-3xs text-text-muted">
        click a row to focus · ↑↓ moves · {mode === "range" ? "↵ writes the bracket" : "keys stamp the selection"} ·
        viewers follow
      </p>
    </aside>
  );

  const railNarrow = (
    <aside className="flex max-h-[46%] shrink-0 items-start gap-3 overflow-y-auto border-border-subtle border-t bg-surface-tertiary/20 p-2.5">
      {cropFields && sel.focusCrop?.fovName && channels.length > 0 ? (
        <CropThumb
          fovName={sel.focusCrop.fovName}
          t={sel.focusCrop.t}
          rowIndex={sel.focusCrop.rowIndex}
          datasetKey={sel.focusCrop.datasetKey}
          channels={channels}
          hash={hash}
          className="size-24 shrink-0 rounded border border-border"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-medium text-foreground">
          obs {sel.focusId ?? "—"}
          {sel.selectedIds.size > 1 ? ` · ${sel.selectedIds.size} selected` : ""}
        </span>
        {mode === "range" ? (
          rangeBase ? (
            rangeControls
          ) : (
            <p className="text-2xs text-text-muted">Name a metric above to start bracketing.</p>
          )
        ) : labels.length === 0 ? (
          <p className="text-2xs text-text-muted">Add labels above to start.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l, i) => (
              <Button
                key={l}
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5"
                disabled={busy || !sel.focusId}
                onClick={() => void onStamp(l)}
              >
                {l} <Kbd>{hotkeys[i]}</Kbd>
              </Button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
  const rail = wide ? railWide : railNarrow;

  return (
    <div ref={bodyRef} className="flex h-full min-h-0 w-full flex-col overflow-hidden text-xs">
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
                  <SelectValue placeholder="— select —" />
                </SelectTrigger>
                <SelectContent>
                  {columns.length === 0 ? (
                    <div className="px-2 py-1.5 text-2xs text-text-muted">no columns yet — create one →</div>
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
          <span className="text-2xs text-text-muted">
            {rangeBase ? (
              <>
                writes <span className="text-primary">{`${rangeBase}_min · ${rangeBase}_max`}</span>
              </>
            ) : (
              "float · float"
            )}
          </span>
        ) : (
          <>
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
            </div>
            {labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {labels.map((l, i) => (
                  <Button
                    key={l}
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-2xs"
                    disabled={busy || (!sel.selectedIds.size && !sel.focusId)}
                    onClick={() => void onStamp(l)}
                  >
                    {l} <Kbd>{hotkeys[i]}</Kbd>
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* no-scope caution (table still usable per-row) */}
      {!hasScope && (
        <div className="flex items-start gap-1.5 border-warning/30 border-b bg-warning/10 px-2.5 py-1.5 text-2xs text-warning">
          <span aria-hidden>⚠</span>
          <span>No scope wired — labeling the whole dataset. Connect a Filter or Selection upstream to scope it.</span>
        </div>
      )}

      {/* table + focus rail (beside when wide, stacked below when narrow) */}
      <div className={cn("flex min-h-0 flex-1", wide ? "flex-row" : "flex-col")}>
        <AnnotateTable
          coordinator={coordinator}
          table={table}
          selection={host.inputSelection}
          contextColumns={tableContext}
          labelColumn={tableLabelCol}
          localLabels={localLabels}
          labels={tableLabels}
          hotkeys={tableHotkeys}
          numericLabel={mode === "range"}
          cropFields={cropFields}
          channels={channels}
          hash={hash}
          onChange={setSel}
          onStamp={mode === "range" ? () => {} : (v) => void onStamp(v)}
          onSkip={onSkip}
          onTotalCount={setTotal}
        />
        {rail}
      </div>

      {/* footer */}
      <div className="flex items-center gap-2.5 border-border-subtle border-t px-2.5 py-1.5 text-3xs">
        <span className="text-muted-foreground">
          scope <Bracketed>{total.toLocaleString()}</Bracketed>
        </span>
        <span className="text-text-muted">stamped {stamped.toLocaleString()} this session</span>
        <div className="ml-auto flex items-center gap-2">
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
    </div>
  );
}
