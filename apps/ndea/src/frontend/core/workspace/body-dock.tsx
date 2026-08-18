/**
 * Body presentation adapters. Runtime ownership lives under core/node/runtime:
 * sockets only adopt its stable elements, and this root adapter only observes
 * state plus exposes the explicit retry transition.
 */

import { useSelector } from "@tanstack/react-store";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ExactNodeTypeRef } from "@ndea/sdk";

import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import type { NodeInstanceRuntime } from "@/core/node/runtime/instance-runtime";
import { useWorkspaceNodeRuntimes } from "@/core/node/runtime/runtime-context-value";
import { resolveNodeForm } from "./canvas/port-positions";
import { useWorkspace, useWorkspaceSelector } from "./workspace-context";

function ActiveBodyRuntime({ label, runtime }: { readonly label: string; readonly runtime: NodeInstanceRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  if (state.status === "ready" || state.status === "disposed") return null;
  if (state.status === "failed") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-medium text-sm text-foreground">{label} failed</div>
        <div className="max-w-xs break-all font-mono text-muted-foreground text-xs">{state.error.message}</div>
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-muted-foreground text-xs hover:bg-muted"
          onClick={() => void runtime.retry()}
        >
          Retry
        </button>
      </div>
    );
  }
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading {label}…</div>;
}

function BodyRuntimeAdapter({
  nodeId,
  definitionRef,
  label,
}: {
  readonly nodeId: string;
  readonly definitionRef: ExactNodeTypeRef;
  readonly label: string;
}) {
  const runtimes = useWorkspaceNodeRuntimes();
  const [runtime, setRuntime] = useState(() => runtimes.get(nodeId));

  useEffect(() => {
    setRuntime(runtimes.activate(nodeId, definitionRef));
  }, [definitionRef, nodeId, runtimes]);

  return runtime ? <ActiveBodyRuntime label={label} runtime={runtime} /> : null;
}

function BodyOwner({
  nodeId,
  definitionRef,
  label,
}: {
  readonly nodeId: string;
  readonly definitionRef: ExactNodeTypeRef;
  readonly label: string;
}) {
  const runtimes = useWorkspaceNodeRuntimes();
  return createPortal(
    <PanelErrorBoundary panelName={label}>
      <BodyRuntimeAdapter nodeId={nodeId} definitionRef={definitionRef} label={label} />
    </PanelErrorBoundary>,
    runtimes.bodyDock(nodeId),
  );
}

/** Sticky activation: presentation changes never dispose a live instance. */
export function WorkspaceBodies() {
  const ws = useWorkspace();
  const nodes = useWorkspaceSelector((state) => state.nodes);
  useWorkspaceSelector((state) => state.explicit);
  useWorkspaceSelector((state) => state.disposition);
  useWorkspaceSelector((state) => state.formOverride);
  const fullscreen = useSelector(ws.ui, (state) => state.fullscreen);
  const activated = useRef(new Set<string>());

  const live: { id: string; definitionRef: ExactNodeTypeRef; label: string }[] = [];
  for (const node of Object.values(nodes)) {
    const spec = ws.nodeLibrary.getSpecExact(node.definitionRef);
    if (!spec?.definition.load) continue;
    const form = resolveNodeForm(ws, node.id);
    const needsBody =
      ws.placementOf(node.id) === "staged" ||
      form === "full" ||
      (form === "card" && spec.body === "card-and-full") ||
      fullscreen === node.id;
    if (needsBody) activated.current.add(node.id);
    if (activated.current.has(node.id)) {
      live.push({ id: node.id, definitionRef: spec.definition.ref, label: node.label });
    }
  }
  for (const nodeId of activated.current) {
    if (!nodes[nodeId]) activated.current.delete(nodeId);
  }

  return (
    <>
      {live.map((body) => (
        <BodyOwner key={body.id} nodeId={body.id} definitionRef={body.definitionRef} label={body.label} />
      ))}
    </>
  );
}

/**
 * Adopts the runtime-owned header slot without changing instance lifetime.
 *
 * The `adopt` guard is load-bearing, not a micro-optimization: these refs are
 * inline closures, so React re-invokes them on EVERY render, and `appendChild`
 * of an already-correct child still detaches and re-inserts it. Re-insertion
 * resets `scrollTop`/`scrollLeft` on the whole subtree WITHOUT firing a scroll
 * event, which strands anything tracking scroll offset in JS: TanStack Virtual
 * reads offset only from scroll events, so a scrolled table kept rendering rows
 * at its pre-reset offset and painted an empty band.
 */
function adopt(element: HTMLElement | null, dock: HTMLElement): void {
  if (element && dock.parentElement !== element) element.appendChild(dock);
}

export function HeaderSocket({ nodeId }: { readonly nodeId: string }) {
  const runtimes = useWorkspaceNodeRuntimes();
  return (
    <div
      data-nodrag="1"
      className="nodrag flex h-full min-w-0 flex-1 items-center overflow-hidden"
      ref={(element) => {
        adopt(element, runtimes.headerDock(nodeId));
      }}
    />
  );
}

/** Adopts the runtime-owned Body dock; appendChild preserves the live DOM tree. */
export function BodySocket({
  nodeId,
  className,
  claimable = false,
}: {
  readonly nodeId: string;
  readonly className?: string;
  readonly claimable?: boolean;
}) {
  const ws = useWorkspace();
  const runtimes = useWorkspaceNodeRuntimes();
  const claimed = useWorkspaceSelector((state) => state.claimed === nodeId);
  return (
    <div
      className={`relative ${className ?? "nowheel nodrag flex min-h-0 flex-1 flex-col overflow-hidden"}`}
      ref={(element) => {
        adopt(element, runtimes.bodyDock(nodeId));
      }}
    >
      {claimable && !claimed ? (
        <div
          className="absolute inset-0 z-10 cursor-pointer"
          title="click to take the pointer"
          onPointerDown={(event) => {
            event.stopPropagation();
            ws.claim(nodeId);
          }}
        />
      ) : null}
    </div>
  );
}
