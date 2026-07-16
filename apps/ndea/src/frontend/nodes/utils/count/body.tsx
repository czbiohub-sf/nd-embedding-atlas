import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { NodeBodyProps } from "@/core/node/app-node-host";
import { predicateToSql, toRows } from "@/lib/mosaic-helpers";
import type { CountCapabilities } from "./node";
import { countQuery } from "./query";

export function CountBody({ host }: NodeBodyProps<unknown, CountCapabilities>) {
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
        if (active) setCount(toRows<{ n: number }>(result)[0]?.n ?? 0);
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
}
