import { defineNode, exactNodeTypeRef, type NodeHost } from "@ndea/sdk";
import type { NodeBodyMounter } from "./contracts";

/**
 * The two built-ins that need no injected app services: `obs` lazily mounts its
 * portable body, `proxy` has no body at all. Every other built-in takes app
 * services and is constructed from its own subpath entry.
 */
export function createBuiltinNodeDefinitions({ mountBody }: { mountBody: NodeBodyMounter }) {
  const obs = defineNode({
    ref: exactNodeTypeRef("obs", "1.0.0"),
    title: "obs",
    role: "transform",
    inputs: [],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: [],
    load: async () => {
      // Lazy loader: bodies must not enter the bundle until a node mounts.
      const { ObsBody } = await import("./obs/body");
      return { mountBody: (host: NodeHost) => mountBody(ObsBody, host, "obs") };
    },
  });

  const proxy = defineNode({
    ref: exactNodeTypeRef("proxy", "1.0.0"),
    title: "proxy",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: [],
  });

  return { obs, proxy } as const;
}
