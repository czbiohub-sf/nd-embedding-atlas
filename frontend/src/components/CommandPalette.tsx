import { useState, useEffect } from "react";
import { LayoutGrid, Table2, RotateCcw, Sun, Moon } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "./ui/command";
import { useDashboard } from "../hooks/useDashboard";
import { useTerminalTable } from "../providers/TerminalTableProvider";
import { useTheme } from "../providers/ThemeProvider";

interface CommandPaletteProps {
  onAddScatter: (obsmKey: string) => void;
}

export function CommandPalette({ onAddScatter }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const {
    state: { metadata },
  } = useDashboard();
  const { toggle: toggleTable } = useTerminalTable();
  const { theme, toggle: toggleTheme } = useTheme();

  // ⌘K to open — use native listener to avoid conflicts with cmdk internals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Show all embeddings — unloaded ones are fetched on demand when the panel opens
  const obsmEntries = Object.entries(metadata.obsm ?? {});

  function dispatch(fn: () => void) {
    fn();
    setOpen(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search commands…" autoFocus />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {obsmEntries.length > 0 && (
          <CommandGroup heading="Scatter">
            {obsmEntries.map(([key]) => {
              const label = key.replace(/^X_/, "");
              return (
                <CommandItem key={key} onSelect={() => dispatch(() => onAddScatter(key))}>
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  <span>New Scatter — {label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        <CommandGroup heading="Layout">
          <CommandItem onSelect={() => dispatch(toggleTable)}>
            <Table2 className="mr-2 h-4 w-4" />
            <span>Toggle Table</span>
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              dispatch(() => {
                localStorage.clear();
                location.reload();
              })
            }
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            <span>Reset Layout</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Appearance">
          <CommandItem onSelect={() => dispatch(toggleTheme)}>
            {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            <span>Toggle {theme === "dark" ? "Light" : "Dark"} Mode</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
