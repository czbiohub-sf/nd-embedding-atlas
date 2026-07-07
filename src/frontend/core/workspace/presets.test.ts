import { describe, expect, test } from "bun:test";

import { DOC_VERSION } from "./persist";
import { resolvePreset } from "./presets";

describe("resolvePreset", () => {
  test("resolves the bundled annotate preset to a valid WsState", () => {
    const state = resolvePreset("annotate");
    // Non-null == the bundled doc passed migrate + validateDoc (the same
    // never-hydrate-corrupt-state path localStorage loads run through).
    expect(state).not.toBeNull();
    expect(state!.nodes).toBeDefined();
    expect(state!.edges).toBeDefined();
    // The preset opens to the tiled dashboard, not the node canvas (R10).
    expect(state!.disposition).toBe("hidden");
  });

  test("returns null for an unknown preset name (no throw)", () => {
    expect(resolvePreset("does-not-exist")).toBeNull();
  });

  // The bundled doc is authored at DOC_VERSION so migrate is a no-op on load.
  test("bundled annotate doc is at the current DOC_VERSION", async () => {
    const doc = (await import("./annotate.doc.json")).default as { version: number };
    expect(doc.version).toBe(DOC_VERSION);
  });

  // TODO(U2b): once the R9 graph is authored into annotate.doc.json, assert the
  // node types (obs, wrangle, table, count, scatter, cache, annotate, fov,
  // gallery) and the obs→wrangle→{table,count,scatter}, scatter→cache→annotate
  // edges. The placeholder doc is an empty graph until then.
});
