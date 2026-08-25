/**
 * fov-label: label whole fields of view laid out as the plate they came from.
 *
 * The offline Qt viewer grouped FOVs into Good / Neutral / Bad panels because it had no
 * crossfiltering — the panels WERE the filter. Here the arrangement carries different
 * information: each well is drawn as its physical grid of fields, so whole-well and
 * positional effects (a dud well, a bad edge, an empty centre) are visible at a glance.
 * The label rides on the cell outline instead of the layout.
 *
 * Interaction: click selects. Label with keys 1/2/3/0 on the selected field or selection.
 * Writes land in `goodness_user`, beside the
 * imported `goodness` rather than over it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { rowIndex } from "@ndea/sdk";
import { Badge } from "@ndea/ui/components/badge";
import { Button } from "@ndea/ui/components/button";
import { ButtonGroup } from "@ndea/ui/components/button-group";
import { Kbd } from "@ndea/ui/components/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { SliderRow } from "@ndea/ui/components/slider-row";
import { announceAnnotationWrite, useAnnotationColumns } from "../query/annotations";
import { focusObs } from "../gallery/routing";
import { useFovChannels } from "./useFovChannels";
import { useNodeFocus } from "../query/useNodeFocus";
import {
  GOODNESS_COLUMN,
  GOODNESS_KEY_FOR,
  GOODNESS_KEYS,
  GOODNESS_TEXT,
  GOODNESS_USER_COLUMN,
  type Goodness,
  goodnessCode,
} from "./goodness";
import { decodePlateGrid } from "./plate-grid";
import { PlateTree } from "./PlateTree";
import { orderWellFovs, PlateWellGrid } from "./PlateWellGrid";
import { useConfigState } from "./useConfigState";
import {
  applyClick,
  applyGroupClick,
  EMPTY_SELECTION,
  labelTargets,
  pruneSelection,
  type ClickModifiers,
} from "./selection";
import { usePlateFovs, type PlateFov } from "./usePlateFovs";
import type { FovLabelBodyProps, FovLabelServices } from "./contracts";

/**
 * On-screen cell edge in px. The floor still shows a whole plate; the ceiling is for judging
 * one field. Fixed rather than fractional: `1fr` tracks divide the tile width, so three 7x7
 * wells in a short tile collapse to ~15px and the images stop being judgeable.
 */
const CELL_PX_MIN = 32;
const CELL_PX_MAX = 240;
const DEFAULT_CELL_PX = 96;

/** Ranking column preference, best first: a tuned score if present, else the label. */
const RANK_CANDIDATES = ["fov_score", "score", GOODNESS_USER_COLUMN, GOODNESS_COLUMN] as const;

export function createFovLabelView(useServices: () => FovLabelServices) {
  return function FovLabelView({ host }: FovLabelBodyProps) {
    const services = useServices();
    const metadata = services.metadata;
    const [status, setStatus] = useState<string | null>(null);
    // Labels applied locally but not yet confirmed by a refetch. Without this, a click waits
    // on a write plus a full 147-row requery before the outline changes, which reads as the
    // control not working. Cleared when the refetch returns the same value.
    const [pending, setPending] = useState<ReadonlyMap<number, Goodness>>(new Map());
    const [selection, setSelection] = useState(EMPTY_SELECTION);
    const [isPlateTreeCollapsed, setIsPlateTreeCollapsed] = useState(false);
    const focusedRowIndex = useNodeFocus(host);

    const fovColumn = metadata.spatial?.crop_fov_col ?? null;
    const tColumn = metadata.spatial?.t_col ?? null;
    const columns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);
    // Local while dragging; `persistCellPx` runs once on release. Not `useConfigState`, which
    // persists on every change -- see the SliderRow comment below.
    const [cellPx, setCellPx] = useState(host.config.cellPx ?? DEFAULT_CELL_PX);
    const persistCellPx = useCallback((px: number) => host.patchConfig({ cellPx: px }), [host]);
    const [layout, setLayout] = useConfigState<"plate" | "ranked">(
      host.config.layout ?? "plate",
      useCallback((value: "plate" | "ranked") => host.patchConfig({ layout: value }), [host]),
    );
    const [rankColumn, setRankColumn] = useConfigState<string | null>(
      host.config.rankColumn ?? RANK_CANDIDATES.find((c) => columns.includes(c)) ?? null,
      useCallback((value: string | null) => host.patchConfig({ rankColumn: value }), [host]),
    );
    // Metadata carries column names, not types, so every column is offered. A
    // non-numeric pick coerces to null and those fields sink below the ranked ones
    // rather than silently sorting as zero.
    const rankOptions = useMemo(() => columns.filter((c) => c !== fovColumn), [columns, fovColumn]);

    // Annotation columns are NOT in `metadata.obs_columns` -- they live in `ann_{name}` tables
    // joined into the view -- so the real list has to come from the server or every label ever
    // written stays invisible after a reload.
    const annotations = useAnnotationColumns();

    const { fovs, isLoading, error } = usePlateFovs({
      coordinator: host.data.coordinator,
      fovColumn,
      tColumn,
      columns,
      annotationColumns: annotations.columns,
      annotationRevision: annotations.revision,
      annotationsReady: annotations.isReady,
      rankColumn,
    });

    const [channelIndex, setChannelIndex] = useConfigState(
      host.config.channel ?? 0,
      useCallback((index: number) => host.patchConfig({ channel: index }), [host]),
    );
    const {
      channels,
      hash,
      labels: channelLabels,
      isMask,
    } = useFovChannels(metadata.plate_channels, fovs[0]?.fovName ?? null, channelIndex);
    const viewerZ = services.viewerZ("docked");

    const displayed = useMemo(
      () =>
        pending.size === 0
          ? fovs
          : fovs.map((f) => {
              const override = pending.get(f.rowIndex);
              return override ? { ...f, goodness: override, isUserLabel: override !== "unlabeled" } : f;
            }),
      [fovs, pending],
    );
    const byFovName = useMemo(() => new Map(displayed.map((f) => [f.fovName, f])), [displayed]);
    // Keyed on the NAMES, not the array: a label edit produces a new rows array but the same
    // plate, so the grid (and every `well` prop derived from it) stays referentially stable.
    const fovNameKey = useMemo(() => fovs.map((f) => f.fovName).join("\u0000"), [fovs]);
    const grid = useMemo(() => decodePlateGrid(fovNameKey === "" ? [] : fovNameKey.split("\u0000")), [fovNameKey]);

    // One flat order across every well, in the sequence the cells are drawn, so a shift-range
    // selects what looks contiguous. `orderWellFovs` is the same function the grid renders with.
    const visualOrder = useMemo(
      () => grid.wells.flatMap((well) => orderWellFovs(well, byFovName, layout).map((f) => f.rowIndex)),
      [grid, byFovName, layout],
    );

    // Drop rows that vanished, so a stale selection cannot be batch-labelled.
    useEffect(() => {
      setSelection((prev) => pruneSelection(prev, new Set(visualOrder)));
    }, [visualOrder]);

    // Publish focus only after React commits the selection. Calling the external focus store
    // from a state updater lets React execute that store write during render.
    useEffect(() => {
      if (selection.anchor != null) focusObs(host, rowIndex(selection.anchor));
    }, [host, selection.anchor]);

    const onSelect = useCallback(
      (fov: PlateFov, modifiers: ClickModifiers) => {
        setSelection((prev) => applyClick(prev, visualOrder, fov.rowIndex, modifiers));
      },
      [visualOrder],
    );

    /**
     * A field clicked in the tree rail. Identical to a grid click, deliberately: the rail is a
     * second way to drive one selection, not a selection of its own.
     */
    const onSelectField = useCallback(
      (targetRowIndex: number, modifiers: ClickModifiers) => {
        setSelection((prev) => applyClick(prev, visualOrder, targetRowIndex, modifiers));
      },
      [visualOrder],
    );

    /**
     * A whole well clicked in the rail.
     *
     * Goes through `applyGroupClick` rather than assigning the row set directly, so the anchor
     * lands on the well's FIRST field in visual order and a following shift-click extends from
     * somewhere the user actually looked.
     */
    const onSelectWell = useCallback(
      (rowIndices: number[], modifiers: ClickModifiers) => {
        setSelection((prev) => applyGroupClick(prev, visualOrder, rowIndices, modifiers));
      },
      [visualOrder],
    );

    // POST /api/annotations/columns is NOT idempotent -- it 409s when the column exists -- so
    // creating it on every click made the first label succeed and every later one fail. Create
    // at most once per mount, and treat "already exists" as the success it actually is.
    const columnReady = useRef(false);
    if (!columnReady.current && annotations.columns.includes(GOODNESS_USER_COLUMN)) columnReady.current = true;
    const ensureColumn = useCallback(async () => {
      if (columnReady.current) return;
      try {
        await host.dataAPI.createAnnotationColumn?.(GOODNESS_USER_COLUMN, "float");
      } catch (err) {
        // A 409 means another mount (or a previous session) already made it.
        if (!/already exists/i.test(err instanceof Error ? err.message : String(err))) throw err;
      }
      columnReady.current = true;
    }, [host]);

    const onLabel = useCallback(
      async (fov: PlateFov, value: Goodness) => {
        // Labelling a cell inside the selection labels the whole selection; outside it, just
        // that cell. One write for the batch, not one per field.
        const targets = labelTargets(selection, fov.rowIndex);
        setPending((prev) => {
          const next = new Map(prev);
          for (const id of targets) next.set(id, value);
          return next;
        });
        try {
          await ensureColumn();
          const code = goodnessCode(value);
          await host.dataAPI.writeAnnotationByPredicate?.(
            GOODNESS_USER_COLUMN,
            code == null ? "" : String(code),
            `__row_index__ IN (${targets.join(", ")})`,
          );
          setStatus(null);
          // Announce AFTER the write resolves: every node reading annotations re-reads, and the
          // revision also busts Mosaic's SQL-text result cache. This replaces the local
          // refetch, which only ever told this node.
          announceAnnotationWrite();
        } catch (err) {
          // Roll the optimistic values back: showing labels the store rejected would be worse
          // than showing none, since the operator would believe the fields were marked.
          setPending((prev) => {
            const next = new Map(prev);
            for (const id of targets) next.delete(id);
            return next;
          });
          setStatus(err instanceof Error ? err.message : String(err));
        }
      },
      [host, ensureColumn, selection],
    );

    useEffect(() => {
      if (pending.size === 0) return;
      const settled = fovs.filter((f) => pending.get(f.rowIndex) === f.goodness).map((f) => f.rowIndex);
      if (settled.length === 0) return;
      setPending((prev) => {
        const next = new Map(prev);
        for (const id of settled) next.delete(id);
        return next;
      });
    }, [fovs, pending]);

    // 1/2/3/0 label whatever is selected, so a plate can be worked through without
    // returning to the mouse for every field.
    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const value = GOODNESS_KEYS[event.key];
        if (!value || focusedRowIndex == null) return;
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        const fov = displayed.find((f) => f.rowIndex === focusedRowIndex);
        if (fov) void onLabel(fov, value);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [focusedRowIndex, displayed, onLabel]);

    if (fovColumn == null) {
      return (
        <div className="flex h-full w-full items-center justify-center p-4 text-center">
          <div className="max-w-[260px] text-2xs text-muted-foreground/60 leading-relaxed">
            This dataset has no FOV column, so there is no plate to lay out. Needs an obs column of image paths
            (conventionally <code>fov_name</code>).
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col bg-node-surface">
        <div className="flex flex-none items-center gap-2 px-2 py-1.5">
          <span className="font-mono text-2xs text-foreground/70">
            {fovs.length} FOV{fovs.length === 1 ? "" : "s"} · {grid.wells.length} well
            {grid.wells.length === 1 ? "" : "s"}
          </span>
          {grid.layout === "sequential" && (
            <span
              className="font-mono text-[9px] text-warning"
              title="Field ids are not RRRCCC grid codes (e.g. an online pre-scan store), so cells are filled in acquisition order rather than by plate position."
            >
              acquisition order
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
            {(["good", "neutral", "bad", "unlabeled"] as const).map((value) => (
              <span key={value} className="flex items-center gap-1">
                <Kbd>{GOODNESS_KEY_FOR[value]}</Kbd>
                <span className={GOODNESS_TEXT[value]}>{value === "unlabeled" ? "clear" : value}</span>
              </span>
            ))}
          </span>

          {channelLabels.length > 1 && (
            <Select value={String(channelIndex)} onValueChange={(v) => setChannelIndex(Number(v))}>
              <SelectTrigger
                aria-label="channel"
                title={isMask ? "Label mask: rendered over its full ID range" : "Channel to display"}
                className="h-6 w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channelLabels.map((label, i) => (
                  <SelectItem key={label} value={String(i)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isMask && <Badge variant="secondary">mask</Badge>}

          <ButtonGroup>
            {(["plate", "ranked"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                variant={mode === layout ? "secondary" : "ghost"}
                aria-pressed={mode === layout}
                title={
                  mode === "plate"
                    ? "Lay fields out at their position on the plate"
                    : "Order fields best-first within each well"
                }
                onClick={() => setLayout(mode)}
              >
                {mode}
              </Button>
            ))}
          </ButtonGroup>

          {layout === "ranked" && (
            <Select value={rankColumn ?? undefined} onValueChange={(v) => setRankColumn(v ?? null)}>
              <SelectTrigger aria-label="rank column" title="Column to rank on" className="h-6 w-44">
                <SelectValue placeholder=": rank by :" />
              </SelectTrigger>
              <SelectContent>
                {rankOptions.map((column) => (
                  <SelectItem key={column} value={column}>
                    {column}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Continuous while dragging, persisted once on release: `patchConfig` re-cooks the
              graph and re-renders every staged panel (~180ms measured), so writing it per frame
              would make the slider crawl. */}
          <SliderRow
            label="size"
            value={cellPx}
            min={CELL_PX_MIN}
            max={CELL_PX_MAX}
            step={8}
            className="w-40 flex-none"
            labelClassName="w-7"
            valueClassName="w-8"
            formatValue={(px) => `${px}px`}
            onValueChange={setCellPx}
            onValueCommitted={persistCellPx}
          />
        </div>

        {status && <div className="flex-none px-2 font-mono text-[9px] text-destructive">✗ {status}</div>}
        {error && <div className="flex-none px-2 font-mono text-[9px] text-destructive">✗ {error}</div>}
        {isLoading && fovs.length === 0 && (
          <div className="px-2 py-2 text-2xs text-muted-foreground/60">Loading fields…</div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Plate hierarchy is hidden in ranked layout, where it would contradict screen order. */}
          {layout === "plate" &&
            (isPlateTreeCollapsed ? (
              <div className="flex w-7 flex-none items-start justify-center border-border/40 border-r pt-1">
                <button
                  type="button"
                  aria-label="Expand well list"
                  title="Expand well list"
                  onClick={() => setIsPlateTreeCollapsed(false)}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            ) : (
              <PlateTree
                wells={grid.wells}
                byFovName={byFovName}
                order={visualOrder}
                selected={selection.selected}
                onSelectField={onSelectField}
                onSelectWell={onSelectWell}
                onCollapse={() => setIsPlateTreeCollapsed(true)}
              />
            ))}

          {/* Scrolls rather than shrinking: cells stay legible at any tile size. */}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="flex flex-wrap items-start gap-5">
              {grid.wells.map((well) => (
                <PlateWellGrid
                  key={well.well}
                  well={well}
                  byFovName={byFovName}
                  channels={channels}
                  hash={hash}
                  viewerZ={viewerZ}
                  half={host.config.half}
                  size={host.config.size}
                  cellPx={cellPx}
                  layout={layout}
                  selected={selection.selected}
                  focusedRowIndex={focusedRowIndex}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };
}
