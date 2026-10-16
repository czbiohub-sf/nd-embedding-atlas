import type { NodeCapability, NodeDefinition } from "@ndea/sdk";
import type { AppNodeHost, ErasedAppNodeHost } from "@/core/node/app-node-host";

type ServiceRequirement = readonly [path: readonly string[], kind: "callable" | "object"];
type Permission =
  | "network"
  | "filesystem-import"
  | "filesystem-export"
  | "clipboard-read"
  | "clipboard-write"
  | "gpu"
  | "schema-mutation"
  | "irreversible-data-write";
type CapabilityCategory = "operations" | "coordination" | "authorityResources" | "environmentMarkers";

export interface CapabilityDoc {
  label: string;
  doc: string;
  visible: boolean;
}

interface Capability extends CapabilityDoc {
  category: CapabilityCategory;
  services: readonly ServiceRequirement[];
  permission: Permission | null;
}

/** The app's capability policy, documentation, and host requirements live together. */
export const nodeCapabilities = {
  "data-read": {
    category: "operations",
    label: "reads data",
    doc: "Reads dataset metadata and queries rows through the scoped data service.",
    visible: false,
    services: [
      [["data"], "object"],
      [["registerClient"], "callable"],
      [["inputPredicate"], "object"],
      [["dataAPI"], "object"],
      [["dataAPI", "query"], "callable"],
    ],
    permission: null,
  },
  "row-set-publish": {
    category: "operations",
    label: "saves row sets",
    doc: "Saves selected rows as a named observation set on the server.",
    visible: false,
    services: [
      [["dataAPI"], "object"],
      [["dataAPI", "createObservationSet"], "callable"],
    ],
    permission: null,
  },
  "focus-coordination": {
    category: "coordination",
    label: "shares focus",
    doc: "Reads and publishes the focused row for linked views.",
    visible: false,
    services: [
      [["focus"], "object"],
      [["focus", "get"], "callable"],
      [["focus", "set"], "callable"],
    ],
    permission: null,
  },
  "view-coordination": {
    category: "coordination",
    label: "shares view",
    doc: "Shares pan, zoom, and linked-view state.",
    visible: false,
    services: [
      [["viewCoordination"], "object"],
      [["viewCoordination", "broadcast"], "callable"],
      [["viewCoordination", "toggleLock"], "callable"],
    ],
    permission: null,
  },
  "gpu-device": {
    category: "authorityResources",
    label: "GPU",
    doc: "Renders on your graphics card for speed. Needs a WebGPU browser (Chrome or Edge).",
    visible: true,
    services: [[["acquireDeviceLease"], "callable"]],
    permission: "gpu",
  },
  "schema-mutation": {
    category: "authorityResources",
    label: "adds columns",
    doc: "Can add new columns to your data, such as cluster labels.",
    visible: true,
    services: [],
    permission: "schema-mutation",
  },
  "spatial-data": {
    category: "environmentMarkers",
    label: "shows images",
    doc: "Loads image crops for cells from the OME-Zarr source.",
    visible: true,
    services: [],
    permission: null,
  },
  "wasm-bitmap": {
    category: "environmentMarkers",
    label: "bitmap engine",
    doc: "Uses the app-provided WebAssembly bitmap runtime.",
    visible: false,
    services: [],
    permission: null,
  },
  "annotation-write": {
    category: "operations",
    label: "writes labels",
    doc: "Creates and edits your own annotation columns.",
    visible: true,
    services: [
      [["dataAPI"], "object"],
      [["dataAPI", "listAnnotationColumns"], "callable"],
      [["dataAPI", "createAnnotationColumn"], "callable"],
      [["dataAPI", "writeAnnotationByPredicate"], "callable"],
      [["dataAPI", "commitAnnotations"], "callable"],
    ],
    permission: "irreversible-data-write",
  },
  compute: {
    category: "environmentMarkers",
    label: "server compute",
    doc: "Runs its work on the server (DuckDB), not in the browser.",
    visible: true,
    services: [],
    permission: null,
  },
  "ordering-coordination": {
    category: "coordination",
    label: "shares sort",
    doc: "Shares its sort column and direction with linked views.",
    visible: true,
    services: [
      [["ordering"], "object"],
      [["ordering", "get"], "callable"],
      [["ordering", "set"], "callable"],
    ],
    permission: null,
  },
  "filter-coordination": {
    category: "coordination",
    label: "shares filters",
    doc: "Publishes and consumes filters with linked views.",
    visible: true,
    services: [
      [["filter"], "object"],
      [["filter", "selection"], "object"],
      [["filter", "getResolved"], "callable"],
      [["filter", "subscribeResolved"], "callable"],
      [["filter", "publish"], "callable"],
      [["filter", "clear"], "callable"],
      [["filter", "materializeRowIds"], "callable"],
    ],
    permission: null,
  },
  "color-coordination": {
    category: "coordination",
    label: "shares color",
    doc: "Shares its color-by column with linked views.",
    visible: true,
    services: [
      [["colorBy"], "object"],
      [["colorBy", "get"], "callable"],
      [["colorBy", "set"], "callable"],
      [["colorBy", "subscribe"], "callable"],
    ],
    permission: null,
  },
} satisfies Record<NodeCapability, Capability>;

export const availableNodeCapabilities: readonly NodeCapability[] = Object.freeze(
  Object.keys(nodeCapabilities) as NodeCapability[],
);

export const CAPABILITIES_BY_CATEGORY = Object.groupBy(
  availableNodeCapabilities,
  (capability) => nodeCapabilities[capability].category,
);

/** Capabilities to render as chips for a node, humanized and de-noised. */
export function humanizedCapabilities(caps: Iterable<NodeCapability>): CapabilityDoc[] {
  const out: CapabilityDoc[] = [];
  for (const capability of caps) {
    const doc = nodeCapabilities[capability];
    if (doc.visible) out.push(doc);
  }
  return out;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || (typeof current !== "object" && typeof current !== "function")) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

/** Reject a partial host before mounting the node. */
export function assertNodeHostCapabilities<Config, const Capabilities extends readonly NodeCapability[]>(
  definition: Pick<NodeDefinition<unknown, Capabilities>, "ref" | "capabilities">,
  host: ErasedAppNodeHost<Config>,
): asserts host is AppNodeHost<Config, Capabilities[number]> {
  const missing = definition.capabilities.filter((capability: NodeCapability) => !host.capabilities.has(capability));
  const label = `${definition.ref.nodeTypeId}@${definition.ref.nodeTypeVersion}`;
  if (missing.length > 0) {
    throw new Error(`node host for ${label} is missing capabilities: ${missing.join(", ")}`);
  }

  const invalid: string[] = [];
  for (const capability of definition.capabilities) {
    for (const [path, kind] of nodeCapabilities[capability].services) {
      const value = readPath(host, path);
      if (kind === "callable" ? typeof value !== "function" : value === null || typeof value !== "object") {
        invalid.push(`${capability}.${path.join(".")} must be ${kind}`);
      }
    }
  }
  if (invalid.length > 0) {
    throw new Error(`node host for ${label} has invalid capability services: ${invalid.join(", ")}`);
  }
}
