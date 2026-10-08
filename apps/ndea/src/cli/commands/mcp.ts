/**
 * `ndea mcp`: connect coding agents to a running ndea's MCP endpoint.
 *
 *   ndea mcp install [--agent claude-code,codex] [--yes]  write the server into agent configs
 *   ndea mcp check                                        server reachable? token accepted? agents current?
 *   ndea mcp uninstall [--agent …]                        remove it again
 *
 * Agent detection and each agent's config format come from add-mcp, the same
 * engine as `npx add-mcp`; ndea supplies the URL and the bearer token kept in
 * ~/.ndea/mcp-token.
 */

import { defineCommand, defineGroup, option } from "@bunli/core";
import {
  agents,
  detectGlobalAgents,
  getAgentTypes,
  listInstalledServers,
  removeServer,
  upsertServer,
  type AgentType,
  type InstalledServer,
} from "add-mcp";
import { z } from "zod";

import { loadMcpToken } from "../../server/mcp-token.ts";

const SERVER_NAME = "ndea";
/** Preselected in the picker: the agents ndea is developed and smoke-tested with. */
const PRESELECTED: readonly AgentType[] = ["claude-code", "codex"];

const portOption = option(z.coerce.number().int().min(1).max(65535).default(5055), {
  description: "Port `ndea view` serves on",
});
const agentOption = option(z.string().optional(), {
  description: `Comma-separated agents (${getAgentTypes().join(", ")})`,
});

/** `ndea view` binds IPv4 loopback; spelling it out avoids `localhost` resolving to ::1 first. */
function endpoint(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

const SERVER_LABEL = "ndea server".padEnd(22);

function parseAgents(value: string): AgentType[] {
  const known = new Set<string>(getAgentTypes());
  const requested = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    console.error(`Unknown agent(s): ${unknown.join(", ")}. Known: ${[...known].join(", ")}`);
    process.exit(1);
  }
  return requested as AgentType[];
}

/** Agents installed on this machine that can reach an HTTP MCP server. */
async function detectedHttpAgents(): Promise<AgentType[]> {
  return (await detectGlobalAgents()).filter((agent) => agents[agent].supportedTransports.includes("http"));
}

/** The ndea entry in one agent's config: ours by name, or any entry pointing at an ndea /mcp URL. */
function ndeaEntry(servers: readonly InstalledServer[]): InstalledServer | undefined {
  return servers.find(
    (server) =>
      server.serverName === SERVER_NAME || /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/mcp$/.test(server.identity),
  );
}

function mentions(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value && typeof value === "object") return Object.values(value).some((child) => mentions(child, needle));
  return false;
}

const installCommand = defineCommand({
  name: "install" as const,
  description: "Add ndea's MCP server to your coding agents' configs",
  options: {
    agent: agentOption,
    yes: option(z.boolean().default(false), { description: "Install to every detected agent without asking" }),
    port: portOption,
  },
  async handler({ flags, prompt }) {
    const detected = await detectedHttpAgents();
    let targets: AgentType[];
    if (flags.agent) targets = parseAgents(flags.agent);
    else if (flags.yes) targets = detected;
    else if (process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
      if (detected.length === 0) {
        console.error(`No coding agents detected. Name one with --agent (${getAgentTypes().join(", ")}).`);
        process.exit(1);
      }
      targets = await prompt.multiselect<AgentType>("Install ndea's MCP server into", {
        options: detected.map((agent) => ({ value: agent, label: agents[agent].displayName })),
        initialValues: detected.filter((agent) => PRESELECTED.includes(agent)),
      });
    } else {
      console.error(
        "Not interactive (no terminal, or CI): pass --agent claude-code,codex, or --yes for every detected agent.",
      );
      process.exit(1);
    }
    if (targets.length === 0) {
      console.log("Nothing selected; no config changed.");
      return;
    }

    const url = endpoint(flags.port);
    const config = { type: "http" as const, url, headers: { Authorization: `Bearer ${await loadMcpToken()}` } };
    let failed = false;
    for (const agent of targets) {
      const result = upsertServer(agent, SERVER_NAME, config);
      if (result.success) console.log(`  ✓ ${agents[agent].displayName.padEnd(22)} ${result.path}`);
      else {
        failed = true;
        console.log(`  ✗ ${agents[agent].displayName.padEnd(22)} ${result.error ?? "not written"}`);
      }
    }
    console.log(`\n${url} is in place. Restart open agent sessions to load it; verify with \`ndea mcp check\`.`);
    if (failed) process.exit(1);
  },
});

const checkCommand = defineCommand({
  name: "check" as const,
  description: "Check the MCP server and which agents can reach it with the current token",
  options: { port: portOption },
  async handler({ flags }) {
    const url = endpoint(flags.port);
    const bearer = `Bearer ${await loadMcpToken()}`;
    let healthy = true;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: bearer,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const body = await response.text();
      if (response.ok) {
        const tools = body.match(/"name":"/g)?.length ?? 0;
        console.log(`  ✓ ${SERVER_LABEL} ${url} accepts the token (${tools} tools)`);
      } else {
        healthy = false;
        const hint =
          response.status === 401 ? "rejects ~/.ndea/mcp-token; restart `ndea view` to reload it" : body.slice(0, 120);
        console.log(`  ✗ ${SERVER_LABEL} ${url} answered ${response.status}: ${hint}`);
      }
    } catch {
      healthy = false;
      console.log(`  ✗ ${SERVER_LABEL} nothing listening at ${url}; start \`ndea view\` (or pass --port)`);
    }

    const installed = await listInstalledServers({ global: true, agents: await detectedHttpAgents() });
    let current = 0;
    for (const { agentType, displayName, servers, error } of installed) {
      const label = displayName.padEnd(22);
      if (error) {
        console.log(`  ? ${label} config unreadable: ${error}`);
        continue;
      }
      const entry = ndeaEntry(servers);
      if (!entry) console.log(`  · ${label} not installed (ndea mcp install --agent ${agentType})`);
      else if (entry.identity !== url) {
        healthy = false;
        console.log(`  ✗ ${label} points at ${entry.identity}; reinstall: ndea mcp install --agent ${agentType}`);
      } else if (!mentions(entry.config, bearer)) {
        healthy = false;
        console.log(`  ✗ ${label} has an old token; reinstall: ndea mcp install --agent ${agentType}`);
      } else {
        current += 1;
        console.log(`  ✓ ${label} ${entry.configPath}`);
      }
    }
    if (current === 0) console.log("\nNo agent is set up yet: run `ndea mcp install`.");
    if (!healthy || current === 0) process.exit(1);
  },
});

const uninstallCommand = defineCommand({
  name: "uninstall" as const,
  description: "Remove ndea's MCP server from agent configs",
  options: { agent: agentOption },
  async handler({ flags }) {
    const scope = flags.agent ? parseAgents(flags.agent) : await detectedHttpAgents();
    const installed = await listInstalledServers({ global: true, agents: scope });
    let removed = 0;
    for (const { agentType, displayName, servers } of installed) {
      const entry = ndeaEntry(servers);
      if (!entry) continue;
      const result = removeServer(agentType, entry.serverName);
      if (result.removed) {
        removed += 1;
        console.log(`  ✓ ${displayName.padEnd(22)} ${result.path}`);
      } else console.log(`  ✗ ${displayName.padEnd(22)} ${result.error ?? "not removed"}`);
    }
    if (removed === 0) console.log("ndea is not installed in any detected agent.");
  },
});

export default defineGroup({
  name: "mcp" as const,
  description: "Connect coding agents to ndea's MCP server",
  commands: [installCommand, checkCommand, uninstallCommand],
});
