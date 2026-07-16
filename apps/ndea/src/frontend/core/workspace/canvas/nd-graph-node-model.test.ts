import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef } from "@ndea/sdk";

import type { GraphNodeRole } from "@/core/graph/records";
import type { AppNodeDescriptor } from "@/core/node/library";
import {
  formatCookStatus,
  formatNodeCount,
  isNodeCountActive,
  resolveDisabledNodeStyle,
  resolveNodeBodyMode,
  resolveNodeLedState,
  shouldShowNodeCount,
  shouldShowNodeHeader,
} from "./nd-graph-node-model";

function descriptor(nodeTypeId: string, role: GraphNodeRole): AppNodeDescriptor {
  return {
    definitionRef: exactNodeTypeRef(nodeTypeId, "1.0.0"),
    role,
  } as AppNodeDescriptor;
}

describe("graph node presentation decisions", () => {
  test("keeps count registration scoped to the established node and form policy", () => {
    expect(isNodeCountActive(null, "full")).toBe(false);
    expect(isNodeCountActive(descriptor("count", "transform"), "chip")).toBe(false);
    expect(isNodeCountActive(descriptor("subnet", "subnet"), "card")).toBe(false);
    expect(isNodeCountActive(descriptor("proxy", "proxy"), "full")).toBe(false);
    expect(isNodeCountActive(descriptor("filter", "transform"), "card")).toBe(true);
    expect(isNodeCountActive(descriptor("scatter", "view"), "chip")).toBe(true);
    expect(isNodeCountActive(descriptor("scatter", "view"), "card")).toBe(false);
  });

  test("shows a staged view count without activating its canvas count subscription", () => {
    const view = descriptor("scatter", "view");
    expect(shouldShowNodeCount(null, true, true)).toBe(false);
    expect(shouldShowNodeCount(view, false, true)).toBe(true);
    expect(shouldShowNodeCount(view, false, false)).toBe(false);
    expect(shouldShowNodeCount(descriptor("filter", "transform"), true, false)).toBe(true);
  });

  test("preserves count display precedence", () => {
    expect(formatNodeCount({ visible: false, error: "failed", cooking: true, count: 1200 })).toBeNull();
    expect(formatNodeCount({ visible: true, error: "failed", cooking: true, count: 1200 })).toBe("✗");
    expect(formatNodeCount({ visible: true, error: null, cooking: true, count: 1200 })).toBe("…");
    expect(formatNodeCount({ visible: true, error: null, cooking: false, count: null })).toBeNull();
    expect(formatNodeCount({ visible: true, error: null, cooking: false, count: 1200 })).toBe("1,200");
  });

  test("preserves telemetry LED precedence", () => {
    expect(resolveNodeLedState({ telemetryOn: false, flagged: false, cooking: true, dirty: true })).toBeNull();
    expect(resolveNodeLedState({ telemetryOn: true, flagged: true, cooking: true, dirty: true })).toBe("idle");
    expect(resolveNodeLedState({ telemetryOn: true, flagged: false, cooking: true, dirty: true })).toBe("cooking");
    expect(resolveNodeLedState({ telemetryOn: true, flagged: false, cooking: false, dirty: true })).toBe("dirty");
    expect(resolveNodeLedState({ telemetryOn: true, flagged: false, cooking: false, dirty: false })).toBe("clean");
  });

  test("preserves staged, fullscreen, and form body modes", () => {
    const base = { hasBody: true, fullscreen: false, body: "full-only" as const };
    expect(resolveNodeBodyMode({ ...base, form: "chip", staged: false })).toBe("hidden");
    expect(resolveNodeBodyMode({ ...base, form: "full", staged: true })).toBe("hidden");
    expect(resolveNodeBodyMode({ ...base, form: "card", staged: false, hasBody: false })).toBe("hidden");
    expect(resolveNodeBodyMode({ ...base, form: "card", staged: false, fullscreen: true })).toBe(
      "fullscreen-placeholder",
    );
    expect(resolveNodeBodyMode({ ...base, form: "full", staged: false })).toBe("socket");
    expect(resolveNodeBodyMode({ ...base, form: "card", staged: false, body: "card-and-full" })).toBe("socket");
    expect(resolveNodeBodyMode({ ...base, form: "card", staged: false })).toBe("compact-placeholder");
  });

  test("formats footer cooking state before duration", () => {
    expect(formatCookStatus(true, 12.34)).toBe("cooking…");
    expect(formatCookStatus(false)).toBe("cook —");
    expect(formatCookStatus(false, 12.34)).toBe("cook 12.3ms");
  });

  test("keeps body header and disabled-frame presentation conditions", () => {
    expect(shouldShowNodeHeader(true, "full", false, false)).toBe(true);
    expect(shouldShowNodeHeader(false, "full", false, false)).toBe(false);
    expect(shouldShowNodeHeader(true, "card", false, false)).toBe(false);
    expect(shouldShowNodeHeader(true, "full", true, false)).toBe(false);
    expect(shouldShowNodeHeader(true, "full", false, true)).toBe(false);

    expect(resolveDisabledNodeStyle(false, true)).toBeUndefined();
    expect(resolveDisabledNodeStyle(true, false)).toEqual({ opacity: 0.45, filter: undefined });
    expect(resolveDisabledNodeStyle(true, true)).toEqual({ opacity: 0.45, filter: "grayscale(0.8)" });
  });
});
