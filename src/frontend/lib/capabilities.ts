/**
 * Data-capability accessor (CAPABILITY-CONTRACT.md §3-§4).
 *
 * The server derives the capability set at open()/ingest and bakes it into
 * `Metadata.capabilities` — the single source of truth. The frontend never
 * re-derives; it wraps that array in a Set so every feature gate reads one
 * vocabulary (`caps.has("plate-image")`) instead of ad-hoc `metadata.plate` /
 * `Object.keys(metadata.obsm).length` checks scattered across components.
 *
 * The returned Set is also the shape a future xyflow source node exposes; a
 * view/transform's `requires` is checked against it with the §2 subset
 * predicate (`requires.every((c) => caps.has(c))`).
 */

import type { DataCapability, Metadata } from "@/types";

export type DataCapabilitySet = ReadonlySet<DataCapability>;

/** Wrap the server-provided capability array in a Set. */
export function capabilitiesOf(metadata: Pick<Metadata, "capabilities">): DataCapabilitySet {
  return new Set(metadata.capabilities ?? []);
}
