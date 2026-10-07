import type { HierarchyNodeHost, HierarchyState } from "@/core/node/app-node-host";
import type { NodeRuntimeSessionPort } from "./session-port";

export function createHierarchyNodeFacet(
  session: NodeRuntimeSessionPort,
  nodeId: string,
): HierarchyNodeHost["hierarchy"] {
  let snapshot: HierarchyState | undefined;
  const read = (): HierarchyState => {
    const childCount = Object.values(session.store.state.nodes).filter(
      (node) => node.parent === nodeId && node.definitionRef.nodeTypeId !== "proxy",
    ).length;
    if (snapshot?.childCount === childCount) return snapshot;
    snapshot = Object.freeze({ childCount });
    return snapshot;
  };

  return Object.freeze({
    getSnapshot: read,
    subscribe(onChange: () => void) {
      const subscription = session.store.subscribe(onChange);
      return () => subscription.unsubscribe();
    },
    enter: () => session.enterSubnet(nodeId),
  });
}
