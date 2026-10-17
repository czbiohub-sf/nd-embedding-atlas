/**
 * ThemeProvider: manages dark/light mode with localStorage persistence.
 * Applies `.dark` to `document.documentElement` and exposes a toggle.
 * Defaults to dark mode; respects OS preference only on first visit.
 */
import { createContext, use, useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggle(): void;
  setTheme(t: Theme): void;
}

// eslint-disable-next-line react/only-export-components
export const ThemeContext = createContext<ThemeContextValue | null>(null);

// eslint-disable-next-line react/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem("ndea-theme") as Theme | null;
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable
  }
  // Brand-canonical default is light (Biohub technical mode); honor an explicit OS dark pref.
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Sync the DOM class and persisted preference with the current theme.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("ndea-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return <ThemeContext value={{ theme, toggle, setTheme }}>{children}</ThemeContext>;
}
