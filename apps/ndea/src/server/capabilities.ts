/**
 * Server-side data-capability derivation (CAPABILITY-CONTRACT.md §3.1).
 *
 * The single point where a dataset's *provided* capability set is computed —
 * at metadata build time, from fields the server already has. The result is
 * baked into `Metadata.capabilities` (the wire single-source-of-truth); the
 * frontend never re-derives, it just reads that array (see `capabilitiesOf`).
 *
 * Inputs are primitives (not `ViewerState`) so the mapping is pure + unit
 * testable, and so the derivation table in the doc maps 1:1 onto the branches
 * below. Six of eight capabilities are derivable from current metadata;
 * `obsp` / `temporal` are reserved and land with their features.
 */

import { type DataCapability, DataCapabilitySchema } from "@ndea/protocol";

export interface CapabilityInputs {
  /** obs dataframe present (obs_columns non-empty). Effectively always true. */
  hasObs: boolean;
  /** var count — number (AnnData) or per-modality record (MuData). */
  varCount: number | Record<string, number> | undefined;
  /** Registered obsm embedding keys. */
  obsmKeys: readonly string[];
  /** Spatial x/y columns resolved (not merely a null-filled spatial block). */
  hasSpatialXY: boolean;
  /** OME-Zarr plate / HCS pixel data mounted. */
  hasPlate: boolean;
  /** MuData (>1 modality). */
  isMultimodal: boolean;
}

/** True when any modality reports a positive var count. */
function hasAnyVar(varCount: number | Record<string, number> | undefined): boolean {
  if (varCount == null) return false;
  if (typeof varCount === "number") return varCount > 0;
  return Object.values(varCount).some((v) => v > 0);
}

/**
 * The §3.1 derivation table, encoded as data. `Record<DataCapability, …>` makes
 * it provably TOTAL: adding a member to `DataCapabilitySchema` is a compile
 * error here until a predicate is supplied (CAPABILITY-CONTRACT.md §3, R9 —
 * the enum is the single source of truth, no silent drift). `obsp` / `temporal`
 * are reserved with an explicit `() => false` — "named, not yet detectable" —
 * rather than a silent omission; they flip on once their server-side detection
 * (neighbor graph / tracks) formalizes.
 */
const DERIVERS: Record<DataCapability, (i: CapabilityInputs) => boolean> = {
  obs: (i) => i.hasObs,
  var: (i) => hasAnyVar(i.varCount),
  obsm: (i) => i.obsmKeys.length > 0,
  obsp: () => false,
  spatial: (i) => i.hasSpatialXY,
  "plate-image": (i) => i.hasPlate,
  multimodal: (i) => i.isMultimodal,
  temporal: () => false,
};

/** Map already-computed metadata facts to the flat capability vocabulary. */
export function deriveDataCapabilities(input: CapabilityInputs): DataCapability[] {
  // Iterate the enum tuple (single source) so output order is deterministic and
  // every member is considered exactly once.
  return DataCapabilitySchema.options.filter((cap) => DERIVERS[cap](input));
}
