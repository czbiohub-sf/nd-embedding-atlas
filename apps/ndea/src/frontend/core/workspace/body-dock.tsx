/**
 * Body dock — ONE live body per node; bodies reparent, never remount (C4).
 *
 * Mechanism: each plugin-backed node gets a stable dock element
 * (ws.dockEl(id), created once). `BodyOwner` — mounted under the
 * workspace-root `WorkspaceBodies`, NOT inside any container — owns the
 * NodeHost (built once, disposed only when the node is removed) and
 * renders the plugin Component into the dock element via createPortal.
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
import { loadNodeModule } from "@/core/node/load-module";
import type { OrderingApi, ViewSyncApi } from "@ndea/sdk";
import { getDescriptor } from "@/core/node/registry";
import { asInstanceId } from "@ndea/sdk";
import { stringPredicate } from "@/lib/mosaic-helpers";
import { NODE_DEFS } from "./node-defs";
import { resolveNodeForm } from "./canvas/port-positions";
import { useWorkspace, useWsSelector } from "./workspace-context";
// (lasso capture + push wires need the workspace store inside the owner)

/** The `viewSync` coordination cell — pan/zoom plus the broadcaster's node id
 *  (so a node doesn't re-apply its own broadcast). All fields JsonValue. */
type ViewSyncCell = { panX?: number; panY?: number; zoom?: number; src?: string };

/** The `ordering` coordination cell — shared sort column + direction. */
type OrderingCell = { col: string; dir: "asc" | "desc" } | null;

function BodyOwnerInner({ nodeId, pluginId }: { nodeId: string; pluginId: string }) {
  const ws = useWorkspace();
  const module = use(loadNodeModule(pluginId));
  const makeHost = useDashboardHostShim();

  // Built EXACTLY ONCE per node lifetime — keyed by node identity, not
  // mount location. The per-node input Selection is the engine sink target;
  // the focus store mirrors pushed focus values for host.highlight.subscribe.
  const [{ handle, input, focus }] = useState(() => {
    const sel = Selection.single();
    const built = makeHost<unknown, unknown>({
      instanceId: asInstanceId(nodeId),
      meta: getDescriptor(pluginId)!,
      reason: "graph-node",
      config: { ...(module.defaultConfig as Record<string, unknown>) },
      options: {},
      panel: { id: nodeId, headerEl: ws.headerEl(nodeId) },
      inputSelection: sel,
    });
    return { handle: built, input: sel, focus: new Store<string | null>(null) };
  });
  useEffect(() => () => handle.dispose(), [handle]);

  const off = useWsSelector((st) => st.flags[nodeId]?.off ?? false);

  // Display-active sink: while this body lives (and its display flag is up),
  // every flush delivers the node's cooked value — pred/sel land in the input
  // Selection, focus lands in the focus store. One delivery path, all kinds.
  useEffect(() => {
    if (off) return;
    const source = { __ndeaGraphNode: nodeId };
    return ws.engine.registerSink(nodeId, (v) => {
      if (v === undefined) return;
      if (v.kind === "focus") {
        focus.setState(() => v.obsId);
        return;
      }
      const sql = v.sql;
      input.update({
        source,
        clients: new Set(),
        value: sql ? [sql] : [],
        predicate: sql ? stringPredicate(sql) : null,
      });
    });
  }, [ws, nodeId, input, focus, off]);

  // Edge-bound host (C5/C6): on the workspace surface a plugin's authored
  // outputs flow down its wires, not onto the global buses. The lasso becomes
  // an engine emission on the node's push port (the global SelectionBus
  // publish is suppressed — the dashboard keeps its global semantics); a row
  // focus likewise; and host.highlight reads back the node's focus INPUT so
  // consumers (the image viewer) make the focus wire load-bearing.
  const edgeBoundHost = useMemo(() => {
    const host = handle.host;
    return new Proxy(host, {
      get(t, prop, recv) {
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
        if (prop === "viewSync") {
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
          const api: ViewSyncApi = {
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
          if (!t.capabilities.has("ordering")) return Reflect.get(t, prop, recv);
          const TYPE = "ordering";
          const read = (): OrderingCell => {
            const scope = ws.coordination.scopeOf(nodeId, TYPE);
            return scope === undefined
              ? null
              : ((ws.coordination.readCoordination(TYPE, scope) as OrderingCell) ?? null);
          };
          const api: OrderingApi = {
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
        if (prop === "highlight") {
          // Coordination-aware: a node SCOPED on the `focus` type reads+writes the
          // shared cell (coordinationSpace.focus[scope]) so every node on that scope
          // highlights the same obs. An unscoped node keeps the per-node /
          // focus-wire behavior. Generalizes the old syncGroups/groupFocus split.
          const effective = (): string | null => {
            const scope = ws.coordination.scopeOf(nodeId, "focus");
            if (scope === undefined) return focus.state;
            const v = ws.coordination.readCoordination("focus", scope);
            return typeof v === "string" ? v : null; // null/undefined cell → null
          };
          return {
            get: effective,
            set: (id: string | null) => {
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
            subscribe: (cb: (id: string | null) => void) => {
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
        if (prop === "api") {
          const api = Reflect.get(t, prop, recv) as unknown as Record<string, unknown>;
          return new Proxy(api, {
            get(at, ap, arecv) {
              const v = Reflect.get(at, ap, arecv);
              if (ap === "publishSelection" && typeof v === "function") {
                return async (ids: number[]) => {
                  // the server-side token table is still wanted (the predicate
                  // references it) — only the global publish is bypassed
                  const token = (await (v as (i: number[]) => Promise<{ predicate: string }>).call(at, ids)) as {
                    predicate: string;
                  };
                  ws.emitLasso(nodeId, token.predicate, ids);
                  return token;
                };
              }
              return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(at) : v;
            },
          });
        }
        const v = Reflect.get(t, prop, recv);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  }, [handle, ws, nodeId, focus]);

  const Component = module.Component;
  return <Component host={edgeBoundHost} />;
}

function BodyOwner({ nodeId, pluginId, label }: { nodeId: string; pluginId: string; label: string }) {
  const ws = useWorkspace();
  return createPortal(
    <PanelErrorBoundary panelName={label}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading {label}…</div>
        }
      >
        <BodyOwnerInner nodeId={nodeId} pluginId={pluginId} />
      </Suspense>
    </PanelErrorBoundary>,
    ws.dockEl(nodeId),
  );
}

/**
 * WorkspaceBodies — mounts a BodyOwner per plugin-backed node, sticky from
 * first need. Lives at the workspace root so no container unmount can take
 * a body down with it.
 */
export function WorkspaceBodies() {
  const ws = useWorkspace();
  const nodes = useWsSelector((s) => s.nodes);
  // placement + form + fullscreen are the activation inputs
  useWsSelector((s) => s.explicit);
  useWsSelector((s) => s.disposition);
  useWsSelector((s) => s.formOverride);
  const fullscreen = useSelector(ws.ui, (u) => u.fullscreen);
  const activated = useRef(new Set<string>());

  const live: { id: string; pluginId: string; label: string }[] = [];
  for (const n of Object.values(nodes)) {
    const def = NODE_DEFS[n.type];
    if (def.kind !== "view" || !n.pluginId) continue;
    const needs = ws.placementOf(n.id) === "staged" || resolveNodeForm(ws, n.id) === "full" || fullscreen === n.id;
    if (needs) activated.current.add(n.id);
    if (activated.current.has(n.id)) live.push({ id: n.id, pluginId: n.pluginId, label: n.label });
  }
  // drop activation for removed nodes
  for (const id of activated.current) if (!nodes[id]) activated.current.delete(id);

  return (
    <>
      {live.map((b) => (
        <BodyOwner key={b.id} nodeId={b.id} pluginId={b.pluginId} label={b.label} />
      ))}
    </>
  );
}

/**
 * HeaderSocket — same adoption contract as BodySocket, for the node/tile
 * header's middle gap. Whichever header currently shows the body adopts the
 * node's header slot element; plugins portal a compact toolbar into it via
 * host.ui.container.headerEl. `nodrag` keeps toolbar interactions from
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
  const claimed = useWsSelector((s) => s.claimed === nodeId);
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
