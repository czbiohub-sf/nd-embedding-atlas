import { describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import { sessionKeyOf } from "./workspace-context";

const meta = (id?: string, preset?: string) =>
  ({ props: id ? { data: { id } } : undefined, preset }) as unknown as Metadata;

describe("sessionKeyOf", () => {
  test("two presets on the same dataset get different keys", () => {
    // The bug this guards: without the preset in the key, opening a dataset under one preset
    // and later under another hit the stored document and silently restored the first
    // preset's graph, so the second --preset appeared to do nothing.
    const a = sessionKeyOf(meta("_index", "annotate"), "dataset");
    const b = sessionKeyOf(meta("_index", "smart-fov-selection"), "dataset");
    expect(a).not.toBe(b);
  });

  test("the same dataset and preset reload the same workspace", () => {
    expect(sessionKeyOf(meta("_index", "annotate"), "dataset")).toBe(
      sessionKeyOf(meta("_index", "annotate"), "dataset"),
    );
  });

  test("switching dataset still gets a fresh doc", () => {
    expect(sessionKeyOf(meta("a", "annotate"), "dataset")).not.toBe(sessionKeyOf(meta("b", "annotate"), "dataset"));
  });

  test("an unset preset is omitted rather than stringified", () => {
    // metadata.preset is optional; "undefined" must not become part of the key.
    const key = sessionKeyOf(meta("_index"), "dataset");
    expect(key).toBe("_index:dataset");
    expect(key).not.toContain("undefined");
  });

  test("no identity at all falls back to null, so storage uses its shared key", () => {
    expect(sessionKeyOf(meta(), "")).toBeNull();
  });
});
