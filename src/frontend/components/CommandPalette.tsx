import type { FilterExpr } from "@uwdata/mosaic-sql";
import { cast, count, Query, sum } from "@uwdata/mosaic-sql";
import { ChevronRight, Download, LayoutGrid, Moon, RotateCcw, ScanIcon, Sun, Table2 } from "lucide-react";
import { lazy, type RefObject, Suspense, useCallback, useEffect, useState } from "react";
import { useDashboard } from "../hooks/useDashboard";
import { useMosaicClient } from "../hooks/useMosaicClient";
import { filterExprToExpr } from "../lib/mosaic-helpers";
import { usePanel } from "../stores/panelRegistry";
import { useTheme } from "../ThemeProvider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";
import { Kbd, KbdGroup } from "./ui/kbd";

const ExportDialog = lazy(() => import("./toolbar/ExportDialog"));

interface CommandPaletteProps {
  onAddScatter: (obsmKey: string) => void;
  onOpenViewer?: () => void;
  onFloatViewer?: () => void;
  openRef?: RefObject<((page: "scatter") => void) | null>;
}

export function CommandPalette({ onAddScatter, onOpenViewer, onFloatViewer, openRef }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"root" | "scatter">("root");
  const [search, setSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const {
    state: { metadata },
    meta: { coordinator, brushSelection, table },
  } = useDashboard();
  const { toggle: toggleTable } = usePanel("table");
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { theme, toggle: toggleTheme } = useTheme();

  // Track filtered obs count for Export (same query as ExportButton)
  const exportQuery = useCallback(
    (predicate: FilterExpr) => {
      const pred = filterExprToExpr(predicate);
      return Query.from(table).select({ total: count(), filtered: sum(cast(pred, "INT")) });
    },
    [table],
  );
  const exportTransform = useCallback((result: unknown) => {
    const rows = Array.isArray(result) ? result : Array.from(result as Iterable<Record<string, unknown>>);
    const r = rows[0];
    return { total: Number(r?.total ?? 0), filtered: Number(r?.filtered ?? 0) };
  }, []);
  const { data: exportData } = useMosaicClient({
    coordinator,
    selection: brushSelection,
    query: exportQuery,
    transform: exportTransform,
  });
  const canExport = exportData && exportData.filtered > 0 && exportData.filtered < exportData.total;

  useEffect(() => {
    if (!open) {
      setPage("root");
      setSearch("");
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, []);

  useEffect(() => {
    if (!openRef) return () => {};
    openRef.current = (targetPage: "scatter") => {
      setPage(targetPage);
      setSearch("");
      setOpen(true);
    };
    return () => {
      openRef.current = null;
    };
  }, [openRef]);

  const obsmEntries = Object.entries(metadata.obsm ?? {});

  function dispatch(fn: () => void) {
    fn();
    setOpen(false);
  }

  const placeholder = page === "scatter" ? "Search embeddings…" : "Search commands…";

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && !search && page !== "root") {
            e.preventDefault();
            setPage("root");
          }
          if (e.key === "Escape" && page !== "root") {
            e.preventDefault();
            setPage("root");
          }
        }}
      >
        <CommandInput placeholder={placeholder} autoFocus value={search} onValueChange={setSearch} />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* ── Root page ── */}
          {page === "root" && (
            <>
              {obsmEntries.length > 0 && (
                <CommandGroup heading="Scatter">
                  <CommandItem
                    onSelect={() => {
                      setSearch("");
                      setPage("scatter");
                    }}
                  >
                    <LayoutGrid data-icon="inline-start" />
                    New Scatter
                    <ChevronRight className="ml-auto size-3 text-muted-foreground" />
                  </CommandItem>
                </CommandGroup>
              )}

              <CommandSeparator />
              <CommandGroup heading="Layout">
                <CommandItem onSelect={() => dispatch(toggleTable)}>
                  <Table2 data-icon="inline-start" />
                  Toggle Table
                  <KbdGroup className="ml-auto">
                    <Kbd>⌘</Kbd>
                    <Kbd>J</Kbd>
                  </KbdGroup>
                </CommandItem>
                {metadata.plate && onOpenViewer && (
                  <CommandItem onSelect={() => dispatch(onOpenViewer)}>
                    <ScanIcon data-icon="inline-start" />
                    Open Image Viewer
                  </CommandItem>
                )}
                {metadata.plate && onFloatViewer && (
                  <CommandItem onSelect={() => dispatch(onFloatViewer)}>
                    <ScanIcon data-icon="inline-start" />
                    Float Image Viewer
                  </CommandItem>
                )}
                <CommandItem
                  onSelect={() =>
                    dispatch(() => {
                      localStorage.clear();
                      location.reload();
                    })
                  }
                >
                  <RotateCcw data-icon="inline-start" />
                  Reset Layout
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />
              <CommandGroup heading="Data">
                <CommandItem
                  disabled={!canExport}
                  onSelect={() => {
                    if (!canExport) return;
                    setOpen(false);
                    setExportOpen(true);
                  }}
                >
                  <Download data-icon="inline-start" />
                  Export selection…
                  {exportData && (
                    <span className="ml-auto text-3xs text-muted-foreground/50 tabular-nums">
                      {canExport ? exportData.filtered.toLocaleString() : "no selection"}
                    </span>
                  )}
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />
              <CommandGroup heading="Appearance">
                <CommandItem onSelect={() => dispatch(toggleTheme)}>
                  {theme === "dark" ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
                  Toggle {theme === "dark" ? "Light" : "Dark"} Mode
                </CommandItem>
              </CommandGroup>

              {/* Version footer */}
              {metadata.version && (
                <div className="select-none px-3 py-2 text-3xs text-muted-foreground/40">ndea v{metadata.version}</div>
              )}
            </>
          )}

          {/* ── Scatter sub-page ── */}
          {page === "scatter" && (
            <CommandGroup heading="Choose embedding">
              {obsmEntries.map(([key]) => (
                <CommandItem key={key} onSelect={() => dispatch(() => onAddScatter(key))}>
                  <LayoutGrid data-icon="inline-start" />
                  {key.replace(/^X_/, "")}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      {/* Export dialog — Dialog manages its own portal, survives palette close */}
      <Suspense fallback={null}>
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} filtered={exportData?.filtered ?? 0} />
      </Suspense>
    </>
  );
}
