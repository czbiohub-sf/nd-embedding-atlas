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

import type { DataCapability } from "../protocol/index.ts";

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

/** Map already-computed metadata facts to the flat capability vocabulary. */
export function deriveDataCapabilities(input: CapabilityInputs): DataCapability[] {
  const caps: DataCapability[] = [];
  if (input.hasObs) caps.push("obs");
  if (hasAnyVar(input.varCount)) caps.push("var");
  if (input.obsmKeys.length > 0) caps.push("obsm");
  if (input.hasSpatialXY) caps.push("spatial");
  if (input.hasPlate) caps.push("plate-image");
  if (input.isMultimodal) caps.push("multimodal");
  // obsp / temporal: additive — emitted once the neighbor-gallery / tracks
  // features formalize their server-side detection (doc §3.1, §8.3).
  return caps;
}
