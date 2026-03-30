/**
 * TerminalTableProvider — global state for the ⌘J terminal-style table drawer.
 *
 * State: { open: boolean; height: number }
 * Default height: 300px, persisted to localStorage("ndea_table_height")
 * Registers ⌘J hotkey to toggle open/closed.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";

const HEIGHT_KEY = "ndea_table_height";
const DEFAULT_HEIGHT = 300;

interface TerminalTableState {
  open: boolean;
  height: number;
  toggle: () => void;
  setHeight: (h: number) => void;
}

const TerminalTableContext = createContext<TerminalTableState | null>(null);

export function TerminalTableProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [height, setHeightState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(HEIGHT_KEY);
      return saved ? Number(saved) : DEFAULT_HEIGHT;
    } catch {
      return DEFAULT_HEIGHT;
    }
  });

  const setHeight = useCallback((h: number) => {
    const clamped = Math.max(100, Math.min(window.innerHeight - 80, h));
    setHeightState(clamped);
    try {
      localStorage.setItem(HEIGHT_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  useHotkey("Mod+J", toggle, { preventDefault: true });

  const value = useMemo(() => ({ open, height, toggle, setHeight }), [open, height, toggle, setHeight]);

  return <TerminalTableContext.Provider value={value}>{children}</TerminalTableContext.Provider>;
}

export function useTerminalTable(): TerminalTableState {
  const ctx = useContext(TerminalTableContext);
  if (!ctx) throw new Error("useTerminalTable must be used inside TerminalTableProvider");
  return ctx;
}
