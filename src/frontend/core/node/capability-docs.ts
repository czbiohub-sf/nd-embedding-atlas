/**
 * Humanized labels for node capabilities, shown as chips in the Tier 1 hover
 * card. The raw `NodeCapability` id is a developer token (`schema-mutate`,
 * `wasm-bitmap`); the user-facing hover shows the `label` here instead.
 *
 * Capabilities NOT in this map are intentionally hidden from the user tier —
 * they're either internal (`read`, `wasm-bitmap`) or already implied by the
 * node's ports (`selection-in`/`selection-out` show up in the io signature).
 * A dev mode can still surface the raw ids. See `.design/docs-integration-plan.md`.
 */

import type { NodeCapability } from "./types";

export interface CapabilityDoc {
  /** Chip label shown in the user hover. */
  label: string;
  /** One-line explanation (its own hover / dev mode). */
  doc: string;
}

export const CAPABILITY_DOCS: Partial<Record<NodeCapability, CapabilityDoc>> = {
  gpu: {
    label: "GPU",
    doc: "Renders on your graphics card for speed. Needs a WebGPU browser (Chrome or Edge).",
  },
  "schema-mutate": {
    label: "adds columns",
    doc: "Can add new columns to your data, such as cluster labels.",
  },
  spatial: {
    label: "shows images",
    doc: "Loads image crops for cells from the OME-Zarr source.",
  },
  annotate: {
    label: "writes labels",
    doc: "Creates and edits your own annotation columns.",
  },
  "transform-compute": {
    label: "server compute",
    doc: "Runs its work on the server (DuckDB), not in the browser.",
  },
  ordering: {
    label: "shares sort",
    doc: "Shares its sort column and direction with linked views.",
  },
  collections: {
    label: "uses collections",
    doc: "Reads and writes saved cell collections.",
  },
};

/** Capabilities to render as chips for a node, humanized and de-noised. */
export function humanizedCapabilities(caps: ReadonlySet<NodeCapability>): CapabilityDoc[] {
  const out: CapabilityDoc[] = [];
  for (const c of caps) {
    const d = CAPABILITY_DOCS[c];
    if (d) out.push(d);
  }
  return out;
}
