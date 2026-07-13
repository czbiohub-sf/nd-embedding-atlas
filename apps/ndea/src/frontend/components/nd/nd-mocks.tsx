/**
 * nd-mocks — seeded design-reference mocks (point cloud, microscopy crop,
 * table rows, histogram). Used by the #/nd-spec dev route ONLY; production
 * surfaces render real engine state. Ported from the design handoff's
 * prototype/helpers.jsx.
 */

import { useMemo } from "react";

/** Deterministic PRNG — mulberry32. */
export function ndMulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAT_PALETTE = ["#8b7bf7", "#f59e0b", "#34d399", "#f43f5e", "#38bdf8"];

export function NdScatterMock({
  width = 280,
  height = 200,
  seed = 7,
  mono = null,
}: {
  width?: number;
  height?: number;
  seed?: number;
  mono?: string | null;
}) {
  const pr = Math.max(1.2, Math.min(2.8, width / 200));
  const pts = useMemo(() => {
    const rnd = ndMulberry(seed);
    const clusters = Array.from({ length: 5 }, (_, i) => ({
      cx: 0.12 + rnd() * 0.76,
      cy: 0.12 + rnd() * 0.76,
      sx: 0.03 + rnd() * 0.075,
      sy: 0.03 + rnd() * 0.075,
      n: 90 + Math.floor(rnd() * 130),
      c: i,
    }));
    const out: { x: number; y: number; c: number }[] = [];
    for (const cl of clusters) {
      for (let i = 0; i < cl.n; i++) {
        const u1 = Math.max(rnd(), 1e-6);
        const u2 = rnd();
        const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const g2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        out.push({ x: (cl.cx + g1 * cl.sx) * width, y: (cl.cy + g2 * cl.sy) * height, c: cl.c });
      }
    }
    return out;
  }, [seed, width, height]);

  return (
    <svg width={width} height={height} className="block">
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={pr}
          fill={mono ?? CAT_PALETTE[p.c % CAT_PALETTE.length]}
          opacity={mono ? 0.55 : 0.8}
        />
      ))}
    </svg>
  );
}

export function NdTableMock({
  rows = 6,
  highlight = 2,
  fontSize = 10,
}: {
  rows?: number;
  highlight?: number;
  fontSize?: number;
}) {
  const stages = ["interphase", "metaphase", "anaphase", "prophase"];
  const rnd = ndMulberry(41);
  const data = Array.from({ length: rows }, (_, i) => ({
    id: `OBS-${String(184223 + i * 37)}`,
    stage: stages[Math.floor(rnd() * stages.length)],
    area: (180 + rnd() * 320).toFixed(1),
    donor: `D${1 + Math.floor(rnd() * 4)}`,
  }));
  const grid = "grid grid-cols-[1.4fr_1.1fr_0.9fr_0.6fr] gap-2";
  return (
    <div className="w-full overflow-hidden font-mono leading-[1.7] tabular-nums" style={{ fontSize }}>
      <div className={`${grid} border-b border-border pb-0.5 text-text-muted`}>
        {["obs_id", "stage", "area_um2", "donor"].map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {data.map((r, i) => (
        <div
          key={r.id}
          className={`${grid} -mx-0.5 rounded-[3px] px-0.5 ${i === highlight ? "bg-emphasis text-foreground" : "text-muted-foreground"}`}
        >
          <span>{r.id}</span>
          <span>{r.stage}</span>
          <span className="text-right">{r.area}</span>
          <span>{r.donor}</span>
        </div>
      ))}
    </div>
  );
}

export function NdHistoMock({ w, h = 64, t = 0.42 }: { w: number; h?: number; t?: number }) {
  const rnd = ndMulberry(11);
  const bars = Array.from({ length: 34 }, (_, i) => {
    const x = i / 34;
    return Math.exp(-((x - 0.3) ** 2 / 0.025)) * 0.85 + Math.exp(-((x - 0.62) ** 2 / 0.012)) * 0.5 + rnd() * 0.07;
  });
  const bw = w / bars.length;
  return (
    <svg width={w} height={h} className="block">
      {bars.map((b, i) => (
        <rect
          key={i}
          x={i * bw + 0.5}
          y={h - b * (h - 8)}
          width={bw - 1.5}
          height={b * (h - 8)}
          fill={i / bars.length >= t ? "var(--color-wire-pred)" : "rgba(160, 160, 160, 0.3)"}
        />
      ))}
      <line
        x1={t * w}
        y1={0}
        x2={t * w}
        y2={h}
        stroke="var(--color-wire-sel)"
        strokeWidth="1.25"
        strokeDasharray="3 3"
      />
    </svg>
  );
}
