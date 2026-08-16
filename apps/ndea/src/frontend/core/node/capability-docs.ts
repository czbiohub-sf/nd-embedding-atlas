/** Closed documentation for SDK node capabilities. */

import type { NodeCapability } from "@ndea/sdk";

export interface CapabilityDoc {
  /** Chip label shown in the user hover. */
  label: string;
  /** One-line explanation (its own hover / dev mode). */
  doc: string;
  /** Internal and port-implied capabilities stay documented but omit user chips. */
  visible: boolean;
}

export const CAPABILITIES_BY_CATEGORY = {
  operations: ["data-read", "row-set-publish", "annotation-write"],
  coordination: ["focus-coordination", "view-coordination", "ordering-coordination", "filter-coordination"],
  authorityResources: ["schema-mutation", "gpu-device"],
  environmentMarkers: ["spatial-data", "wasm-bitmap", "compute"],
} as const satisfies Record<string, readonly NodeCapability[]>;

export const CAPABILITY_DOCS = {
  "data-read": {
    label: "reads data",
    doc: "Reads dataset metadata and queries rows through the scoped data service.",
    visible: false,
  },
  "row-set-publish": {
    label: "publishes rows",
    doc: "Publishes an instance-scoped temporary row set through the data service.",
    visible: false,
  },
  "focus-coordination": {
    label: "shares focus",
    doc: "Reads and publishes the focused row for linked views.",
    visible: false,
  },
  "view-coordination": {
    label: "shares view",
    doc: "Shares pan, zoom, and linked-view state.",
    visible: false,
  },
  "gpu-device": {
    label: "GPU",
    doc: "Renders on your graphics card for speed. Needs a WebGPU browser (Chrome or Edge).",
    visible: true,
  },
  "schema-mutation": {
    label: "adds columns",
    doc: "Can add new columns to your data, such as cluster labels.",
    visible: true,
  },
  "spatial-data": {
    label: "shows images",
    doc: "Loads image crops for cells from the OME-Zarr source.",
    visible: true,
  },
  "wasm-bitmap": {
    label: "bitmap engine",
    doc: "Uses the app-provided WebAssembly bitmap runtime.",
    visible: false,
  },
  "annotation-write": {
    label: "writes labels",
    doc: "Creates and edits your own annotation columns.",
    visible: true,
  },
  compute: {
    label: "server compute",
    doc: "Runs its work on the server (DuckDB), not in the browser.",
    visible: true,
  },
  "ordering-coordination": {
    label: "shares sort",
    doc: "Shares its sort column and direction with linked views.",
    visible: true,
  },
  "filter-coordination": {
    label: "shares filters",
    doc: "Publishes and consumes filters with linked views.",
    visible: true,
  },
} satisfies Record<NodeCapability, CapabilityDoc>;

/** Capabilities to render as chips for a node, humanized and de-noised. */
export function humanizedCapabilities(caps: Iterable<NodeCapability>): CapabilityDoc[] {
  const out: CapabilityDoc[] = [];
  for (const c of caps) {
    const d = CAPABILITY_DOCS[c];
    if (d.visible) out.push(d);
  }
  return out;
}
