import type { PointerEvent as ReactPointerEvent } from "react";

import { NodeDocButton } from "@/components/node-workspace/node-doc";
import { NdIconButton } from "@/components/node-workspace/nd-icon-button";
import { NdNodeFrame } from "@/components/node-workspace/nd-node-frame";
import { NdHud } from "@/components/node-workspace/nd-primitives";
import type { NdResizeCorner } from "@/components/node-workspace/nd-resize-grips";
import type { GraphDocumentNode } from "@/core/graph/records";
import type { AppNodeDescriptor } from "@/core/node/library";
import { BodySocket, HeaderSocket } from "../body-dock";
import { ND_TIMING } from "../constants";
import { NdHandle } from "./NdHandle";
import { BypassOverlay, DisplayOffBadge, FeedbackBadges, FlagButton, SyncBadge, SyncGroupButton } from "./node-extras";
import { formatCookStatus, resolveDisabledNodeStyle, shouldShowNodeHeader } from "./nd-graph-node-model";
import type { NdGraphNodeModel } from "./useNdGraphNodeModel";

interface NodeViewProps {
  model: NdGraphNodeModel;
  selected: boolean;
}

interface ResolvedNodeViewProps extends NodeViewProps {
  node: GraphDocumentNode;
  def: AppNodeDescriptor;
}

export function UnresolvedNdGraphNode({ model, selected }: NodeViewProps) {
  const { id, ws, node, size, inMarquee, claimed, locked } = model;
  if (!node) return null;

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
        portsSlot={<UnresolvedNodePorts model={model} />}
      >
        <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-warning/50 px-3">
          <NdHud size={8.5}>
            definition unavailable · {node.definitionRef.nodeTypeId}@{node.definitionRef.nodeTypeVersion}
          </NdHud>
        </div>
      </NdNodeFrame>
    </div>
  );
}

function UnresolvedNodePorts({ model }: { model: NdGraphNodeModel }) {
  const { id, unresolvedPorts } = model;
  return (
    <>
      {unresolvedPorts.incoming ? (
        <NdHandle
          nodeId={id}
          portId={unresolvedPorts.incoming.toPort}
          kind={unresolvedPorts.incoming.kind}
          out={false}
        />
      ) : null}
      {unresolvedPorts.outgoing ? (
        <NdHandle nodeId={id} portId={unresolvedPorts.outgoing.fromPort} kind={unresolvedPorts.outgoing.kind} out />
      ) : null}
    </>
  );
}

export function ProxyNdGraphNode({ model, node, def }: ResolvedNodeViewProps) {
  const { id, ws, size } = model;
  return (
    <div
      ref={(element) => ws.registerEl(`canvas:${id}`, element)}
      className="relative box-border flex h-[26px] items-center rounded-full border border-border bg-node-surface px-2"
      style={{ width: size.w }}
      data-nd-node={id}
      data-nd-form="chip"
    >
      <span className="truncate font-mono text-[9.5px] text-text-muted">{node.label}</span>
      {def.inputPorts.map((port, index) => (
        <NdHandle
          key={`in:${port.id}`}
          nodeId={id}
          portId={port.id}
          kind={port.kind}
          out={false}
          top={13 + index * 13}
        />
      ))}
      {def.outputPorts.map((port, index) => (
        <NdHandle key={`out:${port.id}`} nodeId={id} portId={port.id} kind={port.kind} out top={13 + index * 13} />
      ))}
    </div>
  );
}

export function ResolvedNdGraphNode({
  model,
  node,
  def,
  selected,
  onResize,
}: ResolvedNodeViewProps & {
  onResize: (corner: NdResizeCorner, event: ReactPointerEvent) => void;
}) {
  const {
    id,
    ws,
    form,
    size,
    flipHidden,
    inMarquee,
    claimed,
    staged,
    locked,
    led,
    countText,
    spec,
    hasBody,
    fullscreen,
    flagged,
    dispOff,
    resizing,
  } = model;
  const label = node.definitionRef.nodeTypeId === "subnet" ? `⊟ ${node.label}` : node.label;
  const headerSlot = shouldShowNodeHeader(hasBody, form, staged, fullscreen) ? <HeaderSocket nodeId={id} /> : undefined;
  const disabledStyle = resolveDisabledNodeStyle(flagged, dispOff);

  return (
    <div
      ref={(element) => ws.registerEl(`canvas:${id}`, element)}
      className="relative"
      style={{ opacity: flipHidden ? 0 : 1 }}
    >
      <NdNodeFrame
        nodeId={id}
        form={form}
        w={size.w}
        h={form === "chip" ? undefined : size.h}
        label={label}
        led={led}
        count={countText}
        badge={spec?.checkpoint ? <NdHud size={9}>◆</NdHud> : undefined}
        selected={selected || inMarquee}
        claimed={claimed}
        staged={staged}
        locked={locked}
        onCycleForm={() => ws.cycleForm(id, form)}
        onToggleLock={() => ws.toggleFormLock(id, form)}
        headerSlot={headerSlot}
        actions={<NodeActions model={model} node={node} def={def} />}
        footer={form === "full" && model.telemetryOn ? <NodeFooter model={model} /> : null}
        onResize={form !== "chip" && !staged ? onResize : null}
        morphMs={resizing ? 0 : ND_TIMING.morphMs}
        portsSlot={<ResolvedNodePorts model={model} def={def} />}
        style={disabledStyle}
      >
        <NodeBody model={model} node={node} />
      </NdNodeFrame>
      <NodeOverlays model={model} />
    </div>
  );
}

function NodeBody({ model, node }: { model: NdGraphNodeModel; node: GraphDocumentNode }) {
  const { id, bodyMode } = model;
  if (bodyMode === "hidden") return null;
  if (bodyMode === "socket") {
    const claimable = node.definitionRef.nodeTypeId === "scatter" || node.definitionRef.nodeTypeId === "image-viewer";
    return <BodySocket nodeId={id} claimable={claimable} />;
  }

  const message =
    bodyMode === "fullscreen-placeholder" ? "body fullscreen · esc" : `${node.label.toLowerCase()} · full body at ⛶`;
  return (
    <div className="grid min-h-12 flex-1 place-items-center rounded border border-dashed border-border">
      <NdHud size={8.5}>{message}</NdHud>
    </div>
  );
}

function PlacementAction({ model, def }: { model: NdGraphNodeModel; def: AppNodeDescriptor }) {
  const { ws, id, form, staged } = model;
  if (def.stage === "canvas-only" || form === "chip") return null;

  return (
    <NdIconButton
      icon={staged ? "pin-down" : "pin-up"}
      label={staged ? "pull" : "stage"}
      title={staged ? "pull body to canvas" : "pin body to stage"}
      onClick={() => ws.togglePlacement(id, ND_TIMING.seamMs)}
    />
  );
}

function NodeActions({
  model,
  node,
  def,
}: {
  model: NdGraphNodeModel;
  node: GraphDocumentNode;
  def: AppNodeDescriptor;
}) {
  const { ws, id, form, hasBody } = model;
  const compact = form === "chip";
  const nodeTypeId = node.definitionRef.nodeTypeId;

  return (
    <>
      <NodeDocButton definitionRef={node.definitionRef} compact={compact} />
      {nodeTypeId.startsWith("asset/") ? (
        <NdIconButton
          icon="config"
          title="edit node asset definition"
          label={compact ? null : "edit definition"}
          compact={compact}
          onClick={() => ws.openNodeAssetEditor(id)}
        />
      ) : null}
      {nodeTypeId === "subnet" ? (
        <NdIconButton
          icon="config"
          title="create node asset from subnet contents"
          compact={compact}
          onClick={() => ws.openSubnetAssetAuthoring(id)}
        />
      ) : null}
      <FlagButton node={node} compact={compact} />
      {def.role === "view" && !compact ? <SyncGroupButton nodeId={id} /> : null}
      {hasBody && def.role === "view" ? (
        <NdIconButton
          icon="fullscreen"
          title="fullscreen body"
          onClick={() => ws.setFullscreen(id)}
          compact={compact}
        />
      ) : null}
      <PlacementAction model={model} def={def} />
      {nodeTypeId !== "obs" ? (
        <NdIconButton icon="close" title="delete node" onClick={() => ws.removeNode(id)} compact={compact} />
      ) : null}
    </>
  );
}

function NodeFooter({ model }: { model: NdGraphNodeModel }) {
  const { epoch, cooking, cookMs } = model;

  return (
    <>
      <span>epoch {String(epoch).padStart(4, "0")}</span>
      <span>{formatCookStatus(cooking, cookMs)}</span>
    </>
  );
}

function ResolvedNodePorts({ model, def }: { model: NdGraphNodeModel; def: AppNodeDescriptor }) {
  const { id, fanIn } = model;
  return (
    <>
      {def.inputPorts.map((port, index) => (
        <NdHandle
          key={`in:${port.id}`}
          nodeId={id}
          portId={port.id}
          kind={port.kind}
          out={false}
          top={13 + index * 14}
        />
      ))}
      {def.hasIn && fanIn > 1 ? (
        <span
          className="font-hud absolute z-[8] rounded-[3px] border border-wire-pred/50 bg-muted px-1 text-[8.5px] text-wire-pred"
          style={{ left: -36, top: 7 }}
        >
          AND
        </span>
      ) : null}
      {def.outputPorts.map((port, index) => (
        <NdHandle key={`out:${port.id}`} nodeId={id} portId={port.id} kind={port.kind} out top={13 + index * 14} />
      ))}
    </>
  );
}

function NodeOverlays({ model }: { model: NdGraphNodeModel }) {
  const { id, form, bypassed, dispOff, feedback } = model;
  return (
    <>
      {bypassed ? <BypassOverlay chip={form === "chip"} /> : null}
      {dispOff && form !== "chip" ? <DisplayOffBadge /> : null}
      <FeedbackBadges nodeId={id} channels={feedback} />
      <SyncBadge nodeId={id} />
    </>
  );
}
