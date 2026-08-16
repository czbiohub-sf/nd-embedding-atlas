"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { MoonIcon, SunIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@ndea/ui/components/command";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ndea/ui/components/sheet";
import { ND_PORT_KINDS, type NdPortKind } from "@/components/node-workspace/nd-port";
import { humanizedCapabilities } from "@/core/node/capability-docs";
import type { NodeCatalog } from "@/core/plugin/catalog";
import type { ExactNodeTypeRef, NodePort } from "@ndea/sdk";
import { useTheme } from "@/ThemeProvider";
import { DocsContext } from "./docs-context";

/**
 * DocsProvider: mounts the in-app documentation surfaces once, near the app
 * root, and exposes imperative openers via `useDocs()`:
 *   · ⌘K / Ctrl+K → the docs search palette (`CommandDialog`)
 *   · openDocs(exactRef) → the node definition's full reference (`Sheet`)
 * Content is sourced from the definition's documentation, ports, and capabilities :
 * no MDX pipeline yet (tiers 2–3 rich prose land with it). See the plan doc.
 */
export function DocsProvider({ children, catalog }: { children: ReactNode; catalog: NodeCatalog }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [docsRef, setDocsRef] = useState<ExactNodeTypeRef | null>(null);

  const openCommand = useCallback(() => setCommandOpen(true), []);
  const openDocs = useCallback((definitionRef: ExactNodeTypeRef) => {
    setCommandOpen(false);
    setDocsRef(definitionRef);
  }, []);

  // ⌘K / Ctrl+K toggles the docs search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ openCommand, openDocs }), [openCommand, openDocs]);

  return (
    <DocsContext.Provider value={value}>
      {children}
      <DocsCommand catalog={catalog} open={commandOpen} onOpenChange={setCommandOpen} onPick={openDocs} />
      <NodeDocsSheet catalog={catalog} definitionRef={docsRef} onClose={() => setDocsRef(null)} />
    </DocsContext.Provider>
  );
}

/* ── ⌘K search palette ────────────────────────────────────────────────────
 * Matches the sketch (docs-system.html): typed glyph rows, an Actions group,
 * and a footer with kbd hints + a light/dark toggle. A "Pages" group (searching
 * the MDX doc pages) lands with the in-app MDX pipeline. */

/** A node's typed glyph: colored dot by its primary port kind (like the sketch). */
function NodeGlyph({ kind }: { kind: NdPortKind }) {
  const spec = ND_PORT_KINDS[kind];
  const shape =
    spec.shape === "diamond"
      ? { borderRadius: 2, transform: "rotate(45deg)" }
      : spec.shape === "square"
        ? { borderRadius: 2 }
        : { borderRadius: 999 };
  return <span className="size-[10px] shrink-0" style={{ background: spec.color, ...shape }} />;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-border/60 bg-foreground/5 px-1 py-px font-mono text-[8px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function DocsCommand({
  catalog,
  open,
  onOpenChange,
  onPick,
}: {
  catalog: NodeCatalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (definitionRef: ExactNodeTypeRef) => void;
}) {
  const { theme, toggle } = useTheme();
  // Recompute when opened so newly registered definitions are included.
  const entries = useMemo(
    () =>
      open
        ? catalog
            .listDefinitions()
            .filter((definition) => definition.documentation)
            .toSorted((a, b) => a.title.localeCompare(b.title))
        : [],
    [catalog, open],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search docs" description="Find node documentation">
      <CommandInput placeholder="Search docs…" />
      <CommandList>
        <CommandEmpty>No documentation found.</CommandEmpty>
        <CommandGroup heading="Nodes">
          {entries.map((d) => {
            const kind = d.outputs[0]?.kind ?? d.inputs[0]?.kind ?? "pred";
            return (
              <CommandItem
                key={`${d.ref.nodeTypeId}@${d.ref.nodeTypeVersion}`}
                value={`${d.title} ${d.documentation?.summary ?? ""}`}
                onSelect={() => onPick(d.ref)}
                className="gap-2.5"
              >
                <NodeGlyph kind={kind} />
                <span className="font-medium">{d.title}</span>
                <span className="truncate text-muted-foreground">{d.documentation?.summary}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="toggle theme light dark" onSelect={toggle} className="gap-2.5">
            {theme === "dark" ? (
              <SunIcon className="size-3.5 text-text-muted" />
            ) : (
              <MoonIcon className="size-3.5 text-text-muted" />
            )}
            <span className="font-medium">Toggle theme</span>
            <span className="ml-auto text-[9px] text-text-muted">{theme === "dark" ? "light" : "dark"}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* footer: kbd hints + light/dark toggle (sketch parity) */}
      <div className="flex items-center gap-3 border-border/60 border-t px-3 py-2 text-[9px] text-text-muted">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle light/dark theme"
          className="inline-flex size-5 items-center justify-center rounded-[4px] border border-border/60 text-text-muted hover:text-foreground"
        >
          {theme === "dark" ? <MoonIcon className="size-3" /> : <SunIcon className="size-3" />}
        </button>
      </div>
    </CommandDialog>
  );
}

/* ── full-docs sheet: one node's reference, from structured definition data ── */

function PortRow({ port, out }: { port: NodePort; out: boolean }) {
  const spec = ND_PORT_KINDS[port.kind];
  const shape =
    spec.shape === "diamond"
      ? { borderRadius: 2, transform: "rotate(45deg)" }
      : spec.shape === "square"
        ? { borderRadius: 2 }
        : { borderRadius: 999 };
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-[3px] size-[9px] shrink-0 border-[1.4px]"
        style={{ borderColor: spec.color, background: out ? spec.color : "transparent", ...shape }}
      />
      <div>
        <span className="font-medium text-foreground">{port.label}</span>
        <span className="ml-1.5 text-text-muted">
          {out ? "out" : "in"} · {spec.label}
        </span>
        {port.documentation && <p className="mt-0.5 text-muted-foreground leading-snug">{port.documentation}</p>}
      </div>
    </div>
  );
}

function NodeDocsSheet({
  catalog,
  definitionRef,
  onClose,
}: {
  catalog: NodeCatalog;
  definitionRef: ExactNodeTypeRef | null;
  onClose: () => void;
}) {
  const definition = definitionRef ? catalog.resolveExact(definitionRef) : undefined;
  const doc = definition?.documentation;
  const open = Boolean(definition && doc);
  const caps = definition ? humanizedCapabilities(definition.capabilities) : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-[400px]">
        {definition && doc ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 font-semibold text-[8px] text-primary uppercase tracking-wide">
                  {definition.role}
                </span>
                <SheetTitle className="text-[15px]">{definition.title}</SheetTitle>
              </div>
              <SheetDescription>{doc.summary}</SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3">
              <section>
                <h4 className="mb-1.5 font-semibold text-[9px] text-text-muted uppercase tracking-wide">Overview</h4>
                <p className="text-muted-foreground leading-relaxed">{doc.use}</p>
                {doc.note && (
                  <p className="mt-2 rounded-md border border-border/70 bg-foreground/5 px-2.5 py-1.5 text-muted-foreground leading-snug">
                    {doc.note}
                  </p>
                )}
              </section>

              {(definition.inputs.length > 0 || definition.outputs.length > 0) && (
                <section>
                  <h4 className="mb-2 font-semibold text-[9px] text-text-muted uppercase tracking-wide">Connections</h4>
                  <div className="flex flex-col gap-2.5">
                    {definition.inputs.map((p) => (
                      <PortRow key={p.id} port={p} out={false} />
                    ))}
                    {definition.outputs.map((p) => (
                      <PortRow key={p.id} port={p} out />
                    ))}
                  </div>
                </section>
              )}

              {caps.length > 0 && (
                <section>
                  <h4 className="mb-2 font-semibold text-[9px] text-text-muted uppercase tracking-wide">
                    Capabilities
                  </h4>
                  <div className="flex flex-col gap-2">
                    {caps.map((c) => (
                      <div key={c.label}>
                        <span className="font-medium text-foreground">{c.label}</span>
                        <p className="mt-0.5 text-muted-foreground leading-snug">{c.doc}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
