/**
 * WorkspaceShell: the workspace frame: Stage pane + wiring Canvas on the
 * two state axes. Canvas disposition (full ↔ split ↔ hidden) is a
 * camera/geometry animation (dispoMs, panes + camera together), never a
 * mount change: ONE ReactFlow stays mounted throughout. Body placement
 * (embedded ↔ staged) reparents through the body-dock. Status bar is the
 * only chrome bar: identity · engine · disposition control · hints · ws LED.
 */

import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";

import { NdHud, NdLed } from "@/components/nd/nd-primitives";
import { NdBreadcrumb } from "@/components/nd/nd-breadcrumb";
import { NdIconButton } from "@/components/nd/nd-icon-button";
import { PanelBottom, PanelBottomClose, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { BodySocket, HeaderSocket, WorkspaceBodies } from "./body-dock";
import { WorkspaceCanvas } from "./canvas/WorkspaceCanvas";
import { ND_TIMING } from "./constants";
import type { AppNodeLibrary } from "@/core/node/library";
import { StagePane, stageHasContent } from "./stage/StagePane";
import {
  useTelemetrySelector,
  useWorkspace,
  useWorkspacePersistence,
  useWorkspaceSelector,
  WorkspaceProvider,
} from "./workspace-context";
import type { GhostState } from "./workspace-store";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const WELL = 8; // strip gutter: aligned to stage padding
const WIRE_HDR = 26; // wiring tile header height (strip mode)
const STATUS_H = 22;

// emphasis axis order for the ⇧F cycle + the status-bar segmented control
const DISPOSITIONS = ["full", "strip", "hidden"] as const;

/* ── FLIP relocation ghost ───────────────────────────────────────── */
function FlipGhost({ ghost }: { ghost: GhostState }) {
  // animate from → to by flipping a CSS transition one frame after mount
  return (
    <div
      ref={(el) => {
        if (!el) return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            el.style.left = `${ghost.to.left}px`;
            el.style.top = `${ghost.to.top}px`;
            el.style.width = `${ghost.to.width}px`;
            el.style.height = `${ghost.to.height}px`;
          }),
        );
      }}
      className="pointer-events-none fixed z-[90] box-border flex items-start rounded-[7px] border-[1.5px] border-primary bg-card shadow-[0_12px_40px_rgba(0,0,0,0.5),0_0_24px_color-mix(in_oklab,var(--color-primary)_30%,transparent)]"
      style={{
        left: ghost.from.left,
        top: ghost.from.top,
        width: ghost.from.width,
        height: ghost.from.height,
        transition: `all ${ND_TIMING.seamMs}ms cubic-bezier(0.25, 0.8, 0.3, 1)`,
      }}
    >
      <div className="flex h-[26px] items-center gap-1.5 px-[9px]">
        <NdLed state="clean" />
        <span className="text-[11.5px] font-medium text-foreground">{ghost.label}</span>
      </div>
    </div>
  );
}

/* ── fullscreen: a node body fills the workspace ─────────────────── */
/** Third dock adopter (after canvas node + stage tile): the body and its
 *  header toolbar reparent in, WebGPU state survives by construction, and
 *  exiting hands both back to whichever socket owns them. esc exits
 *  (capture phase: the canvas esc-chain never sees it). */
function FullscreenOverlay() {
  const ws = useWorkspace();
  const fsId = useSelector(ws.ui, (u) => u.fullscreen);
  const node = useWorkspaceSelector((s) => (fsId ? s.nodes[fsId] : undefined));

  useEffect(() => {
    if (!fsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ws.setFullscreen(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fsId, ws]);

  if (!fsId || !node) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 border-b border-border bg-card px-[9px] leading-none whitespace-nowrap">
        <NdLed state="clean" />
        <span className="text-[11.5px] font-medium whitespace-nowrap">{node.label}</span>
        <HeaderSocket nodeId={fsId} />
        <span className="font-mono text-[9.5px] whitespace-nowrap text-text-muted">◆ {fsId}</span>
        <NdIconButton icon="fullscreen" active title="exit fullscreen (esc)" onClick={() => ws.setFullscreen(null)} />
      </div>
      <div className="min-h-0 flex-1 p-2">
        <BodySocket nodeId={fsId} className="flex h-full min-h-0 flex-col overflow-hidden" />
      </div>
    </div>
  );
}

/* ── status bar ──────────────────────────────────────────────────── */
function StatusBar() {
  const ws = useWorkspace();
  const { runtime } = useDatasetSession();
  const epoch = useTelemetrySelector((t) => t.epoch);
  const cookingAny = useTelemetrySelector((t) => Object.keys(t.cooking).length > 0);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const disposition = useWorkspaceSelector((s) => s.disposition);
  const zoomForms = useSelector(ws.ui, (u) => u.zoomForms);

  return (
    // 1fr·auto·1fr grid: the side columns are forced EQUAL, so the
    // STAGE|CANVAS switch sits at the true center and stays put while the
    // flanking text changes width (engine idle/cooking, ⇧F expand/collapse)
    <div
      className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center overflow-hidden border-t border-border bg-card px-2.5 font-mono text-3xs whitespace-nowrap text-text-muted select-none"
      style={{ height: STATUS_H }}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-4 shrink-0 place-items-center rounded bg-primary">
          <NdHud size={7} className="text-white normal-case">
            nD
          </NdHud>
        </span>
        <span className="rounded border border-border px-1.5 py-px">{runtime.table}</span>
        <span style={{ color: cookingAny ? "var(--color-wire-pred)" : undefined }}>
          {cookingAny ? "engine cooking" : "engine idle"}
        </span>
        {telemetryOn ? <span>epoch {String(epoch).padStart(4, "0")}</span> : null}
        <NdIconButton
          icon="power"
          active={telemetryOn}
          title={telemetryOn ? "cook telemetry on: click to quiet LEDs, dashes, epochs" : "cook telemetry off"}
          onClick={() => ws.setTelemetryEnabled(!telemetryOn)}
        />
        <NdIconButton
          icon="form-chip"
          active={zoomForms}
          title={
            zoomForms
              ? "zoom forms on: zooming out shrinks nodes to cards/chips"
              : "zoom forms off: nodes hold their largest view; click to let zoom drive forms"
          }
          onClick={() => ws.setZoomForms(!zoomForms)}
        />
      </div>
      {/* The disposition control belongs to the editor. A fixed-preset build
          stays on the preset's saved disposition with no way to switch. */}
      {NODE_EDITOR_ENABLED ? (
        <ButtonGroup className="shrink-0">
          {(
            [
              { disp: "full", Icon: Workflow, title: "wiring fills the workspace" },
              { disp: "strip", Icon: PanelBottom, title: "split: stage above, wiring docked" },
              { disp: "hidden", Icon: PanelBottomClose, title: "stage fills, wiring collapsed" },
            ] as const
          ).map(({ disp, Icon, title }) => {
            const active = disposition === disp;
            return (
              <Button
                key={disp}
                type="button"
                variant={active ? "secondary" : "ghost"}
                size="icon-xs"
                aria-pressed={active}
                title={title}
                aria-label={title}
                onClick={() => ws.setDisposition(disp)}
              >
                <Icon strokeWidth={1.75} />
              </Button>
            );
          })}
        </ButtonGroup>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 items-center justify-end gap-3.5">
        {NODE_EDITOR_ENABLED ? <span>drag select · tab add · y knife · ⇧F wiring · esc</span> : null}
        <span className="inline-flex items-center gap-[5px]">
          ws <NdLed state="clean" size={5} />
        </span>
      </div>
    </div>
  );
}

/* ── frame ───────────────────────────────────────────────────────── */
export interface WorkspaceSurfacePolicy {
  readonly recoveryOnly: boolean;
  readonly mountStage: boolean;
  readonly mountCanvas: boolean;
  readonly mountStatusBar: boolean;
  readonly mountBodies: boolean;
  /** Session-local stage layout remains adjustable without graph authoring. */
  readonly editStageLayout: boolean;
  readonly installAuthoringListeners: boolean;
}

export function workspaceSurfacePolicy(
  mode: "writable" | "recovery",
  nodeEditorEnabled: boolean,
): WorkspaceSurfacePolicy {
  const writable = mode === "writable";
  return Object.freeze({
    recoveryOnly: !writable,
    mountStage: writable,
    mountCanvas: writable && nodeEditorEnabled,
    mountStatusBar: writable,
    mountBodies: writable,
    editStageLayout: writable,
    installAuthoringListeners: writable && nodeEditorEnabled,
  });
}

function RecoveryWorkspaceSurface({ persistence }: { persistence: ReturnType<typeof useWorkspacePersistence> }) {
  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-background p-8 select-none">
      <div
        role="alert"
        className="max-w-xl rounded-md border border-warning/60 bg-card p-4 font-mono text-xs shadow-xl"
      >
        <div className="mb-2 font-semibold text-warning">Workspace opened read-only for recovery</div>
        <div>stage: {persistence.stage ?? "unknown"}</div>
        {persistence.backupKey ? <div>backup: {persistence.backupKey}</div> : null}
        {persistence.errors.map((error) => (
          <div key={error} className="mt-2 break-words text-text-muted">
            {error}
          </div>
        ))}
        <div className="mt-3 text-text-muted">
          Authoring controls, node bodies, autosave, and migration rewrites are disabled.
        </div>
      </div>
    </div>
  );
}

function WritableWorkspaceFrame({ policy }: { policy: WorkspaceSurfacePolicy }) {
  const ws = useWorkspace();
  const disposition = useWorkspaceSelector((s) => s.disposition);
  const stripH = useWorkspaceSelector((s) => s.stripH);
  const stageTree = useWorkspaceSelector((s) => s.stageTree);
  const graphPath = useWorkspaceSelector((s) => s.graphPath);
  useWorkspaceSelector((s) => s.explicit);
  useWorkspaceSelector((s) => s.nodes);
  const nodeCount = useWorkspaceSelector((s) => Object.keys(s.nodes).length);
  const edgeCount = useWorkspaceSelector((s) => Object.keys(s.edges).length);
  const cookingAny = useTelemetrySelector((t) => Object.keys(t.cooking).length > 0);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const ghost = useSelector(ws.ui, (u) => u.ghost);

  const full = disposition === "full";
  const hidden = disposition === "hidden";
  const stagedCount = ws.stagedIds().length;
  const stageOccupied = stageHasContent(stageTree, stagedCount);

  // ⇧F cycles the emphasis axis: full → strip → hidden → full. Editor-only :
  // a fixed-preset build has no canvas to reveal.
  useEffect(() => {
    if (!policy.installAuthoringListeners) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "F" && e.shiftKey) {
        const cur = ws.store.state.disposition;
        const i = DISPOSITIONS.indexOf(cur);
        ws.setDisposition(DISPOSITIONS[(i + 1) % DISPOSITIONS.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws, policy.installAuthoringListeners]);

  // refit the camera with the pane animation: but not while hidden (fitView on
  // a 0-height pane yields a garbage viewport that would persist on show).
  // Matches the pane timing so camera + geometry settle together.
  useEffect(() => {
    if (disposition === "hidden") return;
    const t = setTimeout(() => ws.requestFit?.(ND_TIMING.dispoMs), 30);
    return () => clearTimeout(t);
  }, [ws, disposition]);

  // disposition geometry rides dispoMs (snappy): not the camera-fly-to seamMs
  const paneTransition = `left ${ND_TIMING.dispoMs}ms ${ND_TIMING.dispoEase}, top ${ND_TIMING.dispoMs}ms ${ND_TIMING.dispoEase}, width ${ND_TIMING.dispoMs}ms ${ND_TIMING.dispoEase}, height ${ND_TIMING.dispoMs}ms ${ND_TIMING.dispoEase}`;

  // pane rects (percent/px hybrid via absolute insets). When hidden, the stage
  // takes the whole frame (the wiring handle folds into the status bar); when
  // stripped, it sits above the strip.
  const stageStyle: React.CSSProperties = { left: 0, top: 0, right: 0, bottom: hidden ? 0 : stripH };
  const sideStageStyle: React.CSSProperties = {
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(400px, 30vw)",
    borderLeft: "1px solid var(--border)",
  };
  const canvasStyle: React.CSSProperties = full
    ? {
        left: 0,
        top: 0,
        width: stageOccupied ? "calc(100% - min(400px, 30vw))" : "100%",
        height: "100%",
        borderRadius: 0,
      }
    : hidden
      ? {
          // collapsed: the ONE ReactFlow stays mounted, slid below the viewport
          // (height 0) so WebGPU + camera survive a hide → show round-trip
          left: WELL + 1,
          top: "100%",
          width: `calc(100% - ${WELL * 2 + 2}px)`,
          height: 0,
          borderRadius: 0,
        }
      : {
          left: WELL + 1,
          top: `calc(100% - ${stripH - WIRE_HDR - 1}px)`,
          width: `calc(100% - ${WELL * 2 + 2}px)`,
          height: stripH - WIRE_HDR - WELL - 2,
          borderRadius: "0 0 6px 6px",
        };

  const divDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = stripH;
    const H = window.innerHeight - STATUS_H;
    const mv = (ev: PointerEvent) => ws.setStripH(clamp(startH + (startY - ev.clientY), 160, Math.round(H * 0.7)));
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background select-none">
      <div className="relative min-h-0 flex-1">
        {/* stage: main area (strip) or right column (full canvas, only when occupied) */}
        {policy.mountStage && !full ? (
          <div className="absolute overflow-hidden" style={{ ...stageStyle, transition: paneTransition }}>
            <StagePane vertical={false} editable={policy.editStageLayout} />
          </div>
        ) : policy.mountStage && stageOccupied ? (
          <div className="absolute overflow-hidden" style={{ ...sideStageStyle, transition: paneTransition }}>
            <StagePane vertical editable={policy.editStageLayout} />
          </div>
        ) : null}

        {/* Wiring tile chrome (strip mode): the canvas wears tile anatomy.
            A fixed-preset build never enters strip or mounts the canvas. */}
        {policy.mountCanvas && disposition === "strip" ? (
          <div
            className="absolute box-border flex flex-col overflow-hidden rounded-[7px] border border-border bg-node-surface"
            style={{
              left: WELL,
              bottom: WELL,
              width: `calc(100% - ${WELL * 2}px)`,
              height: stripH - WELL,
              transition: paneTransition,
            }}
          >
            <div
              onPointerDown={divDrag}
              title="drag to resize · ⇧F to expand"
              className="box-border flex shrink-0 cursor-ns-resize items-center gap-1.5 overflow-hidden border-b border-border px-[9px] whitespace-nowrap"
              style={{ height: WIRE_HDR }}
            >
              <span className="shrink-0 text-[10px] tracking-[1px] text-text-muted select-none">⠏</span>
              {telemetryOn ? <NdLed state={cookingAny ? "cooking" : "clean"} /> : null}
              <span className="text-[11.5px] font-medium whitespace-nowrap">Wiring</span>
              <span className="font-mono text-[9.5px] whitespace-nowrap text-text-muted">
                {nodeCount} nodes · {edgeCount} edges
              </span>
              <span className="flex-1" />
              <NdBreadcrumb
                items={ws
                  .crumbs()
                  .map((c, i, all) =>
                    i === all.length - 1 ? { label: c.label } : { label: c.label, onClick: () => ws.jumpLevel(c.id) },
                  )}
              />
              {graphPath ? <NdIconButton icon="up" title="up to parent (u)" onClick={() => ws.exitSubnet()} /> : null}
              <NdIconButton
                icon="form-full"
                title="fit graph in view"
                onClick={() => ws.requestFit?.(ND_TIMING.seamMs)}
              />
              <NdIconButton
                icon="pin-up"
                label="expand"
                title="expand wiring to full canvas (⇧F)"
                onClick={() => ws.setDisposition("full")}
              />
            </div>
          </div>
        ) : null}

        {/* the ONE canvas: re-disposed, never remounted. Editor-only: the wiring
            canvas is the sole home of the Tab palette, right-click add-menu, knife,
            connect, and node-delete listeners. A fixed-preset build does not mount
            it, so authoring is absent while Stage bodies remain unaffected. */}
        {policy.mountCanvas ? (
          <div
            className="absolute overflow-hidden"
            style={{
              ...canvasStyle,
              transition: `${paneTransition}, border-radius ${ND_TIMING.dispoMs}ms ${ND_TIMING.dispoEase}`,
            }}
          >
            <WorkspaceCanvas />
          </div>
        ) : null}

        {/* fullscreen body: covers the panes, leaves the status bar */}
        {policy.mountBodies ? <FullscreenOverlay /> : null}
      </div>

      {policy.mountStatusBar ? <StatusBar /> : null}
      {ghost ? <FlipGhost ghost={ghost} /> : null}
      {policy.mountBodies ? <WorkspaceBodies /> : null}
    </div>
  );
}

function WorkspaceFrame() {
  const persistence = useWorkspacePersistence();
  const policy = workspaceSurfacePolicy(persistence.mode, NODE_EDITOR_ENABLED);
  if (policy.recoveryOnly) return <RecoveryWorkspaceSurface persistence={persistence} />;
  return <WritableWorkspaceFrame policy={policy} />;
}

export function WorkspaceShell({ nodeLibrary }: { nodeLibrary: AppNodeLibrary }) {
  return (
    <WorkspaceProvider nodeLibrary={nodeLibrary}>
      <WorkspaceFrame />
    </WorkspaceProvider>
  );
}
