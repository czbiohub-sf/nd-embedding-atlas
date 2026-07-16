import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef } from "@ndea/sdk";

import type { Workspace } from "../workspace-store";
import { portPos, resolveNodeForm, resolveNodeSize } from "./port-positions";

describe("Canvas node projection", () => {
  test("an unresolved document node keeps visible card geometry for its record and edges", () => {
    const workspace = {
      store: {
        state: {
          nodes: {
            missing: {
              id: "missing",
              definitionRef: exactNodeTypeRef("external-missing", "1.0.0"),
              label: "Unavailable plugin",
            },
          },
          positions: { missing: { x: 40, y: 70 } },
          sizeOverrides: {},
        },
      },
      def: () => null,
    } as unknown as Workspace;

    expect(resolveNodeForm(workspace, "missing")).toBe("card");
    expect(resolveNodeSize(workspace, "missing")).toEqual({ w: 240, h: 96 });
    expect(portPos(workspace, "missing", "in")).toEqual({ x: 40, y: 83 });
    expect(portPos(workspace, "missing", "out")).toEqual({ x: 280, y: 83 });
  });
});
