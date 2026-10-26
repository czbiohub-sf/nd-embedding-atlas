/**
 * The live status screen, shared by `ndea view` in a terminal (in-process)
 * and `ndea status` (polling `/api/status`). `renderStatus` is the plain-text
 * Overview; `runStatusTui` redraws Overview · Activity · Logs every second on
 * OpenTUI's alternate screen.
 */

import { homedir } from "node:os";
import { runTui } from "@crustjs/tui";
import { style } from "@crustjs/style";
import { BoxRenderable, ScrollBoxRenderable, StyledText, TabSelectRenderable, TextRenderable, fg } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import type { RuntimeStatus } from "@ndea/protocol";
import { openUrl } from "./startup/output.ts";

type Line = TextChunk[];
type Dataset = RuntimeStatus["datasets"][number];

const ACCENT = "#6e4ff9";
const GREEN = "#00bc7d";
const AMBER = "#f59e0b";
const RED = "#e7000b";
const MUTED = "#8a8f98";
const TABS = ["Overview", "Activity", "Logs"];
const HOME = homedir();

/** A color, or none under `NO_COLOR` / `--no-color`. */
const tint = (hex: string): string | undefined => (style.colorsEnabled ? hex : undefined);
const paint = (text: string, hex?: string): TextChunk => {
  const color = hex && tint(hex);
  return color ? fg(color)(text) : { __isChunk: true, text };
};
const ago = (iso: string, now: number): string => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m`
      : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};
const n = (value: number): string => value.toLocaleString("en-US");
const size = (bytes: number): string =>
  bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)} GB` : `${(bytes / 2 ** 20).toFixed(1)} MB`;

/** `~` for the home directory, then a middle ellipsis down to `width`. */
function fit(path: string, width: number): string {
  const short = path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
  const room = Math.max(width, 9);
  if (short.length <= room) return short;
  return `${short.slice(0, Math.ceil((room - 1) / 2))}…${short.slice(short.length - Math.floor((room - 1) / 2))}`;
}

const field = (name: string, ...rest: TextChunk[]): Line => [paint(name.padEnd(12), MUTED), ...rest];
const join = (parts: Line[], separator = " · "): Line =>
  parts.flatMap((part, index) => (index ? [paint(separator, MUTED), ...part] : part));

/** `name`, then `items` packed into lines of `width`; continuation lines indent under the first item. */
function wrap(name: string, items: Line[], width: number, separator: string): Line[] {
  const lines = [field(name)];
  let used = 12;
  for (const item of items) {
    const length = item.reduce((sum, chunk) => sum + chunk.text.length, 0);
    if (lines.at(-1)!.length > 1) {
      if (used + separator.length + length > width) {
        lines.push(field(""));
        used = 12;
      } else {
        lines.at(-1)!.push(paint(separator, MUTED));
        used += separator.length;
      }
    }
    lines.at(-1)!.push(...item);
    used += length;
  }
  return lines;
}

function header(s: RuntimeStatus, now: number): Line {
  return [
    paint(`ndea v${s.server.version}`, ACCENT),
    paint(`  ${s.server.url}  up ${ago(s.server.startedAt, now)}  rss ${(s.server.rss / 2 ** 20).toFixed(0)} MB`),
    paint(`  ingest ${s.server.ingest}`, MUTED),
  ];
}

/** One dataset's card body; `width` bounds the paths. */
function card(d: Dataset, s: RuntimeStatus, width: number): Line[] {
  const { errors, loading } = s.embeddings;
  const lines = [
    field(
      "format",
      paint(`${d.format} · ${n(d.observations)} obs × ${n(d.variables)} var · ${n(d.obsColumns)} obs columns`),
    ),
  ];
  if (d.modalities?.length)
    lines.push(
      ...wrap(
        "modalities",
        d.modalities.map((m) => [paint(`${m.name} ${n(m.observations)} × ${n(m.variables)}`)]),
        width,
        " · ",
      ),
    );
  lines.push(
    ...wrap(
      "embeddings",
      [
        [paint(`${d.embeddings.length} `)],
        ...d.embeddings.map((key) => [paint(key, errors[key] ? RED : loading.includes(key) ? AMBER : GREEN)]),
      ],
      width,
      " ",
    ),
  );
  if (d.plate) {
    lines.push(
      ...wrap(
        "images",
        [[paint(`${n(d.plate.wells)} wells`)], ...d.plate.channels.map((c) => [paint("■ ", c.color), paint(c.name)])],
        width,
        "  ",
      ),
      field("plate", paint(fit(d.plate.path, width - 12))),
    );
  }
  const bytes = d.bytes === undefined ? "…" : size(d.bytes);
  lines.push(field("storage", paint(`${bytes}  `), paint(fit(d.path, width - 14 - bytes.length))));
  return lines;
}

function workspace(s: RuntimeStatus, now: number, width: number): Line {
  const last = s.workspace.recent[0];
  return join([
    [paint(fit(s.workspace.path, width - 40))],
    [paint(`revision ${s.workspace.revision}`)],
    ...(last ? [[paint("last "), ...actor(last.actor), paint(` ${ago(last.committedAt, now)} ago`)]] : []),
  ]);
}

const actor = ({ kind, agent }: RuntimeStatus["workspace"]["recent"][number]["actor"]): Line =>
  agent ? [paint(agent, ACCENT), paint(` (${kind})`, MUTED)] : [paint(kind)];

function activity(s: RuntimeStatus, now: number): Line[] {
  if (s.workspace.recent.length === 0) return [[paint("no revisions yet", MUTED)]];
  return s.workspace.recent.map((r) => [
    paint(`#${r.revision}`.padEnd(7)),
    ...actor(r.actor),
    paint(r.restoredFrom ? `  restored #${r.restoredFrom}` : `  ${r.ops} op${r.ops === 1 ? "" : "s"}`),
    paint(`  ${ago(r.committedAt, now)} ago`, MUTED),
  ]);
}

function logs(s: RuntimeStatus): Line[] {
  if (s.logs.length === 0) return [[paint("no log lines yet", MUTED)]];
  return s.logs.map(({ level, text, at }) => {
    const color = level === "error" ? RED : level === "warn" ? AMBER : undefined;
    return [
      paint(`${new Date(at).toTimeString().slice(0, 8)} `, MUTED),
      paint(level === "error" ? "✗ " : level === "warn" ? "! " : "  ", color),
      paint(text, color),
    ];
  });
}

const plain = (lines: Line[]): string => lines.map((line) => line.map((chunk) => chunk.text).join("")).join("\n");
const styled = (lines: Line[]): StyledText =>
  new StyledText(lines.flatMap((line, index) => (index ? [paint("\n"), ...line] : line)));

/** The plain-text Overview, for a non-TTY `ndea status`. */
export function renderStatus(s: RuntimeStatus, now = Date.now()): string {
  return plain([
    header(s, now),
    [],
    ...s.datasets.flatMap((d) => [[paint(d.name)], ...card(d, s, Infinity).map((line) => [paint("  "), ...line]), []]),
    field("workspace", ...workspace(s, now, Infinity)),
  ]);
}

/** Copy `text` with the first clipboard command on PATH; a no-op without one. */
function copy(text: string): void {
  const command = ["pbcopy", "wl-copy", "clip"].find((name) => Bun.which(name));
  if (command) Bun.spawn([command], { stdin: new Blob([text]) });
}

/** Redraw `poll()` every second until `q` or Ctrl+C; resolves once the terminal is restored. */
export async function runStatusTui(poll: () => RuntimeStatus | Promise<RuntimeStatus>): Promise<void> {
  await runTui(async (renderer) => {
    const frame = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column" });
    const top = new TextRenderable(renderer, { content: "", paddingX: 1 });
    const tabs = new TabSelectRenderable(renderer, {
      options: TABS.map((name, index) => ({ name: `${index + 1} ${name}`, description: "" })),
      tabWidth: 14,
      height: 1,
      showDescription: false,
      showUnderline: false,
      selectedBackgroundColor: tint(ACCENT),
    });
    const panes = TABS.map(
      (_, index) =>
        new ScrollBoxRenderable(renderer, {
          flexGrow: 1,
          visible: index === 0,
          stickyScroll: index === 2,
          stickyStart: "bottom",
          contentOptions: { flexDirection: "column", paddingX: 1 },
        }),
    );
    const [overview, activityPane, logsPane] = panes;
    const cards = new Map<string, TextRenderable>();
    const workspaceText = new TextRenderable(renderer, { content: "" });
    const workspaceBox = new BoxRenderable(renderer, {
      border: true,
      borderStyle: "rounded",
      borderColor: tint(MUTED),
      title: " Workspace ",
      paddingX: 1,
    });
    workspaceBox.add(workspaceText);
    overview.add(workspaceBox);
    const activityText = new TextRenderable(renderer, { content: "" });
    const logsText = new TextRenderable(renderer, { content: "" });
    activityPane.add(activityText);
    logsPane.add(logsText);
    const footer = new TextRenderable(renderer, {
      content: styled([
        join(
          ["Tab/1-3 switch", "↑↓ scroll", "o open browser", "c copy URL", "q quit"].map((hint) => [paint(hint, MUTED)]),
          "   ",
        ),
      ]),
      paddingX: 1,
    });
    for (const child of [top, tabs, ...panes, footer]) frame.add(child);
    renderer.root.add(frame);

    let url = "";
    const draw = async () => {
      const now = Date.now();
      const width = renderer.width - 7; // pane padding, card border and padding, scrollbar
      try {
        const s = await poll();
        url = s.server.url;
        top.content = styled([header(s, now)]);
        for (const d of s.datasets) {
          let text = cards.get(d.name);
          if (!text) {
            text = new TextRenderable(renderer, { content: "" });
            const box = new BoxRenderable(renderer, {
              border: true,
              borderStyle: "rounded",
              borderColor: tint(GREEN),
              title: ` ${d.name} `,
              titleColor: tint(ACCENT),
              paddingX: 1,
            });
            box.add(text);
            overview.add(box, cards.size);
            cards.set(d.name, text);
          }
          text.content = styled(card(d, s, width));
        }
        workspaceText.content = styled([workspace(s, now, width)]);
        activityText.content = styled(activity(s, now));
        logsText.content = styled(logs(s));
      } catch (error) {
        top.content = styled([
          [paint(`status unavailable: ${error instanceof Error ? error.message : String(error)}`, RED)],
        ]);
      }
    };
    const show = (index: number) => {
      tabs.setSelectedIndex(index);
      panes.forEach((pane, i) => (pane.visible = i === index));
      panes[index].focus();
    };
    await draw();
    show(0);
    const timer = setInterval(() => void draw(), 1000);
    renderer.on("destroy", () => clearInterval(timer));
    renderer.keyInput.on("keypress", (key) => {
      const tab = tabs.getSelectedIndex();
      if (key.name === "q") renderer.destroy();
      else if (key.name === "o" && url) openUrl(url);
      else if (key.name === "c" && url) copy(url);
      else if (key.name === "tab") show((tab + (key.shift ? TABS.length - 1 : 1)) % TABS.length);
      else if (["1", "2", "3"].includes(key.name)) show(Number(key.name) - 1);
    });
  }).catch((error: unknown) => {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  });
}
