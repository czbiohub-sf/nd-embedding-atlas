import type { NodeCapability, NodeDefinition } from "@ndea/sdk";
import type { AppNodeHost, ErasedAppNodeHost } from "./app-node-host";

type ServiceRequirement = readonly [path: readonly string[], kind: "callable" | "object"];

const CAPABILITY_SERVICE_REQUIREMENTS = {
  "data-read": [
    [["data"], "object"],
    [["registerClient"], "callable"],
    [["inputPredicate"], "object"],
    [["dataAPI"], "object"],
    [["dataAPI", "query"], "callable"],
  ],
  "row-set-publish": [
    [["dataAPI"], "object"],
    [["dataAPI", "publishRowSet"], "callable"],
    [["dataAPI", "disposePublishedRowSet"], "callable"],
  ],
  "focus-coordination": [
    [["focus"], "object"],
    [["focus", "get"], "callable"],
    [["focus", "set"], "callable"],
  ],
  "view-coordination": [
    [["viewCoordination"], "object"],
    [["viewCoordination", "broadcast"], "callable"],
    [["viewCoordination", "toggleLock"], "callable"],
  ],
  "schema-mutation": [],
  "spatial-data": [],
  "gpu-device": [[["acquireDeviceLease"], "callable"]],
  "wasm-bitmap": [],
  compute: [],
  "annotation-write": [
    [["dataAPI"], "object"],
    [["dataAPI", "listAnnotationColumns"], "callable"],
    [["dataAPI", "createAnnotationColumn"], "callable"],
    [["dataAPI", "writeAnnotationByPredicate"], "callable"],
    [["dataAPI", "commitAnnotations"], "callable"],
  ],
  "ordering-coordination": [
    [["ordering"], "object"],
    [["ordering", "get"], "callable"],
    [["ordering", "set"], "callable"],
  ],
  "filter-coordination": [
    [["filter"], "object"],
    [["filter", "selection"], "object"],
    [["filter", "getResolved"], "callable"],
    [["filter", "subscribeResolved"], "callable"],
    [["filter", "publish"], "callable"],
    [["filter", "clear"], "callable"],
    [["filter", "associateClient"], "callable"],
    [["filter", "disassociateClient"], "callable"],
    [["filter", "materializeRowIds"], "callable"],
  ],
} satisfies Record<NodeCapability, readonly ServiceRequirement[]>;

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || (typeof current !== "object" && typeof current !== "function")) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

/** Fail at the composition boundary instead of executing a module with a partial host. */
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
    for (const [path, kind] of CAPABILITY_SERVICE_REQUIREMENTS[capability]) {
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
