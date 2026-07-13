import type { NodeCapability, NodeDefinition, NodeHost } from "@ndea/sdk";

/** Fail at the composition boundary instead of mounting a partially capable Body. */
export function assertNodeHostCapabilities(
  definition: Pick<NodeDefinition, "ref" | "capabilities">,
  host: Pick<NodeHost, "capabilities">,
): void {
  const missing = definition.capabilities.filter((capability: NodeCapability) => !host.capabilities.has(capability));
  if (missing.length === 0) return;
  throw new Error(
    `node host for ${definition.ref.nodeTypeId}@${definition.ref.nodeTypeVersion} is missing capabilities: ${missing.join(", ")}`,
  );
}
