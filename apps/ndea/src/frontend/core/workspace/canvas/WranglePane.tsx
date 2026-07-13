/**
 * WranglePane — the wrangle node's body: a PRQL editor over the node's input
 * relation ("VEX for data"). Debounced compile → DuckDB SQL client-side; the
 * compiled predicate is handed to the engine (ws.setWranglePred), which ANDs
 * it with upstream in the cook. A status line shows compiled / error / empty.
 *
 * Lite semantics: the node emits a PREDICATE — membership in the rows the
 * pipeline selects (`__obs_index__ IN (SELECT __obs_index__ FROM (<sql>))`),
 * so it composes as a mask with the rest of the graph. A DESCRIBE probe
 * classifies the compiled SQL: keeps `__obs_index__` → row filter; drops it
 * (aggregate / narrow select) → "reshaping", passes through (a relation
 * output for the later rel-wire phase, NOT a silent all-rows mask); binder
 * rejection (bad column) → error. PRQL is schema-blind, so the probe is the
 * second validation layer that catches column typos.
 */

import { useEffect, useRef, useState } from "react";

import { PrqlEditor } from "@/components/nd/PrqlEditor";
import { NdHud } from "@/components/nd/nd-primitives";
import { compilePrql, type PrqlError } from "../prql";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";

const DEBOUNCE_MS = 280;

type WrangleStatus = "clean" | "compiling" | "error" | "empty" | "reshaping";

export function WranglePane({ id }: { id: string }) {
  const ws = useWorkspace();
  const prql = useWorkspaceSelector((s) => (s.nodes[id]?.config as { prql?: string } | undefined)?.prql ?? "");
  const table = ws.deps.table;
  const [error, setError] = useState<PrqlError | null>(null);
  const [status, setStatus] = useState<WrangleStatus>(prql.trim() ? "clean" : "empty");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);

  // compile the CURRENT text (debounced) → predicate + status. Runs on mount
  // and whenever the text changes; independent of upstream (cook ANDs that).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const src = prql.trim();
    if (!src) {
      setStatus("empty");
      setError(null);
      ws.setWranglePred(id, null);
      return;
    }

    // Validate the compiled SQL against the LIVE schema via DESCRIBE — the
    // second validation layer (PRQL is schema-blind; the DuckDB binder catches
    // bad column refs). Three outcomes:
    //   · filter    — output carries __obs_index__ → usable as a row mask
    //   · reshaping — valid SQL but no __obs_index__ (aggregate / narrow select);
    //                 NOT a row filter — pass through, don't correlate-and-lie
    //   · error     — binder rejected it (typo'd column, bad ref) → show it
    const validate = async (sql: string): Promise<"filter" | "reshaping" | { error: string }> => {
      try {
        const t = await ws.deps.coordinator.query(`DESCRIBE (${sql})`);
        const cols = [...(t as Iterable<{ column_name: string }>)].map((row) => row.column_name);
        return cols.includes("__obs_index__") ? "filter" : "reshaping";
      } catch (e) {
        const raw = String((e as { message?: string }).message ?? e);
        return {
          error: raw
            .replace(/^[A-Za-z ]*Error:\s*/, "")
            .split("\n")[0]
            .slice(0, 160),
        };
      }
    };

    setStatus("compiling");
    const myGen = ++gen.current;
    timer.current = setTimeout(() => {
      void (async () => {
        const r = await compilePrql(prql, table);
        if (myGen !== gen.current) return; // superseded by a newer keystroke
        if (!r.ok) {
          setError(r.error);
          setStatus("error");
          // keep the last good predicate — don't flap the graph mid-keystroke
          return;
        }
        const v = await validate(r.sql);
        if (myGen !== gen.current) return;
        if (typeof v === "object") {
          // binder rejected the compiled SQL — surface it on the whole pipeline
          setError({ reason: v.error, from: 0, to: prql.length });
          setStatus("error");
          return;
        }
        if (v === "reshaping") {
          setError(null);
          setStatus("reshaping");
          ws.setWranglePred(id, null); // not a filter — pass through, don't lie
          return;
        }
        setError(null);
        setStatus("clean");
        ws.setWranglePred(id, `"__obs_index__" IN (SELECT "__obs_index__" FROM (${r.sql}))`);
      })();
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [prql, table, id, ws]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1 rounded border border-border bg-muted px-1.5">
        <PrqlEditor value={prql} onChange={(next) => ws.setWranglePrql(id, next)} error={error} />
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
