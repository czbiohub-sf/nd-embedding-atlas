/**
 * Node-anatomy fitness functions (nodes-as-internal-plugins). They keep the
 * canonical node layout from eroding:
 *   1. fs ↔ registry agree — every registered node spec is exactly one
 *      `nodes/**​/node.tsx`, and vice-versa. Add a node without a `node.tsx`
 *      (or a `node.tsx` that doesn't register) and this fails.
 *   2. ratchet: the legacy `<x>.node.tsx` spec naming is gone — the spec is
 *      always `node.tsx`.
 *   3. ratchet: node views are `view.tsx`, never `<X>PluginView.tsx`.
 *
 * Naming is the contract here; behavior is covered by node-registry.test.ts
 * (every type resolves a spec) and host-routing.test.ts (cross-view routing).
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

import { listWorkspaceNodeSpecs } from "@/core/workspace/definitions";

const APP_ROOT = resolve(import.meta.dir, "../../../..");
const glob = (pattern: string) => [...new Glob(pattern).scanSync(APP_ROOT)];

// `selection` is an explicit tuple compatibility definition without its own
// implementation folder.
const INLINE_ALIASES = new Set(["selection"]);

describe("node anatomy (internal-plugin contract)", () => {
  test("every real node spec lives at nodes/**/node.tsx — fs ↔ registry agree", () => {
    const specFiles = glob("src/frontend/nodes/**/node.tsx");
    const realNodes = listWorkspaceNodeSpecs().filter((s) => !INLINE_ALIASES.has(s.type));
    expect(specFiles.length, `node.tsx files: ${specFiles.join(", ")}`).toBe(realNodes.length);
  });

  test("ratchet: legacy <x>.node.tsx spec naming is gone (spec is node.tsx)", () => {
    const legacy = glob("src/frontend/**/*.node.tsx");
    expect(legacy, `legacy spec names remain: ${legacy.join(", ")}`).toEqual([]);
  });

  test("ratchet: node views are view.tsx, not <X>PluginView.tsx", () => {
    const legacy = glob("src/frontend/nodes/**/*PluginView.tsx");
    expect(legacy, `legacy view names remain: ${legacy.join(", ")}`).toEqual([]);
  });
});
