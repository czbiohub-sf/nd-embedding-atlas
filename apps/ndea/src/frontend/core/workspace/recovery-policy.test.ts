import { describe, expect, test } from "bun:test";

import { createNativeAppNodeLibrary } from "@/core/node/library";
import { toWorkspaceDocument } from "./document";
import { workspaceSurfacePolicy } from "./WorkspaceShell";
import { applyNodeAssetRecovery, initializeWorkspaceDocument } from "./workspace-context";
import type { WorkspaceDocumentState } from "./types";

function emptyState(): WorkspaceDocumentState {
  return {
    nodeAssets: [],
    nodes: {},
    edges: {},
    positions: {},
    sizeOverrides: {},
    formOverride: {},
    formLocked: {},
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeId: null,
    explicit: {},
    stageTree: null,
    disposition: "strip",
    stripH: 280,
    claimed: null,
    graphPath: null,
    flags: {},
    coordinationScopes: {},
    coordinationSpace: {},
  };
}

describe("workspace recovery policy", () => {
  test("an invalid server document opens read-only: never loaded, never overwritten by a seed", () => {
    const invalid = {
      ...toWorkspaceDocument(emptyState()),
      edges: { e1: { id: "e1", from: "ghost", fromPort: "out", to: "ghost", toPort: "in", kind: "pred" } },
    };
    let loads = 0;
    let seeds = 0;
    const workspace = {
      nodeLibrary: createNativeAppNodeLibrary(),
      loadDocument() {
        loads += 1;
      },
    };
    const persistence = initializeWorkspaceDocument(workspace, invalid, () => (seeds += 1));

    expect(loads).toBe(0);
    expect(seeds).toBe(0);
    expect(persistence.mode).toBe("recovery");
    expect(persistence.errors).toEqual(['/edges/e1/from: unknown node "ghost"', '/edges/e1/to: unknown node "ghost"']);

    expect(initializeWorkspaceDocument(workspace, null, () => (seeds += 1))).toEqual({ mode: "writable", errors: [] });
    expect([loads, seeds]).toEqual([0, 1]);
  });

  test("surface policy separates recovery, authoring, and fixed-preset builds", () => {
    expect(workspaceSurfacePolicy("recovery", true)).toEqual({
      recoveryOnly: true,
      mountStage: false,
      mountCanvas: false,
      mountStatusBar: false,
      mountBodies: false,
      editStageLayout: false,
      installAuthoringListeners: false,
    });
    expect(workspaceSurfacePolicy("writable", true)).toEqual({
      recoveryOnly: false,
      mountStage: true,
      mountCanvas: true,
      mountStatusBar: true,
      mountBodies: true,
      editStageLayout: true,
      installAuthoringListeners: true,
    });
    expect(workspaceSurfacePolicy("writable", false)).toEqual({
      recoveryOnly: false,
      mountStage: true,
      mountCanvas: false,
      mountStatusBar: true,
      mountBodies: true,
      editStageLayout: true,
      installAuthoringListeners: false,
    });
  });

  test("node asset storage corruption enters recovery without hiding document failures", () => {
    const assetFailure = {
      kind: "recovery" as const,
      error: "invalid user asset JSON",
      raw: "{broken",
      source: { sourceId: "user", kind: "user" as const, assets: [] },
    };
    expect(applyNodeAssetRecovery({ mode: "writable", errors: [] }, assetFailure)).toEqual({
      mode: "recovery",
      errors: ["user node asset storage: invalid user asset JSON"],
    });
    expect(applyNodeAssetRecovery({ mode: "recovery", errors: ["graph cycle"] }, assetFailure)).toEqual({
      mode: "recovery",
      errors: ["graph cycle", "user node asset storage: invalid user asset JSON"],
    });
  });
});
