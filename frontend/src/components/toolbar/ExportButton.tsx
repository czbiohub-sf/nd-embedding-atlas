import type { FilterExpr } from "@uwdata/mosaic-sql";
import { cast, count, Query, sum } from "@uwdata/mosaic-sql";
import { lazy, Suspense, useCallback, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr } from "../../lib/mosaic-helpers";

const ExportDialog = lazy(() => import("./ExportDialog"));

interface PointCounts {
  total: number;
  filtered: number;
}

export function ExportButton() {
  const { meta } = useDashboard();
  const { coordinator, brushSelection, table } = meta;
  const [open, setOpen] = useState(false);

  const query = useCallback(
    (predicate: FilterExpr) => {
      const pred = filterExprToExpr(predicate);
      return Query.from(table).select({
        total: count(),
        filtered: sum(cast(pred, "INT")),
      });
    },
    [table],
  );

  const transform = useCallback((result: unknown): PointCounts => {
    const rows = Array.isArray(result) ? result : Array.from(result as Iterable<Record<string, unknown>>);
    const r = rows[0];
    return {
      total: Number(r?.total ?? 0),
      filtered: Number(r?.filtered ?? 0),
    };
  }, []);

  const { data } = useMosaicClient({
    coordinator,
    selection: brushSelection,
    query,
    transform,
  });

  const disabled = !data || data.filtered === data.total || data.filtered === 0;

  return (
    <div className="relative">
      <button
        type="button"
        className="font-mono text-[11px] text-text-muted tabular-nums hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Export
      </button>
      <Suspense fallback={null}>
        <ExportDialog open={open} onOpenChange={setOpen} filtered={data?.filtered ?? 0} />
      </Suspense>
    </div>
  );
}
