import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { SubnetCapabilities, SubnetHierarchyResolver, SubnetIconButton } from "./contracts";
import { createSubnetBody } from "./body";

export function createSubnetDefinition({
  mountBody,
  getHierarchy,
  IconButton,
}: {
  mountBody: NodeBodyMounter;
  getHierarchy: SubnetHierarchyResolver;
  IconButton: SubnetIconButton;
}) {
  return defineNode({
    ref: exactNodeTypeRef("subnet", "1.0.0"),
    title: "Subnet",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: [] as readonly SubnetCapabilities[],
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const SubnetBody = createSubnetBody(getHierarchy, IconButton);
      return { mountBody: (host) => mountBody(SubnetBody, host, "Subnet") };
    },
  });
}
