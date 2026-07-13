import { describe, expect, test } from "bun:test";

import { workspaceSurfacePolicy } from "./WorkspaceShell";
import { initializeWorkspaceDocument } from "./workspace-context";
import type { WorkspaceDocumentState } from "./types";

function emptyState(): WorkspaceDocumentState {
  return {
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

  test("recovery exposes no disposition, config, or topology mutation surface", () => {
    expect(workspaceSurfacePolicy("recovery")).toEqual({
      recoveryOnly: true,
      mountStage: false,
      mountCanvas: false,
      mountStatusBar: false,
      mountBodies: false,
      installAuthoringListeners: false,
    });
    expect(workspaceSurfacePolicy("writable")).toEqual({
      recoveryOnly: false,
      mountStage: true,
      mountCanvas: true,
      mountStatusBar: true,
      mountBodies: true,
      installAuthoringListeners: true,
    });
  });
});
