import { describe, expect, test } from "bun:test";
import { Store } from "@tanstack/store";
import { exactNodeTypeRef } from "@ndea/sdk";
import { createHierarchyNodeFacet } from "@/core/node/runtime/host-facets";
import type { NodeRuntimeSessionPort } from "@/core/node/runtime/session-port";

describe("hierarchy facet", () => {
  test("counts a subnet's inner nodes, excluding its proxies, and follows the document", () => {
    const store = new Store({
      nodes: {
        subnet: { id: "subnet", definitionRef: exactNodeTypeRef("subnet", "1.0.0"), label: "Subnet" },
        child: { id: "child", definitionRef: exactNodeTypeRef("count", "1.0.0"), label: "Count", parent: "subnet" },
        seam: { id: "seam", definitionRef: exactNodeTypeRef("proxy", "1.0.0"), label: "Proxy", parent: "subnet" },
      },
      flags: {},
    });
    let entered = 0;
    const session = {
      store,
      enterSubnet: () => {
        entered += 1;
      },
    } as unknown as NodeRuntimeSessionPort;
    const hierarchy = createHierarchyNodeFacet(session, "subnet");

    const initial = hierarchy.getSnapshot();
    expect(initial).toEqual({ childCount: 1 });
    expect(hierarchy.getSnapshot()).toBe(initial);
    hierarchy.enter();
    expect(entered).toBe(1);

    store.setState((state) => ({
      ...state,
      nodes: {
        ...state.nodes,
        second: { id: "second", definitionRef: exactNodeTypeRef("count", "1.0.0"), label: "Count", parent: "subnet" },
      },
    }));
    expect(hierarchy.getSnapshot()).toEqual({ childCount: 2 });
  });
});
