/**
 * Synthetic scatter background for sketch backdrops.
 * Renders a fake embedding scatter + a dashed lasso polygon so the
 * gallery overlays have spatial context without booting the real GPU
 * scatter renderer.
 */

import { useEffect, useRef } from "react";

interface FauxScatterProps {
  className?: string;
  showLasso?: boolean;
  selectionCount?: number;
}

export function FauxScatter({ className, showLasso = true, selectionCount = 247 }: FauxScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      let state = 7;
      const rand = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
      };

      const lasso = { cx: w * 0.42, cy: h * 0.55, rx: w * 0.18, ry: h * 0.22 };

      const total = 8000;
      const palette = ["#06b6d4", "#22d3ee", "#3b82f6", "#a78bfa", "#f43f5e", "#f59e0b", "#10b981"];
      for (let i = 0; i < total; i++) {
        const px = rand() * w;
        const py = rand() * h;
        const dx = (px - lasso.cx) / lasso.rx;
        const dy = (py - lasso.cy) / lasso.ry;
        const inLasso = dx * dx + dy * dy < 1;
        const color = palette[Math.floor(rand() * palette.length)];
        ctx.fillStyle = color;
        ctx.globalAlpha = inLasso ? 0.85 : 0.18;
        ctx.fillRect(px, py, inLasso ? 2.5 : 1.5, inLasso ? 2.5 : 1.5);
      }
      ctx.globalAlpha = 1;

      if (showLasso) {
        ctx.strokeStyle = "oklch(0.585 0.233 277.117)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(lasso.cx, lasso.cy, lasso.rx, lasso.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "oklch(0.585 0.233 277.117 / 0.08)";
        ctx.beginPath();
        ctx.ellipse(lasso.cx, lasso.cy, lasso.rx, lasso.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [showLasso]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {showLasso && (
        <div className="pointer-events-none absolute top-1/2 left-[42%] -translate-x-1/2 -translate-y-1/2 select-none">
          <div className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 font-mono text-3xs text-primary backdrop-blur-sm">
            {selectionCount} selected
          </div>
        </div>
      )}
    </div>
  );
}
