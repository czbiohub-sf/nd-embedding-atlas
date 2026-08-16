import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import type { CountNodeHost, CountPredicateToSql } from "./contracts";
import { countQuery } from "./query";

const CountRowSchema = z.object({ n: z.number() });
const IterableQueryResultSchema = z.custom<Iterable<unknown>>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function",
);

function countFromQueryResult(result: unknown): number {
  const rows = Array.isArray(result) ? result : Array.from(IterableQueryResultSchema.parse(result));
  return CountRowSchema.parse(rows[0]).n;
}

export function createCountBody(predicateToSql: CountPredicateToSql) {
  return function CountBody({ host }: { host: CountNodeHost }) {
    const selection = host.inputPredicate;
    const subscribe = useCallback(
      (onChange: () => void) => {
        selection.addEventListener("value", onChange);
        return () => selection.removeEventListener("value", onChange);
      },
      [selection],
    );
    const predicate = useSyncExternalStore(subscribe, () => predicateToSql(selection));
    const [count, setCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let active = true;
      setCount(null);
      setError(null);
      void host.dataAPI
        .query(countQuery(host.data.table, predicate), host.signal)
        .then((result) => {
          if (active) setCount(countFromQueryResult(result));
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        });
      return () => {
        active = false;
      };
    }, [host, predicate]);

    return (
      <span
        className={`font-mono text-[22px] font-semibold tabular-nums${error ? " text-destructive" : ""}`}
        title={error ?? undefined}
      >
        {error ? "✗" : count === null ? "…" : count.toLocaleString("en-US")}
      </span>
    );
  };
}
