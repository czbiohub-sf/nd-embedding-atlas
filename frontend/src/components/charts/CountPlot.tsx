import type { ExprNode, FilterExpr } from "@uwdata/mosaic-sql";
import {
    asc,
    cast,
    column,
    count,
    desc,
    isNotDistinct,
    isNotNull,
    isNull,
    literal,
    or,
    Query,
    sum,
} from "@uwdata/mosaic-sql";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "../../lib/mosaic-helpers";

const NULL_VALUE = "__null__";

interface CountPlotRow {
    value: string | null;
    count: number;
    countSelected: number;
}

interface Props {
    field: string;
    limit?: number;
}

export function CountPlot({ field, limit = 11 }: Props) {
    const { meta } = useDashboard();
    const { coordinator, brushSelection, table } = meta;

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const sourceRef = useRef({ reset: () => setSelected(new Set()) });

    const textExpr = useMemo(() => cast(column(field), "TEXT"), [field]);

    const query = useCallback(
        (predicate: FilterExpr) => {
            const pred = filterExprToExpr(predicate);
            return Query.from(table)
                .select({
                    value: textExpr,
                    count: count(),
                    countSelected: sum(cast(pred, "INT")),
                })
                .groupby(textExpr)
                .orderby(isNotNull(textExpr), desc(count()), asc("value"))
                .limit(limit);
        },
        [table, limit, textExpr],
    );

    const transform = useCallback((result: unknown): CountPlotRow[] => {
        const rows = toRows(result);
        return rows.map((r) => ({
            value: r.value != null ? String(r.value) : null,
            count: Number(r.count),
            countSelected: Number(r.countSelected),
        }));
    }, []);

    const { data, loading } = useMosaicClient({
        coordinator,
        selection: brushSelection,
        query,
        transform,
    });

    // Click a bar to toggle filter
    const handleClick = (value: string | null) => {
        const key = value ?? NULL_VALUE;
        const next = new Set(selected);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        setSelected(next);

        if (next.size === 0) {
            brushSelection.update({
                source: sourceRef.current,
                clients: new Set(),
                value: null,
                predicate: null,
            });
        } else {
            const predicates = [...next].map((v) => {
                if (v === NULL_VALUE) return isNull(textExpr) as ExprNode;
                return isNotDistinct(textExpr, literal(v)) as ExprNode;
            });
            brushSelection.update({
                source: sourceRef.current,
                clients: new Set(),
                value: [...next],
                predicate: or(...predicates) as ExprNode,
            });
        }
    };

    if (!data || data.length === 0) {
        return <div className="py-2 text-[11px] text-text-muted">{loading ? "Loading..." : "No data"}</div>;
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
                        className={`flex h-6 w-full items-center gap-2 rounded-sm text-left hover:bg-elevated/50 ${
                            isActive ? "" : "opacity-35"
                        }`}
                        onClick={() => handleClick(row.value)}
                    >
                        {/* Label */}
                        <span
                            className="min-w-0 max-w-[40%] shrink-0 truncate font-mono text-[11px] text-text-secondary"
                            title={row.value ?? "(null)"}
                        >
                            {row.value ?? "(null)"}
                        </span>

                        {/* Bar */}
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

                        {/* Count */}
                        <span className="shrink-0 font-mono text-[11px] text-text-muted tabular-nums">
                            {row.countSelected.toLocaleString()}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
