import { useSyncExternalStore } from "react";
import type { NodeHost } from "@ndea/sdk";
import type { SubnetHierarchyResolver, SubnetIconButton } from "./contracts";

export function createSubnetBody(getHierarchy: SubnetHierarchyResolver, IconButton: SubnetIconButton) {
  return function SubnetBody({ host }: { host: NodeHost }) {
    const hierarchy = getHierarchy(host);
    const { childCount } = useSyncExternalStore(hierarchy.subscribe, hierarchy.getSnapshot, hierarchy.getSnapshot);

    return (
      <div className="flex flex-col gap-[7px]">
        <span className="font-mono text-3xs text-muted-foreground">{childCount} inner · own wiring level</span>
        <span data-nodrag="1" className="inline-flex">
          <IconButton
            icon="enter"
            label="enter"
            title="enter subnet (double-click)"
            onClick={() => hierarchy.enter()}
          />
        </span>
      </div>
    );
  };
}
