import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { getWsNode, listWsNodes } from "@/core/workspace/node-kit";
import type { WsNodeType } from "@/core/workspace/types";
import { registerBuiltins } from "@/core/workspace/definitions";
import { getDefinition, getNode, listNodes, parseConfig } from "./registry";
import { loadNodeModule } from "./load-module";

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

const DEFINITION_IDS = ["scatter", "table", "count-plot", "histogram", "gallery", "annotate"] as const;

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

  test("each same-id built-in keeps graph runtime app-local and definition metadata authoritative", () => {
    for (const id of DEFINITION_IDS) {
      const node = getNode(id);
      const definition = getDefinition(id);
      expect(definition, `definition "${id}" is not registered`).toBeDefined();
      expect(node, `node "${id}" is not registered`).toBeDefined();
      expect(node).not.toBe(definition);
      expect(node?.title).toBe(definition?.title);
      expect(typeof (node as { cook?: unknown }).cook, `node "${id}" lost its graph runtime`).toBe("function");
      expect(typeof definition?.load, `definition "${id}" lost its lazy module`).toBe("function");
    }
  });

  test("each built-in registry identity is unique while legacy split names remain unchanged", () => {
    const ids = listNodes().map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getNode("fov")?.title).toBe("Idetik");
    expect(getDefinition("image-viewer")?.title).toBe("Image Viewer");
    expect(getNode("threshold")?.title).toBe("Threshold Filter");
    expect(getDefinition("transform-filter")?.title).toBe("Threshold Filter");
  });

  test("native view modules expose framework-neutral Body mounts, not React components", async () => {
    const module = await loadNodeModule("scatter");
    expect(module.mountBody).toBeFunction();
    expect("Component" in module).toBe(false);
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
