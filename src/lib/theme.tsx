import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// App-wide light/dark appearance toggle. Two different things share the
// word "theme" in this codebase — this is the main app's own light/dark
// mode; it is NOT the same as a coach's public-profile `data-theme`
// (coach-profile-tokens.css), which is a separate, independently-scoped
// CSS variable namespace (`--bg`/`--text-primary` etc. vs this file's
// `--background`/`--foreground`) for that coach's own marketing page.
// They can never collide, but don't confuse one for the other.

export type Theme = "dark" | "light";

const LS_KEY = "strider:theme";

// Dark stays the default for anyone who hasn't chosen — this toggle is
// additive, not a redesign, so nobody's view changes unless they opt in.
function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(LS_KEY) === "light" ? "light" : "dark";
}

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  // Reconciles the DOM class with React state on mount/change. The actual
  // very-first-paint value is already set by the blocking inline script in
  // __root.tsx (see RootShell) so there's no flash before this ever runs —
  // this just keeps the two in sync from here on (e.g. toggling live, or a
  // future preference synced down from the account row after this
  // component has already mounted).
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, next);
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
