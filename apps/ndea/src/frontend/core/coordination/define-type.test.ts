/**
 * defineCoordinationType fitness test (U3) — the registration gate.
 *
 * Every coordination type must declare a capability, bind to a real NodeHost
 * facet, and carry a JsonValue-serializable schema (KD3/KD4/R5). Importing
 * `./coordination` registers focus/viewSync/ordering as a side effect; these
 * assert the registry holds well-formed specs and that the define-time gate
 * rejects malformed ones.
 */

import { z } from "zod";
import { describe, expect, test } from "bun:test";

import { defineCoordinationType, defineGroupChannel, listCoordinationTypes } from "./define-type";
// importing the type constants loads coordination.ts, registering focus,
// viewSync, and ordering through the API as a side effect.
import { FOCUS_TYPE, ORDERING_TYPE, VIEW_SYNC_TYPE } from "./coordination";

// The cross-view facet names that exist on NodeHost (host.ts). A type whose
// hostFacet isn't one of these can't be reached through the seam.
const KNOWN_HOST_FACETS = new Set(["highlight", "viewSync", "ordering"]);

describe("registered coordination types are well-formed", () => {
  test("focus, viewSync, and ordering are all registered", () => {
    expect([FOCUS_TYPE.type, VIEW_SYNC_TYPE.type, ORDERING_TYPE.type]).toEqual(["focus", "viewSync", "ordering"]);
    const types = listCoordinationTypes().map((s) => s.type);
    expect(types).toContain("focus");
    expect(types).toContain("viewSync");
    expect(types).toContain("ordering");
  });

  test("every registration declares a capability + an existing host facet", () => {
    for (const spec of listCoordinationTypes()) {
      expect(spec.capability, `${spec.type}: missing capability`).toBeTruthy();
      expect(KNOWN_HOST_FACETS.has(spec.hostFacet), `${spec.type}: hostFacet "${spec.hostFacet}" not on NodeHost`).toBe(
        true,
      );
    }
  });

  test("every registration's default is JsonValue-serializable and passes its schema", () => {
    for (const spec of listCoordinationTypes()) {
      expect(JSON.stringify(spec.defaultValue), `${spec.type}: default not serializable`).not.toBeUndefined();
      expect(spec.schema.safeParse(spec.defaultValue).success, `${spec.type}: default fails schema`).toBe(true);
    }
  });
});

describe("define-time gate rejects malformed types (KD3/R5)", () => {
  test("a missing capability throws", () => {
    expect(() =>
      defineCoordinationType({
        type: "__bad_cap",
        schema: z.string().nullable(),
        defaultValue: null,
        capability: "" as never,
        hostFacet: "highlight",
      }),
    ).toThrow(/capability/);
  });

  test("a missing host facet throws", () => {
    expect(() =>
      defineCoordinationType({
        type: "__bad_facet",
        schema: z.string().nullable(),
        defaultValue: null,
        capability: "read",
        hostFacet: "",
      }),
    ).toThrow(/hostFacet/);
  });

  test("a non-JsonValue default throws (serializability gate)", () => {
    expect(() =>
      defineCoordinationType({
        type: "__bad_value",
        schema: z.any(),
        defaultValue: (() => 0) as never, // a function — not JsonValue
        capability: "read",
        hostFacet: "highlight",
      }),
    ).toThrow(/serializ/i);
  });

  test("a default its own schema rejects throws", () => {
    expect(() =>
      defineCoordinationType({
        type: "__bad_schema",
        schema: z.number(),
        defaultValue: "not a number" as never,
        capability: "read",
        hostFacet: "highlight",
      }),
    ).toThrow(/schema/);
  });
});

describe("defineGroupChannel sugar", () => {
  test("registers a nullable-string group channel reachable via the registry", () => {
    defineGroupChannel({ type: "__test_group", capability: "read", hostFacet: "highlight" });
    const spec = listCoordinationTypes().find((s) => s.type === "__test_group");
    expect(spec).toBeDefined();
    expect(spec!.defaultValue).toBeNull();
    expect(spec!.schema.safeParse("obs_1").success).toBe(true);
    expect(spec!.schema.safeParse(null).success).toBe(true);
  });
});
