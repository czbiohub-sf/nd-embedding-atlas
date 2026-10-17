/**
 * EXPERIMENTAL structure view: Enter on an Overview dataset card draws its
 * AnnData layout (scverse's schema diagram, not to scale) and plate well grid;
 * Esc returns. Data: `server/structure.ts` via `loadStructure(name)`.
 *
 * To remove it:
 * 1. Delete this file, `apps/ndea/src/server/structure.ts`,
 *    `apps/ndea/src/server/__tests__/structure.test.ts`, and
 *    `packages/protocol/src/structure.ts`.
 * 2. `packages/protocol/src/index.ts`: drop the `./structure` export line.
 * 3. `apps/ndea/src/server/app.ts`: drop the `handleStructure` import and the
 *    `/api/status/datasets/:name/structure` route.
 * 4. `apps/ndea/src/cli/tui.ts`: drop `DatasetStructure` from the protocol
 *    import, the `loadStructure` parameter of `runStatusTui`, the
 *    `let [selected, structure]` line, the card `borderStyle` statement in
 *    `draw`, `else if (structure) return;`, and the up/down and return key
 *    branches; footer hints back to "↑↓ scroll" without "↵ structure".
 * 5. `cli/startup/server.ts`: drop the `structure.ts` import and the second
 *    `runStatusTui` argument. `cli/commands/status.ts`: drop the second
 *    `runStatusTui` argument and `DatasetStructureSchema` from its import.
 */

import { style } from "@crustjs/style";
import { FrameBufferRenderable, RGBA, TextAttributes } from "@opentui/core";
import type { CliRenderer, KeyEvent, OptimizedBuffer } from "@opentui/core";
import type { DatasetStructure } from "@ndea/protocol";

type AnnDataPart = DatasetStructure["anndata"];
type Keyed = AnnDataPart["obsm"];
type Frame = AnnDataPart["obs"];
interface Block {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  shade: string;
  label: string;
  detail: string;
  lit: boolean;
}

const rgb = (hex: string): RGBA => RGBA.fromHex(style.colorsEnabled ? hex : "#ffffff");
const CLEAR = RGBA.fromValues(0, 0, 0, 0);
const WHITE = "#ffffff";
const MUTED = "#8a8f98";
const ACCENT = "#6e4ff9";
const RED = "#e7000b";
const { BOLD, DIM } = TextAttributes;
const SCHEMA_W = 72;
const SCHEMA_H = 20;

const n = (value: number): string => value.toLocaleString("en-US");
const dims = (shape: number[]): string => shape.map(n).join(" × ");
const keys = (list: Keyed): string => list.map((k) => `${k.key} ${dims(k.shape)}`).join(" · ") || "—";
const cols = (f: Frame): string => f.columns.map((c) => `${c.name} ${c.dtype}`).join(" · ") || "no columns";

/** `text` split on " · " into lines of at most `width`. */
function wrap(text: string, width: number): string[] {
  const lines = [""];
  for (const item of text.split(" · ")) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + item.length + 3 > width) lines.push(item);
    else lines[last] += lines[last] ? ` · ${item}` : item;
  }
  return lines;
}

/** scverse's layout and palette, in selection order. */
function blocks(a: AnnDataPart): Block[] {
  const part = (name: string, list: Keyed, x: number, y: number, w: number, h: number, color: string, shade = "▓") => ({
    name,
    x,
    y,
    w,
    h,
    color,
    shade,
    label: list.length ? n(list.length) : "—",
    detail: `${list.length} keys: ${keys(list)}`,
    lit: list.length > 0,
  });
  return [
    {
      ...part("var", [], 24, 0, 38, 3, "#2c96c0", "▒"),
      label: a.var.count ? `${n(a.var.count)} · ${a.var.columns.length} cols` : "—",
      detail: `${n(a.var.count)} variables · ${a.var.columns.length} columns: ${cols(a.var)}`,
      lit: a.var.count > 0,
    },
    part("obsp", a.obsp, 0, 3, 12, 6, "#f15c5a", "░"),
    part("obsm", a.obsm, 13, 3, 10, 8, "#ef9021"),
    {
      ...part("X", [], 24, 3, 38, 5, "#3c8b53", "█"),
      label: a.X ? `${dims(a.X.shape)}  ${a.X.dtype}` : "—",
      detail: a.X ? `${dims(a.X.shape)}  ${a.X.dtype}` : "absent",
      lit: a.X !== null,
    },
    part("layers", a.layers, 24, 8, 38, 3, "#4fba6f"),
    {
      ...part("obs", [], 63, 3, 9, 8, "#efc41c", "▒"),
      label: a.obs.columns.length ? n(a.obs.columns.length) : "—",
      detail: `${n(a.obs.count)} observations · ${a.obs.columns.length} columns: ${cols(a.obs)}`,
      lit: a.obs.columns.length > 0,
    },
    part("varm", a.varm, 24, 11, 38, 3, "#194c61"),
    part("varp", a.varp, 24, 14, 12, 6, "#965ba5", "░"),
    {
      ...part("uns", [], 2, 13, 18, 1, WHITE),
      label: `{ uns · ${a.uns} }`,
      detail: `${a.uns} keys`,
      lit: a.uns > 0,
    },
  ];
}

function drawBlock(buf: OptimizedBuffer, b: Block, ox: number, oy: number, selected: boolean): void {
  const color = rgb(b.lit ? b.color : MUTED);
  const attr = (b.lit ? 0 : DIM) | (selected ? BOLD : 0);
  if (b.h === 1) return buf.drawText(`${selected ? "▸" : " "}${b.label}`, ox + b.x - 1, oy + b.y, color, CLEAR, attr);
  buf.drawBox({
    x: ox + b.x,
    y: oy + b.y,
    width: b.w,
    height: b.h,
    border: true,
    borderStyle: selected ? "double" : "rounded",
    borderColor: color,
    backgroundColor: CLEAR,
    title: ` ${b.name} `,
    titleColor: color,
  });
  for (let row = 1; row < b.h - 1; row++)
    buf.drawText((b.lit ? b.shade : " ").repeat(b.w - 2), ox + b.x + 1, oy + b.y + row, color, CLEAR, attr);
  const label = ` ${b.label} `.slice(0, b.w - 2);
  const x = ox + b.x + 1 + ((b.w - 2 - label.length) >> 1);
  buf.drawText(label, x, oy + b.y + (b.h >> 1), b.lit ? rgb(WHITE) : color, CLEAR, attr);
}

/** The well grid (FOV count per well), channel swatches, and the first FOV's array. */
function drawPlate(
  buf: OptimizedBuffer,
  p: NonNullable<DatasetStructure["plate"]>,
  x: number,
  y: number,
  width: number,
) {
  const fovs = new Map(p.wells.map((w) => [`${w.row},${w.col}`, w.fovs]));
  buf.drawText(`Plate · ${p.wells.length} wells`, x, y, rgb(WHITE), CLEAR, BOLD);
  buf.drawText(`   ${p.columns.map((c) => c.padStart(3)).join("")}`, x, y + 1, rgb(MUTED));
  p.rows.forEach((row, r) => {
    buf.drawText(row.padStart(3), x, y + 2 + r, rgb(MUTED));
    p.columns.forEach((_, c) => {
      const count = fovs.get(`${r},${c}`);
      buf.drawText((count ? String(count) : "·").padStart(3), x + 3 + c * 3, y + 2 + r, rgb(count ? WHITE : MUTED));
    });
  });
  let row = y + 3 + p.rows.length;
  let cx = x;
  for (const channel of p.channels) {
    if (cx > x && cx + channel.name.length + 2 > x + width) [cx, row] = [x, row + 1];
    buf.drawText("■", cx, row, rgb(channel.color));
    buf.drawText(channel.name, cx + 2, row, rgb(WHITE));
    cx += channel.name.length + 4;
  }
  const image = p.image ? `${p.image.axes} ${dims(p.image.shape)}  ${p.image.dtype}` : "—";
  buf.drawText(`FOV 0  ${image}`, x, row + 1, rgb(MUTED));
}

/** Replace the screen with `name`'s structure until Esc, then call `close`. */
export function openStructure(
  renderer: CliRenderer,
  name: string,
  load: (name: string) => Promise<DatasetStructure>,
  close: () => void,
): void {
  const hidden = renderer.root.getChildren().filter((child) => child.visible);
  for (const child of hidden) child.visible = false;
  const fb = new FrameBufferRenderable(renderer, {
    width: renderer.width,
    height: renderer.height,
    position: "absolute",
  });
  renderer.root.add(fb);
  renderer.currentFocusedRenderable?.blur();
  let data: DatasetStructure | null = null;
  let error = "";
  let selected = 3; // X

  const draw = () => {
    if (fb.isDestroyed) return;
    const buf = fb.frameBuffer;
    const { width, height } = renderer;
    buf.clear(CLEAR);
    const modality = data?.modality ? ` · ${data.modality}` : "";
    buf.drawText(`Structure · ${name}${modality}`, 1, 0, rgb(ACCENT), CLEAR, BOLD);
    buf.drawText("experimental · not to scale", width - 28, 0, rgb(MUTED));
    buf.drawText("←→↑↓ select   Esc back   q quit", 1, height - 1, rgb(MUTED));
    if (!data) {
      buf.drawText(error || "loading…", 1, 2, rgb(error ? RED : MUTED));
      return fb.requestRender();
    }
    const parts = blocks(data.anndata);
    parts.forEach((b, i) => drawBlock(buf, b, 1, 2, i === selected));
    const b = parts[selected];
    const detail = wrap(`${b.name}  ${b.detail}`, Math.min(width - 2, SCHEMA_W + 10));
    detail.forEach((line, i) => buf.drawText(line, 1, 3 + SCHEMA_H + i, rgb(i ? WHITE : b.lit ? b.color : MUTED)));
    if (data.plate) {
      const right = width >= SCHEMA_W + 54; // room for a 50-column panel beside the schema
      const [x, y] = right ? [SCHEMA_W + 4, 2] : [1, 4 + SCHEMA_H + detail.length];
      drawPlate(buf, data.plate, x, y, width - x - 1);
    }
    fb.requestRender();
  };
  const resize = (width: number, height: number) => {
    fb.width = width;
    fb.height = height;
  };
  const onKey = (key: KeyEvent) => {
    const count = data ? blocks(data.anndata).length : 1;
    if (key.name === "escape") {
      renderer.keyInput.off("keypress", onKey);
      renderer.off("resize", resize);
      renderer.root.remove(fb);
      fb.destroy();
      for (const child of hidden) child.visible = true;
      return close();
    }
    if (key.name === "left" || key.name === "up") selected = (selected + count - 1) % count;
    else if (key.name === "right" || key.name === "down") selected = (selected + 1) % count;
    draw();
  };
  fb.on("resize", draw);
  renderer.on("resize", resize);
  renderer.keyInput.on("keypress", onKey);
  draw();
  load(name)
    .then(
      (structure) => (data = structure),
      (err: unknown) => (error = err instanceof Error ? err.message : String(err)),
    )
    .finally(draw);
}
