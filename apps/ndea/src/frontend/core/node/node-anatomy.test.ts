/**
 * Node-anatomy fitness functions (nodes-as-internal-plugins). They keep the
 * canonical node layout from eroding:
 *   1. fs ↔ registry agree: every registered built-in has one app-owned
 *      native contribution beside the registry.
 *   2. ratchet: legacy app-local node implementation directories stay gone.
 *   3. ratchet: package node views are `view.tsx`, never `<X>PluginView.tsx`.
 *
 * Naming is the contract here; behavior is covered by node-registry.test.ts
 * (every type resolves a spec) and host-routing.test.ts (cross-view routing).
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

import { createNativeAppNodeLibrary } from "./library";

const nativeNodeLibrary = createNativeAppNodeLibrary();

const APP_ROOT = resolve(import.meta.dir, "../../../..");
const WORKSPACE_ROOT = resolve(APP_ROOT, "../..");
const glob = (pattern: string) => [...new Glob(pattern).scanSync(APP_ROOT)];
const workspaceGlob = (pattern: string) => [...new Glob(pattern).scanSync(WORKSPACE_ROOT)];

describe("node anatomy (internal-plugin contract)", () => {
  test("every built-in has one app native contribution: fs ↔ registry agree", () => {
    const contributionFiles = glob("src/frontend/core/node/native-contributions/*.tsx");
    expect(contributionFiles.length, `contributions: ${contributionFiles.join(", ")}`).toBe(
      nativeNodeLibrary.listSpecs().length,
    );
  });

  test("ratchet: app-local node implementation directories stay gone", () => {
    expect(glob("src/frontend/nodes/**/*")).toEqual([]);
  });

  test("ratchet: package node views are view.tsx, not <X>PluginView.tsx", () => {
    const legacy = workspaceGlob("packages/nodes/src/**/*PluginView.tsx");
    expect(legacy, `legacy view names remain: ${legacy.join(", ")}`).toEqual([]);
  });
});
