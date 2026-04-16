/**
 * ThemeProvider — manages dark/light mode with localStorage persistence.
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
    // Respect OS preference on first visit; default to dark
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);

    const applyTheme = useCallback((t: Theme) => {
        const root = document.documentElement;
        if (t === "dark") {
            root.classList.add("dark");
        } else {
            root.classList.remove("dark");
        }
        try {
            localStorage.setItem("ndea-theme", t);
        } catch {
            /* ignore */
        }
        setThemeState(t);
    }, []);

    // Apply on mount
    useEffect(() => {
        applyTheme(theme);
    }, [applyTheme, theme]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = useCallback(() => {
        applyTheme(theme === "dark" ? "light" : "dark");
    }, [theme, applyTheme]);

    const setTheme = useCallback((t: Theme) => applyTheme(t), [applyTheme]);

    return <ThemeContext value={{ theme, toggle, setTheme }}>{children}</ThemeContext>;
}
