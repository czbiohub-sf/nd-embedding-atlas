/**
 * defineCoordinationType: the extract-after-two primitive (U3).
 *
 * U1 inlined `focus` and U2 inlined `viewSync` directly against the coordination
 * backbone. With two concrete instances proven, the shared shape is extracted
 * here: a registry of coordination TYPES, each declaring a validated cell schema,
 * a capability gate, and the `NodeHost` facet it binds to. Mirrors
 * `use-coordination`'s `coordinationTypes` map, adapted to our host seam.
 *
 * The gate is enforced at DEFINE time (KD3/R5): a type whose value isn't
 * `JsonValue`-serializable: a Mosaic Selection, a GPU handle, a function: is
 * rejected here, not at save time, so share/undo/persist always hold.
 */

import { z, type ZodType } from "zod";

import type { JsonValue, NodeCapability } from "@ndea/sdk";

export interface CoordinationTypeSpec {
  /** the coordination type key (e.g. "focus", "viewSync", "ordering"). */
  type: string;
  /** schema for ONE cell's value: must validate a `JsonValue`. */
  schema: ZodType;
  /** the value a freshly minted cell holds. */
  defaultValue: JsonValue;
  /** a node only gets {@link hostFacet} when `host.capabilities` has this. */
  capability: NodeCapability;
  /** the `NodeHost` facet this type is reached through (the host-seam binding). */
  hostFacet: string;
}

const registry = new Map<string, CoordinationTypeSpec>();

/**
 * Register a coordination type. Rejects (throws) at define time on a
 * non-`JsonValue` default, a default its own schema rejects, or a missing
 * type/capability/facet: the serializability + completeness gate (KD3/R5).
 */
export function defineCoordinationType(spec: CoordinationTypeSpec): CoordinationTypeSpec {
  if (!spec.type) throw new Error("coordination type: `type` is required");
  if (!spec.capability) throw new Error(`coordination type "${spec.type}": a \`capability\` is required (KD4)`);
  if (!spec.hostFacet) throw new Error(`coordination type "${spec.type}": a \`hostFacet\` is required (KD4)`);
  // JsonValue gate: the default (and thus the cell) must survive JSON round-trip.
  if (JSON.stringify(spec.defaultValue) === undefined) {
    throw new Error(`coordination type "${spec.type}": defaultValue is not JSON-serializable (KD3)`);
  }
  if (!spec.schema.safeParse(spec.defaultValue).success) {
    throw new Error(`coordination type "${spec.type}": defaultValue fails its own schema`);
  }
  registry.set(spec.type, spec);
  return spec;
}

/**
 * Sugar for the most common shape: a "group channel" where N nodes referencing a
 * named scope share ONE nullable value (the `focus`/`ordering` pattern). The
 * value schema defaults to a nullable string id.
 */
export function defineGroupChannel(opts: {
  type: string;
  capability: NodeCapability;
  hostFacet: string;
  value?: ZodType;
}): CoordinationTypeSpec {
  const value = opts.value ?? z.string().nullable();
  return defineCoordinationType({
    type: opts.type,
    schema: value,
    defaultValue: null,
    capability: opts.capability,
    hostFacet: opts.hostFacet,
  });
}

/** A registered type's spec, or undefined. */
export function getCoordinationType(type: string): CoordinationTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered coordination type (registration order). */
export function listCoordinationTypes(): CoordinationTypeSpec[] {
  return [...registry.values()];
}

/** The per-type cell validator: `type → { scope → value? }` (buildSpecSchema-style). */
export function coordinationCellSchema(type: string): ZodType | undefined {
  const spec = registry.get(type);
  return spec ? z.record(z.string(), spec.schema.optional()) : undefined;
}
