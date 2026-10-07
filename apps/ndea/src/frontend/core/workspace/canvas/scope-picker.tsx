/**
 * Scope picker: per-type scope binding. For each coordination TYPE the node
 * supports (capability-gated), it offers the EXISTING scopes plus "New scope"
 * (mint) and "Unlink": never free-text, so a node can't bind a dangling
 * scope. A freshly spawned node participates in nothing until linked here.
 */

import { Link2 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@ndea/ui/components/popover";
import { NdCaption, NdHud } from "@/components/node-workspace/nd-primitives";
import { bindingScope, COORDINATION_TYPE_IDS, COORDINATION_TYPES } from "@/core/coordination/types";
import { ON_ACCENT_INK } from "@/lib/color/brand";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";

export function ScopePicker({ nodeId }: { nodeId: string }) {
  const ws = useWorkspace();
  const definitionRef = useWorkspaceSelector((s) => s.nodes[nodeId]?.definitionRef ?? null);
  // subscribe to every binding so existing-scope lists and this node's own
  // bindings stay live as peers link/unlink.
  const bindings = useWorkspaceSelector((s) => s.bindings);
  const assigned = bindings[nodeId] ?? {};

  const caps = definitionRef ? ws.nodeLibrary.getSpecExact(definitionRef)?.definition.capabilities : undefined;
  const types = COORDINATION_TYPE_IDS.filter((type) => caps?.includes(COORDINATION_TYPES[type].capability));
  if (types.length === 0) return null;

  const activeScopes = types.flatMap((type) => bindingScope(type, assigned[type]) ?? []);
  const triggerColor = activeScopes.length > 0 ? ws.coordination.scopeColor(activeScopes[0]) : undefined;

  return (
    <Popover>
      <PopoverTrigger
        data-nodrag="1"
        title={
          activeScopes.length > 0
            ? `linked on ${activeScopes.length} channel(s): click to edit`
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
          {types.map((type) => {
            const current = bindingScope(type, assigned[type]) ?? null;
            const existing = ws.coordination.existingScopes(type);
            return (
              <div key={type} className="flex flex-col gap-1">
                <NdHud size={8.5}>{COORDINATION_TYPES[type].label}</NdHud>
                <div className="flex flex-wrap gap-1">
                  {existing.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      title={current === scope ? `on ${scope}: click to unlink` : `link onto ${scope}`}
                      onClick={() =>
                        current === scope
                          ? ws.coordination.clearScope(nodeId, type)
                          : ws.coordination.assignScope(nodeId, type, scope)
                      }
                      className="inline-flex items-center gap-[3px] rounded-full border px-[6px] py-[2px] font-mono text-[9px]"
                      style={
                        current === scope
                          ? {
                              background: ws.coordination.scopeColor(scope),
                              color: ON_ACCENT_INK,
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
                    onClick={() => ws.coordination.assignScope(nodeId, type, ws.coordination.mintScope(type))}
                    className="rounded-full border border-dashed border-border px-[6px] py-[2px] font-mono text-[9px] text-text-muted hover:bg-muted"
                  >
                    + new
                  </button>
                  {current ? (
                    <button
                      type="button"
                      title="unlink from this channel"
                      onClick={() => ws.coordination.clearScope(nodeId, type)}
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
