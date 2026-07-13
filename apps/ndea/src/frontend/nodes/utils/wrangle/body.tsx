import { useEffect, useRef, useState } from "react";

import { PrqlEditor } from "@/components/nd/PrqlEditor";
import { NdHud } from "@/components/nd/nd-primitives";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { WrangleCapabilities, WrangleConfig } from "./node";
import { compilePrql, type PrqlError } from "./prql";

const DEBOUNCE_MS = 280;

type WrangleStatus = "clean" | "compiling" | "error" | "empty" | "reshaping";
type WrangleSqlKind = "filter" | "reshaping" | { error: string };

export async function classifyWrangleSql(
  query: (sql: string, signal?: AbortSignal) => Promise<unknown>,
  sql: string,
  signal?: AbortSignal,
): Promise<WrangleSqlKind> {
  try {
    const result = await query(`DESCRIBE (${sql})`, signal);
    const columns = [...(result as Iterable<{ column_name: string }>)].map((row) => row.column_name);
    return columns.includes("__obs_index__") ? "filter" : "reshaping";
  } catch (error) {
    const raw = String((error as { message?: string }).message ?? error);
    return {
      error: raw
        .replace(/^[A-Za-z ]*Error:\s*/, "")
        .split("\n")[0]
        .slice(0, 160),
    };
  }
}

export function WrangleBody({ host }: NodeBodyProps<WrangleConfig, WrangleCapabilities>) {
  const [prql, setPrql] = useState(host.config.prql ?? "");
  const [error, setError] = useState<PrqlError | null>(null);
  const [status, setStatus] = useState<WrangleStatus>(prql.trim() ? "clean" : "empty");
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const src = prql.trim();
    if (!src) {
      setStatus("empty");
      setError(null);
      host.patchConfig({ predicateSql: null });
      return;
    }

    setStatus("compiling");
    const timer = setTimeout(() => {
      void (async () => {
        const compiled = await compilePrql(prql, host.data.table);
        if (currentGeneration !== generation.current) return;
        if (!compiled.ok) {
          setError(compiled.error);
          setStatus("error");
          return;
        }
        const kind = await classifyWrangleSql(
          (sql, signal) => host.dataAPI.query(sql, signal),
          compiled.sql,
          host.signal,
        );
        if (currentGeneration !== generation.current) return;
        if (typeof kind === "object") {
          setError({ reason: kind.error, from: 0, to: prql.length });
          setStatus("error");
          return;
        }
        setError(null);
        if (kind === "reshaping") {
          setStatus("reshaping");
          host.patchConfig({ predicateSql: null });
          return;
        }
        setStatus("clean");
        host.patchConfig({
          predicateSql: `"__obs_index__" IN (SELECT "__obs_index__" FROM (${compiled.sql}))`,
        });
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (generation.current === currentGeneration) generation.current += 1;
    };
  }, [host, prql]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1 rounded border border-border bg-muted px-1.5">
        <PrqlEditor
          value={prql}
          onChange={(next) => {
            setPrql(next);
            host.patchConfig({ prql: next });
          }}
          error={error}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 px-0.5 font-mono text-3xs leading-none">
        {status === "error" ? (
          <span className="truncate text-destructive" title={error?.reason}>
            ✗ {error?.reason}
          </span>
        ) : status === "compiling" ? (
          <span className="text-text-muted">compiling…</span>
        ) : status === "empty" ? (
          <NdHud size={8}>prql · pass-through</NdHud>
        ) : status === "reshaping" ? (
          <span
            className="truncate text-wire-sel"
            title="this pipeline reshapes the relation (drops per-row identity) — it isn't a row filter. Relation outputs land in the rel-wire phase; as a filter it passes through."
          >
            ⬡ reshaping — not a row filter (pass-through)
          </span>
        ) : (
          <span className="text-success">✓ compiled</span>
        )}
      </div>
    </div>
  );
}
