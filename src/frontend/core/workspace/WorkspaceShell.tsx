/**
 * WorkspaceShell — the workspace frame: Stage pane + wiring Canvas on the
 * two state axes. Canvas disposition (bottom Strip ↔ Full canvas) is a
 * camera/geometry animation (420 ms, panes + camera together), never a
 * mount change — ONE ReactFlow stays mounted throughout. Body placement
 * (embedded ↔ staged) reparents through the body-dock. Status bar is the
 * only chrome bar: identity · engine · STAGE|CANVAS · hints · ws LED.
 */

import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";

import { NdHud, NdLed } from "@/components/nd/nd-primitives";
import { NdBreadcrumb } from "@/components/nd/nd-breadcrumb";
import { NdIconButton } from "@/components/nd/nd-icon-button";
import { useDashboard } from "@/hooks/useDashboard";
import { BodySocket, HeaderSocket, WorkspaceBodies } from "./body-dock";
import { WorkspaceCanvas } from "./canvas/WorkspaceCanvas";
import { ND_TIMING } from "./constants";
import { StagePane, stageHasContent } from "./stage/StagePane";
import { useTelemetrySelector, useWorkspace, useWsSelector, WorkspaceProvider } from "./workspace-context";
import type { GhostState } from "./workspace-store";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const WELL = 8; // strip gutter — aligned to stage padding
const WIRE_HDR = 26; // wiring tile header height (strip mode)
const STATUS_H = 22;

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
      className="pointer-events-none fixed z-[90] box-border flex items-start rounded-[7px] border-[1.5px] border-primary bg-card shadow-[0_12px_40px_rgba(0,0,0,0.5),0_0_24px_oklch(0.554_0.236_281/30%)]"
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

/* ── fullscreen — a node body fills the workspace ─────────────────── */
/** Third dock adopter (after canvas node + stage tile): the body and its
 *  header toolbar reparent in, WebGPU state survives by construction, and
 *  exiting hands both back to whichever socket owns them. esc exits
 *  (capture phase — the canvas esc-chain never sees it). */
function FullscreenOverlay() {
  const ws = useWorkspace();
  const fsId = useSelector(ws.ui, (u) => u.fullscreen);
  const node = useWsSelector((s) => (fsId ? s.nodes[fsId] : undefined));

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
  const { meta } = useDashboard();
  const epoch = useTelemetrySelector((t) => t.epoch);
  const cookingAny = useTelemetrySelector((t) => Object.keys(t.cooking).length > 0);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const disposition = useWsSelector((s) => s.disposition);
  const zoomForms = useSelector(ws.ui, (u) => u.zoomForms);

  return (
    // 1fr·auto·1fr grid — the side columns are forced EQUAL, so the
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
        <span className="rounded border border-border px-1.5 py-px">{meta.table}</span>
        <span style={{ color: cookingAny ? "var(--color-wire-pred)" : undefined }}>
          {cookingAny ? "engine cooking" : "engine idle"}
        </span>
        {telemetryOn ? <span>epoch {String(epoch).padStart(4, "0")}</span> : null}
        <NdIconButton
          icon="power"
          active={telemetryOn}
          title={telemetryOn ? "cook telemetry on — click to quiet LEDs, dashes, epochs" : "cook telemetry off"}
          onClick={() => ws.setTelemetryEnabled(!telemetryOn)}
        />
        <NdIconButton
          icon="form-chip"
          active={zoomForms}
          title={
            zoomForms
              ? "zoom forms on — zooming out shrinks nodes to cards/chips"
              : "zoom forms off — nodes hold their largest view; click to let zoom drive forms"
          }
          onClick={() => ws.setZoomForms(!zoomForms)}
        />
      </div>
      <span className="inline-flex shrink-0 rounded-md border border-border bg-muted p-0.5">
        {(["stage", "canvas"] as const).map((m) => {
          const active = (m === "canvas") === (disposition === "full");
          return (
            <button
              type="button"
              key={m}
              onClick={() => ws.setDisposition(m === "canvas" ? "full" : "strip")}
              className={`cursor-pointer rounded px-[11px] py-0.5 font-hud text-[9px] uppercase ${
                active
                  ? "border border-border-active bg-surface-tertiary text-foreground"
                  : "border border-transparent text-text-muted"
              }`}
            >
              {m}
            </button>
          );
        })}
      </span>
      <div className="flex min-w-0 items-center justify-end gap-3.5">
        <span>drag select · tab add · y knife · ⇧F {disposition === "full" ? "collapse" : "expand"} · esc</span>
        <span className="inline-flex items-center gap-[5px]">
          ws <NdLed state="clean" size={5} />
        </span>
      </div>
    </div>
  );
}

/* ── frame ───────────────────────────────────────────────────────── */
function WorkspaceFrame() {
  const ws = useWorkspace();
  const disposition = useWsSelector((s) => s.disposition);
  const stripH = useWsSelector((s) => s.stripH);
  const stageTree = useWsSelector((s) => s.stageTree);
  const graphPath = useWsSelector((s) => s.graphPath);
  useWsSelector((s) => s.explicit);
  useWsSelector((s) => s.nodes);
  const nodeCount = useWsSelector((s) => Object.keys(s.nodes).length);
  const edgeCount = useWsSelector((s) => Object.keys(s.edges).length);
  const cookingAny = useTelemetrySelector((t) => Object.keys(t.cooking).length > 0);
  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const ghost = useSelector(ws.ui, (u) => u.ghost);

  const full = disposition === "full";
  const stagedCount = ws.stagedIds().length;
  const stageOccupied = stageHasContent(stageTree, stagedCount);

  // ⇧F toggles the disposition
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "F" && e.shiftKey) ws.setDisposition(ws.store.state.disposition === "full" ? "strip" : "full");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  // refit the camera with the pane animation
  useEffect(() => {
    const t = setTimeout(() => ws.requestFit?.(ND_TIMING.seamMs), 30);
    return () => clearTimeout(t);
  }, [ws, disposition]);

  const paneTransition = `left ${ND_TIMING.seamMs}ms ${ND_TIMING.seamEase}, top ${ND_TIMING.seamMs}ms ${ND_TIMING.seamEase}, width ${ND_TIMING.seamMs}ms ${ND_TIMING.seamEase}, height ${ND_TIMING.seamMs}ms ${ND_TIMING.seamEase}`;

  // pane rects (percent/px hybrid via absolute insets)
  const stageStyle: React.CSSProperties = { left: 0, top: 0, right: 0, bottom: stripH };
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
        {/* stage — main area (strip) or right column (full canvas, only when occupied) */}
        {!full ? (
          <div className="absolute overflow-hidden" style={{ ...stageStyle, transition: paneTransition }}>
            <StagePane vertical={false} />
          </div>
        ) : stageOccupied ? (
          <div className="absolute overflow-hidden" style={{ ...sideStageStyle, transition: paneTransition }}>
            <StagePane vertical />
          </div>
        ) : null}

        {/* wiring tile chrome (strip mode): the canvas wears tile anatomy */}
        {!full ? (
          <div
            className="absolute box-border flex flex-col overflow-hidden rounded-[7px] border border-border bg-card"
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

        {/* the ONE canvas — re-disposed, never remounted */}
        <div
          className="absolute overflow-hidden"
          style={{ ...canvasStyle, transition: `${paneTransition}, border-radius 420ms ease` }}
        >
          <WorkspaceCanvas />
        </div>

        {/* fullscreen body — covers the panes, leaves the status bar */}
        <FullscreenOverlay />
      </div>

      <StatusBar />
      {ghost ? <FlipGhost ghost={ghost} /> : null}
      <WorkspaceBodies />
    </div>
  );
}

export function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <WorkspaceFrame />
    </WorkspaceProvider>
  );
}
