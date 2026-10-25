/**
 * Runtime status: one snapshot of what this server process is doing, shared
 * by `GET /api/status`, `ndea status`, and the in-process TUI. The client
 * counters and the log ring are process-wide: one server per process.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { format } from "node:util";
import type { HarnessPresence, RuntimeStatus } from "@ndea/protocol";
import { VERSION } from "../cli/version.ts";
import type { ServerSession } from "./state.ts";

const startedAt = new Date().toISOString();
const MAX_AGENTS = 32;
const MAX_LOGS = 200;
const agents = new Map<string, string>();
const logs: RuntimeStatus["logs"] = [];
const presenceListeners = new Set<(presence: HarnessPresence) => void>();
/** Warnings and errors printed while the TUI is up; replayed once it exits. Null when not muted. */
let held: (() => void)[] | null = null;

/** Mutated by `ws.ts` (open sockets) and the `/mcp` wrapper (requests in flight). */
export const clients = { browserSockets: 0, mcpInFlight: 0 };

/** Record an `X-Ndea-Agent` sighting; keeps the most recent 32 agents and notifies `watchHarness` listeners. */
export function agentSeen(agent: string): void {
  agents.delete(agent);
  agents.set(agent, new Date().toISOString());
  if (agents.size > MAX_AGENTS) agents.delete(agents.keys().next().value!);
  const presence = harnessPresence();
  for (const listener of presenceListeners) listener(presence);
}

/** Named agents, most recently seen first. */
export function harnessPresence(): HarnessPresence {
  return { agents: [...agents].toReversed().map(([agent, lastSeen]) => ({ agent, lastSeen })) };
}

/** Call `listener` with the current presence now and after every sighting, until the returned dispose. */
export function watchHarness(listener: (presence: HarnessPresence) => void): () => void {
  listener(harnessPresence());
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
}

/** Keep the last 200 `console.log/warn/error` lines for the status Logs tab; call once at startup. */
export function captureConsole(): void {
  for (const level of ["log", "warn", "error"] as const) {
    const write = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const at = new Date().toISOString();
      for (const text of Bun.stripANSI(format(...args)).split("\n")) {
        if (text.trim()) logs.push({ level, text, at });
      }
      logs.splice(0, logs.length - MAX_LOGS);
      if (!held) write(...args);
      else if (level !== "log") held.splice(0, held.push(() => write(...args)) - MAX_LOGS);
    };
  }
}

/**
 * While the full-screen TUI is up, console output would draw over it; its Logs tab shows the ring instead.
 * Unmuting replays the warnings and errors held meanwhile, so they outlive the screen.
 */
export function muteConsole(value: boolean): void {
  if (value) {
    held ??= [];
    return;
  }
  const replay = held ?? [];
  held = null;
  for (const write of replay) write();
}

/** Total file bytes under `path` (a zarr directory or a single file); undefined when unreadable. */
export async function diskBytes(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for await (const file of new Bun.Glob("**/*").scan({ cwd: path, onlyFiles: true, dot: true })) {
      total += (await stat(join(path, file))).size;
    }
    return total;
  } catch {
    return undefined;
  }
}

export function getRuntimeStatus(session: ServerSession, url: string): RuntimeStatus {
  const { workspace } = session;
  return {
    server: { version: VERSION, url, startedAt, rss: process.memoryUsage.rss(), ingest: session.status.ingest },
    datasets: session.status.datasets,
    embeddings: {
      available: session.availableObsmKeys,
      loading: [...session.loadingTasks.keys()].filter(
        (key) => !session.obsmLoaders.has(key) && !session.loadErrors.has(key),
      ),
      errors: Object.fromEntries(session.loadErrors),
    },
    workspace: {
      path: workspace.path,
      revision: workspace.get().revision,
      recent: workspace
        .history({ limit: 50 })
        .map(({ ops, baseRevision: _, ...revision }) => ({ ...revision, ops: ops.length })),
    },
    clients: { ...clients, ...harnessPresence() },
    logs,
  };
}
