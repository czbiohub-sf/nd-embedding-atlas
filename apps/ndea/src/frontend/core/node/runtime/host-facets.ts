import { Store } from "@tanstack/store";
import type { NodeHost, RowIndex } from "@ndea/sdk";
import type { GraphPortValue } from "@/core/graph/values";
import type {
  CheckpointCreationNodeHost,
  CheckpointInputState,
  CheckpointNodeHost,
  CheckpointState,
  HierarchyNodeHost,
  HierarchyState,
} from "@/core/node/app-node-host";
import type { NodeRuntimeSessionPort } from "./session-port";

export interface EdgeInputRowSetBinding extends Pick<
  NodeHost<unknown, "row-set-subscribe">,
  "externalRowSet" | "onExternalRowSet"
> {
  update(rowIndices: readonly RowIndex[] | null): void;
}

/** Instance-local row-set input delivered by graph edges, independent of the global row-set bus. */
export function createEdgeInputRowSetBinding(): EdgeInputRowSetBinding {
  const rowSet = new Store<readonly RowIndex[] | null>(null);
  return Object.freeze({
    externalRowSet: () => rowSet.state,
    onExternalRowSet(callback: (rowIndices: readonly RowIndex[] | null) => void) {
      const subscription = rowSet.subscribe(() => callback(rowSet.state));
      return () => subscription.unsubscribe();
    },
    update(rowIndices: readonly RowIndex[] | null) {
      rowSet.setState(() => rowIndices);
    },
  });
}

export function deliverEdgeInputRowSet(binding: EdgeInputRowSetBinding, value: GraphPortValue): void {
  binding.update(value.kind === "sel" ? (value.rowIds ?? null) : null);
}

function sameCheckpointInput(left: CheckpointInputState | null, right: CheckpointInputState | null): boolean {
  if (left === right) return true;
  if (left?.kind !== right?.kind || left?.predicate !== right?.predicate) return false;
  return left?.kind !== "row-set" || (right?.kind === "row-set" && left.rowCount === right.rowCount);
}

function sameCheckpointState(left: CheckpointState, right: CheckpointState): boolean {
  return (
    left.epoch === right.epoch &&
    left.pinned === right.pinned &&
    left.pinnedEpoch === right.pinnedEpoch &&
    sameCheckpointInput(left.input, right.input)
  );
}

export function createCheckpointNodeFacet(
  session: NodeRuntimeSessionPort,
  nodeId: string,
): CheckpointNodeHost["checkpoint"] {
  let snapshot: CheckpointState | undefined;
  const read = (): CheckpointState => {
    const live = session.liveCacheInput(nodeId);
    const input: CheckpointInputState | null =
      live === null
        ? null
        : live.kind === "sel"
          ? { kind: "row-set", predicate: live.sql, rowCount: live.rowIds?.length ?? null }
          : { kind: "predicate", predicate: live.sql };
    const next: CheckpointState = {
      epoch: session.telemetry.state.epoch,
      pinned: session.isCached(nodeId),
      pinnedEpoch: session.store.state.nodes[nodeId]?.stamp ?? null,
      input,
    };
    if (snapshot && sameCheckpointState(snapshot, next)) return snapshot;
    snapshot = Object.freeze(next);
    return snapshot;
  };

  return Object.freeze({
    getSnapshot: read,
    subscribe(onChange: () => void) {
      const documentSubscription = session.store.subscribe(onChange);
      const telemetrySubscription = session.telemetry.subscribe(onChange);
      return () => {
        documentSubscription.unsubscribe();
        telemetrySubscription.unsubscribe();
      };
    },
    pin: () => session.pinCache(nodeId),
    unpin: () => session.uncache(nodeId),
  });
}

export function createCheckpointCreationNodeFacet(
  session: NodeRuntimeSessionPort,
  nodeId: string,
): CheckpointCreationNodeHost["checkpointCreation"] {
  return Object.freeze({ create: () => session.freezeSelection(nodeId) });
}

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
