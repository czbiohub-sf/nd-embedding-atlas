/**
 * NodeCounts: ONE batched count query per engine flush.
 *
 * useNodeCount hooks register their node while count-active (a refcount, so
 * the canvas card and a stage tile can both ask); after every engine flush
 * the controller pulls each registered node's predicate (cache-aware: the
 * flush just cooked them) and issues a single
 *
 *   SELECT count(*) FILTER (WHERE p₀) AS c0, … FROM <table>
 *
 *: N predicates share one table scan instead of N round-trips, and the
 * post-flush `flush` telemetry event replaces the old setTimeout(30) race
 * (hope-the-rAF-flush-landed) in the per-node hooks.
 *
 * Only REGISTERED nodes are pulled: pulling cooks, and the lazy-sink rule
 * (display-active nodes only) must hold for counts exactly as it did when
 * each hook pulled for itself.
 */

import { Store } from "@tanstack/store";

export interface NodeCountsDeps {
  /** post-flush, cache-aware predicate read; null/undefined → unfiltered */
  predicateOf: (nodeId: string) => string | null;
  query: (sql: string) => Promise<unknown>;
  toRows: <T>(result: unknown) => T[];
  table: string;
}

const DEBOUNCE_MS = 30;

export class NodeCounts {
  /** nodeId → row count under the node's cooked predicate */
  readonly store = new Store<Record<string, number>>({});
  /** nodeId → error reason when the last batch count failed (else absent) */
  readonly errors = new Store<Record<string, string>>({});

  private refs = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  private readonly deps: NodeCountsDeps;

  constructor(deps: NodeCountsDeps) {
    this.deps = deps;
  }

  /** count this node while mounted-active; returns the unregister */
  register(nodeId: string): () => void {
    this.refs.set(nodeId, (this.refs.get(nodeId) ?? 0) + 1);
    this.refresh();
    return () => {
      const n = (this.refs.get(nodeId) ?? 1) - 1;
      if (n <= 0) this.refs.delete(nodeId);
      else this.refs.set(nodeId, n);
    };
  }

  /** debounced (trailing): rapid flushes during a drag collapse to one query */
  refresh(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    const ids = [...this.refs.keys()];
    if (ids.length === 0) return;
    const gen = ++this.generation;

    // aliases are positional (node ids contain hyphens); predicate text is
    // baked in, so Mosaic's text-keyed query cache stays correct under the
    // repo's revision-suffix convention for mutable temp tables
    const cols = ids.map((id, i) => {
      const p = this.deps.predicateOf(id);
      return p ? `count(*) FILTER (WHERE ${p}) AS c${i}` : `count(*) AS c${i}`;
    });
    const sql = `SELECT ${cols.join(", ")} FROM ${this.deps.table}`;

    let row: Record<string, number | bigint> | undefined;
    try {
      row = this.deps.toRows<Record<string, number | bigint>>(await this.deps.query(sql))[0];
    } catch (e) {
      // Don't freeze stale numbers silently: flag the failed nodes so the UI can
      // show ✗ instead of a confidently-wrong count. (Superseded epochs are
      // filtered by the generation check below, so they don't reach here.)
      if (gen !== this.generation || this.disposed) return;
      const reason = e instanceof Error ? e.message : String(e);
      this.errors.setState((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = reason;
        return next;
      });
      return;
    }
    if (gen !== this.generation || this.disposed || !row) return;

    // Success → clear any prior error flags for the nodes we just counted.
    if (ids.some((id) => this.errors.state[id] !== undefined)) {
      this.errors.setState((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    }

    this.store.setState(() => {
      const next: Record<string, number> = {};
      ids.forEach((id, i) => {
        next[id] = Number(row[`c${i}`] ?? 0);
      });
      return next;
    });
  }
}
