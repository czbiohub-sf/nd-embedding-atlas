/**
 * GraphEngine: the node-graph evaluation core.
 *
 * Implements the **hybrid push-dirty / pull-cook** model that Houdini, Blender
 * geometry-nodes, and TouchDesigner all converge on:
 *
 *   - PUSH  `markDirty(id)` bumps a monotonic `epoch`, marks the node + every
 *           transitively-downstream node dirty, and aborts the prior epoch's
 *           signal (so a superseded async cook can cancel).
 *   - PULL  `pull(id, ctx)` walks UPSTREAM and cooks on demand. A *clean* node
 *           (`!dirty` with a valid cache) HALTS the walk and returns its cache :
 *           the Houdini "clean node is a cache boundary" rule.
 *   - EMIT  `emit(id, port, value)` records an **authored** output on a source
 *           port: the push half of push/pull unified into one value model. A
 *           derived output exists because a cook computed it; an emission
 *           exists because the user acted (a lasso, a row focus). Edges whose
 *           `(from, fromPort)` carries an emission read it directly; everything
 *           downstream is dirtied (the source itself is NOT: its derived
 *           output didn't change) and ordinary pull delivery does the rest.
 *   - DEDUP a per-sweep `visited` set (Houdini's `markVisitPass`) cooks a shared
 *           upstream node once per flush even in a diamond, and guards against
 *           re-entry if a cook is ever made async.
 *   - FAN-IN a port with >1 incoming edge hands its cook the RAW value array in
 *           edge-insertion order: composition (AND/OR/diff/latest-wins) is the
 *           cook's decision, not the engine's. `andPreds` is the exported
 *           helper for the common predicate case.
 *   - LAZY  only *registered* sinks (mounted, display-active views) are pulled
 *           on `flush`. A closed view unregisters → its upstream transforms are
 *           never cooked.
 *
 * The engine is value-generic (`GraphEngine<V>`) and framework-agnostic: no
 * React, no Mosaic, no xyflow, and no knowledge of port *kinds*: typing is a
 * descriptor/canvas concern. This package also supplies the tagged NDEA value
 * union (pred/sel/focus) and evaluator used by the app runtime.
 */

import type { NodeComputeContext, PredicatePortValue } from "@ndea/sdk/graph";

/** The classic edge payload: a SQL predicate, or `null` = "everything". */
export type Predicate = PredicatePortValue;

/**
 * A node's cook function: given the RAW per-input-port value arrays (fan-in
 * order = edge insertion order), produce this node's derived output.
 */
export type GraphCookFunction<V> = (inputs: ReadonlyMap<string, readonly V[]>, ctx: NodeComputeContext) => V;

export interface GraphNodeEvaluationSpec<V> {
  id: string;
  /** Display/debug only; the engine evaluates every node uniformly via `cook`. */
  kind: "source" | "transform" | "view";
  cook: GraphCookFunction<V>;
}

export interface GraphEvaluationEdge {
  from: string;
  /** Source port id. An edge reads the emission on `(from, fromPort)` when one
   *  exists, else the source's derived (cooked) output. Default: "out". */
  fromPort?: string;
  to: string;
  /** Target input-port id: edges sharing a `toPort` fan in together. */
  toPort: string;
}

/** A sink (display-active view) gets its pulled output value pushed here. */
export type GraphSinkListener<V> = (value: V) => void;

/**
 * Cook-telemetry event: feeds node LEDs (clean/dirty/cooking), cooking-dash
 * animation, per-node cook milliseconds, and the status bar.
 *
 *   - `dirty`     : the node flipped clean → dirty in a `markDirty` cascade
 *                    (emitted once per node per cascade).
 *   - `cook-start`: the node's `cook` fn is about to run (cache hits emit
 *                    nothing).
 *   - `cook-end`  : the node's `cook` fn returned; `ms` is the duration of
 *                    THIS node's cook fn only, not its upstream recursion.
 *   - `emit`      : an authored value landed on `(node, port)`; downstream
 *                    was dirtied, the node itself stays clean.
 *   - `flush`     : a flush completed: every registered sink delivered, the
 *                    cooked graph is settled at `epoch`. node is "*" (whole
 *                    graph). The post-flush read signal (e.g. batched counts).
 */
export interface GraphEvaluationTelemetryEvent {
  node: string;
  type: "dirty" | "cook-start" | "cook-end" | "emit" | "flush";
  /** cook-end only: `performance.now()` delta of the cook fn. */
  ms?: number;
  /** emit only: the source port carrying the authored value. */
  port?: string;
  /** Engine epoch at emission. */
  epoch: number;
}

export type GraphEvaluationTelemetryListener = (event: GraphEvaluationTelemetryEvent) => void;

interface GraphNode<V> {
  spec: GraphNodeEvaluationSpec<V>;
  dirty: boolean;
  /** Epoch at which `cached` was computed; `-1` = never cooked. */
  cachedEpoch: number;
  cached: V | undefined;
}

/** AND-compose predicate strings, dropping `null` ("everything") operands. */
export function andPreds(parts: readonly Predicate[]): Predicate {
  const live = parts.filter((p): p is string => p !== null && p.trim().length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  return live.map((p) => `(${p})`).join(" AND ");
}

/** OR-compose predicate strings; `null` ("everything") short-circuits to null. */
export function orPreds(parts: readonly Predicate[]): Predicate {
  if (parts.some((p) => p === null || p.trim().length === 0)) return null;
  const live = parts as readonly string[];
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  return live.map((p) => `(${p})`).join(" OR ");
}

export interface GraphEngineOptions<V> {
  /**
   * How a `flush` is scheduled after a dirty/emit. Defaults to a synchronous
   * scheduler (tests, SSR); the browser layer passes a `requestAnimationFrame`
   * scheduler so a burst of dirties coalesces into one cook pass per frame.
   */
  schedule?: (flush: () => void) => void;
  /**
   * Bypass composition (Houdini `b`): how a bypassed node's inputs pass
   * through uncooked. Required before `setBypass` is used with a non-Predicate
   * value type; the default flattens all ports and AND-composes entries that
   * look like predicates (correct for `GraphEngine<Predicate>`).
   */
  passthrough?: (inputs: ReadonlyMap<string, readonly V[]>) => V;
}

export class GraphEngine<V = Predicate> {
  private readonly nodes = new Map<string, GraphNode<V>>();
  private edges: GraphEvaluationEdge[] = [];
  private readonly sinks = new Map<string, { readonly listener: GraphSinkListener<V> }>();
  private readonly telemetryListeners = new Set<GraphEvaluationTelemetryListener>();
  /** authored outputs, keyed `${id}:${port}` */
  private readonly emissions = new Map<string, V>();

  private epochCounter = 0;
  private epochController = new AbortController();
  private flushScheduled = false;
  private readonly schedule: (flush: () => void) => void;
  private readonly passthrough: (inputs: ReadonlyMap<string, readonly V[]>) => V;

  constructor(opts: GraphEngineOptions<V> = {}) {
    this.schedule = opts.schedule ?? ((flush) => flush());
    this.passthrough =
      opts.passthrough ??
      ((inputs) => {
        const flat = [...inputs.values()].flat();
        return andPreds(flat as readonly Predicate[]) as V;
      });
  }

  /** Monotonic graph epoch: exposed for staleness checks / debugging. */
  get epoch(): number {
    return this.epochCounter;
  }

  // ── Topology ────────────────────────────────────────────────────────────────

  addNode(spec: GraphNodeEvaluationSpec<V>): void {
    if (this.nodes.has(spec.id)) throw new Error(`graph: duplicate node id '${spec.id}'`);
    this.nodes.set(spec.id, { spec, dirty: true, cachedEpoch: -1, cached: undefined });
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.sinks.delete(id);
    for (const key of this.emissions.keys()) if (key.startsWith(`${id}:`)) this.emissions.delete(key);
    // Drop incident edges; dirty the far endpoint of any inbound-to-others edge.
    const survivors: GraphEvaluationEdge[] = [];
    for (const e of this.edges) {
      if (e.from === id || e.to === id) {
        if (e.from === id && this.nodes.has(e.to)) this.markDirty(e.to);
      } else {
        survivors.push(e);
      }
    }
    this.edges = survivors;
  }

  /**
   * Non-mutating connect check: `connect` would succeed. Exposed so the canvas
   * can gate `isValidConnection` (live drag feedback) on the same DAG rule.
   */
  canConnect(edge: Pick<GraphEvaluationEdge, "from" | "to">): boolean {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) return false;
    if (edge.from === edge.to) return false;
    // A new edge from→to closes a cycle iff `from` is already reachable from `to`.
    return !this.reaches(edge.to, edge.from);
  }

  /**
   * Add an edge. Rejects (returns `false`, no mutation) if either endpoint is
   * unknown or if the edge would close a cycle: DAG-only. On success the
   * target is dirtied.
   */
  connect(edge: GraphEvaluationEdge): boolean {
    if (!this.canConnect(edge)) return false;
    this.edges.push(edge);
    this.markDirty(edge.to);
    return true;
  }

  disconnect(edge: GraphEvaluationEdge): void {
    const before = this.edges.length;
    this.edges = this.edges.filter(
      (e) =>
        !(
          e.from === edge.from &&
          e.to === edge.to &&
          e.toPort === edge.toPort &&
          (e.fromPort ?? "out") === (edge.fromPort ?? "out")
        ),
    );
    if (this.edges.length !== before && this.nodes.has(edge.to)) this.markDirty(edge.to);
  }

  /** Is `target` reachable from `start` by following edges downstream? */
  private reaches(start: string, target: string): boolean {
    if (start === target) return true;
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of this.edges) if (e.from === cur) stack.push(e.to);
    }
    return false;
  }

  // ── Push: dirty ─────────────────────────────────────────────────────────────

  /**
   * Mark `id` and every transitively-downstream node dirty, bump the epoch,
   * abort the prior epoch's in-flight work, and schedule a flush. Idempotent
   * within a frame (the scheduler coalesces).
   */
  markDirty(id: string): void {
    if (!this.nodes.has(id)) return;
    this.bumpEpoch();
    this.dirtyCascade([id]);
    this.scheduleFlush();
  }

  private bumpEpoch(): void {
    this.epochCounter += 1;
    this.epochController.abort();
    this.epochController = new AbortController();
  }

  /** BFS downstream from the given roots, marking dirty + announcing flips. */
  private dirtyCascade(roots: string[]): void {
    const stack = [...roots];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = this.nodes.get(cur);
      if (node && !node.dirty) {
        node.dirty = true;
        this.emitTelemetry({ node: cur, type: "dirty", epoch: this.epochCounter });
      }
      for (const e of this.edges) if (e.from === cur) stack.push(e.to);
    }
  }

  // ── Push: authored emissions ────────────────────────────────────────────────

  /**
   * Record an authored value on a source port (a lasso, a row focus: values
   * that exist because the user acted, not because a cook derived them).
   * Edges from `(id, port)` deliver this value; the node itself stays clean
   * (its derived output didn't change), but everything downstream of those
   * edges is dirtied and a flush is scheduled.
   */
  emit(id: string, port: string, value: V): void {
    if (!this.nodes.has(id)) return;
    this.emissions.set(`${id}:${port}`, value);
    this.bumpEpoch();
    this.emitTelemetry({ node: id, type: "emit", port, epoch: this.epochCounter });
    const targets = this.edges.filter((e) => e.from === id && (e.fromPort ?? "out") === port).map((e) => e.to);
    this.dirtyCascade(targets);
    this.scheduleFlush();
  }

  /** The current authored value on `(id, port)`, if any. */
  getEmission(id: string, port: string): V | undefined {
    return this.emissions.get(`${id}:${port}`);
  }

  clearEmission(id: string, port: string): void {
    if (!this.emissions.delete(`${id}:${port}`)) return;
    this.bumpEpoch();
    const targets = this.edges.filter((e) => e.from === id && (e.fromPort ?? "out") === port).map((e) => e.to);
    this.dirtyCascade(targets);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.schedule(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  // ── Pull / cook ─────────────────────────────────────────────────────────────

  /**
   * Cook every registered sink (display-active views) with a fresh per-sweep
   * `visited` set shared across sinks, so a shared upstream node cooks once per
   * flush. Closed/unregistered sinks are never pulled → their upstream is never
   * cooked (lazy, display-active gating).
   */
  flush(): void {
    const ctx = this.currentContext();
    const visited = new Set<string>();
    for (const [id, { listener }] of this.sinks) {
      listener(this.pullInternal(id, ctx, visited));
    }
    // the graph is settled: post-flush readers (batched counts) key off this
    this.emitTelemetry({ node: "*", type: "flush", epoch: this.epochCounter });
  }

  private currentContext(): NodeComputeContext {
    return { signal: this.epochController.signal, epoch: this.epochCounter };
  }

  /**
   * Pull a node's output value. Public entry uses a private per-call visited
   * set; the cache-boundary rule means repeated pulls within one epoch are O(1).
   */
  pull(id: string, ctx: NodeComputeContext = this.currentContext()): V {
    return this.pullInternal(id, ctx, new Set<string>());
  }

  private pullInternal(id: string, ctx: NodeComputeContext, visited: Set<string>): V {
    const node = this.nodes.get(id);
    if (!node) return undefined as V;

    // markVisitPass dedup: a node already cooked in this sweep returns its cache
    // (and guards async re-entry).
    if (visited.has(id)) return node.cached as V;

    // Cache boundary: a clean node with a valid cache halts the upstream walk.
    if (!node.dirty && node.cachedEpoch >= 0) {
      visited.add(id);
      return node.cached as V;
    }

    visited.add(id);

    // Resolve inputs grouped by target port: RAW arrays, edge-insertion order.
    // An edge whose (from, fromPort) carries an emission reads the authored
    // value; otherwise it pulls the source's derived output.
    const inputs = new Map<string, V[]>();
    for (const e of this.edges) {
      if (e.to !== id) continue;
      const emissionKey = `${e.from}:${e.fromPort ?? "out"}`;
      // has() not ??: an authored null (e.g. a cleared lasso) must DELIVER null,
      // not fall back to the derived output.
      const upstream = this.emissions.has(emissionKey)
        ? (this.emissions.get(emissionKey) as V)
        : this.pullInternal(e.from, ctx, visited);
      const bucket = inputs.get(e.toPort);
      if (bucket) bucket.push(upstream);
      else inputs.set(e.toPort, [upstream]);
    }

    // Bypass (Houdini `b` flag): the node's own cook is skipped entirely and
    // the composed input passes through uncooked. Downstream ripples as if the
    // node weren't there.
    if (this.bypassed.has(id)) {
      const through = this.passthrough(inputs);
      node.cached = through;
      node.cachedEpoch = ctx.epoch;
      node.dirty = false;
      return through;
    }

    // Telemetry brackets the cook fn ONLY (inputs above already pulled, so the
    // ms delta excludes upstream recursion). Zero-overhead when nobody listens.
    const traced = this.telemetryListeners.size > 0;
    let t0 = 0;
    if (traced) {
      this.emitTelemetry({ node: id, type: "cook-start", epoch: this.epochCounter });
      t0 = performance.now();
    }
    const output = node.spec.cook(inputs, ctx);
    if (traced) {
      this.emitTelemetry({
        node: id,
        type: "cook-end",
        ms: performance.now() - t0,
        epoch: this.epochCounter,
      });
    }
    node.cached = output;
    node.cachedEpoch = ctx.epoch;
    node.dirty = false;
    return output;
  }

  // ── Flags ─────────────────────────────────────────────────────────────────────

  private readonly bypassed = new Set<string>();

  /**
   * Bypass a node (Houdini `b`): its cook is skipped and the passthrough-
   * composed input flows through uncooked. Toggling dirties node + downstream.
   */
  setBypass(id: string, on: boolean): void {
    if (!this.nodes.has(id)) return;
    if (on === this.bypassed.has(id)) return;
    if (on) this.bypassed.add(id);
    else this.bypassed.delete(id);
    this.markDirty(id);
  }

  // ── Sinks ─────────────────────────────────────────────────────────────────────

  /** Register a display-active sink. Pulled on every flush until unregistered. */
  registerSink(id: string, listener: GraphSinkListener<V>): () => void {
    const registration = { listener };
    this.sinks.set(id, registration);
    // Cook it immediately so a freshly-mounted view gets its current value.
    listener(this.pull(id));
    return () => {
      if (this.sinks.get(id) === registration) this.sinks.delete(id);
    };
  }

  unregisterSink(id: string): void {
    this.sinks.delete(id);
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to cook-telemetry events. Returns an idempotent unsubscribe.
   * Listener exceptions are swallowed so a faulty observer can never break
   * cooking; with zero listeners the cook path pays nothing.
   */
  onTelemetry(listener: GraphEvaluationTelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  private emitTelemetry(event: GraphEvaluationTelemetryEvent): void {
    for (const listener of this.telemetryListeners) {
      try {
        listener(event);
      } catch {
        // a faulty observer must never break cooking
      }
    }
  }

  /** Test/introspection helper. */
  dirtyNodes(): string[] {
    return [...this.nodes.values()].filter((n) => n.dirty).map((n) => n.spec.id);
  }
}
