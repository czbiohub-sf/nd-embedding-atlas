import { describe, expect, test } from "bun:test";
import {
  andPreds,
  GraphEngine,
  orPreds,
  type GraphCookFunction,
  type GraphEvaluationTelemetryEvent,
  type Predicate,
} from "./engine";

/** A cook that records how many times it ran (cache-boundary / dedup probes). */
function counted(fn: GraphCookFunction<Predicate>): { cook: GraphCookFunction<Predicate>; calls: () => number } {
  let n = 0;
  return {
    cook: (inputs, ctx) => {
      n += 1;
      return fn(inputs, ctx);
    },
    calls: () => n,
  };
}

/** A view sink cooks as AND of its single input port "in" (the common case). */
const passThrough: GraphCookFunction<Predicate> = (inputs) => andPreds(inputs.get("in") ?? []);

describe("GraphEngine", () => {
  test("source → transform → sink: null source means 'everything', transform AND-composes", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "src", kind: "source", cook: () => null });
    engine.addNode({
      id: "filter",
      kind: "transform",
      cook: (inputs) => {
        const upstream = andPreds(inputs.get("in") ?? []);
        return upstream ? `(${upstream}) AND (x > 5)` : "x > 5";
      },
    });
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    expect(engine.connect({ from: "src", to: "filter", toPort: "in" })).toBe(true);
    expect(engine.connect({ from: "filter", to: "sink", toPort: "in" })).toBe(true);

    // null upstream drops out → just the threshold clause flows to the sink.
    expect(engine.pull("sink")).toBe("x > 5");
  });

  test("cache boundary: a clean upstream node is NOT recooked when only a dependent changes", () => {
    const engine = new GraphEngine();
    const src = counted(() => "src_pred");
    const filter = counted((inputs) => `(${andPreds(inputs.get("in") ?? [])}) AND (x > 5)`);
    engine.addNode({ id: "src", kind: "source", cook: src.cook });
    engine.addNode({ id: "filter", kind: "transform", cook: filter.cook });
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "filter", toPort: "in" });
    engine.connect({ from: "filter", to: "sink", toPort: "in" });

    engine.pull("sink");
    expect(src.calls()).toBe(1);
    expect(filter.calls()).toBe(1);

    // Dirty ONLY the transform — source stays clean.
    engine.markDirty("filter");
    engine.pull("sink");

    expect(src.calls()).toBe(1); // cache boundary halted the walk at the clean source
    expect(filter.calls()).toBe(2);
  });

  test("diamond dedup: a shared upstream cooks once per pull sweep", () => {
    const engine = new GraphEngine();
    const src = counted(() => "base");
    engine.addNode({ id: "src", kind: "source", cook: src.cook });
    engine.addNode({ id: "a", kind: "transform", cook: (i) => `(${andPreds(i.get("in") ?? [])}) AND (a)` });
    engine.addNode({ id: "b", kind: "transform", cook: (i) => `(${andPreds(i.get("in") ?? [])}) AND (b)` });
    // Both branches fan into the sink's single "in" port.
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "a", toPort: "in" });
    engine.connect({ from: "src", to: "b", toPort: "in" });
    engine.connect({ from: "a", to: "sink", toPort: "in" });
    engine.connect({ from: "b", to: "sink", toPort: "in" });

    const out = engine.pull("sink");
    expect(src.calls()).toBe(1); // cooked once despite two paths
    // Fan-in AND of the two branches (each carrying the shared base).
    expect(out).toBe("((base) AND (a)) AND ((base) AND (b))");
  });

  test("fan-in: cooks receive RAW arrays in edge-insertion order — composition is theirs", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "p", kind: "source", cook: () => "a > 1" });
    engine.addNode({ id: "q", kind: "source", cook: () => "b < 2" });
    // One sink ANDs, another ORs the SAME fan-in — engine stays policy-free.
    engine.addNode({ id: "andSink", kind: "view", cook: (i) => andPreds(i.get("in") ?? []) });
    engine.addNode({ id: "orSink", kind: "view", cook: (i) => orPreds(i.get("in") ?? []) });
    engine.addNode({ id: "rawSink", kind: "view", cook: (i) => JSON.stringify(i.get("in") ?? []) });
    for (const sink of ["andSink", "orSink", "rawSink"]) {
      engine.connect({ from: "p", to: sink, toPort: "in" });
      engine.connect({ from: "q", to: sink, toPort: "in" });
    }

    expect(engine.pull("andSink")).toBe("(a > 1) AND (b < 2)");
    expect(engine.pull("orSink")).toBe("(a > 1) OR (b < 2)");
    expect(engine.pull("rawSink")).toBe('["a > 1","b < 2"]'); // insertion order preserved
  });

  test("DAG-only: a cycle-closing edge (and a self-edge) is rejected without mutation", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "n1", kind: "source", cook: () => "1" });
    engine.addNode({ id: "n2", kind: "transform", cook: passThrough });
    engine.addNode({ id: "n3", kind: "transform", cook: passThrough });
    expect(engine.connect({ from: "n1", to: "n2", toPort: "in" })).toBe(true);
    expect(engine.connect({ from: "n2", to: "n3", toPort: "in" })).toBe(true);

    // n3 → n1 would close the cycle n1→n2→n3→n1.
    expect(engine.connect({ from: "n3", to: "n1", toPort: "in" })).toBe(false);
    // self-edge.
    expect(engine.connect({ from: "n1", to: "n1", toPort: "in" })).toBe(false);
    // Unknown endpoint.
    expect(engine.connect({ from: "ghost", to: "n1", toPort: "in" })).toBe(false);

    // Graph still acyclic & pullable (no infinite recursion).
    expect(engine.pull("n3")).toBe("1");
  });

  test("canConnect mirrors connect's DAG rule without mutating (isValidConnection gate)", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "n1", kind: "source", cook: () => "1" });
    engine.addNode({ id: "n2", kind: "transform", cook: passThrough });
    engine.connect({ from: "n1", to: "n2", toPort: "in" });

    expect(engine.canConnect({ from: "n2", to: "n1" })).toBe(false); // cycle
    expect(engine.canConnect({ from: "n1", to: "n1" })).toBe(false); // self
    expect(engine.canConnect({ from: "ghost", to: "n2" })).toBe(false); // unknown
    expect(engine.canConnect({ from: "n1", to: "n2" })).toBe(true); // (parallel edge OK)

    // Pure check: nothing was dirtied and no edge was added.
    expect(engine.dirtyNodes()).toEqual(["n1", "n2"]); // initial dirty-on-add state only
    expect(engine.pull("n2")).toBe("1");
  });

  test("disconnect dirties the target so it recooks without the removed input", () => {
    const engine = new GraphEngine({ schedule: (flush) => flush() });
    engine.addNode({ id: "src", kind: "source", cook: () => "x > 5" });
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "sink", toPort: "in" });

    const cooked: Predicate[] = [];
    engine.registerSink("sink", (p) => cooked.push(p));
    expect(cooked.at(-1)).toBe("x > 5");

    engine.disconnect({ from: "src", to: "sink", toPort: "in" });
    expect(cooked.at(-1)).toBe(null); // edge gone → no input → "everything"
  });

  test("display-active gating: only registered sinks are pulled on flush; unregister stops cooking", () => {
    const cooked: Predicate[] = [];
    // Synchronous scheduler so markDirty → flush in-line.
    const engine = new GraphEngine({ schedule: (flush) => flush() });
    let threshold = 5;
    const filter = counted((i) => {
      const up = andPreds(i.get("in") ?? []);
      return up ? `(${up}) AND (x > ${threshold})` : `x > ${threshold}`;
    });
    engine.addNode({ id: "src", kind: "source", cook: () => null });
    engine.addNode({ id: "filter", kind: "transform", cook: filter.cook });
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "filter", toPort: "in" });
    engine.connect({ from: "filter", to: "sink", toPort: "in" });

    const off = engine.registerSink("sink", (p) => cooked.push(p));
    // registerSink cooks immediately.
    expect(cooked.at(-1)).toBe("x > 5");
    const afterRegister = filter.calls();

    // Param change → dirty the transform → flush re-cooks the registered sink.
    threshold = 7;
    engine.markDirty("filter");
    expect(cooked.at(-1)).toBe("x > 7");
    expect(filter.calls()).toBeGreaterThan(afterRegister);

    // Unregister (view closed) → further dirties never cook this branch.
    off();
    const beforeClosed = filter.calls();
    threshold = 9;
    engine.markDirty("filter");
    expect(filter.calls()).toBe(beforeClosed); // not recooked — no display-active sink
    expect(cooked.at(-1)).toBe("x > 7"); // listener never fired again
  });

  test("epoch advances on every markDirty (staleness signal source)", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "n", kind: "source", cook: () => null });
    const e0 = engine.epoch;
    engine.markDirty("n");
    expect(engine.epoch).toBe(e0 + 1);
    engine.markDirty("n");
    expect(engine.epoch).toBe(e0 + 2);
  });

  // ── Cook telemetry ──────────────────────────────────────────────────────────

  /** src → filter → sink chain, pulled once so every node starts clean. */
  function cleanChain(): GraphEngine {
    const engine = new GraphEngine();
    engine.addNode({ id: "src", kind: "source", cook: () => "base" });
    engine.addNode({ id: "filter", kind: "transform", cook: (i) => `(${andPreds(i.get("in") ?? [])}) AND (x > 5)` });
    engine.addNode({ id: "sink", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "filter", toPort: "in" });
    engine.connect({ from: "filter", to: "sink", toPort: "in" });
    engine.pull("sink"); // cook everything clean
    return engine;
  }

  test("telemetry: markDirty cascade emits 'dirty' once for the node + each clean→dirty downstream", () => {
    const engine = cleanChain();
    const events: GraphEvaluationTelemetryEvent[] = [];
    engine.onTelemetry((e) => events.push(e));

    engine.markDirty("filter"); // dirties filter + sink; src stays clean
    const dirtied = events.filter((e) => e.type === "dirty");
    expect(dirtied.map((e) => e.node).toSorted()).toEqual(["filter", "sink"]);
    // Epoch stamped at emission = the freshly-bumped markDirty epoch.
    expect(dirtied.every((e) => e.epoch === engine.epoch)).toBe(true);

    // Re-dirtying an already-dirty subtree re-emits nothing (no sink registered,
    // so the synchronous flush cooked nothing and the nodes are still dirty).
    // (flush markers fire per flush regardless — filter them out here.)
    const nonFlush = () => events.filter((e) => e.type !== "flush");
    const before = nonFlush().length;
    engine.markDirty("filter");
    expect(nonFlush().length).toBe(before);

    // Once src is dirtied too, the cascade announces ONLY the newly-flipped node.
    engine.markDirty("src");
    expect(
      nonFlush()
        .slice(before)
        .map((e) => `${e.type}:${e.node}`),
    ).toEqual(["dirty:src"]);
  });

  test("telemetry: cook-start/cook-end bracket real cooks with ms >= 0; cache hits emit nothing", () => {
    const engine = cleanChain();
    const events: GraphEvaluationTelemetryEvent[] = [];
    engine.onTelemetry((e) => events.push(e));

    // Fully clean graph → pull is a pure cache hit → zero cook events.
    engine.pull("sink");
    expect(events).toEqual([]);

    // Dirty the transform; flush (via registered sink) recooks filter + sink only.
    engine.registerSink("sink", () => {});
    engine.markDirty("filter"); // default scheduler flushes synchronously
    const cooks = events.filter((e) => e.type !== "dirty" && e.type !== "flush");
    expect(cooks.map((e) => `${e.type}:${e.node}`)).toEqual([
      "cook-start:filter",
      "cook-end:filter",
      "cook-start:sink",
      "cook-end:sink",
    ]); // src is a clean cache boundary — never bracketed
    for (const e of cooks) {
      if (e.type === "cook-end") {
        expect(e.ms).toBeGreaterThanOrEqual(0);
      } else {
        expect(e.ms).toBeUndefined();
      }
      expect(e.epoch).toBe(engine.epoch);
    }
  });

  test("telemetry: a completed flush announces 'flush' last, at the settled epoch", () => {
    const engine = cleanChain();
    const events: GraphEvaluationTelemetryEvent[] = [];
    engine.onTelemetry((e) => events.push(e));

    engine.registerSink("sink", () => {}); // direct pull — no flush scheduled
    engine.markDirty("filter"); // sync scheduler → cooks then the flush marker

    const last = events[events.length - 1];
    expect(last.type).toBe("flush");
    expect(last.node).toBe("*");
    expect(last.epoch).toBe(engine.epoch);
    expect(events.filter((e) => e.type === "flush").length).toBe(1);
  });

  test("telemetry: unsubscribe stops events and is idempotent; other listeners keep firing", () => {
    const engine = cleanChain();
    const a: GraphEvaluationTelemetryEvent[] = [];
    const b: GraphEvaluationTelemetryEvent[] = [];
    const offA = engine.onTelemetry((e) => a.push(e));
    engine.onTelemetry((e) => b.push(e));

    engine.markDirty("src");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toEqual(a.length);

    offA();
    offA(); // idempotent — second call is a no-op
    const aFrozen = a.length;
    engine.pull("sink"); // recook the dirty chain → cook events for b only
    expect(a.length).toBe(aFrozen);
    expect(b.length).toBeGreaterThan(aFrozen);
  });

  test("telemetry: a throwing listener breaks neither the cook nor later listeners", () => {
    const engine = cleanChain();
    const survived: GraphEvaluationTelemetryEvent[] = [];
    engine.onTelemetry(() => {
      throw new Error("boom");
    });
    engine.onTelemetry((e) => survived.push(e));

    const cooked: Predicate[] = [];
    engine.registerSink("sink", (p) => cooked.push(p));
    engine.markDirty("filter"); // synchronous flush: dirty + cook events, all through the thrower

    expect(cooked.at(-1)).toBe("(base) AND (x > 5)"); // cook completed
    expect(survived.filter((e) => e.type === "dirty").length).toBeGreaterThan(0);
    expect(survived.filter((e) => e.type === "cook-end").length).toBeGreaterThan(0);
  });
});

describe("authored emissions (push unified into pull)", () => {
  /** scatter with a derived "out" (pred) and an authored "push" port (lasso). */
  function pushRig() {
    const engine = new GraphEngine({ schedule: (flush) => flush() });
    const scatterCook = counted((i) => andPreds(i.get("in") ?? []));
    engine.addNode({ id: "src", kind: "source", cook: () => "base" });
    engine.addNode({ id: "scatter", kind: "view", cook: scatterCook.cook });
    engine.addNode({ id: "gallery", kind: "view", cook: (i) => andPreds(i.get("in") ?? []) });
    engine.addNode({ id: "table", kind: "view", cook: (i) => andPreds(i.get("in") ?? []) });
    engine.connect({ from: "src", to: "scatter", toPort: "in" });
    // pred wire reads scatter's DERIVED output; sel wire reads its EMISSION port
    engine.connect({ from: "scatter", fromPort: "out", to: "table", toPort: "in" });
    engine.connect({ from: "scatter", fromPort: "push", to: "gallery", toPort: "in" });
    return { engine, scatterCook };
  }

  test("an emission delivers along its port's edges; derived edges are untouched", () => {
    const { engine } = pushRig();
    expect(engine.pull("table")).toBe("base"); // derived pass-through
    // no lasso yet — nothing on the push port → the edge falls back to pulling
    // the source's derived output (sensible pre-emission default)
    expect(engine.pull("gallery")).toBe("base");

    engine.emit("scatter", "push", "id IN (1,2,3)");
    expect(engine.pull("gallery")).toBe("id IN (1,2,3)"); // authored value, not the derived pred
    expect(engine.pull("table")).toBe("base"); // pred wire unaffected

    engine.emit("scatter", "push", "id IN (4)");
    expect(engine.pull("gallery")).toBe("id IN (4)"); // replaced per lasso
  });

  test("emit dirties ONLY downstream of the port — the source stays clean", () => {
    const { engine, scatterCook } = pushRig();
    engine.pull("table");
    engine.pull("gallery");
    expect(engine.dirtyNodes()).toEqual([]);
    const cookedBefore = scatterCook.calls();

    engine.emit("scatter", "push", "id IN (9)");
    // gallery (downstream of the push port) went dirty; scatter + table did not.
    expect(engine.dirtyNodes()).toEqual(["gallery"]);
    engine.pull("gallery");
    expect(scatterCook.calls()).toBe(cookedBefore); // source never recooked
  });

  test("emit bumps the epoch and announces an 'emit' telemetry event", () => {
    const { engine } = pushRig();
    const events: GraphEvaluationTelemetryEvent[] = [];
    engine.onTelemetry((e) => events.push(e));
    const e0 = engine.epoch;

    engine.emit("scatter", "push", "id IN (1)");
    expect(engine.epoch).toBe(e0 + 1);
    const emits = events.filter((e) => e.type === "emit");
    expect(emits).toHaveLength(1);
    expect(emits[0].node).toBe("scatter");
    expect(emits[0].port).toBe("push");
  });

  test("emissions flow to registered sinks on flush", () => {
    const { engine } = pushRig();
    const seen: Predicate[] = [];
    engine.registerSink("gallery", (v) => seen.push(v));
    engine.emit("scatter", "push", "id IN (7,8)"); // sync scheduler → immediate flush
    expect(seen.at(-1)).toBe("id IN (7,8)");
  });

  test("clearEmission restores the pull fallback and dirties downstream", () => {
    const { engine } = pushRig();
    engine.emit("scatter", "push", "id IN (1)");
    expect(engine.pull("gallery")).toBe("id IN (1)");

    engine.clearEmission("scatter", "push");
    expect(engine.pull("gallery")).toBe("base"); // back to the derived fallback
  });

  test("removeNode drops the node's emissions", () => {
    const { engine } = pushRig();
    engine.emit("scatter", "push", "id IN (1)");
    engine.removeNode("scatter");
    expect(engine.getEmission("scatter", "push")).toBeUndefined();
  });
});

describe("bypass flag", () => {
  test("bypassed transform passes its composed input through uncooked", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "src", kind: "source", cook: () => "base" });
    engine.addNode({ id: "thr", kind: "transform", cook: (i) => `${andPreds(i.get("in") ?? []) ?? ""} AND filtered` });
    engine.addNode({ id: "view", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "thr", toPort: "in" });
    engine.connect({ from: "thr", to: "view", toPort: "in" });

    expect(engine.pull("view")).toBe("base AND filtered");
    engine.setBypass("thr", true);
    expect(engine.pull("view")).toBe("base");
    engine.setBypass("thr", false);
    expect(engine.pull("view")).toBe("base AND filtered");
  });

  test("a custom pass-through drives non-predicate value types through bypass", () => {
    type V = { n: number };
    const engine = new GraphEngine<V>({
      passthrough: (inputs) => ({ n: [...inputs.values()].flat().reduce((s, v) => s + v.n, 0) }),
    });
    engine.addNode({ id: "a", kind: "source", cook: () => ({ n: 2 }) });
    engine.addNode({ id: "b", kind: "source", cook: () => ({ n: 3 }) });
    engine.addNode({ id: "t", kind: "transform", cook: () => ({ n: 999 }) });
    engine.addNode({ id: "sink", kind: "view", cook: (i) => (i.get("in") ?? [{ n: -1 }])[0] });
    engine.connect({ from: "a", to: "t", toPort: "in" });
    engine.connect({ from: "b", to: "t", toPort: "in" });
    engine.connect({ from: "t", to: "sink", toPort: "in" });

    expect(engine.pull("sink")).toEqual({ n: 999 });
    engine.setBypass("t", true);
    expect(engine.pull("sink")).toEqual({ n: 5 }); // inputs summed straight through
  });

  test("toggling bypass dirties the node and downstream", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "src", kind: "source", cook: () => null });
    engine.addNode({ id: "thr", kind: "transform", cook: () => "f" });
    engine.addNode({ id: "view", kind: "view", cook: passThrough });
    engine.connect({ from: "src", to: "thr", toPort: "in" });
    engine.connect({ from: "thr", to: "view", toPort: "in" });
    engine.pull("view");
    expect(engine.dirtyNodes()).toEqual([]);
    engine.setBypass("thr", true);
    expect(engine.dirtyNodes().toSorted()).toEqual(["thr", "view"]);
  });

  test("bypass is idempotent — same state never dirties", () => {
    const engine = new GraphEngine();
    engine.addNode({ id: "thr", kind: "transform", cook: () => "f" });
    engine.pull("thr");
    engine.setBypass("thr", false);
    expect(engine.dirtyNodes()).toEqual([]);
  });
});
