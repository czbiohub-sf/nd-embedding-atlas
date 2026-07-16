/**
 * histogram body (PLUGIN-ARCHITECTURE §10.3). Ported from the legacy
 * `components/charts/Histogram`, re-sourced through the host seam: stats + bin
 * queries on `host.data.coordinator`/`table`, scoped to `host.inputSelection`,
 * the brush range emitted on the node's selection-out push port via
 * `publishChartFilter` (no `selectionBus`, no `useDashboard`).
 *
 * Parent gates on a picked column; the inner `HistogramBody` mounts only with a
 * field, so its query hooks never see a null column, and remounts (keyed on
 * field) reset the brush and clear the published filter.
 */

import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { type FilterExpr, cast, column } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { HistogramCapabilities } from "./plugin";
import { useContainerSize } from "@/hooks/useContainerSize";
import { useMosaicClient } from "@/hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "@/lib/mosaic-helpers";
import { FieldPicker } from "@/nodes/charts/core/field-picker";
import { publishChartFilter } from "@/nodes/charts/core/routing";
import type { ChartLeafConfig } from "@/nodes/charts/core/types";
import { useChartLeaf } from "@/nodes/charts/core/use-chart-leaf";
import { binParams as computeBinParams, histogramBrushPredicate, type Stats } from "./binmath";

export interface HistogramConfig extends ChartLeafConfig {
  bins: number;
}
export type HistogramOptions = Record<string, never>;

interface HistBin {
  bin: number;
  countTotal: number;
  countFiltered: number;
}

const CHART_HEIGHT = 64;
const AXIS_HEIGHT = 18;
const TOTAL_HEIGHT = CHART_HEIGHT + AXIS_HEIGHT;

export function HistogramView({ host }: NodeBodyProps<HistogramConfig, HistogramCapabilities>) {
  const { coordinator, table, inputSelection, field, setField } = useChartLeaf(host);
  const bins = host.config.bins ?? 20;
  const onFilter = useCallback((sql: string | null) => publishChartFilter(host, sql), [host]);

  return (
    <div className="flex h-full w-full flex-col gap-1.5 overflow-y-auto bg-card p-2">
      <FieldPicker coordinator={coordinator} value={field} kinds={["number"]} onPick={setField} />
      {field == null ? (
        <div className="px-1 py-2 text-2xs text-muted-foreground/60">Pick a column to plot.</div>
      ) : (
        <HistogramBody
          key={field}
          coordinator={coordinator}
          table={table}
          inputSelection={inputSelection}
          field={field}
          binCount={bins}
          onFilter={onFilter}
        />
      )}
    </div>
  );
}

interface BodyProps {
  coordinator: Coordinator;
  table: string;
  inputSelection: Selection;
  field: string;
  binCount: number;
  onFilter: (sql: string | null) => void;
}

function HistogramBody({ coordinator, table, inputSelection, field, binCount, onFilter }: BodyProps) {
  // Clear the published filter when the field changes (this body remounts).
  useEffect(() => () => onFilter(null), [onFilter]);

  const containerRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth } = useContainerSize(containerRef);

  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void coordinator
      .query(
        `SELECT MIN(CAST("${field}" AS DOUBLE)) AS min,
                MAX(CAST("${field}" AS DOUBLE)) AS max,
                COUNT(*) AS count
         FROM ${table}
         WHERE CAST("${field}" AS DOUBLE) IS NOT NULL
           AND isfinite(CAST("${field}" AS DOUBLE))`,
        { type: "json" },
      )
      .then((result: unknown) => {
        if (cancelled) return;
        const rows = toRows(result);
        const r = rows[0];
        if (r) setStats({ min: Number(r.min), max: Number(r.max), count: Number(r.count) });
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, table, field]);

  const binParams = useMemo(() => computeBinParams(stats, binCount), [stats, binCount]);

  const query = useCallback(
    (predicate: FilterExpr) => {
      if (!binParams) return null;
      const { binStart, binSize } = binParams;
      const fieldExpr = cast(column(field), "DOUBLE");
      const pred = filterExprToExpr(predicate);
      const binExpr = `FLOOR((${String(fieldExpr)} - ${String(binStart)}) / ${String(binSize)})`;
      return `SELECT ${binExpr} AS bin,
                     COUNT(*) AS "countTotal",
                     SUM(CAST((${String(pred)}) AS INT)) AS "countFiltered"
              FROM ${table}
              WHERE ${String(fieldExpr)} IS NOT NULL AND isfinite(${String(fieldExpr)})
              GROUP BY bin
              ORDER BY bin`;
    },
    [field, table, binParams],
  );

  const transform = useCallback((result: unknown): HistBin[] => {
    const rows = toRows(result);
    return rows.map((r) => ({
      bin: Number(r.bin),
      countTotal: Number(r.countTotal),
      countFiltered: Number(r.countFiltered),
    }));
  }, []);

  const { data, loading } = useMosaicClient({
    coordinator,
    selection: inputSelection,
    query,
    transform,
    enabled: binParams != null,
  });

  const svgRef = useRef<SVGSVGElement>(null);
  const [brushRange, setBrushRange] = useState<[number, number] | null>(null);
  const brushing = useRef(false);

  // Constant-value column: show the value with count instead of an empty histogram.
  if (stats && stats.count > 0 && stats.min === stats.max) {
    return (
      <div ref={containerRef} className="py-2">
        <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-medium text-2xs text-foreground">
          {formatTick(stats.min)}
        </span>
        <span className="ml-1 text-3xs text-muted-foreground">({stats.count.toLocaleString()} rows)</span>
      </div>
    );
  }

  if (!binParams || !data || data.length === 0) {
    return (
      <div ref={containerRef} className="py-2 text-2xs text-muted-foreground">
        {loading ? "Loading..." : "No data"}
      </div>
    );
  }

  const { binStart, binSize } = binParams;
  const maxCount = Math.max(...data.map((d) => d.countTotal), 1);

  const minBin = Math.min(...data.map((d) => d.bin));
  const maxBin = Math.max(...data.map((d) => d.bin));
  const totalBins = maxBin - minBin + 1;

  const w = containerWidth > 0 ? containerWidth : 200;
  const gap = 1;
  const barWidth = Math.max((w - gap * (totalBins - 1)) / totalBins, 2);

  return (
    <div ref={containerRef} className="w-full">
      <svg
        ref={svgRef}
        width={w}
        height={TOTAL_HEIGHT}
        className="block"
        aria-hidden="true"
        onMouseDown={(e) => {
          if (!svgRef.current) return;
          brushing.current = true;
          const rect = svgRef.current.getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const binIdx = Math.floor((xPx / w) * totalBins) + minBin;
          const val = binStart + binIdx * binSize;
          setBrushRange([val, val]);
        }}
        onMouseMove={(e) => {
          if (!brushing.current || !svgRef.current || !brushRange) return;
          const rect = svgRef.current.getBoundingClientRect();
          const xPx = e.clientX - rect.left;
          const binIdx = Math.floor((xPx / w) * totalBins) + minBin;
          const val = binStart + (binIdx + 1) * binSize;
          setBrushRange([brushRange[0], val]);
        }}
        onMouseUp={() => {
          brushing.current = false;
          if (brushRange) onFilter(histogramBrushPredicate(field, brushRange[0], brushRange[1]));
        }}
        onMouseLeave={() => {
          brushing.current = false;
        }}
      >
        {data.map((bin) => {
          const x = (bin.bin - minBin) * (barWidth + gap);
          const hTotal = (bin.countTotal / maxCount) * CHART_HEIGHT;
          const hFiltered = (bin.countFiltered / maxCount) * CHART_HEIGHT;

          return (
            <g key={bin.bin}>
              <rect x={x} y={CHART_HEIGHT - hTotal} width={barWidth} height={hTotal} className="fill-chart-mark-fade" />
              <rect
                x={x}
                y={CHART_HEIGHT - hFiltered}
                width={barWidth}
                height={hFiltered}
                className="fill-chart-mark"
              />
            </g>
          );
        })}

        {brushRange
          ? (() => {
              const lo = Math.min(brushRange[0], brushRange[1]);
              const hi = Math.max(brushRange[0], brushRange[1]);
              const xStart = ((lo - binStart) / binSize - minBin) * (barWidth + gap);
              const xEnd = ((hi - binStart) / binSize - minBin) * (barWidth + gap);
              return (
                <rect
                  x={xStart}
                  y={0}
                  width={Math.max(xEnd - xStart, 1)}
                  height={CHART_HEIGHT}
                  fill="color-mix(in oklch, var(--color-primary) 15%, transparent)"
                  stroke="color-mix(in oklch, var(--color-primary) 50%, transparent)"
                  strokeWidth={1}
                />
              );
            })()
          : null}

        <line x1={0} y1={CHART_HEIGHT + 0.5} x2={w} y2={CHART_HEIGHT + 0.5} className="stroke-border" strokeWidth={1} />

        <text
          x={0}
          y={TOTAL_HEIGHT - 3}
          className="fill-muted-foreground"
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
        >
          {stats?.min != null ? formatTick(stats.min) : ""}
        </text>
        <text
          x={w}
          y={TOTAL_HEIGHT - 3}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
        >
          {stats?.max != null ? formatTick(stats.max) : ""}
        </text>
      </svg>
    </div>
  );
}

function formatTick(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toPrecision(3);
}
