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

import { defineCommand, defineFlag } from "@crustjs/core";
import { multiselect } from "@crustjs/prompts";
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

import { loadMcpToken } from "../../server/mcp-token.ts";
import { portFlag, server } from "../lib/server.ts";
import { fail, label, ok, url } from "../lib/style.ts";

const SERVER_NAME = "ndea";
/** Preselected in the picker: the agents ndea is developed and smoke-tested with. */
const PRESELECTED: readonly AgentType[] = ["claude-code", "codex"];

const agentFlag = defineFlag("agent", {
  type: "string",
  description: `Comma-separated agents (${getAgentTypes().join(", ")})`,
});

const pad = (name: string) => name.padEnd(22);

function parseAgents(value: string): AgentType[] {
  const known = new Set<string>(getAgentTypes());
  const requested = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown agent(s): ${unknown.join(", ")}\nknown: ${[...known].join(", ")}`);
  return requested as AgentType[];
}

/** Agents installed on this machine that can reach an HTTP MCP server. */
async function detectedHttpAgents(): Promise<AgentType[]> {
  return (await detectGlobalAgents()).filter((agent) => agents[agent].supportedTransports.includes("http"));
}

/** The ndea entry in one agent's config: ours by name, or any entry pointing at an ndea /mcp URL. */
function ndeaEntry(servers: readonly InstalledServer[]): InstalledServer | undefined {
  return servers.find(
    (entry) =>
      entry.serverName === SERVER_NAME || /^https?:\/\/(localhost|127\.0\.0\.1):\d+\/mcp$/.test(entry.identity),
  );
}

function mentions(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value && typeof value === "object") return Object.values(value).some((child) => mentions(child, needle));
  return false;
}

const installCommand = defineCommand(
  "install",
  { description: "Add ndea's MCP server to your coding agents' configs" },
  (command) =>
    command
      .flags(
        agentFlag,
        { name: "yes", type: "boolean", default: false, description: "Install to every detected agent without asking" },
        portFlag,
      )
      .action(async ({ flags, stdout }) => {
        const detected = await detectedHttpAgents();
        let targets: AgentType[];
        if (flags.agent) targets = parseAgents(flags.agent);
        else if (flags.yes) targets = detected;
        else if (process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
          if (detected.length === 0) {
            throw new Error(`no coding agents detected; name one with --agent (${getAgentTypes().join(", ")})`);
          }
          targets = await multiselect({
            message: "Install ndea's MCP server into",
            choices: detected.map((agent) => ({ value: agent, label: agents[agent].displayName })),
            default: detected.filter((agent) => PRESELECTED.includes(agent)),
          });
        } else {
          throw new Error(
            "not interactive (no terminal, or CI): pass --agent claude-code,codex, or --yes for every detected agent",
          );
        }
        if (targets.length === 0) {
          stdout("Nothing selected; no config changed.");
          return;
        }

        // `ndea view` binds IPv4 loopback; spelling it out avoids `localhost` resolving to ::1 first.
        const endpoint = `http://127.0.0.1:${flags.port}/mcp`;
        const config = {
          type: "http" as const,
          url: endpoint,
          headers: { Authorization: `Bearer ${await loadMcpToken()}` },
        };
        const failed: string[] = [];
        for (const agent of targets) {
          const result = upsertServer(agent, SERVER_NAME, config);
          const name = pad(agents[agent].displayName);
          if (result.success) stdout(`  ${ok(`${name} ${label(result.path)}`)}`);
          else {
            failed.push(agents[agent].displayName);
            stdout(`  ${fail(`${name} ${result.error ?? "not written"}`)}`);
          }
        }
        stdout(
          `\n${url(endpoint)} is in place. Restart open agent sessions to load it; verify with \`ndea mcp check\`.`,
        );
        if (failed.length > 0) throw new Error(`could not write ${failed.join(", ")}`);
      }),
);

const checkCommand = defineCommand(
  "check",
  { description: "Check the MCP server and which agents can reach it with the current token" },
  (command) =>
    command.provide(server()).action(async ({ ctx, stdout }) => {
      const endpoint = `${(await ctx.server).origin}/mcp`;
      const bearer = `Bearer ${await loadMcpToken()}`;
      const serverLabel = pad("ndea server");
      let healthy = true;

      try {
        const response = await fetch(endpoint, {
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
          stdout(`  ${ok(`${serverLabel} ${url(endpoint)} accepts the token ${label(`(${tools} tools)`)}`)}`);
        } else {
          healthy = false;
          const hint =
            response.status === 401
              ? "rejects ~/.ndea/mcp-token; restart `ndea view` to reload it"
              : body.slice(0, 120);
          stdout(`  ${fail(`${serverLabel} ${url(endpoint)} answered ${response.status}: ${hint}`)}`);
        }
      } catch {
        healthy = false;
        stdout(
          `  ${fail(`${serverLabel} nothing listening at ${url(endpoint)}; start \`ndea view\` (or pass --port)`)}`,
        );
      }

      const installed = await listInstalledServers({ global: true, agents: await detectedHttpAgents() });
      let current = 0;
      for (const { agentType, displayName, servers, error } of installed) {
        const name = pad(displayName);
        if (error) {
          stdout(`  ${label("?")} ${name} config unreadable: ${error}`);
          continue;
        }
        const entry = ndeaEntry(servers);
        if (!entry) stdout(`  ${label(`· ${name} not installed (ndea mcp install --agent ${agentType})`)}`);
        else if (entry.identity !== endpoint) {
          healthy = false;
          stdout(`  ${fail(`${name} points at ${entry.identity}; reinstall: ndea mcp install --agent ${agentType}`)}`);
        } else if (!mentions(entry.config, bearer)) {
          healthy = false;
          stdout(`  ${fail(`${name} has an old token; reinstall: ndea mcp install --agent ${agentType}`)}`);
        } else {
          current += 1;
          stdout(`  ${ok(`${name} ${label(entry.configPath)}`)}`);
        }
      }
      if (current === 0) throw new Error("no agent is set up yet: run `ndea mcp install`");
      if (!healthy) throw new Error("MCP setup needs attention (see above)");
    }),
);

const uninstallCommand = defineCommand(
  "uninstall",
  { description: "Remove ndea's MCP server from agent configs" },
  (command) =>
    command.flags(agentFlag).action(async ({ flags, stdout }) => {
      const scope = flags.agent ? parseAgents(flags.agent) : await detectedHttpAgents();
      const installed = await listInstalledServers({ global: true, agents: scope });
      let removed = 0;
      for (const { agentType, displayName, servers } of installed) {
        const entry = ndeaEntry(servers);
        if (!entry) continue;
        const result = removeServer(agentType, entry.serverName);
        if (result.removed) {
          removed += 1;
          stdout(`  ${ok(`${pad(displayName)} ${label(result.path)}`)}`);
        } else stdout(`  ${fail(`${pad(displayName)} ${result.error ?? "not removed"}`)}`);
      }
      if (removed === 0) stdout("ndea is not installed in any detected agent.");
    }),
);

export default defineCommand("mcp", { description: "Connect coding agents to ndea's MCP server" }, (command) =>
  command.add(installCommand, checkCommand, uninstallCommand),
);
