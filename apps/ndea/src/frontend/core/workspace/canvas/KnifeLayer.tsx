/**
 * KnifeLayer: hold `Y` + drag severs every wire the stroke crosses.
 * The stroke samples each wire's bezier (20 segments, wire-geometry) and
 * live-marks crossed wires red; release cuts. World-space rendering via
 * xyflow's ViewportPortal so the stroke tracks pan/zoom.
 */

import { useReactFlow, useStore as useXyStore, ViewportPortal } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import { useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { portPos } from "./port-positions";
import { knifeCrossings, wirePath, type Pt } from "./wire-geometry";

export function useYHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.key !== "y" || e.metaKey || e.ctrlKey) return;
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      setHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "y") setHeld(false);
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return held;
}

interface KnifeState {
  pts: Pt[];
  crossed: string[];
}

export function KnifeLayer({ active }: { active: boolean }) {
  const ws = useWorkspace();
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useXyStore((s) => s.transform[2]);
  const graphPath = useWorkspaceSelector((s) => s.graphPath);
  const allNodes = useWorkspaceSelector((s) => s.nodes);
  const allEdges = useWorkspaceSelector((s) => s.edges);
  // the knife only sees the current level's wires
  const edges = Object.fromEntries(
    Object.entries(allEdges).filter(
      ([, e]) => (allNodes[e.from]?.parent ?? null) === graphPath && (allNodes[e.to]?.parent ?? null) === graphPath,
    ),
  );
  const [knife, setKnife] = useState<KnifeState | null>(null);
  const knifeRef = useRef<KnifeState | null>(null);

  useEffect(() => {
    if (!active && knifeRef.current) {
      // key released mid-stroke: cancel without cutting
      knifeRef.current = null;
      setKnife(null);
    }
  }, [active]);

  const wires = () =>
    Object.values(edges).map((e) => {
      const a = portPos(ws, e.from, "out");
      const b = portPos(ws, e.to, "in");
      return { id: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || e.button !== 0) return;
    e.stopPropagation();
    const w = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const k = { pts: [w], crossed: [] as string[] };
    knifeRef.current = k;
    setKnife(k);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const k = knifeRef.current;
    if (!k) return;
    const w = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const last = k.pts[k.pts.length - 1];
    if (Math.hypot(w.x - last.x, w.y - last.y) < 4 / zoom) return;
    const pts = [...k.pts, w];
    const nk = { pts, crossed: knifeCrossings(pts, wires()) };
    knifeRef.current = nk;
    setKnife(nk);
  };
  const onPointerUp = () => {
    const k = knifeRef.current;
    knifeRef.current = null;
    setKnife(null);
    if (k?.crossed.length) ws.deleteEdges(k.crossed);
  };

  if (!active && !knife) return null;

  return (
    <>
      {/* capture layer above the pane while Y is held */}
      <div
        className="absolute inset-0 z-30 cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {knife ? (
        <>
          <ViewportPortal>
            <svg
              className="pointer-events-none absolute overflow-visible"
              style={{ zIndex: 40 }}
              width="10"
              height="10"
            >
              {/* doomed wires re-drawn red on top */}
              {knife.crossed.map((id) => {
                const e = edges[id];
                if (!e) return null;
                const a = portPos(ws, e.from, "out");
                const b = portPos(ws, e.to, "in");
                return (
                  <path
                    key={id}
                    d={wirePath(a.x, a.y, b.x, b.y)}
                    fill="none"
                    stroke="var(--destructive)"
                    strokeWidth={2.2}
                    strokeDasharray="5 5"
                    style={{ filter: "drop-shadow(0 0 5px oklch(0.704 0.191 22.216 / 0.8))" }}
                  />
                );
              })}
              {knife.pts.length > 1 ? (
                <polyline
                  points={knife.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--destructive)"
                  strokeWidth={1.6 / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.9}
                />
              ) : null}
            </svg>
          </ViewportPortal>
          <div className="absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-md border glass px-3 py-1.25 whitespace-nowrap">
            <span className="font-mono text-[9.5px] text-destructive">
              ✂ knife: {knife.crossed.length} wire{knife.crossed.length === 1 ? "" : "s"} marked · release to cut
            </span>
          </div>
        </>
      ) : null}
    </>
  );
}
