/**
 * K1: the morphing-dot cursor (canvas-only). A 4px dot in travel; on or
 * within 16px of a port the dot itself becomes the port's kind glyph :
 * color leads (70ms), shape follows (60ms delay) so it never expands
 * gray. During a wire drag it rides as a 9px kind-colored ring with an
 * emerald legality glow over legal in-ports. Hidden over UI and claimed
 * bodies. Positioning is rAF-lerped (no gsap: C11).
 */

import { useConnection, useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";

import { ND_PORT_KINDS, type NdPortKind } from "@/components/node-workspace/nd-port";
import { ND_Z } from "../constants";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { portPos } from "./port-positions";

const LERP = 0.55; // per-frame catch-up: snappy but smooth

export function K1Cursor({ paneRef }: { paneRef: React.RefObject<HTMLDivElement | null> }) {
  const ws = useWorkspace();
  const rf = useReactFlow();
  const conn = useConnection();
  const claimed = useWorkspaceSelector((s) => s.claimed);
  const graphPath = useWorkspaceSelector((s) => s.graphPath);
  useWorkspaceSelector((s) => s.nodes);
  useWorkspaceSelector((s) => s.positions);

  const el = useRef<HTMLSpanElement>(null);
  const target = useRef({ x: -100, y: -100 });
  const pos = useRef({ x: -100, y: -100 });
  const raf = useRef(0);

  const connRef = useRef(conn);
  connRef.current = conn;
  const claimedRef = useRef(claimed);
  claimedRef.current = claimed;

  useEffect(() => {
    const pane = paneRef.current;
    const cursor = el.current;
    if (!pane || !cursor) return;

    const setStyle = (kind: NdPortKind | null, legal: boolean | null, dragging: boolean, visible: boolean) => {
      const spec = kind ? ND_PORT_KINDS[kind] : null;
      const dragKind = connRef.current.inProgress
        ? (() => {
            const n = connRef.current.fromNode ? ws.store.state.nodes[connRef.current.fromNode.id] : null;
            const descriptor = n ? ws.def(n.id) : null;
            return descriptor ? ND_PORT_KINDS[descriptor.outKind] : null;
          })()
        : null;
      const color = spec?.color ?? dragKind?.color ?? "var(--foreground)";
      const over = Boolean(spec);
      const size = over ? 20 : dragging ? 9 : 4;
      cursor.style.opacity = visible ? "1" : "0";
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.marginLeft = `${-size / 2}px`;
      cursor.style.marginTop = `${-size / 2}px`;
      cursor.style.background = over
        ? `color-mix(in oklab, ${color} 15%, transparent)`
        : dragging
          ? "transparent"
          : color;
      cursor.style.borderColor = over || dragging ? color : "transparent";
      cursor.style.borderRadius = spec?.shape === "diamond" ? "4px" : spec?.shape === "square" ? "5px" : "99px";
      cursor.style.transform = spec?.shape === "diamond" ? "rotate(45deg)" : "none";
      cursor.style.boxShadow =
        legal === true
          ? "0 0 0 2.5px oklch(0.69 0.19 170 / 45%), 0 0 12px oklch(0.69 0.19 170 / 50%)"
          : over
            ? `0 0 10px color-mix(in oklab, ${color} 40%, transparent)`
            : "none";
    };

    const onMove = (e: PointerEvent) => {
      const rect = pane.getBoundingClientRect();
      target.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (claimedRef.current) {
        setStyle(null, null, false, false);
        return;
      }
      const t = e.target as HTMLElement;
      const onUi = t.closest?.("button, input, select, textarea, [data-nodrag], .react-flow__minimap");
      const onPortEl = t.closest?.("[data-port]");
      const onNode = t.closest?.("[data-nd-node]");
      if (onUi || (onNode && !onPortEl)) {
        setStyle(null, null, false, false);
        return;
      }

      // nearest port of the current level, in world coords
      const w = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const zoom = rf.getZoom();
      let kind: NdPortKind | null = null;
      let legal: boolean | null = null;
      let best = 16 / zoom;
      const s = ws.store.state;
      for (const n of Object.values(s.nodes)) {
        if ((n.parent ?? null) !== (s.graphPath ?? null)) continue;
        const def = ws.def(n.id);
        if (!def) continue;
        for (const which of ["in", "out"] as const) {
          if ((which === "in" && !def.hasIn) || (which === "out" && !def.hasOut)) continue;
          const p = portPos(ws, n.id, which);
          const d = Math.hypot(w.x - p.x, w.y - p.y);
          if (d < best) {
            best = d;
            kind = which === "out" ? def.outKind : def.inKinds[0];
            legal =
              connRef.current.inProgress && which === "in" && connRef.current.fromNode
                ? ws.canConnectWire(connRef.current.fromNode.id, n.id)
                : null;
          }
        }
      }
      if (!kind && onPortEl) kind = (onPortEl.getAttribute("data-port") as NdPortKind | null) ?? null;
      setStyle(kind, legal, connRef.current.inProgress, true);
    };
    const onLeave = () => setStyle(null, null, false, false);

    const tick = () => {
      pos.current.x += (target.current.x - pos.current.x) * LERP;
      pos.current.y += (target.current.y - pos.current.y) * LERP;
      cursor.style.left = `${pos.current.x}px`;
      cursor.style.top = `${pos.current.y}px`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    pane.addEventListener("pointermove", onMove);
    pane.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf.current);
      pane.removeEventListener("pointermove", onMove);
      pane.removeEventListener("pointerleave", onLeave);
    };
  }, [paneRef, rf, ws]);

  // claimed bodies own the pointer: the dot yields (hidden via onMove; the
  // span must STAY mounted or the effect's element reference detaches)
  void claimed;
  void graphPath; // level changes re-evaluate the port index closure

  return (
    <span
      ref={el}
      className="pointer-events-none absolute box-border border-[1.5px]"
      style={{
        zIndex: ND_Z.cursor,
        opacity: 0,
        transition:
          "background 70ms ease, border-color 70ms ease, box-shadow 110ms ease, width 160ms cubic-bezier(0.3, 1.35, 0.4, 1) 60ms, height 160ms cubic-bezier(0.3, 1.35, 0.4, 1) 60ms, margin 160ms cubic-bezier(0.3, 1.35, 0.4, 1) 60ms, border-radius 140ms ease 60ms, transform 160ms ease 60ms",
      }}
    />
  );
}
