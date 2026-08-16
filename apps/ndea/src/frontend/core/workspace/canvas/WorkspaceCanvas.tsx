/**
 * WorkspaceCanvas: the wiring canvas on xyflow. One node type
 * (NdGraphNode), one edge type (NdWireEdge), the typed connection line,
 * dot-grid substrate (22px), Tab/right-click palette, Y-knife, minimap.
 *
 * Input grammar (figma-style): bare left-drag = marquee (partial-touch) ·
 * space / middle = pan · right-click / Tab = add-node palette · Y+drag =
 * knife · L = tidy (selection-scoped when 2+) · smart double-click
 * (port/node → frame it; empty → dive; zoomed-in → fit) · esc chain
 * (menu → edge → selection → claim). Group drag moves the marquee set.
 *
 * The graph document (workspace-store) is the source of truth; xyflow's
 * node/edge arrays are projections (positions + selection sync back).
 * Forms default locked to the largest view; the zoomForms toggle opts into
 * zoom driving the render band (chip < .55 ≤ card < 1.08 ≤ full, hysteresis
 * ±.04). Per-node overrides resolve in NdGraphNode.
 */

import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type ConnectionLineComponentProps,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
// eslint-disable-next-line import/no-unassigned-import
import "@xyflow/react/dist/style.css";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NdBreadcrumb } from "@/components/node-workspace/nd-breadcrumb";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { NdHud } from "@/components/node-workspace/nd-primitives";
import { ndZoomBand, type NdForm } from "@/components/node-workspace/nd-resolve-form";
import { ND_PORT_KINDS } from "@/components/node-workspace/nd-port";
import { BRAND_PERIWINKLE } from "@/lib/color/brand";
import { useTheme } from "@/ThemeProvider";
import { ND_CANVAS, ND_TIMING, ND_ZOOM } from "../constants";
import { FeedbackChannelsContext, useFeedbackChannels } from "../feedback";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { AddNodeMenu, type AddMenuState } from "./AddNodeMenu";
import { K1Cursor } from "./K1Cursor";
import { KnifeLayer, useYHeld } from "./KnifeLayer";
import { NdGraphNode, type NdGraphNodeType } from "./NdGraphNode";
import { NodeAssetDialog } from "./NodeAssetDialog";
import { NdWireEdge, type NdWireEdgeType } from "./NdWireEdge";
import { portPos, resolveNodeSize } from "./port-positions";
import { tidyLayout } from "./tidy";
import { wirePath } from "./wire-geometry";

const nodeTypes = { nd: NdGraphNode };
const edgeTypes = { ndwire: NdWireEdge };

/** Unthemed nodes and unresolved assets in the minimap. */
const MINIMAP_NODE_FALLBACK = "oklch(0.62 0 0 / 60%)";

/** Minimap scrim over the off-view area. ReactFlow writes this into an SVG fill
 *  attribute, which cannot resolve var(), so both schemes are literals here. */
const MINIMAP_MASK = {
  dark: "oklch(0.13 0 0 / 55%)",
  light: "oklch(1 0 0 / 60%)",
} as const;

/** ghost wire in the dragged port's kind color */
function NdConnectionLine({ fromX, fromY, toX, toY, fromNode }: ConnectionLineComponentProps) {
  const ws = useWorkspace();
  const node = useWorkspaceSelector((s) => (fromNode ? s.nodes[fromNode.id] : undefined));
  const kind = node ? (ws.def(node.id)?.outKind ?? "pred") : "pred";
  return (
    <path
      d={wirePath(fromX, fromY, toX, toY)}
      fill="none"
      stroke={ND_PORT_KINDS[kind].color}
      strokeWidth={1.7}
      strokeDasharray="5 4"
      opacity={0.85}
    />
  );
}

function WorkspaceCanvasInner() {
  const ws = useWorkspace();
  const { theme } = useTheme();
  const rf = useReactFlow();
  const { screenToFlowPosition } = rf;
  const nodesReady = useNodesInitialized();
  const yHeld = useYHeld();

  // the shell (and the wiring header's fit button) drive the camera through this
  useEffect(() => {
    ws.requestFit = (duration?: number) => void rf.fitView({ duration, padding: 0.15, maxZoom: 1.2 });
    return () => {
      ws.requestFit = null;
    };
  }, [ws, rf]);

  // initial fit once every node has measured (fixes partial first fit)
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (nodesReady && !didInitialFit.current) {
      didInitialFit.current = true;
      void rf.fitView({ padding: 0.15, maxZoom: 1.2 });
    }
  }, [nodesReady, rf]);
  const paneRef = useRef<HTMLDivElement>(null);
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  const wsNodes = useWorkspaceSelector((s) => s.nodes);
  const wsEdges = useWorkspaceSelector((s) => s.edges);
  const positions = useWorkspaceSelector((s) => s.positions);
  const graphPath = useWorkspaceSelector((s) => s.graphPath);
  const selectedNodeIds = useWorkspaceSelector((s) => s.selectedNodeIds);
  const claimed = useWorkspaceSelector((s) => s.claimed);
  const baseForm = useSelector(ws.ui, (u) => u.baseForm);
  const assetAuthoring = useSelector(ws.ui, (u) => u.assetAuthoring);
  // Derived ONCE here (the DFS), then shared with every node via context: a
  // per-node call would re-run it N times. Recomputes only on topology change.
  const feedbackChannels = useFeedbackChannels();

  // the canvas shows ONE level at a time (hierarchy is document data; the
  // surface re-points). Projections merge selection back in so controlled
  // nodes keep xyflow's selected styling + group drag.
  const levelNodes = useMemo(
    () => Object.values(wsNodes).filter((n) => (n.parent ?? null) === graphPath),
    [wsNodes, graphPath],
  );
  // xyflow measures nodes through its internals, but the MiniMap reads
  // dimensions off the USER node objects. Our projection rebuilds those from
  // the graph document every render (we deliberately don't applyNodeChanges),
  // so measured sizes must be merged back in or every minimap rect bails.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const nodes = useMemo<NdGraphNodeType[]>(
    () =>
      levelNodes.map((n) => ({
        id: n.id,
        type: "nd" as const,
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { wsId: n.id },
        measured: measured[n.id],
        deletable: n.definitionRef.nodeTypeId !== "obs" && n.definitionRef.nodeTypeId !== "proxy",
        selected: selectedIds.has(n.id),
        // claiming: the claimed body rises; everything else recedes
        zIndex: claimed === n.id ? 6 : undefined,
        style: claimed && claimed !== n.id ? { opacity: 0.25, transition: "opacity 200ms" } : undefined,
      })),
    [levelNodes, positions, selectedIds, claimed, measured],
  );
  const edges = useMemo<NdWireEdgeType[]>(() => {
    const level = new Set(levelNodes.map((n) => n.id));
    return Object.values(wsEdges)
      .filter((e) => level.has(e.from) && level.has(e.to))
      .map((e) => ({
        id: e.id,
        type: "ndwire",
        source: e.from,
        sourceHandle: e.fromPort,
        target: e.to,
        targetHandle: e.toPort,
        data: { kind: e.kind },
        style: claimed ? { opacity: 0.25, transition: "opacity 200ms" } : undefined,
      }));
  }, [wsEdges, levelNodes, claimed]);

  // entering / leaving a level refits the camera (one surface, re-pointed)
  const lastPath = useRef(graphPath);
  useEffect(() => {
    if (lastPath.current === graphPath) return;
    lastPath.current = graphPath;
    const t = setTimeout(() => ws.requestFit?.(ND_TIMING.seamMs), 40);
    return () => clearTimeout(t);
  }, [graphPath, ws]);

  // zoom → global render band (hysteresis): only when zoom-semantic forms
  // are opted in; by default every node holds its largest view and zoom is
  // pure navigation. Fresh form overrides clear on band change.
  const zoomForms = useSelector(ws.ui, (u) => u.zoomForms);
  const bandRef = useRef<NdForm>(baseForm);
  const onMove = useCallback(
    (_: unknown, viewport: { zoom: number }) => {
      if (!ws.ui.state.zoomForms) return;
      const next = ndZoomBand(viewport.zoom, bandRef.current, ND_ZOOM);
      if (next !== bandRef.current) {
        bandRef.current = next;
        ws.setBaseForm(next);
      }
    },
    [ws],
  );
  // toggling zoom forms on syncs the band to the current zoom immediately;
  // toggling off resets hysteresis (setZoomForms already re-pins to full)
  useEffect(() => {
    if (!zoomForms) {
      bandRef.current = "full";
      return;
    }
    const next = ndZoomBand(rf.getZoom(), bandRef.current, ND_ZOOM);
    bandRef.current = next;
    ws.setBaseForm(next);
  }, [zoomForms, rf, ws]);

  const onNodesChange = useCallback(
    (changes: NodeChange<NdGraphNodeType>[]) => {
      const dims: Record<string, { width: number; height: number }> = {};
      for (const c of changes) {
        if (c.type === "position" && c.position) ws.setPosition(c.id, c.position);
        else if (c.type === "remove") ws.removeNode(c.id);
        else if (c.type === "dimensions" && c.dimensions) dims[c.id] = c.dimensions;
        else if (c.type === "select") {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (c.selected) next.add(c.id);
            else next.delete(c.id);
            return next;
          });
        }
      }
      if (Object.keys(dims).length) setMeasured((m) => ({ ...m, ...dims }));
    },
    [ws],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<NdWireEdgeType>[]) => {
      for (const c of changes) {
        if (c.type === "remove") ws.deleteEdge(c.id);
      }
    },
    [ws],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (conn) =>
      Boolean(
        conn.source && conn.target && ws.canConnectWire(conn.source, conn.target, conn.sourceHandle, conn.targetHandle),
      ),
    [ws],
  );
  const onConnect = useCallback(
    (conn: Connection) => ws.connect(conn.source, conn.target, conn.sourceHandle, conn.targetHandle),
    [ws],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: selEdges }: OnSelectionChangeParams) => {
      ws.setGraphSelection(
        sel.map((node) => node.id),
        selEdges.map((edge) => edge.id),
      );
    },
    [ws],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    ws.setGraphSelection([], []);
  }, [ws]);

  const openAddMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      // Base UI's Positioner anchors to the cursor and handles viewport
      // collision (flips near edges), so we just hand it the raw point.
      setAddMenu({ clientX, clientY, world: screenToFlowPosition({ x: clientX, y: clientY }) });
    },
    [screenToFlowPosition],
  );

  /* ── tidy (L): Sugiyama-lite over the level, or just the marquee set ── */
  const tidy = useCallback(() => {
    const s = ws.store.state;
    const level = Object.values(s.nodes).filter((n) => (n.parent ?? null) === s.graphPath);
    const scope = s.selectedNodeIds.length > 1 ? new Set(s.selectedNodeIds) : new Set(level.map((n) => n.id));
    const tidyNodes = level.map((n) => {
      const size = resolveNodeSize(ws, n.id);
      return { id: n.id, w: size.w, h: size.h };
    });
    const tidyEdges = Object.values(s.edges).map((e) => ({ from: e.from, to: e.to }));
    // pitch adapts to the widest measured node so full-form bodies never overlap columns
    const maxW = Math.max(...tidyNodes.map((n) => n.w), 220);
    const next = tidyLayout(tidyNodes, tidyEdges, s.positions, { scope, columnPitch: Math.max(300, maxW + 90) });
    ws.setPositions(next);
    setTimeout(() => ws.requestFit?.(ND_TIMING.seamMs), 40);
  }, [ws]);

  /* ── smart double-click: port/node → frame · empty → dive · zoomed-in → fit ── */
  const frameNode = useCallback(
    (id: string) => {
      const pos = ws.store.state.positions[id];
      if (!pos) return;
      const size = resolveNodeSize(ws, id);
      void rf.fitBounds(
        { x: pos.x - 50, y: pos.y - 40, width: size.w + 100, height: size.h + 80 },
        { duration: ND_TIMING.seamMs },
      );
      ws.selectNode(id);
    },
    [ws, rf],
  );
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, select, [data-nodrag]")) return;
      const w = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // port proximity first: frame its node
      const zoom = rf.getZoom();
      let portNode: string | null = null;
      let best = 22 / zoom;
      for (const n of Object.values(ws.store.state.nodes)) {
        const def = ws.def(n.id);
        if (!def) continue;
        for (const which of ["in", "out"] as const) {
          if ((which === "in" && !def.hasIn) || (which === "out" && !def.hasOut)) continue;
          const p = portPos(ws, n.id, which);
          const d = Math.hypot(w.x - p.x, w.y - p.y);
          if (d < best) {
            best = d;
            portNode = n.id;
          }
        }
      }
      if (portNode) {
        frameNode(portNode);
        return;
      }
      const nodeEl = target.closest("[data-nd-node]");
      if (nodeEl) {
        const nid = nodeEl.getAttribute("data-nd-node")!;
        if (ws.store.state.nodes[nid]?.definitionRef.nodeTypeId === "subnet") ws.enterSubnet(nid);
        else frameNode(nid);
        return;
      }
      // empty pane: zoomed-in → back to fit; zoomed-out → dive toward the point
      if (zoom >= ND_ZOOM.fullMin - 0.05) {
        ws.requestFit?.(ND_TIMING.seamMs);
        return;
      }
      let bestId: string | null = null;
      let bestD = 320;
      for (const n of Object.values(ws.store.state.nodes)) {
        const p = ws.store.state.positions[n.id];
        if (!p) continue;
        const size = resolveNodeSize(ws, n.id);
        const d = Math.hypot(w.x - (p.x + size.w / 2), w.y - (p.y + size.h / 2));
        if (d < bestD) {
          bestD = d;
          bestId = n.id;
        }
      }
      if (bestId) frameNode(bestId);
      else void rf.setCenter(w.x, w.y, { zoom: ND_ZOOM.fullMin + 0.06, duration: ND_TIMING.seamMs });
    },
    [ws, rf, screenToFlowPosition, frameNode],
  );

  // keys: Tab palette · L tidy · esc chain (menu → edge → selection → claim)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const m = lastMouse.current;
        const rect = paneRef.current?.getBoundingClientRect();
        openAddMenuAt(m?.x ?? (rect ? rect.left + rect.width / 2 : 0), m?.y ?? (rect ? rect.top + rect.height / 2 : 0));
      }
      if ((e.key === "l" || e.key === "L") && !e.metaKey && !e.ctrlKey && !e.shiftKey) tidy();
      if (e.key === "u" && !e.metaKey && !e.ctrlKey && ws.store.state.graphPath) ws.exitSubnet();
      // node flags on the selected node (Houdini b / d)
      if ((e.key === "b" || e.key === "d") && !e.metaKey && !e.ctrlKey) {
        const sel = ws.store.state.selectedNodeId;
        if (sel) ws.toggleFlag(sel, e.key === "b" ? "bypass" : "off");
      }
      if (e.key === "Escape") {
        const s = ws.store.state;
        if (addMenu) setAddMenu(null);
        else if (s.selectedEdgeId) ws.selectEdge(null);
        else if (s.selectedNodeId || s.selectedNodeIds.length) clearSelection();
        else if (s.claimed) ws.releaseClaim();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAddMenuAt, tidy, ws, addMenu, clearSelection]);

  return (
    <FeedbackChannelsContext.Provider value={feedbackChannels}>
      <div
        ref={paneRef}
        className="relative h-full w-full"
        style={{ cursor: claimed ? "default" : "none" }}
        onPointerMove={(e) => {
          lastMouse.current = { x: e.clientX, y: e.clientY };
        }}
        onDoubleClick={onDoubleClick}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          isValidConnection={isValidConnection}
          connectionLineComponent={NdConnectionLine}
          onMove={onMove}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            openAddMenuAt(e.clientX, e.clientY);
          }}
          onPaneClick={() => {
            setAddMenu(null);
            ws.selectNode(null);
            ws.release();
          }}
          minZoom={ND_ZOOM.min}
          maxZoom={ND_ZOOM.max}
          zoomOnDoubleClick={false}
          // figma grammar: bare left-drag = marquee (partial touch); middle / space = pan
          selectionOnDrag={!yHeld}
          selectionMode={SelectionMode.Partial}
          panOnDrag={yHeld ? false : [1]}
          panActivationKeyCode="Space"
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={ND_CANVAS.dotGridPx} size={1} color="oklch(1 0 0 / 12%)" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            className="overflow-hidden rounded-md border glass"
            style={{ width: ND_CANVAS.minimapW, height: 110, background: "var(--glass-bg)" }}
            maskColor={MINIMAP_MASK[theme]}
            bgColor="transparent"
            nodeColor={(n: Node) => {
              const node = ws.store.state.nodes[n.id];
              // ReactFlow paints the minimap into SVG fill attributes, which do
              // not resolve var(), so these have to be literals.
              if (!node) return MINIMAP_NODE_FALLBACK;
              if (n.id === ws.store.state.selectedNodeId) return BRAND_PERIWINKLE[500];
              return ws.nodeLibrary.getSpecExact(node.definitionRef)?.accent ?? MINIMAP_NODE_FALLBACK;
            }}
            nodeStrokeWidth={0}
          />
        </ReactFlow>
        {/* canvas HUD: level breadcrumb (full canvas shows it; strip header carries its own) */}
        {graphPath ? (
          <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
            <NdHud size={9.5}>wiring</NdHud>
            <NdBreadcrumb
              items={ws
                .crumbs()
                .map((c, i, all) =>
                  i === all.length - 1 ? { label: c.label } : { label: c.label, onClick: () => ws.jumpLevel(c.id) },
                )}
            />
            <NdIconButton icon="up" title="up to parent (u)" compact onClick={() => ws.exitSubnet()} />
          </div>
        ) : null}
        {/* claim hint bar */}
        {claimed ? (
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-md border glass px-3 py-1.25 whitespace-nowrap">
            <NdHud size={9.5} className="text-foreground">
              {wsNodes[claimed]?.label.toLowerCase() ?? claimed} holds the pointer
            </NdHud>
            <span className="font-mono text-[9.5px] text-text-muted">
              wheel/drag → its camera · esc or click outside → canvas
            </span>
          </div>
        ) : null}
        {/* marquee action bar: tidy · collapse into subnet */}
        {selectedNodeIds.length > 1 ? (
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border glass px-2.5 py-1.25 whitespace-nowrap">
            <span className="font-mono text-[9.5px] text-foreground">{selectedNodeIds.length} selected</span>
            <NdIconButton icon="tidy" label="tidy" title="lay out the selection (L)" onClick={tidy} />
            <NdIconButton
              icon="enter"
              label="collapse into subnet"
              title="replace the selection with a subnet containing it"
              onClick={() => ws.collapseSelection()}
            />
            <NdIconButton
              icon="config"
              label="create node asset"
              title="publish the selection as a versioned declarative node asset"
              onClick={() => ws.openNodeAssetAuthoring()}
            />
            <span className="font-mono text-[9px] text-text-muted">esc clear</span>
          </div>
        ) : null}
        <K1Cursor paneRef={paneRef} />
        <KnifeLayer active={yHeld} />
        <AddNodeMenu menu={addMenu} onClose={() => setAddMenu(null)} />
        {assetAuthoring ? (
          <NodeAssetDialog
            mode={assetAuthoring.mode}
            nodeId={assetAuthoring.mode === "edit" ? assetAuthoring.nodeId : undefined}
            open
            onOpenChange={(open) => {
              if (!open) ws.closeNodeAssetAuthoring();
            }}
          />
        ) : null}
      </div>
    </FeedbackChannelsContext.Provider>
  );
}

export function WorkspaceCanvas() {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner />
    </ReactFlowProvider>
  );
}
