/**
 * Annotate node body — a TABLE-first labeling surface (one door, one node).
 *
 * Rows = the scoped obs (the wired predicate, delivered as `host.inputSelection`
 * and consumed straight by `AnnotateTable`/`useTableQuery` — the same plumbing
 * the Table node uses, so it scopes off a Filter/Wrangle edge correctly).
 *
 * Selection is SPREADSHEET-style (click / shift / ⌘) and a label key or chip
 * stamps the whole current selection. The focused (last-clicked) row drives
 * `host.highlight.set`, so wired viewers (Idetik, Gallery) follow it. A
 * separate "stamp all in scope" path writes server-side over the full predicate.
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
import { useGalleryChannels } from "@/nodes/table/useGalleryChannels";
import type { NodeViewProps } from "@/core/node/sdk";

export interface AnnotateConfig {
  column: string | null;
  labels: string[];
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

  const [localLabels, setLocalLabels] = useState<Map<string, string>>(() => new Map());
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
          for (const id of ids) next.set(id, value);
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

  // stamp the ENTIRE scope server-side (the true bulk path, beyond loaded rows)
  const stampAllInScope = useCallback(
    async (value: string) => {
      if (!targetColumn || !value || busy) return;
      const where = scopeExpr ? String(filterExprToExpr(scopeExpr)) : "TRUE";
      setBusy(true);
      setStatus(null);
      try {
        await ensureColumn(targetColumn);
        const res = await host.api.writeAnnotationByPredicate?.(targetColumn, value, where);
        persistLabels();
        setStatus(
          `✓ ${(res?.n ?? total).toLocaleString()} obs → ${targetColumn} = "${value}" (re-scope to refresh cells)`,
        );
      } catch (err) {
        setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [targetColumn, busy, scopeExpr, ensureColumn, host, persistLabels, total],
  );

  const onSkip = useCallback(() => setStatus(null), []);
  const stamped = localLabels.size;
  const stampValue = labels[0] ?? "";

  // ── focus rail — vertical beside (wide) / compact strip below (narrow) ──
  const railWide = (
    <aside className="flex w-[212px] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-border-subtle border-l bg-surface-tertiary/20 p-3">
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
      {labels.length === 0 ? (
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
        click a row to focus · ↑↓ moves · keys stamp the selection · viewers follow
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
        {labels.length === 0 ? (
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
          <span className="text-2xs text-text-muted">col</span>
          {creating ? (
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
          contextColumns={contextColumns}
          labelColumn={targetColumn}
          localLabels={localLabels}
          labels={labels}
          hotkeys={hotkeys}
          cropFields={cropFields}
          channels={channels}
          hash={hash}
          onChange={setSel}
          onStamp={(v) => void onStamp(v)}
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
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-3xs text-text-muted"
            disabled={busy || !targetColumn || !stampValue}
            onClick={() => void stampAllInScope(stampValue)}
            title={`stamp every obs in scope = ${stampValue || "(no label)"}`}
          >
            stamp all {total.toLocaleString()} = {stampValue || "…"}
          </Button>
        </div>
      </div>
    </div>
  );
}
