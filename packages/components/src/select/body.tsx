import { quoteIdent, type FilterClause } from "@ndea/protocol";
import type { ComponentHost } from "@ndea/sdk";
import { cn } from "@ndea/ui/lib/utils";
import { useEffect, useState, useSyncExternalStore } from "react";

import { toRows } from "../query/mosaic";
import type { SelectConfig } from "./definition";

const FACET = "select";

/** A column's values (with obs counts under the view's predicate) as pills; the chosen set is its `in` clause. */
export function SelectBody({ host }: { host: ComponentHost<SelectConfig> }) {
  const { column } = host.config;
  const predicate = useSyncExternalStore(
    (onChange) => host.filter.subscribeResolved(onChange),
    () => host.filter.getResolved().predicate,
  );
  const [chosen, setChosen] = useState(() => {
    const own = host.filter.facet(FACET);
    return new Set(own?.op === "in" ? own.values.map(String) : []);
  });
  const [options, setOptions] = useState<{ value: string; n: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const col = quoteIdent(column);
    host.data.coordinator
      .query(
        `SELECT CAST(${col} AS VARCHAR) AS value, COUNT(*)::INT AS n FROM ${host.data.table}${predicate ? ` WHERE ${predicate}` : ""} GROUP BY 1 ORDER BY 2 DESC LIMIT 200`,
      )
      .then(
        (result) => live && (setOptions(toRows<{ value: string; n: number }>(result)), setError(null)),
        (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
      );
    return () => {
      live = false;
    };
  }, [host, column, predicate]);

  const toggle = (value: string) => {
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setChosen(next);
    const clause: FilterClause | null = next.size > 0 ? { op: "in", column, values: [...next] } : null;
    if (clause) host.filter.publish(FACET, clause);
    else host.filter.clear(FACET);
  };

  if (error) return <div className="p-2.5 font-mono text-destructive text-sm">{error}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-auto p-2">
      {(options ?? []).map(({ value, n }) => {
        const on = chosen.has(value);
        return (
          <button
            type="button"
            key={value}
            aria-pressed={on}
            onClick={() => toggle(value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-0.5 text-sm",
              on
                ? "bg-accent text-accent-foreground"
                : "bg-muted text-foreground hover:shadow-[inset_0_0_0_1px_var(--line-3)]",
            )}
          >
            {value}
            <span className={cn("font-mono text-xs tabular-nums", on ? "opacity-70" : "text-text-muted")}>
              {n.toLocaleString("en-US")} obs
            </span>
          </button>
        );
      })}
    </div>
  );
}
