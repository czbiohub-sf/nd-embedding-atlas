import { useSyncExternalStore } from "react";

import { NdIconButton } from "@/components/nd/nd-icon-button";
import type { HierarchyNodeHost, NodeBodyProps } from "@/core/node/app-node-host";

export function SubnetBody({ host }: NodeBodyProps<unknown, never, HierarchyNodeHost>) {
  const { childCount } = useSyncExternalStore(
    host.hierarchy.subscribe,
    host.hierarchy.getSnapshot,
    host.hierarchy.getSnapshot,
  );

  return (
    <div className="flex flex-col gap-[7px]">
      <span className="font-mono text-3xs text-muted-foreground">{childCount} inner · own wiring level</span>
      <span data-nodrag="1" className="inline-flex">
        <NdIconButton
          icon="enter"
          label="enter"
          title="enter subnet (double-click)"
          onClick={() => host.hierarchy.enter()}
        />
      </span>
    </div>
  );
}
