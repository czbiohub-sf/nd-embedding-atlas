import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { getWsNode, listWsNodes } from "@/core/workspace/node-kit";
import type { WsNodeType } from "@/core/workspace/types";
import { registerBuiltins } from "@/core/workspace/descriptors";
import { parseConfig } from "./registry";

registerBuiltins();
const APP_ROOT = resolve(import.meta.dir, "../../../..");

// Keep the compile-time union and runtime registry in lockstep.
const ALL_TYPES: WsNodeType[] = [
  "obs",
  "dataset",
  "threshold",
  "wrangle",
  "annotate",
  "count",
  "table",
  "scatter",
  "count-plot",
  "histogram",
  "gallery",
  "fov",
  "collection",
  "export",
  "cache",
  "selection",
  "subnet",
  "proxy",
];

const REGISTRATION_ORDER: WsNodeType[] = [
  "obs",
  "dataset",
  "threshold",
  "wrangle",
  "annotate",
  "count",
  "table",
  "scatter",
  "count-plot",
  "histogram",
  "gallery",
  "fov",
  "collection",
  "export",
  "cache",
  "subnet",
  "proxy",
  "selection",
];

describe("node registry fitness functions", () => {
  test("every node type resolves to a registered node spec", () => {
    for (const type of ALL_TYPES) {
      expect(getWsNode(type), `node type "${type}" has no registered WsNodeSpec`).toBeDefined();
    }
  });

  test("built-in bootstrap is idempotent and preserves registry order", () => {
    registerBuiltins();
    expect(listWsNodes().map((spec) => spec.type)).toEqual(REGISTRATION_ORDER);
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
    for (const file of new Glob("src/frontend/**/*.{ts,tsx}").scanSync(APP_ROOT)) {
      if (file.includes(".test.")) continue; // the guard targets production code
      const matches = readFileSync(join(APP_ROOT, file), "utf8").match(/switch\s*\(\s*(node|def)\.type\s*\)/g);
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
