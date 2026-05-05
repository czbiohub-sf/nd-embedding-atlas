/**
 * Mock data + synthetic crop generator for gallery sketches.
 *
 * No backend required — synthesizes microscopy-looking crops via canvas
 * so the sketches can be evaluated standalone via `vp dev` and visiting
 * `localhost:5173/#gallery-sketches`.
 */

export interface MockObs {
  rowIndex: number;
  fov: string;
  well: string;
  t: number;
  x: number;
  y: number;
  category: "infected" | "uninfected" | "dead" | "mitotic";
  embeddingDistance: number;
}

const CATEGORIES: MockObs["category"][] = ["infected", "uninfected", "dead", "mitotic"];

const WELLS = ["B/02", "B/03", "B/04", "C/02", "C/03", "C/04", "D/02"];

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function generateMockSelection(count: number, seed = 42): MockObs[] {
  const rng = seededRandom(seed);
  const rows: MockObs[] = [];
  for (let i = 0; i < count; i++) {
    const wellIdx = Math.floor(rng() * WELLS.length);
    const well = WELLS[wellIdx];
    const fovIdx = Math.floor(rng() * 9);
    const fov = `${well}/${String(fovIdx).padStart(6, "0")}`;
    rows.push({
      rowIndex: 1000 + i,
      fov,
      well,
      t: Math.floor(rng() * 48),
      x: 200 + Math.floor(rng() * 1600),
      y: 200 + Math.floor(rng() * 1600),
      category: CATEGORIES[Math.floor(rng() * CATEGORIES.length)],
      embeddingDistance: rng() * 0.8 + 0.1,
    });
  }
  return rows;
}

export function groupByFov(obs: MockObs[]): Map<string, MockObs[]> {
  const map = new Map<string, MockObs[]>();
  for (const o of obs) {
    const list = map.get(o.fov);
    if (list) list.push(o);
    else map.set(o.fov, [o]);
  }
  return map;
}

const cropCache = new Map<number, string>();

export function synthCropUrl(obs: MockObs): string {
  const cached = cropCache.get(obs.rowIndex);
  if (cached) return cached;

  const size = 200;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);

  const rng = seededRandom(obs.rowIndex);
  const channelTints: Record<MockObs["category"], [string, string]> = {
    infected: ["#06b6d4", "#f43f5e"],
    uninfected: ["#22d3ee", "#3b82f6"],
    dead: ["#525252", "#737373"],
    mitotic: ["#10b981", "#f59e0b"],
  };
  const [tintA, tintB] = channelTints[obs.category];

  const blobCount = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < blobCount; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r = 12 + rng() * 28;
    const tint = i % 2 === 0 ? tintA : tintB;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, tint);
    grad.addColorStop(0.4, `${tint}cc`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 300; i++) {
    ctx.fillRect(rng() * size, rng() * size, 1, 1);
  }

  const url = canvas.toDataURL("image/webp", 0.7);
  cropCache.set(obs.rowIndex, url);
  return url;
}

export const CATEGORY_COLORS: Record<MockObs["category"], string> = {
  infected: "oklch(0.585 0.233 27)",
  uninfected: "oklch(0.62 0.18 220)",
  dead: "oklch(0.55 0 0)",
  mitotic: "oklch(0.65 0.18 145)",
};
