import { describe, expect, test } from "bun:test";

import { resolveNodeEditorEnabled } from "./feature-flags";

describe("node editor feature flag", () => {
  test("defaults on in development and off in production", () => {
    expect(resolveNodeEditorEnabled(true)).toBe(true);
    expect(resolveNodeEditorEnabled(false)).toBe(false);
  });

  test("accepts explicit true and false overrides", () => {
    expect(resolveNodeEditorEnabled(false, "true")).toBe(true);
    expect(resolveNodeEditorEnabled(true, "false")).toBe(false);
  });

  test("rejects ambiguous values", () => {
    expect(() => resolveNodeEditorEnabled(true, "1")).toThrow(
      'VITE_NDEA_NODE_EDITOR must be "true" or "false", received "1"',
    );
  });
});
