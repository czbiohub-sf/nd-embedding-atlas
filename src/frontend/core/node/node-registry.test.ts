/**
 * Fitness functions — the guards that keep the node layer evolutionary
 * (evolutionary-node-design plan, U6). They fail CI when the seam erodes:
 *   1. every node type resolves to a registered `WsNodeSpec` — node identity is
 *      now ONE source of truth (the spec); NODE_DEFS is a derived view. A type
 *      in the union with no spec (or vice-versa) fails here, so drift between
 *      the WsNodeType union and the registry becomes impossible;
 *   2. every spec's config schema accepts a fresh (empty) config (a newly-added
 *      node can't ship a schema that rejects its own default);
 *   3. node-type dispatch doesn't creep back — `switch (node.type)` /
 *      `switch (def.type)` stays at ZERO. Both the cook switch
 *      (`registerEngineNode`) and the body switch (`NdGraphNode`) are gone:
 *      cook + body resolve through the spec registry, and the one instance-
 *      driven node (threshold) converges via the `registerEngine` escape hatch,
 *      not a switch. The ratchet locks that in.
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";

import { registerBuiltinNodes } from "@/core/workspace/nodes";
import { getWsNode } from "@/core/workspace/node-kit";
import type { WsNodeType } from "@/core/workspace/types";
import { registerDescriptors } from "@/core/workspace/descriptors";
import { parseConfig } from "./registry";

// Register both halves of the registry, exactly as the app does at boot.
registerBuiltinNodes();
registerDescriptors();

// Every member of the compile-time union — the every-type-has-a-spec guard ties
// the union (compile-time exhaustiveness) to the registry (runtime dispatch).
const ALL_TYPES: WsNodeType[] = [
  "obs",
  "dataset",
  "threshold",
  "wrangle",
  "annotate",
  "count",
  "table",
  "scatter",
  "gallery",
  "fov",
  "collection",
  "export",
  "cache",
  "selection",
  "subnet",
  "proxy",
];

describe("node registry fitness functions", () => {
  test("every node type resolves to a registered node spec", () => {
    for (const type of ALL_TYPES) {
      expect(getWsNode(type), `node type "${type}" has no registered WsNodeSpec`).toBeDefined();
    }
  });

  test("every spec's config schema accepts a fresh (empty) config", () => {
    for (const type of ALL_TYPES) {
      const spec = getWsNode(type);
      if (spec?.config) {
        expect(parseConfig(spec, {}).ok, `spec "${type}" config schema rejects a fresh {} config`).toBe(true);
      }
    }
  });

  test("no node-type dispatch switch remains (ratchet at 0)", () => {
    let count = 0;
    const hits: string[] = [];
    for (const file of new Glob("src/frontend/**/*.{ts,tsx}").scanSync(".")) {
      if (file.includes(".test.")) continue; // the guard targets production code
      const matches = readFileSync(file, "utf8").match(/switch\s*\(\s*(node|def)\.type\s*\)/g);
      if (matches) {
        count += matches.length;
        hits.push(`${file} (${matches.length})`);
      }
    }
    // Baseline 0: cook + body both dispatch through `getWsNode(type)`; threshold
    // (the one instance-driven node) converges via `registerEngine`, not a switch.
    expect(count, `unexpected node-type switch(es): ${hits.join(", ")}`).toBe(0);
  });
});
