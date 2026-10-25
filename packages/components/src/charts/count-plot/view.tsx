import type { FilterClause } from "@ndea/protocol";
import type { FilterCoordinationAPI } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type FilterExpr, cast, column } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BodyProps } from "../../contracts";
import type { ChartServices, UseChartQuery } from "../core/contracts";
import { FieldPicker } from "../core/field-picker";
import { buildCountPlotQuery } from "../core/filter-queries";
import { toRows } from "../core/mosaic-helpers";
import { useChartLeaf } from "../core/use-chart-leaf";
import { countPlotPredicate, NULL_VALUE } from "./predicate";
import type { CountPlotConfig } from "./types";

interface CountPlotRow {
  value: string | null;
  count: number;
  countSelected: number;
}

export function createCountPlotView({ useColumnTypes, useQuery }: ChartServices) {
  const CountPlotBody = createCountPlotBody(useQuery);
  return function CountPlotView({ host }: BodyProps<CountPlotConfig>) {
    const { coordinator, table, filter, field, setField } = useChartLeaf(host);
    const types = useColumnTypes(coordinator);
    const limit = host.config.limit ?? 11;
    const onFilter = useCallback(
      (clause: FilterClause | null) => {
        if (clause === null) host.filter.clear("chart");
        else host.filter.publish("chart", clause);
      },
      [host],
    );

    return (
      <div className="flex h-full w-full flex-col gap-1.5 overflow-y-auto bg-surface p-2">
        <FieldPicker types={types} value={field} kinds={["string", "boolean"]} onPick={setField} />
        {field == null ? (
          <div className="px-1 py-2 text-sm text-muted-foreground/60">Pick a column to plot.</div>
        ) : (
          <CountPlotBody
            key={field}
            coordinator={coordinator}
            table={table}
            filter={filter}
            field={field}
            limit={limit}
            onFilter={onFilter}
          />
        )}
      </div>
    );
  };
}

interface ChartBodyProps {
  coordinator: Coordinator;
  table: string;
  filter: FilterCoordinationAPI;
  field: string;
  limit: number;
  onFilter: (clause: FilterClause | null) => void;
}

function createCountPlotBody(useQuery: UseChartQuery) {
  return function CountPlotBody({ coordinator, table, filter, field, limit, onFilter }: ChartBodyProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Clear the published filter when the field changes (this body remounts).
    useEffect(() => () => onFilter(null), [onFilter]);

    const textExpr = useMemo(() => cast(column(field), "TEXT"), [field]);

    const query = useCallback(
      (predicate: FilterExpr) => buildCountPlotQuery(table, textExpr, limit, predicate),
      [table, limit, textExpr],
    );

    const transform = useCallback((result: unknown): CountPlotRow[] => {
      const rows = toRows(result);
      return rows.map((r) => ({
        value: r.value != null ? String(r.value as string | number | boolean) : null,
        count: Number(r.count),
        countSelected: Number(r.countSelected),
      }));
    }, []);

    const { data, loading } = useQuery({ coordinator, filter, query, transform });

    const handleClick = (value: string | null) => {
      const key = value ?? NULL_VALUE;
      const next = new Set(selected);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      setSelected(next);
      onFilter(countPlotPredicate(field, next));
    };

    if (!data || data.length === 0) {
      return <div className="py-2 text-sm text-muted-foreground">{loading ? "Loading..." : "No data"}</div>;
    }

    const maxCount = Math.max(...data.map((d) => d.count), 1);

    return (
      <div className="flex flex-col gap-0.5">
        {data.map((row) => {
          const key = row.value ?? NULL_VALUE;
          const isActive = selected.size === 0 || selected.has(key);
          const barWidthTotal = (row.count / maxCount) * 100;
          const barWidthSelected = row.count > 0 ? (row.countSelected / maxCount) * 100 : 0;

          return (
            <button
              type="button"
              key={key}
              className={`flex h-6 w-full items-center gap-2 rounded-sm text-left hover:bg-muted/50 ${
                isActive ? "" : "opacity-35"
              }`}
              onClick={() => handleClick(row.value)}
            >
              <span
                className="min-w-0 max-w-[40%] shrink-0 truncate font-mono text-sm text-muted-foreground"
                title={row.value ?? "(null)"}
              >
                {row.value ?? "(null)"}
              </span>

              <div className="relative h-3.5 min-w-0 flex-1">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-chart-mark-fade"
                  style={{ width: `${barWidthTotal}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-chart-mark transition-[width] duration-100"
                  style={{ width: `${barWidthSelected}%` }}
                />
              </div>

              <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
                {row.countSelected.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    );
  };
}
