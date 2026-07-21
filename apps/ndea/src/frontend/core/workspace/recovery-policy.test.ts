import { describe, expect, test } from "bun:test";

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
  test("topology recovery preserves validated state without invoking the runtime initializer", () => {
    const state = emptyState();
    let loads = 0;
    let seeds = 0;
    const persistence = initializeWorkspaceDocument(
      {
        loadDocument() {
          loads += 1;
          throw new Error("invalid topology must never reach runtime initialization");
        },
      },
      {
        kind: "recovery",
        stage: "topology",
        errors: ["resolved cycle"],
        raw: "{}",
        state,
      },
      () => {
        seeds += 1;
      },
    );

    expect(loads).toBe(0);
    expect(seeds).toBe(0);
    expect(persistence).toEqual({
      mode: "recovery",
      stage: "topology",
      errors: ["resolved cycle"],
      recoveryState: state,
    });
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
      stage: "config",
      errors: ["user node asset storage: invalid user asset JSON"],
    });
    expect(
      applyNodeAssetRecovery(
        { mode: "recovery", stage: "topology", errors: ["graph cycle"], recoveryState: emptyState() },
        assetFailure,
      ),
    ).toEqual({
      mode: "recovery",
      stage: "topology",
      errors: ["graph cycle", "user node asset storage: invalid user asset JSON"],
      recoveryState: emptyState(),
    });
  });
});
