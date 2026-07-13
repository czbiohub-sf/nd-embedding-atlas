/**
 * Body dock — ONE live body per node; bodies reparent, never remount (C4).
 *
 * Mechanism: each definition-backed node gets a stable dock element
 * (ws.dockEl(id), created once). `BodyOwner` — mounted under the
 * workspace-root `WorkspaceBodies`, NOT inside any container — owns the
 * NodeHost (built once, disposed only when the node is removed) and
 * mounts the plugin body into the dock element.
 * Canvas nodes and stage tiles render a `BodySocket`, which ADOPTS the
 * dock element with appendChild. Moving a DOM node preserves canvas /
 * WebGPU state, so cameras and device leases survive pin ⇡ / pull ⇣ by
 * construction. When no socket is mounted (embedded chip/card), the dock
 * sits detached and the body stays alive offscreen.
 *
 * Activation is sticky: a body mounts the first time its node needs one
 * (staged, or embedded at full form) and persists until the node is
 * removed — form changes are presentation, not lifecycle. Display gating
 * is the `d` flag (M6), not the form.
 */

import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { Selection } from "@uwdata/mosaic-core";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import { useDashboardHostShim } from "@/core/host/use-dashboard-host-shim";
import { assertNodeHostCapabilities } from "@/core/node/host-capabilities";
import { loadNodeModule } from "@/core/node/load-module";
import type { ExactNodeTypeRef, OrderingCoordinationAPI, RowIndex, ViewCoordinationAPI } from "@ndea/sdk";
import { nodeInstanceId } from "@ndea/sdk";
import { stringPredicate } from "@/lib/mosaic-helpers";
import {
  createCheckpointCreationNodeFacet,
  createCheckpointNodeFacet,
  createEdgeInputRowSetBinding,
  createHierarchyNodeFacet,
  deliverEdgeInputRowSet,
} from "./node-host-facets";
import { resolveNodeForm } from "./canvas/port-positions";
import { useWorkspace, useWorkspaceSelector } from "./workspace-context";
// (lasso capture + push wires need the workspace store inside the owner)

/** The `viewSync` coordination cell — pan/zoom plus the broadcaster's node id
 *  (so a node doesn't re-apply its own broadcast). All fields JsonValue. */
type ViewSyncCell = { panX?: number; panY?: number; zoom?: number; src?: string };

/** The `ordering` coordination cell — shared sort column + direction. */
type OrderingCell = { col: string; dir: "asc" | "desc" } | null;

function bindMethod(value: unknown, target: object): unknown {
  return typeof value === "function" ? value.bind(target) : value;
}

function BodyOwnerInner({ nodeId, definitionRef }: { nodeId: string; definitionRef: ExactNodeTypeRef }) {
  const ws = useWorkspace();
  const catalog = ws.deps.nodeLibrary.catalog;
  const module = use(loadNodeModule(catalog, definitionRef));
  const definition = catalog.resolveExact(definitionRef);
  if (!definition) {
    throw new Error(`node definition not found: ${definitionRef.nodeTypeId}@${definitionRef.nodeTypeVersion}`);
  }
  const spec = ws.deps.nodeLibrary.getSpec(ws.store.state.nodes[nodeId]?.type ?? "");
  const makeHost = useDashboardHostShim();

  // Built EXACTLY ONCE per node lifetime — keyed by node identity, not
  // mount location. The per-node input Selection is the engine sink target;
  // the focus store mirrors pushed focus values for host.focus.subscribe.
  const [{ handle, input, inputRowSet, focus, appFacets }] = useState(() => {
    const sel = Selection.single();
    const nodeConfig = ws.store.state.nodes[nodeId]?.config;
    const defaultConfig = definition.config?.defaultValue;
    const config = {
      ...(defaultConfig && typeof defaultConfig === "object" && !Array.isArray(defaultConfig) ? defaultConfig : {}),
      ...(nodeConfig && typeof nodeConfig === "object" && !Array.isArray(nodeConfig) ? nodeConfig : {}),
    };
    const built = makeHost<unknown>({
      instanceId: nodeInstanceId(nodeId),
      definition,
      config,
      bodyHeaderElement: ws.headerEl(nodeId),
      inputPredicate: sel,
    });
    return {
      handle: built,
      input: sel,
      inputRowSet: createEdgeInputRowSetBinding(),
      focus: new Store<RowIndex | null>(null),
      appFacets: {
        ...(spec?.checkpoint ? { checkpoint: createCheckpointNodeFacet(ws, nodeId) } : {}),
        ...(spec?.checkpointCreation ? { checkpointCreation: createCheckpointCreationNodeFacet(ws, nodeId) } : {}),
        ...(spec?.kind === "subnet" ? { hierarchy: createHierarchyNodeFacet(ws, nodeId) } : {}),
      },
    };
  });
  const [mountError, setMountError] = useState<Error | null>(null);

  const off = useWorkspaceSelector((st) => st.flags[nodeId]?.off ?? false);

  // Display-active sink: while this body lives (and its display flag is up),
  // every flush delivers the node's cooked value — pred/sel land in the input
  // Selection, focus lands in the focus store. One delivery path, all kinds.
  useEffect(() => {
    if (off) return;
    const source = { __ndeaGraphNode: nodeId };
    return ws.registerGraphSink(nodeId, (v) => {
      if (v === undefined) return;
      if (v.kind === "focus") {
        deliverEdgeInputRowSet(inputRowSet, v);
        focus.setState(() => v.rowIndex);
        return;
      }
      deliverEdgeInputRowSet(inputRowSet, v);
      const sql = v.sql;
      input.update({
        source,
        clients: new Set(),
        value: sql ? [sql] : [],
        predicate: sql ? stringPredicate(sql) : null,
      });
    });
  }, [ws, nodeId, input, inputRowSet, focus, off]);

  // Edge-bound host (C5/C6): on the workspace surface a plugin's authored
  // outputs flow down its wires, not onto the global buses. The lasso becomes
  // an engine emission on the node's push port (the global SelectionBus
  // publish is suppressed — the dashboard keeps its global semantics); a row
  // focus likewise; and host.focus reads back the node's focus INPUT so
  // consumers (the image viewer) make the focus wire load-bearing.
  const edgeBoundHost = useMemo(() => {
    const host = handle.host;
    return new Proxy(host, {
      get(t, prop, recv) {
        if (typeof prop === "string" && Object.hasOwn(appFacets, prop)) {
          return appFacets[prop as keyof typeof appFacets];
        }
        if (prop === "patchConfig") {
          return (patch: Record<string, unknown>) => {
            ws.updateNodeConfig(nodeId, patch);
            t.patchConfig(patch);
          };
        }
        if (prop === "externalRowSet") return inputRowSet.externalRowSet;
        if (prop === "onExternalRowSet") {
          return (callback: (rowIndices: readonly RowIndex[] | null) => void) => {
            const unsubscribe = inputRowSet.onExternalRowSet(callback);
            t.track(unsubscribe);
            return unsubscribe;
          };
        }
        if (prop === "publishPredicate") {
          return (facet: string, sql: string | null) => {
            if (facet === "lasso") {
              // already emitted with row ids by the publishSelection tap?
              if (ws.getLasso(nodeId)?.sql !== sql) ws.emitLasso(nodeId, sql);
              return; // edge-bound: never the global crossfilter
            }
            t.publishPredicate(facet, sql);
          };
        }
        if (prop === "viewCoordination") {
          // Coordination-backed view-sync: a node SCOPED on the `viewSync` type
          // shares pan/zoom through coordinationSpace.viewSync[scope] with its
          // peers; an unscoped node is independent. Replaces the process-wide
          // view-sync singleton (one lock across all panels) with per-scope locks.
          // The cell carries `src` (the broadcaster's id) so a node doesn't
          // re-apply its own broadcast (the old sourcePanelId self-skip).
          const TYPE = "viewSync";
          const LOCK = "lock1"; // single shared scope until the U4 picker
          const cell = (): ViewSyncCell | undefined => {
            const scope = ws.coordination.scopeOf(nodeId, TYPE);
            return scope === undefined ? undefined : (ws.coordination.readCoordination(TYPE, scope) as ViewSyncCell);
          };
          const api: ViewCoordinationAPI = {
            get panX() {
              return cell()?.panX ?? 0;
            },
            get panY() {
              return cell()?.panY ?? 0;
            },
            get zoom() {
              return cell()?.zoom ?? 1;
            },
            get linked() {
              return ws.coordination.scopeOf(nodeId, TYPE) !== undefined;
            },
            broadcast: (s) => {
              const scope = ws.coordination.scopeOf(nodeId, TYPE);
              if (scope === undefined) return; // unscoped → broadcasting is a no-op
              ws.coordination.setCoordinationValue(TYPE, scope, {
                panX: s.panX,
                panY: s.panY,
                zoom: s.zoom,
                src: nodeId,
              });
            },
            toggleLock: () => {
              if (ws.coordination.scopeOf(nodeId, TYPE) !== undefined) ws.coordination.clearScope(nodeId, TYPE);
              else ws.coordination.assignScope(nodeId, TYPE, LOCK);
            },
            subscribe: (cb) =>
              ws.coordination.subscribe(nodeId, TYPE, (v) => {
                const c = v as ViewSyncCell | undefined;
                if (c && c.src !== nodeId) cb({ panX: c.panX ?? 0, panY: c.panY ?? 0, zoom: c.zoom ?? 1 });
              }),
          };
          return api;
        }
        if (prop === "ordering") {
          // Capability-gated (KD4): only an `ordering`-capable node (table) gets the
          // facet; others fall through to the underlying host (undefined). A pure
          // group channel — shared sort, no per-node wire fallback. Unscoped → the
          // node keeps its own local sort (set is a no-op, get is null).
          if (!t.capabilities.has("ordering-coordination")) return Reflect.get(t, prop, recv);
          const TYPE = "ordering";
          const read = (): OrderingCell => {
            const scope = ws.coordination.scopeOf(nodeId, TYPE);
            return scope === undefined
              ? null
              : ((ws.coordination.readCoordination(TYPE, scope) as OrderingCell) ?? null);
          };
          const api: OrderingCoordinationAPI = {
            get: read,
            set: (v) => {
              const scope = ws.coordination.scopeOf(nodeId, TYPE);
              if (scope === undefined) return; // unscoped → local sort only
              ws.coordination.setCoordinationValue(TYPE, scope, v);
            },
            subscribe: (cb) => ws.coordination.subscribe(nodeId, TYPE, (v) => cb((v as OrderingCell) ?? null)),
          };
          return api;
        }
        if (prop === "focus") {
          // Coordination-aware: a node SCOPED on the `focus` type reads+writes the
          // shared cell (coordinationSpace.focus[scope]) so every node on that scope
          // highlights the same obs. An unscoped node keeps the per-node /
          // focus-wire behavior. Generalizes the old syncGroups/groupFocus split.
          const effective = (): RowIndex | null => {
            const scope = ws.coordination.scopeOf(nodeId, "focus");
            if (scope === undefined) return focus.state;
            return ws.coordination.readCoordination("focus", scope) ?? null;
          };
          return {
            get: effective,
            set: (id: RowIndex | null) => {
              const scope = ws.coordination.scopeOf(nodeId, "focus");
              if (scope !== undefined) {
                // scoped: write the shared cell only — do NOT also emitFocus, or a
                // scoped+wired node would double-fire consumers (KD7/R1).
                ws.coordination.setCoordinationValue("focus", scope, id);
              } else {
                // Reflect locally FIRST so the node isolates its OWN clicked point
                // even when unlinked — emitFocus only pushes OUT the focus port
                // (down wires / to consumers), it never sets the emitter's own
                // readable focus. Then emit so wired consumers (image viewer) follow.
                focus.setState(() => id);
                ws.emitFocus(nodeId, id);
              }
            },
            subscribe: (cb: (id: RowIndex | null) => void) => {
              // fire only on a real change to the EFFECTIVE focus. Selector-scoped
              // (KD5): the coordination subscribe wakes on this node's resolved
              // `focus` cell or its scope membership flipping; the per-node store
              // subscribe covers the unscoped fallback. No whole-store listener.
              let last = effective();
              const fire = () => {
                const v = effective();
                if (v !== last) {
                  last = v;
                  cb(v);
                }
              };
              const s1 = focus.subscribe(fire);
              const s2 = ws.coordination.subscribe(nodeId, "focus", fire);
              return () => {
                s1.unsubscribe();
                s2();
              };
            },
          };
        }
        if (prop === "dataAPI") {
          const api = Reflect.get(t, prop, recv) as unknown as Record<string, unknown>;
          return new Proxy(api, {
            get(at, ap, arecv) {
              const v = Reflect.get(at, ap, arecv);
              if (ap === "publishRowSet" && typeof v === "function") {
                return async (ids: RowIndex[]) => {
                  // the server-side token table is still wanted (the predicate
                  // references it) — only the global publish is bypassed
                  const token = (await (v as (i: RowIndex[]) => Promise<{ predicate: string }>).call(at, ids)) as {
                    predicate: string;
                  };
                  ws.emitLasso(nodeId, token.predicate, ids);
                  return token;
                };
              }
              return bindMethod(v, at);
            },
          });
        }
        const v = Reflect.get(t, prop, recv);
        return bindMethod(v, t);
      },
    });
  }, [handle, ws, nodeId, focus, inputRowSet, appFacets]);

  useEffect(() => {
    const mountBody = module.mountBody;
    if (!mountBody) return;
    try {
      assertNodeHostCapabilities(definition, edgeBoundHost);
    } catch (error) {
      setMountError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let active = true;
    let mounted: Awaited<ReturnType<typeof mountBody>> | undefined;
    void Promise.resolve(mountBody(edgeBoundHost))
      .then((body) => {
        if (!active) {
          body.dispose();
          return;
        }
        mounted = body;
        ws.dockEl(nodeId).appendChild(body.element);
      })
      .catch((error: unknown) => {
        if (active) setMountError(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      active = false;
      mounted?.dispose();
    };
  }, [module, definition, edgeBoundHost, ws, nodeId]);
  useEffect(() => () => handle.dispose(), [handle]);

  if (mountError) throw mountError;
  return null;
}

function BodyOwner({
  nodeId,
  definitionRef,
  label,
}: {
  nodeId: string;
  definitionRef: ExactNodeTypeRef;
  label: string;
}) {
  const ws = useWorkspace();
  return createPortal(
    <PanelErrorBoundary panelName={label}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading {label}…</div>
        }
      >
        <BodyOwnerInner nodeId={nodeId} definitionRef={definitionRef} />
      </Suspense>
    </PanelErrorBoundary>,
    ws.dockEl(nodeId),
  );
}

/**
 * WorkspaceBodies — mounts a BodyOwner per loadable definition, sticky from
 * first need. Lives at the workspace root so no container unmount can take
 * a body down with it.
 */
export function WorkspaceBodies() {
  const ws = useWorkspace();
  const nodes = useWorkspaceSelector((s) => s.nodes);
  // placement + form + fullscreen are the activation inputs
  useWorkspaceSelector((s) => s.explicit);
  useWorkspaceSelector((s) => s.disposition);
  useWorkspaceSelector((s) => s.formOverride);
  const fullscreen = useSelector(ws.ui, (u) => u.fullscreen);
  const activated = useRef(new Set<string>());

  const live: { id: string; definitionRef: ExactNodeTypeRef; label: string }[] = [];
  for (const n of Object.values(nodes)) {
    const spec = ws.deps.nodeLibrary.getSpec(n.type);
    if (!spec?.definition.load) continue;
    const form = resolveNodeForm(ws, n.id);
    const needs =
      ws.placementOf(n.id) === "staged" ||
      form === "full" ||
      (form === "card" && spec.body === "card-and-full") ||
      fullscreen === n.id;
    if (needs) activated.current.add(n.id);
    if (activated.current.has(n.id)) {
      live.push({ id: n.id, definitionRef: spec.definition.ref, label: n.label });
    }
  }
  // drop activation for removed nodes
  for (const id of activated.current) if (!nodes[id]) activated.current.delete(id);

  return (
    <>
      {live.map((b) => (
        <BodyOwner key={b.id} nodeId={b.id} definitionRef={b.definitionRef} label={b.label} />
      ))}
    </>
  );
}

/**
 * HeaderSocket — same adoption contract as BodySocket, for the node/tile
 * header's middle gap. Whichever header currently shows the body adopts the
 * node's header slot element; plugins portal a compact toolbar into it via
 * host.bodyHeaderElement. `nodrag` keeps toolbar interactions from
 * starting an xyflow node drag.
 */
export function HeaderSocket({ nodeId }: { nodeId: string }) {
  const ws = useWorkspace();
  return (
    <div
      data-nodrag="1"
      className="nodrag flex h-full min-w-0 flex-1 items-center overflow-hidden"
      ref={(el) => {
        if (el) el.appendChild(ws.headerEl(nodeId));
      }}
    />
  );
}

/**
 * BodySocket — a container (canvas node at full form, stage tile) adopts
 * the node's dock element. Unmount leaves the dock detached on purpose:
 * the next socket re-adopts it, and React state inside never notices.
 */
export function BodySocket({
  nodeId,
  className,
  claimable = false,
}: {
  nodeId: string;
  className?: string;
  /** embedded interactive bodies (scatter/FOV on the canvas) claim the
   *  pointer on click; stage tiles never claim — they own their rectangle */
  claimable?: boolean;
}) {
  const ws = useWorkspace();
  const claimed = useWorkspaceSelector((s) => s.claimed === nodeId);
  return (
    <div
      className={`relative ${className ?? "nowheel nodrag flex min-h-0 flex-1 flex-col overflow-hidden"}`}
      ref={(el) => {
        if (el) el.appendChild(ws.dockEl(nodeId));
      }}
    >
      {claimable && !claimed ? (
        <div
          className="absolute inset-0 z-10 cursor-pointer"
          title="click to take the pointer"
          onPointerDown={(e) => {
            e.stopPropagation();
            ws.claim(nodeId);
          }}
        />
      ) : null}
    </div>
  );
}
