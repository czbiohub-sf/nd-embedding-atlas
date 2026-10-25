"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "@/ThemeProvider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ndea/ui/components/command";

const OpenPaletteContext = createContext<() => void>(() => {});

/** Opens the command palette (the rail's Search button); ⌘K toggles it anywhere. */
export function useOpenCommandPalette(): () => void {
  return use(OpenPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const openPalette = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    setOpen(false);
  };

  return (
    <OpenPaletteContext value={openPalette}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} title="Commands" description="Change application theme">
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No commands found</CommandEmpty>
          <CommandGroup heading="Theme">
            <CommandItem value="light theme" data-checked={theme === "light"} onSelect={() => selectTheme("light")}>
              <SunIcon />
              <span>Light theme</span>
            </CommandItem>
            <CommandItem value="dark theme" data-checked={theme === "dark"} onSelect={() => selectTheme("dark")}>
              <MoonIcon />
              <span>Dark theme</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </OpenPaletteContext>
  );
}
