/**
 * useNodeCount — live row count under a node's cooked predicate.
 *
 * Count policy (spec): sources / transforms / selections always show their
 * count (their bodies are controls, not data); views only at chip form or
 * on the staged placeholder. The caller decides WHEN to ask; this hook just
 * registers the node with the workspace's NodeCounts controller, which runs
 * ONE batched `count(*) FILTER (WHERE …)` query per engine flush — the
 * `flush` telemetry event is the read signal, so there is no per-node query,
 * no debounce here, and no timing race against the rAF flush.
 */

import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";

import { useWorkspace } from "./workspace-context";

export function useNodeCount(
  nodeId: string,
  active: boolean,
): { count: number | null; cooking: boolean; error: string | null } {
  const ws = useWorkspace();
  const cooking = useSelector(ws.telemetry, (t) => t.cooking[nodeId] ?? false);
  const count = useSelector(ws.counts.store, (s) => s[nodeId]);
  const error = useSelector(ws.counts.errors, (e) => e[nodeId] ?? null);

  useEffect(() => {
    if (!active) return;
    return ws.counts.register(nodeId);
  }, [ws, nodeId, active]);

  return { count: active ? (count ?? null) : null, cooking, error: active ? error : null };
}
