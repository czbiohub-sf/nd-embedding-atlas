import { useEffect, useState } from "react";
import { z } from "zod";
import type { ComponentHost } from "@ndea/sdk";
import { toRows, usePredicateSql } from "../query/mosaic";
import { countQuery } from "./query";

const CountRowSchema = z.object({ n: z.number() });

type Counted = { predicate: string | null } & ({ count: number } | { error: string });

export function CountBody({ host }: { host: ComponentHost }) {
  const predicate = usePredicateSql(host.predicate);
  const [counted, setCounted] = useState<Counted | null>(null);

  useEffect(() => {
    let active = true;
    void host.data.coordinator
      .query(countQuery(host.data.table, predicate))
      .then((result) => {
        if (active) setCounted({ predicate, count: CountRowSchema.parse(toRows(result)[0]).n });
      })
      .catch((reason: unknown) => {
        if (active) setCounted({ predicate, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      active = false;
    };
  }, [host, predicate]);

  // An answer for an older predicate reads as loading.
  const current = counted?.predicate === predicate ? counted : null;
  const error = current && "error" in current ? current.error : null;
  return (
    <span
      className={`font-mono text-[22px] font-semibold tabular-nums${error ? " text-destructive" : ""}`}
      title={error ?? undefined}
    >
      {error ? "✗" : current && "count" in current ? current.count.toLocaleString("en-US") : "…"}
    </span>
  );
}
