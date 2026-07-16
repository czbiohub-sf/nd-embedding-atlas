/**
 * NodeDocButton — Tier 1 · Peek. An info button for a node's header that opens
 * the node's contextual documentation in a click popover, sourced from the
 * definition's documentation. Click (not hover) so it's discoverable and never
 * fights the node body. The single renderer for the doc tier; the reference
 * drawer (tier 2) reuses the same `NodeDoc` record.
 *
 * Renders nothing when the node type has no definition or authored documentation —
 * only documented nodes get the button.
 */

import { useState } from "react";
import { useDocs } from "@/components/docs/docs-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ndIconButtonVariants } from "@/components/nd/nd-icon-button";
import { NdIcon } from "@/components/nd/nd-icons";
import { ND_PORT_KINDS, type NdPortKind } from "@/components/nd/nd-port";
import { humanizedCapabilities } from "@/core/node/capability-docs";
import { useWorkspace } from "@/core/workspace/workspace-context";
import type { ExactNodeTypeRef, NodePort } from "@ndea/sdk";
import { cn } from "@/lib/utils";

/** A single typed-port token: kind glyph + label (filled = out, hollow = in). */
function PortToken({ port, out }: { port: NodePort; out: boolean }) {
  const spec = ND_PORT_KINDS[port.kind as NdPortKind];
  const shape =
    spec.shape === "diamond"
      ? { borderRadius: 2, transform: "rotate(45deg)" }
      : spec.shape === "square"
        ? { borderRadius: 2 }
        : { borderRadius: 999 };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-[9px] shrink-0 border-[1.4px]"
        style={{ borderColor: spec.color, background: out ? spec.color : "transparent", ...shape }}
      />
      {port.label}
    </span>
  );
}

export function NodeDocButton({
  definitionRef,
  compact = false,
}: {
  definitionRef: ExactNodeTypeRef;
  compact?: boolean;
}) {
  const workspace = useWorkspace();
  const definition = workspace.nodeLibrary.catalog.resolveExact(definitionRef);
  const doc = definition?.documentation;
  const docs = useDocs();
  const [open, setOpen] = useState(false);
  // No authored docs → no button.
  if (!definition || !doc) return null;

  const caps = humanizedCapabilities(definition.capabilities);
  const { inputs, outputs } = definition;
  const hasSig = inputs.length > 0 || outputs.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-nodrag="1"
        title={`About ${definition.title}`}
        aria-label={`About ${definition.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={cn(ndIconButtonVariants({ compact }), "px-[3px]")}
      >
        <NdIcon name="info" size={compact ? 8 : 9} />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-76 gap-0 p-0">
        {/* header: kind badge + title */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
          <span className="rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 font-semibold text-[8px] text-primary uppercase tracking-wide">
            {definition.role}
          </span>
          <span className="font-semibold text-[13px] leading-none tracking-tight">{definition.title}</span>
        </div>

        {/* io signature: inputs → outputs */}
        {hasSig && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-[10px] text-muted-foreground">
            {inputs.map((p) => (
              <PortToken key={p.id} port={p} out={false} />
            ))}
            {inputs.length > 0 && outputs.length > 0 && <span className="text-muted-foreground/50">→</span>}
            {outputs.map((p) => (
              <PortToken key={p.id} port={p} out />
            ))}
          </div>
        )}

        {/* humanized capability chips */}
        {caps.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2.5">
            {caps.map((c) => (
              <span
                key={c.label}
                className="rounded-full border border-border/60 bg-foreground/5 px-1.5 py-0.5 text-[8.5px] text-muted-foreground"
              >
                {c.label}
              </span>
            ))}
          </div>
        )}

        {/* body: summary + use, then optional note */}
        <div className="border-border/60 border-t px-3 py-2.5">
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">{doc.summary}</p>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground leading-relaxed">{doc.use}</p>
          {doc.note && (
            <p
              className={cn(
                "mt-2.5 rounded-md border border-border/70 bg-foreground/5 px-2 py-1.5",
                "text-[9.5px] text-muted-foreground leading-snug",
              )}
            >
              {doc.note}
            </p>
          )}
        </div>

        {/* footer: escalate to the full-docs sheet (tier 2) */}
        {docs && (
          <div className="border-border/60 border-t px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                docs.openDocs(definitionRef);
              }}
              className="inline-flex items-center gap-1 font-semibold text-[10px] text-primary hover:underline"
            >
              see full docs
              <span aria-hidden>→</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
