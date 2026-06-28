/**
 * Annotate node body — a labeling cursor over a working set (two doors, one node).
 *
 * IN: the upstream predicate (a lasso `sel` or a PRQL/SQL `pred`), delivered on
 * `host.inputSelection` like Table/Gallery. That predicate is the iteration
 * domain. OUT: a `focus` — the obs under the cursor — pushed via
 * `host.highlight.set`, so wired viewers (Idetik, Gallery) follow it.
 *
 * Two shadcn Base UI tabs flip the write mode:
 *  - "Many"        batch — stamp one label across the whole scope (server-side
 *                  `WHERE`, scales to millions; never materializes row ids).
 *  - "One by one"  cursor — step obs-by-obs; a label key writes THAT obs
 *                  (`writeAnnotationByPredicate` over `__row_index__ = id`) and
 *                  auto-advances. Eyes on the viewers, hands here.
 *
 * Plugins never touch `/api/*` — reads go through `host.api.query` (the "read"
 * seam), writes through `host.api.write/createAnnotationColumn` ("annotate").
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bracketed } from "@/components/ui/bracketed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { predicateToSql, toRows } from "@/lib/mosaic-helpers";
import { cn } from "@/lib/utils";
import type { NodeViewProps } from "@/core/node/sdk";

export interface AnnotateConfig {
  /** Target annotation column (existing or freshly created). */
  column: string | null;
  /** Label vocabulary the cursor stamps; index 0 is the batch default. */
  labels: string[];
}
export type AnnotateOptions = Record<never, never>;

// ponytail: the cursor reviews a bounded set; the batch path is server-side
// WHERE (unbounded), so only the one-by-one list is capped. Raise if a real
// review set exceeds it.
const WORKING_SET_CAP = 5000;
const LOOKAHEAD = 4;

interface WorkRow {
  id: string;
  value: string | null;
}

/** One-key hotkey per label: first unused letter, else its 1-based digit. */
function hotkeysFor(labels: string[]): string[] {
  const used = new Set<string>();
  return labels.map((l, i) => {
    const c = l.trim()[0]?.toLowerCase();
    if (c && /[a-z]/.test(c) && !used.has(c)) {
      used.add(c);
      return c;
    }
    return String(i + 1);
  });
}

export function AnnotateView({ host }: NodeViewProps<AnnotateConfig, AnnotateOptions>) {
  const [columns, setColumns] = useState<string[]>([]);
  const [column, setColumn] = useState<string | null>(host.config.column);
  const [newColumn, setNewColumn] = useState("");
  const [labelsText, setLabelsText] = useState((host.config.labels ?? []).join(", "));
  const [tab, setTab] = useState<"many" | "one">("many");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // cursor state
  const [work, setWork] = useState<WorkRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [labeled, setLabeled] = useState<Set<string>>(() => new Set());

  const labels = useMemo(
    () =>
      labelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [labelsText],
  );
  const hotkeys = useMemo(() => hotkeysFor(labels), [labels]);
  const [batchValue, setBatchValue] = useState<string>("");

  const scopePredicate = predicateToSql(host.inputSelection);
  const hasScope = scopePredicate != null;
  const targetColumn = newColumn.trim() || column;

  // Load existing annotation columns once.
  useEffect(() => {
    let alive = true;
    void host.api
      .listAnnotationColumns?.()
      ?.then((cols) => {
        if (alive) setColumns(cols.map((c) => c.name));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  // Fetch the scope count + the (capped, ordered) working set whenever the scope
  // or the target column changes. Values are read for the target column so the
  // cursor shows what's already labeled. Reflected locally on write (no refetch),
  // so the QueryManager's SQL-text cache never serves a stale value back.
  useEffect(() => {
    if (scopePredicate == null) {
      setWork([]);
      setCount(null);
      setCursor(0);
      return;
    }
    const ctrl = new AbortController();
    const valueCol = targetColumn && columns.includes(targetColumn) ? `, "${targetColumn}"` : "";
    const table = host.data.table;
    void (async () => {
      try {
        const [countRows, workRows] = await Promise.all([
          host.api
            .query(`SELECT count(*)::INT AS n FROM "${table}" WHERE ${scopePredicate}`, ctrl.signal)
            .then(toRows<{ n: number }>),
          host.api
            .query(
              `SELECT __row_index__${valueCol} FROM "${table}" WHERE ${scopePredicate} ORDER BY __row_index__ LIMIT ${WORKING_SET_CAP}`,
              ctrl.signal,
            )
            .then(toRows<Record<string, unknown>>),
        ]);
        if (ctrl.signal.aborted) return;
        setCount(countRows[0]?.n ?? 0);
        setWork(
          workRows.map((r) => ({
            id: String(r.__row_index__),
            value: valueCol && r[targetColumn!] != null ? String(r[targetColumn!]) : null,
          })),
        );
        setCursor(0);
      } catch {
        /* superseded / aborted — leave prior state */
      }
    })();
    return () => ctrl.abort();
  }, [scopePredicate, targetColumn, columns, host]);

  // Drive the focus wire: the obs under the cursor → Idetik / Gallery follow.
  const current = work[cursor];
  useEffect(() => {
    if (tab === "one" && current) host.highlight.set(current.id);
  }, [tab, current, host]);

  const ensureColumn = useCallback(
    async (col: string) => {
      if (columns.includes(col)) return;
      await host.api.createAnnotationColumn?.(col);
      setColumns((c) => [...c, col]);
      setColumn(col);
      setNewColumn("");
      host.patchConfig({ column: col });
    },
    [columns, host],
  );

  async function applyMany() {
    const value = batchValue.trim() || labels[0];
    if (!targetColumn || !value || busy || scopePredicate == null) return;
    setBusy(true);
    setStatus(null);
    try {
      await ensureColumn(targetColumn);
      const res = await host.api.writeAnnotationByPredicate?.(targetColumn, value, scopePredicate);
      const n = res?.n ?? 0;
      persistLabels();
      setStatus(`✓ ${n.toLocaleString()} obs → ${targetColumn} = "${value}"`);
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function labelCurrent(value: string) {
    if (!targetColumn || !current || busy) return;
    const id = current.id;
    setBusy(true);
    try {
      await ensureColumn(targetColumn);
      await host.api.writeAnnotationByPredicate?.(targetColumn, value, `__row_index__ = ${id}`);
      setWork((w) => w.map((r, i) => (i === cursor ? { ...r, value } : r)));
      setLabeled((s) => new Set(s).add(id));
      persistLabels();
      advance();
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    setCursor((c) => Math.min(c + 1, work.length - 1));
  }
  function persistLabels() {
    host.patchConfig({ labels });
  }

  // Cursor keyboard: label hotkeys write + advance, Space skips, arrows nudge.
  // Container-scoped (tabIndex) so it never fights other nodes' inputs.
  function onCursorKey(e: React.KeyboardEvent) {
    if (tab !== "one") return;
    const k = e.key.toLowerCase();
    if (e.key === " ") {
      e.preventDefault();
      advance();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      advance();
      return;
    }
    const idx = hotkeys.indexOf(k);
    if (idx >= 0) {
      e.preventDefault();
      void labelCurrent(labels[idx]);
    }
  }

  const noScope = (
    <span className="text-warning">
      ⚠ No input wired — connect a Filter / Selection so labels are scoped, not the whole dataset.
    </span>
  );

  return (
    <div className="flex h-full w-full flex-col gap-2 p-2 text-xs">
      {/* ── always-visible target: column + label vocabulary ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-text-muted">col</span>
          <select
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5"
            value={newColumn ? "" : (column ?? "")}
            onChange={(e) => {
              setNewColumn("");
              setColumn(e.target.value || null);
              host.patchConfig({ column: e.target.value || null });
            }}
          >
            <option value="">— select —</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            className="h-6 w-24 px-1.5 py-0.5 text-xs"
            placeholder="+ new…"
            value={newColumn}
            onChange={(e) => setNewColumn(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-text-muted">labels</span>
          <Input
            className="h-6 min-w-0 flex-1 px-1.5 py-0.5 text-xs"
            placeholder="infected, uninfected…"
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            onBlur={persistLabels}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "many" | "one")} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="many">
            Many {count != null && <Bracketed className="ml-1">{count.toLocaleString()}</Bracketed>}
          </TabsTrigger>
          <TabsTrigger value="one">One by one</TabsTrigger>
        </TabsList>

        {/* ── batch door ── */}
        <TabsContent value="many" className="flex flex-col gap-2 pt-2">
          {!hasScope ? (
            noScope
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {labels.length === 0 && <span className="text-text-muted">add labels above ↑</span>}
                {labels.map((l) => (
                  <Button
                    key={l}
                    variant={batchValue === l ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setBatchValue(l)}
                  >
                    {l}
                  </Button>
                ))}
              </div>
              <Button
                variant="default"
                size="sm"
                className="h-7"
                disabled={busy || !targetColumn || !(batchValue.trim() || labels[0])}
                onClick={() => void applyMany()}
              >
                {busy ? "Applying…" : `Apply to ${count?.toLocaleString() ?? "all"} obs`}
              </Button>
              {status && <span className="break-words text-text-muted">{status}</span>}
            </>
          )}
        </TabsContent>

        {/* ── cursor door ── */}
        <TabsContent
          value="one"
          tabIndex={0}
          onKeyDown={onCursorKey}
          className="flex flex-col gap-2 pt-2 outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
        >
          {!hasScope ? (
            noScope
          ) : work.length === 0 ? (
            <span className="text-text-muted">empty scope</span>
          ) : (
            <>
              <div className="flex items-baseline justify-between font-mono">
                <span>
                  obs <span className="text-foreground">{current?.id}</span>
                </span>
                <span className="text-text-muted tabular-nums">
                  {cursor + 1} / {work.length.toLocaleString()}
                  {work.length >= WORKING_SET_CAP ? "+" : ""}
                </span>
              </div>
              <div className="text-text-muted">
                {targetColumn ?? "—"} ={" "}
                <span className={current?.value ? "text-primary" : "text-text-muted/60"}>
                  {current?.value ?? "unlabeled"}
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {labels.length === 0 && <span className="text-text-muted">add labels above ↑</span>}
                {labels.map((l, i) => (
                  <Button
                    key={l}
                    variant={current?.value === l ? "default" : "outline"}
                    size="sm"
                    className="h-6 gap-1 px-2"
                    disabled={busy}
                    onClick={() => void labelCurrent(l)}
                  >
                    {l} <Kbd>{hotkeys[i]}</Kbd>
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-text-muted" onClick={advance}>
                  skip <Kbd>␣</Kbd>
                </Button>
              </div>

              {/* lookahead — the next few obs in the set */}
              <div className="flex items-center gap-1 font-mono text-2xs text-text-muted/70">
                <span>next</span>
                {work.slice(cursor + 1, cursor + 1 + LOOKAHEAD).map((r) => (
                  <span key={r.id} className={cn(r.value && "text-primary/70")}>
                    {r.id}
                  </span>
                ))}
                {cursor + 1 >= work.length && <span>— end —</span>}
              </div>

              {/* tally */}
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${work.length ? (labeled.size / work.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="shrink-0 text-text-muted tabular-nums">
                  {labeled.size} / {work.length.toLocaleString()}
                </span>
              </div>
              <span className="text-2xs text-text-muted/60">click to focus, then key the label</span>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
