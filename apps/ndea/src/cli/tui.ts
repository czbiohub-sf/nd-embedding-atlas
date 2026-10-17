/**
 * The live status screen, shared by `ndea view` in a terminal (in-process)
 * and `ndea status` (polling `/api/status`). `renderStatus` is the plain-text
 * screen; `runStatusTui` redraws it every second on OpenTUI's alternate screen.
 */

import { runTui } from "@crustjs/tui";
import { TextRenderable } from "@opentui/core";
import type { RuntimeStatus } from "@ndea/protocol";
import { openUrl } from "./startup/output.ts";

const ago = (iso: string, now: number): string => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m`
      : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};
const n = (value: number): string => value.toLocaleString("en-US");

export function renderStatus(s: RuntimeStatus, now = Date.now()): string {
  const { last } = s.workspace;
  const errors = Object.entries(s.embeddings.errors);
  return [
    `ndea v${s.server.version}  ${s.server.url}  up ${ago(s.server.startedAt, now)}  rss ${(s.server.rss / 2 ** 20).toFixed(0)} MB`,
    "",
    "Datasets",
    ...s.datasets.map(
      (d) =>
        `  ${d.name}  ${n(d.observations)} obs${d.variables === undefined ? "" : ` × ${n(d.variables)} var`}  ${d.path}`,
    ),
    "",
    "Embeddings",
    `  available  ${s.embeddings.available.join(", ") || "-"}`,
    `  loading    ${s.embeddings.loading.join(", ") || "-"}`,
    ...errors.map(([key, error]) => `  error      ${key}: ${error}`),
    "",
    "Workspace",
    `  ${s.workspace.path}`,
    `  revision ${s.workspace.revision}${last ? `  last change: ${last.actor.agent ?? last.actor.kind} · ${ago(last.committedAt, now)} ago` : ""}`,
    "",
    "Clients",
    `  browser sockets ${s.clients.browserSockets}   mcp in flight ${s.clients.mcpInFlight}`,
    ...s.clients.agents.map((a) => `  agent ${a.agent}  seen ${ago(a.lastSeen, now)} ago`),
    "",
    "o open browser   q quit",
  ].join("\n");
}

/** Redraw `poll()` every second until `q` or Ctrl+C; resolves once the terminal is restored. */
export async function runStatusTui(poll: () => RuntimeStatus | Promise<RuntimeStatus>): Promise<void> {
  await runTui(async (renderer) => {
    const text = new TextRenderable(renderer, { id: "status", content: "" });
    renderer.root.add(text);
    let url = "";
    const draw = async () => {
      try {
        const status = await poll();
        url = status.server.url;
        text.content = renderStatus(status);
      } catch (error) {
        text.content = `status unavailable: ${error instanceof Error ? error.message : String(error)}\n\nq quit`;
      }
    };
    await draw();
    const timer = setInterval(() => void draw(), 1000);
    renderer.on("destroy", () => clearInterval(timer));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q") renderer.destroy();
      else if (key.name === "o" && url) openUrl(url);
    });
  }).catch((error: unknown) => {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  });
}
