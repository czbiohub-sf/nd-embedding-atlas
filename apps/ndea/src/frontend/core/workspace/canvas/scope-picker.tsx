/**
 * Scope picker (U4) — the per-type scope-assignment popover that replaces the
 * hardcoded "link into group A" button. For each coordination TYPE the node
 * supports (capability-gated), it offers the EXISTING scopes plus "New scope"
 * (mint) and "Unlink" — never free-text, so a node can't reference a dangling
 * scope (KD9). A freshly spawned node participates in nothing until linked here.
 */

import { Link2 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NdCaption, NdHud } from "@/components/nd/nd-primitives";
import { listCoordinationTypes } from "@/core/coordination/define-type";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";

/** Human label for a coordination type (the registry key is terse). */
const TYPE_LABEL: Record<string, string> = { focus: "focus", viewSync: "view sync", ordering: "sort" };

export function ScopePicker({ nodeId }: { nodeId: string }) {
  const ws = useWorkspace();
  const nodeType = useWorkspaceSelector((s) => s.nodes[nodeId]?.type ?? null);
  // subscribe to the whole scope map so existing-scope lists + the node's own
  // assignments stay live as peers link/unlink.
  const allScopes = useWorkspaceSelector((s) => s.coordinationScopes);
  const assigned = allScopes[nodeId] ?? {};

  const caps = nodeType ? ws.deps.nodeLibrary.getSpec(nodeType)?.definition.capabilities : undefined;
  const types = listCoordinationTypes().filter((type) => caps?.includes(type.capability));
  if (types.length === 0) return null;

  const activeScopes = types.map((t) => assigned[t.type]).filter(Boolean);
  const triggerColor = activeScopes.length > 0 ? ws.coordination.scopeColor(activeScopes[0]) : undefined;

  return (
    <Popover>
      <PopoverTrigger
        data-nodrag="1"
        title={
          activeScopes.length > 0
            ? `linked on ${activeScopes.length} channel(s) — click to edit`
            : "link this node onto a shared channel"
        }
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center rounded p-[3px] text-text-muted hover:bg-muted"
        style={triggerColor ? { color: triggerColor } : undefined}
      >
        <Link2 size={12} strokeWidth={2.2} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-44 p-2"
        onClick={(e) => e.stopPropagation()}
        data-nodrag="1"
      >
        <div className="flex flex-col gap-2">
          {types.map((t) => {
            const current = assigned[t.type] ?? null;
            const existing = ws.coordination.existingScopes(t.type);
            return (
              <div key={t.type} className="flex flex-col gap-1">
                <NdHud size={8.5}>{TYPE_LABEL[t.type] ?? t.type}</NdHud>
                <div className="flex flex-wrap gap-1">
                  {existing.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      title={current === scope ? `on ${scope} — click to unlink` : `link onto ${scope}`}
                      onClick={() =>
                        current === scope
                          ? ws.coordination.clearScope(nodeId, t.type)
                          : ws.coordination.assignScope(nodeId, t.type, scope)
                      }
                      className="inline-flex items-center gap-[3px] rounded-full border px-[6px] py-[2px] font-mono text-[9px]"
                      style={
                        current === scope
                          ? {
                              background: ws.coordination.scopeColor(scope),
                              color: "#0c0c12",
                              borderColor: "transparent",
                            }
                          : { borderColor: "var(--color-border)", color: "var(--color-text-muted)" }
                      }
                    >
                      <span
                        className="size-[6px] rounded-full"
                        style={{ background: ws.coordination.scopeColor(scope) }}
                      />
                      {scope}
                    </button>
                  ))}
                  <button
                    type="button"
                    title="mint a new scope and link onto it"
                    onClick={() => ws.coordination.assignScope(nodeId, t.type, ws.coordination.mintScope(t.type))}
                    className="rounded-full border border-dashed border-border px-[6px] py-[2px] font-mono text-[9px] text-text-muted hover:bg-muted"
                  >
                    + new
                  </button>
                  {current ? (
                    <button
                      type="button"
                      title="unlink from this channel"
                      onClick={() => ws.coordination.clearScope(nodeId, t.type)}
                      className="rounded-full px-[6px] py-[2px] font-mono text-[9px] text-text-muted hover:bg-muted"
                    >
                      unlink
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          <NdCaption className="text-[9px]">peers on the same scope share that channel</NdCaption>
        </div>
      </PopoverContent>
    </Popover>
  );
}
