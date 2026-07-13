import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeInstanceId } from "@ndea/sdk";
import { makeTransformHost } from "./graph-host";

describe("transform graph host lifecycle", () => {
  test("aborts and unwinds tracked cleanup once in reverse order", () => {
    const handle = makeTransformHost({
      instanceId: nodeInstanceId("transform-1"),
      definitionRef: exactNodeTypeRef("transform-filter", "1.0.0"),
      config: { threshold: 0 },
      coordinator: { query: () => Promise.resolve([]) } as never,
      table: "atlas",
      metadata: { dataset_keys: [] } as never,
      onPublish() {},
      onConfigPatch() {},
    });
    const cleanup: string[] = [];
    handle.host.onDispose(() => cleanup.push("first"));
    handle.host.track(() => cleanup.push("second"));

    expect(handle.host.signal.aborted).toBe(false);
    handle.dispose();
    expect(handle.host.signal.aborted).toBe(true);
    expect(cleanup).toEqual(["second", "first"]);

    handle.dispose();
    expect(cleanup).toEqual(["second", "first"]);
  });
});
