import type { ExprNode, FilterExpr } from "@uwdata/mosaic-sql";
import { cast, column, isBetween, literal } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useDashboard } from "../../hooks/useDashboard";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "../../lib/mosaic-helpers";

interface HistBin {
  bin: number;
  countTotal: number;
  countFiltered: number;
}

interface Stats {
  min: number;
  max: number;
  count: number;
}

interface Props {
  field: string;
  bins?: number;
}

const CHART_HEIGHT = 64;
const AXIS_HEIGHT = 18;
const TOTAL_HEIGHT = CHART_HEIGHT + AXIS_HEIGHT;

export function Histogram({ field, bins: binCount = 20 }: Props) {
  const { meta } = useDashboard();
  const { coordinator, brushSelection } = meta;

  // Container size tracking
  const containerRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth } = useContainerSize(containerRef);

  // Step 1: query stats to determine bin parameters
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void coordinator
      .query(
        `SELECT MIN(CAST("${field}" AS DOUBLE)) AS min,
                        MAX(CAST("${field}" AS DOUBLE)) AS max,
                        COUNT(*) AS count
                 FROM dataset
                 WHERE CAST("${field}" AS DOUBLE) IS NOT NULL
                   AND isfinite(CAST("${field}" AS DOUBLE))`,
        { type: "json" },
      )
      .then((result: unknown) => {
        if (cancelled) return;
        const rows = toRows(result);
        const r = rows[0];
        if (r) {
          setStats({
            min: Number(r.min),
            max: Number(r.max),
            count: Number(r.count),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, field]);

  // Step 2: compute bin parameters
  const binParams = useMemo(() => {
    if (!stats || stats.count === 0) return null;
    // Constant-value column: min === max, no meaningful histogram
    if (stats.min === stats.max) return null;
    const range = stats.max - stats.min;
    const binSize = range / binCount;
    return { binStart: stats.min, binSize };
  }, [stats, binCount]);

  // Step 3: query bin counts via useMosaicClient
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
                    FROM dataset
                    WHERE ${String(fieldExpr)} IS NOT NULL AND isfinite(${String(fieldExpr)})
                    GROUP BY bin
                    ORDER BY bin`;
    },
    [field, binParams],
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
    selection: brushSelection,
    query,
    transform,
    enabled: binParams != null,
  });

  // Brush state
  const svgRef = useRef<SVGSVGElement>(null);
  const [brushRange, setBrushRange] = useState<[number, number] | null>(null);
  const brushing = useRef(false);
  const sourceRef = useRef({ reset: () => setBrushRange(null) });

  // Constant-value column: show the value with count instead of empty histogram
  if (stats && stats.count > 0 && stats.min === stats.max) {
    return (
      <div ref={containerRef} className="py-2">
        <span className="inline-block rounded bg-blue-900 px-1.5 py-0.5 font-medium text-[11px] text-white">
          {formatTick(stats.min)}
        </span>
        <span className="ml-1 text-[10px] text-text-muted">({stats.count.toLocaleString()} rows)</span>
      </div>
    );
  }

  if (!binParams || !data || data.length === 0) {
    return (
      <div ref={containerRef} className="py-2 text-[11px] text-text-muted">
        {loading ? "Loading..." : "No data"}
      </div>
    );
  }

  const { binStart, binSize } = binParams;
  const maxCount = Math.max(...data.map((d) => d.countTotal), 1);

  const minBin = Math.min(...data.map((d) => d.bin));
  const maxBin = Math.max(...data.map((d) => d.bin));
  const totalBins = maxBin - minBin + 1;

  // Compute bar geometry from actual container width
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
          if (brushRange) {
            const lo = Math.min(brushRange[0], brushRange[1]);
            const hi = Math.max(brushRange[0], brushRange[1]);
            if (lo < hi) {
              const fieldExpr = cast(column(field), "DOUBLE");
              brushSelection.update({
                source: sourceRef.current,
                clients: new Set(),
                value: [lo, hi],
                predicate: isBetween(fieldExpr, [literal(lo), literal(hi)]) as ExprNode,
              });
            }
          }
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

        {/* Brush overlay */}
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
                  fill="rgba(34, 211, 238, 0.15)"
                  stroke="rgba(34, 211, 238, 0.5)"
                  strokeWidth={1}
                />
              );
            })()
          : null}

        {/* Axis line */}
        <line
          x1={0}
          y1={CHART_HEIGHT + 0.5}
          x2={w}
          y2={CHART_HEIGHT + 0.5}
          className="stroke-border-subtle"
          strokeWidth={1}
        />

        {/* X axis labels */}
        <text
          x={0}
          y={TOTAL_HEIGHT - 3}
          className="fill-text-muted"
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
        >
          {stats?.min != null ? formatTick(stats.min) : ""}
        </text>
        <text
          x={w}
          y={TOTAL_HEIGHT - 3}
          textAnchor="end"
          className="fill-text-muted"
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
