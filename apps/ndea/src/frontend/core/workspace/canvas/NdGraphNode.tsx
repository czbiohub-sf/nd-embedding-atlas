/**
 * NdGraphNode — the single xyflow node type for the workspace. Hosts
 * NdNodeFrame in its zoom-resolved form (chip / card / full) with real
 * engine state: LED from cook telemetry, counts per the count policy,
 * plugin bodies at full form, the threshold filter's config body at card+.
 *
 * Ports are xyflow Handles wearing the NdPort glyph (NdHandle), mounted at
 * every form through the frame's portsSlot — xyflow needs live Handles for
 * edges, and ports must ride the frame edge through morphs.
 */

import { useSelector } from "@tanstack/react-store";
import { useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect } from "react";

import { NodeDocButton } from "@/components/nd/node-doc";
import { NdIconButton } from "@/components/nd/nd-icon-button";
import { NdNodeFrame } from "@/components/nd/nd-node-frame";
import { NdHud, type NdLedState } from "@/components/nd/nd-primitives";
import type { NdResizeCorner } from "@/components/nd/nd-resize-grips";
import { BodySocket, HeaderSocket } from "../body-dock";
import { ND_NODE, ND_TIMING } from "../constants";
import { workspaceNodeSize } from "../node-defs";
import { useNodeFeedbackContext } from "../feedback";
import { useNodeCount } from "../use-node-count";
import { useTelemetrySelector, useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { resolveNodeForm, resolveNodeSize } from "./port-positions";
import { NdHandle } from "./NdHandle";
import { BypassOverlay, DisplayOffBadge, FeedbackBadges, FlagButton, SyncBadge, SyncGroupButton } from "./node-extras";

export interface NdGraphNodeData {
  wsId: string;
  [key: string]: unknown;
}
export type NdGraphNodeType = Node<NdGraphNodeData, "nd">;

const fmt = (n: number) => n.toLocaleString("en-US");

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function NdGraphNodeInner({ id, selected }: NodeProps<NdGraphNodeType>) {
  const ws = useWorkspace();
  const rf = useReactFlow();
  const node = useWorkspaceSelector((s) => s.nodes[id]);
  const locked = useWorkspaceSelector((s) => s.formLocked[id] ?? false);
  // form/size react to override + zoom-band + size/placement changes
  useWorkspaceSelector((s) => s.formOverride[id]);
  useWorkspaceSelector((s) => s.sizeOverrides[id]);
  useWorkspaceSelector((s) => s.explicit[id]);
  useWorkspaceSelector((s) => s.disposition);
  useSelector(ws.ui, (u) => u.baseForm);
  const flipHidden = useSelector(ws.ui, (u) => u.flipHide === `canvas:${id}`);
  const resizing = useSelector(ws.ui, (u) => u.resizing === id);
  const fullscreen = useSelector(ws.ui, (u) => u.fullscreen === id);
  const inMarquee = useWorkspaceSelector((s) => s.selectedNodeIds.includes(id));
  const flagsState = useWorkspaceSelector((s) => s.flags[id]);
  const claimed = useWorkspaceSelector((s) => s.claimed === id);
  const fanIn = useWorkspaceSelector(
    (s) => Object.values(s.edges).filter((e) => e.to === id && e.kind === "pred").length,
  );
  const unresolvedPorts = useWorkspaceSelector((state) => {
    const incoming = Object.values(state.edges).find((edge) => edge.to === id)?.kind;
    const outgoing = Object.values(state.edges).find((edge) => edge.from === id)?.kind;
    return { incoming, outgoing };
  });
  const feedback = useNodeFeedbackContext();

  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const cooking = useTelemetrySelector((t) => t.cooking[id] ?? false);
  const dirty = useTelemetrySelector((t) => t.dirty[id] ?? false);
  const epoch = useTelemetrySelector((t) => t.epoch);
  const cookMs = useTelemetrySelector((t) => t.cookMs[id]);

  const updateInternals = useUpdateNodeInternals();

  const def = node ? ws.nodeLibrary.getDescriptor(node.type) : null;
  const form = resolveNodeForm(ws, id);
  const size = resolveNodeSize(ws, id);

  // count policy: non-views always; views at chip only (M3 adds the
  // staged-placeholder case). Count node owns its body number instead.
  const countActive = Boolean(
    def &&
    def.type !== "count" &&
    def.type !== "subnet" &&
    def.type !== "proxy" &&
    (def.kind !== "view" ? true : form === "chip"),
  );
  const { count, cooking: countCooking, error: countError } = useNodeCount(id, countActive);

  useEffect(() => {
    updateInternals(id);
  }, [id, form, size.w, size.h, updateInternals]);

  if (!node) return null;
  if (!def) {
    return (
      <div ref={(element) => ws.registerEl(`canvas:${id}`, element)} className="relative">
        <NdNodeFrame
          nodeId={id}
          form="card"
          w={size.w}
          h={size.h}
          label={node.label}
          led={null}
          badge={<NdHud size={8.5}>unresolved</NdHud>}
          selected={selected || inMarquee}
          claimed={claimed}
          staged={false}
          locked={locked}
          onCycleForm={null}
          onToggleLock={null}
          actions={<NdIconButton icon="close" title="delete unresolved node" onClick={() => ws.removeNode(id)} />}
          portsSlot={
            <>
              {unresolvedPorts.incoming ? <NdHandle nodeId={id} kind={unresolvedPorts.incoming} out={false} /> : null}
              {unresolvedPorts.outgoing ? <NdHandle nodeId={id} kind={unresolvedPorts.outgoing} out /> : null}
            </>
          }
        >
          <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-warning/50 px-3">
            <NdHud size={8.5}>definition unavailable · {node.type}</NdHud>
          </div>
        </NdNodeFrame>
      </div>
    );
  }

  const isProxy = node.type === "proxy";
  const staged = ws.placementOf(id) === "staged";
  const bypassed = flagsState?.bypass ?? false;
  const dispOff = flagsState?.off ?? false;
  const flagged = bypassed || dispOff;
  const led: NdLedState | null = !telemetryOn
    ? null
    : flagged
      ? "idle"
      : cooking
        ? "cooking"
        : dirty
          ? "dirty"
          : "clean";
  // count policy addendum: a staged view's canvas card shows the count (the
  // placeholder doesn't communicate scale)
  const showCount = countActive || (def.kind === "view" && staged);
  const countText = showCount ? (countError ? "✗" : countCooking ? "…" : count === null ? null : fmt(count)) : null;
  const spec = ws.nodeLibrary.getSpec(node.type);
  const isSel = spec?.checkpoint ?? false;
  const hasBody = spec?.definition.load !== undefined;

  const body = (() => {
    if (form === "chip" || staged) return null; // staged → frame renders "body on stage ◆"
    if (!hasBody) return null;
    if (fullscreen)
      return (
        <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-border">
          <NdHud size={8.5}>body fullscreen · esc</NdHud>
        </div>
      );
    if (form === "full" || spec?.body === "card-and-full") {
      return <BodySocket nodeId={id} claimable={node.type === "scatter" || node.type === "image-viewer"} />;
    }
    // Compact card for definitions whose Body is deliberately full-only.
    return (
      <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-border">
        <NdHud size={8.5}>{node.label.toLowerCase()} · full body at ⛶</NdHud>
      </div>
    );
  })();

  const footer =
    form === "full" && telemetryOn ? (
      <>
        <span>epoch {String(epoch).padStart(4, "0")}</span>
        <span>{cooking ? "cooking…" : cookMs !== undefined ? `cook ${cookMs.toFixed(1)}ms` : "cook —"}</span>
      </>
    ) : null;

  /* corner-grip resize — per-form bodySize overrides; chips are canonical.
     Top/left corners anchor the opposite corner by shifting the node origin;
     the 220ms morph is suppressed for the drag (ui.resizing). */
  const beginResize = (corner: NdResizeCorner, e: React.PointerEvent) => {
    if (form === "chip") return;
    const rsForm = form;
    const cur = ws.store.state.sizeOverrides[id]?.[rsForm] ?? workspaceNodeSize(def, rsForm);
    const p0 = ws.store.state.positions[id] ?? { x: 0, y: 0 };
    const start = { x: e.clientX, y: e.clientY, w: cur.w, h: cur.h, px: p0.x, py: p0.y };
    const min = ND_NODE.resizeMin[rsForm];
    ws.setResizing(id);
    const mv = (ev: PointerEvent) => {
      const z = rf.getZoom();
      const dx = (ev.clientX - start.x) / z;
      const dy = (ev.clientY - start.y) / z;
      const w = clamp(corner.includes("e") ? start.w + dx : start.w - dx, min.w, ND_NODE.resizeMax.w);
      const h = clamp(corner.includes("s") ? start.h + dy : start.h - dy, min.h, ND_NODE.resizeMax.h);
      ws.setSizeOverride(id, rsForm, { w, h });
      if (corner.includes("w") || corner.includes("n")) {
        ws.setPosition(id, {
          x: corner.includes("w") ? start.px + (start.w - w) : start.px,
          y: corner.includes("n") ? start.py + (start.h - h) : start.py,
        });
      }
    };
    const up = () => {
      ws.setResizing(null);
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  if (isProxy) {
    return (
      <div
        ref={(el) => ws.registerEl(`canvas:${id}`, el)}
        className="relative box-border flex h-[26px] items-center rounded-full border border-border bg-card px-2"
        style={{ width: size.w }}
        data-nd-node={id}
        data-nd-form="chip"
      >
        <span className="truncate font-mono text-[9.5px] text-text-muted">{node.label}</span>
        {def.hasIn ? <NdHandle nodeId={id} kind={def.inKinds[0]} out={false} /> : null}
        {def.hasOut ? <NdHandle nodeId={id} kind={def.outKind} out /> : null}
      </div>
    );
  }

  const pinButton =
    def.stage !== "canvas-only" && form !== "chip" ? (
      <NdIconButton
        icon={staged ? "pin-down" : "pin-up"}
        label={staged ? "pull" : "stage"}
        title={staged ? "pull body to canvas" : "pin body to stage"}
        onClick={() => ws.togglePlacement(id, ND_TIMING.seamMs)}
      />
    ) : null;

  return (
    <div ref={(el) => ws.registerEl(`canvas:${id}`, el)} className="relative" style={{ opacity: flipHidden ? 0 : 1 }}>
      <NdNodeFrame
        nodeId={id}
        form={form}
        w={size.w}
        h={form === "chip" ? undefined : size.h}
        label={node.type === "subnet" ? `⊟ ${node.label}` : node.label}
        led={led}
        count={countText}
        badge={isSel ? <NdHud size={9}>◆</NdHud> : undefined}
        selected={selected || inMarquee}
        claimed={claimed}
        staged={staged}
        locked={locked}
        onCycleForm={() => ws.cycleForm(id, form)}
        onToggleLock={() => ws.toggleFormLock(id, form)}
        // the plugin's compact toolbar rides the header's middle gap; only
        // where the body is visible (full form, body on canvas) — staged
        // bodies put it in the stage tile's header instead
        headerSlot={hasBody && form === "full" && !staged && !fullscreen ? <HeaderSocket nodeId={id} /> : undefined}
        actions={
          <>
            <NodeDocButton nodeType={node.type} compact={form === "chip"} />
            <FlagButton node={node} compact={form === "chip"} />
            {def.kind === "view" && form !== "chip" ? <SyncGroupButton nodeId={id} /> : null}
            {hasBody && def.kind === "view" ? (
              <NdIconButton
                icon="fullscreen"
                title="fullscreen body"
                onClick={() => ws.setFullscreen(id)}
                compact={form === "chip"}
              />
            ) : null}
            {pinButton}
            {node.type !== "obs" ? (
              <NdIconButton
                icon="close"
                title="delete node"
                onClick={() => ws.removeNode(id)}
                compact={form === "chip"}
              />
            ) : null}
          </>
        }
        footer={footer}
        onResize={form !== "chip" && !staged ? beginResize : null}
        morphMs={resizing ? 0 : ND_TIMING.morphMs}
        portsSlot={
          <>
            {def.hasIn ? <NdHandle nodeId={id} kind={def.inKinds[0]} out={false} /> : null}
            {def.hasIn && fanIn > 1 ? (
              <span
                className="font-hud absolute z-[8] rounded-[3px] border border-wire-pred/50 bg-muted px-1 text-[8.5px] text-wire-pred"
                style={{ left: -36, top: 7 }}
              >
                AND
              </span>
            ) : null}
            {def.hasOut ? <NdHandle nodeId={id} kind={def.outKind} out /> : null}
          </>
        }
        style={
          // opacity/filter transitions live on the frame root — passing a
          // `transition` here would clobber the form-morph geometry tween
          flagged ? { opacity: 0.45, filter: dispOff ? "grayscale(0.8)" : undefined } : undefined
        }
      >
        {body}
      </NdNodeFrame>
      {bypassed ? <BypassOverlay chip={form === "chip"} /> : null}
      {dispOff && form !== "chip" ? <DisplayOffBadge /> : null}
      <FeedbackBadges nodeId={id} channels={feedback} />
      <SyncBadge nodeId={id} />
    </div>
  );
}

export const NdGraphNode = memo(NdGraphNodeInner);
