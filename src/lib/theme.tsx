import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// App-wide light/dark appearance toggle. Two different things share the
// word "theme" in this codebase — this is the main app's own light/dark
// mode; it is NOT the same as a coach's public-profile `data-theme`
// (coach-profile-tokens.css), which is a separate, independently-scoped
// CSS variable namespace (`--bg`/`--text-primary` etc. vs this file's
// `--background`/`--foreground`) for that coach's own marketing page.
// They can never collide, but don't confuse one for the other.
//
// WHITE-LABEL (Update 39): a branded coach can nominate a default
// appearance for their squad, and optionally force it. That's layered on
// top of the personal preference below rather than replacing it — see
// the resolution comment on `theme` for the exact precedence.

export type Theme = "dark" | "light";

const LS_KEY = "strider:theme";

// Dark stays the default for anyone who hasn't chosen — this toggle is
// additive, not a redesign, so nobody's view changes unless they opt in.
function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(LS_KEY);
  return v === "light" ? "light" : v === "dark" ? "dark" : null;
}

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeContextValue {
  /** The theme actually on screen, after brand rules are applied. */
  theme: Theme;
  /** This person's own stored choice, or null if they've never picked one. */
  userTheme: Theme | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Appearance nominated by the branded coach, if any. */
  brandTheme: Theme | null;
  /** When true, brandTheme overrides even an explicit personal choice. */
  brandForced: boolean;
  /** Called by BrandingProvider once branding resolves. */
  setBrandTheme: (theme: Theme | null, force: boolean) => void;
  /** True when the personal toggle is currently overridden by the brand. */
  isLockedByBrand: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [userTheme, setUserThemeState] = useState<Theme | null>(readStoredTheme);
  const [brandTheme, setBrandThemeState] = useState<Theme | null>(null);
  const [brandForced, setBrandForced] = useState(false);

  // Precedence, highest first:
  //   1. A brand theme the coach has explicitly FORCED  — squad consistency.
  //   2. This person's own stored choice                — personal preference.
  //   3. The brand's suggested default                  — a sensible starting
  //      point for someone who's never touched the toggle.
  //   4. "dark"                                         — the app default.
  // Note 2 sits above 3 deliberately: a nominated default is a starting
  // point, not an override. Only force_theme outranks a real choice.
  const theme: Theme = brandForced && brandTheme ? brandTheme : (userTheme ?? brandTheme ?? "dark");
  const isLockedByBrand = brandForced && !!brandTheme;

  // Reconciles the DOM class with React state on mount/change. The actual
  // very-first-paint value is already set by the blocking inline script in
  // __root.tsx (see RootShell) so there's no flash before this ever runs —
  // this just keeps the two in sync from here on (toggling live, or the
  // brand preference arriving once the branding query resolves).
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setUserThemeState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const setBrandTheme = useCallback((next: Theme | null, force: boolean) => {
    setBrandThemeState(next);
    setBrandForced(force);
  }, []);

  const value = useMemo(
    () => ({ theme, userTheme, setTheme, toggleTheme, brandTheme, brandForced, setBrandTheme, isLockedByBrand }),
    [theme, userTheme, setTheme, toggleTheme, brandTheme, brandForced, setBrandTheme, isLockedByBrand],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
