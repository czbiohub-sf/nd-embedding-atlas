import type { FilterCoordinationAPI } from "@ndea/sdk";
import type {
  CheckpointCreationNodeHost,
  CheckpointInputState,
  CheckpointNodeHost,
  CheckpointState,
  HierarchyNodeHost,
  HierarchyState,
} from "@/core/node/app-node-host";
import type { NodeRuntimeSessionPort } from "./session-port";

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
    left.pending === right.pending &&
    left.error === right.error &&
    sameCheckpointInput(left.input, right.input)
  );
}

export function createCheckpointNodeFacet(
  session: NodeRuntimeSessionPort,
  nodeId: string,
  filter: FilterCoordinationAPI,
  signal?: AbortSignal,
): CheckpointNodeHost["checkpoint"] {
  let snapshot: CheckpointState | undefined;
  let operation = 0;
  signal?.addEventListener(
    "abort",
    () => {
      operation += 1;
    },
    { once: true },
  );
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
      pending: session.checkpointStatus.state[nodeId]?.pending ?? false,
      error: session.checkpointStatus.state[nodeId]?.error ?? null,
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
      const checkpointSubscription = session.checkpointStatus.subscribe(onChange);
      return () => {
        documentSubscription.unsubscribe();
        telemetrySubscription.unsubscribe();
        checkpointSubscription.unsubscribe();
      };
    },
    async pin() {
      const current = ++operation;
      const revision = filter.getResolved().revision;
      session.setCheckpointStatus(nodeId, { pending: true, error: null });
      try {
        const materialized = await filter.materializeRowIds(signal);
        if (current !== operation || materialized.revision !== revision || filter.getResolved().revision !== revision) {
          throw new Error("filter changed during Cache pin");
        }
        const pinned = session.pinCache(nodeId, materialized.rowIds);
        if (current === operation) session.setCheckpointStatus(nodeId, { pending: false, error: null });
        return pinned;
      } catch (error) {
        if (current === operation && !signal?.aborted) {
          session.setCheckpointStatus(nodeId, {
            pending: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      }
    },
    unpin() {
      operation += 1;
      session.setCheckpointStatus(nodeId, { pending: false, error: null });
      session.uncache(nodeId);
    },
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
