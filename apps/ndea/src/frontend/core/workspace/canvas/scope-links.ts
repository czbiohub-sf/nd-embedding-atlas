/**
 * Coordination on the canvas. Every scope with a member on the current level
 * becomes a derived hub, and every binding `bindings[node][type]` becomes
 * exactly one link from its scope's hub to the node. The projection holds no
 * state of its own, so a link exists exactly when its binding does: deleting
 * a link clears that binding, and connecting a hub to a node assigns it.
 */

import { bindingScope, COORDINATION_TYPE_IDS, type CoordinationTypeId } from "@/core/coordination/types";
import type { WorkspaceDocument, WorkspaceNodePosition } from "../types";

/** Target handle id every coordinating node exposes for scope links. */
export const SCOPE_HANDLE = "scope";

export interface ScopeHub {
  readonly id: string;
  readonly type: CoordinationTypeId;
  readonly scope: string;
  readonly position: WorkspaceNodePosition;
}

export interface ScopeLink {
  readonly id: string;
  readonly hub: string;
  readonly node: string;
  readonly type: CoordinationTypeId;
  readonly scope: string;
}

const HUB_PREFIX = "scope:";
const LINK_PREFIX = "bind:";
/** Hubs sit above their members, one row per type so shared member sets never stack. */
const HUB_LIFT = 70;
const HUB_ROW = 34;

export function scopeHubId(type: CoordinationTypeId, scope: string): string {
  return `${HUB_PREFIX}${type}:${scope}`;
}

export function scopeLinkId(type: CoordinationTypeId, node: string): string {
  return `${LINK_PREFIX}${type}:${node}`;
}

function parseTyped(id: string, prefix: string): { type: CoordinationTypeId; rest: string } | null {
  if (!id.startsWith(prefix)) return null;
  const body = id.slice(prefix.length);
  const colon = body.indexOf(":");
  const type = body.slice(0, colon) as CoordinationTypeId;
  if (colon < 0 || !COORDINATION_TYPE_IDS.includes(type)) return null;
  return { type, rest: body.slice(colon + 1) };
}

export function parseScopeHubId(id: string): { type: CoordinationTypeId; scope: string } | null {
  const parsed = parseTyped(id, HUB_PREFIX);
  return parsed && { type: parsed.type, scope: parsed.rest };
}

export function parseScopeLinkId(id: string): { type: CoordinationTypeId; node: string } | null {
  const parsed = parseTyped(id, LINK_PREFIX);
  return parsed && { type: parsed.type, node: parsed.rest };
}

/** Project the bindings of the nodes on one canvas level to hubs and links. */
export function projectScopeLinks(
  document: Pick<WorkspaceDocument, "bindings" | "positions">,
  levelNodeIds: ReadonlySet<string>,
): { hubs: ScopeHub[]; links: ScopeLink[] } {
  const members = new Map<string, { type: CoordinationTypeId; scope: string; nodes: string[] }>();
  const links: ScopeLink[] = [];
  for (const [node, byType] of Object.entries(document.bindings)) {
    if (!levelNodeIds.has(node)) continue;
    for (const type of COORDINATION_TYPE_IDS) {
      const scope = bindingScope(type, byType[type]);
      if (scope === undefined) continue;
      const hub = scopeHubId(type, scope);
      const entry = members.get(hub) ?? { type, scope, nodes: [] };
      entry.nodes.push(node);
      members.set(hub, entry);
      links.push({ id: scopeLinkId(type, node), hub, node, type, scope });
    }
  }
  const hubs = [...members].map(([id, { type, scope, nodes }]) => {
    const points = nodes.map((node) => document.positions[node] ?? { x: 0, y: 0 });
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const top = Math.min(...points.map((p) => p.y));
    const row = COORDINATION_TYPE_IDS.indexOf(type);
    return { id, type, scope, position: { x, y: top - HUB_LIFT - row * HUB_ROW } };
  });
  return { hubs, links };
}
