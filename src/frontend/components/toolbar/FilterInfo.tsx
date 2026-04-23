import type { FilterExpr } from "@uwdata/mosaic-sql";
import { cast, count, Query, sum } from "@uwdata/mosaic-sql";
import { useCallback } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "../../lib/mosaic-helpers";

interface PointCounts {
  total: number;
  filtered: number;
}

export function FilterInfo() {
  const { meta } = useDashboard();
  const { coordinator, brushSelection, table } = meta;

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
    const rows = toRows(result);
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

  if (!data) {
    return <div className="ml-auto font-mono text-2xs text-text-muted tabular-nums" />;
  }

  const isFiltered = data.filtered < data.total;

  return (
    <div className="ml-auto font-mono text-2xs text-text-muted tabular-nums">
      {isFiltered
        ? `${data.filtered.toLocaleString()} / ${data.total.toLocaleString()} points`
        : `${data.total.toLocaleString()} points`}
    </div>
  );
}
