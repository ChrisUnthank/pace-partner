import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// App-wide appearance. Two different things share the word "theme" in this
// codebase — this is the main app's own appearance; it is NOT the same as a
// coach's public-profile `data-theme` (coach-profile-tokens.css), which is a
// separate, independently-scoped CSS variable namespace (`--bg` /
// `--text-primary` etc. vs this file's `--background` / `--foreground`) for
// that coach's own marketing page. They can never collide, but don't confuse
// one for the other.
//
// FOUR APPEARANCES (Update 39b). "Dark" and "Light" are the neutral
// black/white palettes. "Brand Dark" and "Brand Light" keep the same
// light/dark structure but tint every surface toward the brand hue — a blue
// brand gets near-navy panels instead of near-black ones. Only the surfaces
// change; text, brand accents, and danger are unaffected.
//
// The brand-* options are only meaningful when a brand colour actually
// exists. If branding is off (or revoked), they degrade to their neutral
// base rather than rendering a half-applied palette — see `appearance` below.

export type Appearance = "dark" | "light" | "brand-dark" | "brand-light";

/** Legacy alias. The neutral base an appearance sits on. Several call sites
 *  only care whether things are dark or light, not which flavour. */
export type Theme = "dark" | "light";

const LS_KEY = "strider:theme";

const ALL_APPEARANCES: Appearance[] = ["dark", "light", "brand-dark", "brand-light"];

export function isDarkAppearance(a: Appearance): boolean {
  return a === "dark" || a === "brand-dark";
}

export function isBrandAppearance(a: Appearance): boolean {
  return a === "brand-dark" || a === "brand-light";
}

/** Strips the brand tint, keeping the light/dark base. Used when an
 *  appearance asks for a tint that isn't available. */
export function baseOf(a: Appearance): Theme {
  return isDarkAppearance(a) ? "dark" : "light";
}

// Dark stays the default for anyone who hasn't chosen — this is additive, not
// a redesign, so nobody's view changes unless they opt in. Returns null (not
// "dark") for "never chose", because the difference between "chose dark" and
// "never chose" is what lets a coach's suggested default apply at all.
function readStoredAppearance(): Appearance | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(LS_KEY) as Appearance | null;
  return v && ALL_APPEARANCES.includes(v) ? v : null;
}

function applyThemeClass(appearance: Appearance) {
  if (typeof document === "undefined") return;
  // The `.dark` class still governs which base palette styles.css serves.
  // The brand tint is applied separately, as inline CSS variables, by
  // BrandingProvider — so a brand-dark page is "the dark palette, with tinted
  // surfaces layered over it", not a third palette to maintain.
  document.documentElement.classList.toggle("dark", isDarkAppearance(appearance));
}

interface ThemeContextValue {
  /** The appearance actually on screen, after brand rules are applied. */
  appearance: Appearance;
  /** Light/dark base of the above. Most consumers only need this. */
  theme: Theme;
  /** This person's own stored choice, or null if they've never picked one. */
  userAppearance: Appearance | null;
  setAppearance: (a: Appearance) => void;
  /** Flips between the current appearance's light and dark counterpart,
   *  preserving whether the brand tint is on. */
  toggleTheme: () => void;
  /** Appearance nominated by the branded coach, if any. */
  brandAppearance: Appearance | null;
  /** When true, brandAppearance overrides even an explicit personal choice. */
  brandForced: boolean;
  /** True when a brand colour exists, so the brand-* options are offered. */
  brandTintAvailable: boolean;
  /** Called by BrandingProvider once branding resolves. */
  setBrandAppearance: (a: Appearance | null, force: boolean, tintAvailable: boolean) => void;
  /** True when the personal picker is currently overridden by the brand. */
  isLockedByBrand: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [userAppearance, setUserAppearanceState] = useState<Appearance | null>(readStoredAppearance);
  const [brandAppearance, setBrandAppearanceState] = useState<Appearance | null>(null);
  const [brandForced, setBrandForced] = useState(false);
  const [brandTintAvailable, setBrandTintAvailable] = useState(false);

  // Precedence, highest first:
  //   1. A brand appearance the coach has explicitly FORCED — squad consistency.
  //   2. This person's own stored choice                    — personal preference.
  //   3. The brand's suggested default                      — a sensible start
  //      for someone who's never touched the picker.
  //   4. "dark"                                             — the app default.
  // Note 2 sits above 3 deliberately: a nominated default is a starting
  // point, not an override. Only force_theme outranks a real choice.
  const requested: Appearance = brandForced && brandAppearance
    ? brandAppearance
    : (userAppearance ?? brandAppearance ?? "dark");

  // A brand tint with no brand colour behind it would render as an
  // ordinary dark/light page with a couple of stray variables set. Degrade to
  // the neutral base instead — this is what makes a revoked entitlement, or a
  // coach turning branding off, fall back cleanly rather than half-applied.
  const appearance: Appearance =
    isBrandAppearance(requested) && !brandTintAvailable ? baseOf(requested) : requested;

  const theme: Theme = baseOf(appearance);
  const isLockedByBrand = brandForced && !!brandAppearance;

  // Reconciles the DOM class with React state. The very-first-paint value is
  // already set by the blocking inline script in __root.tsx (see RootShell) so
  // there's no flash before this ever runs — this keeps the two in sync from
  // here on (picking live, or the brand preference arriving once the branding
  // query resolves).
  useEffect(() => {
    applyThemeClass(appearance);
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setUserAppearanceState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    const tinted = isBrandAppearance(appearance);
    const nextBase: Theme = isDarkAppearance(appearance) ? "light" : "dark";
    setAppearance(tinted ? (`brand-${nextBase}` as Appearance) : nextBase);
  }, [appearance, setAppearance]);

  const setBrandAppearance = useCallback((next: Appearance | null, force: boolean, tintAvailable: boolean) => {
    setBrandAppearanceState(next);
    setBrandForced(force);
    setBrandTintAvailable(tintAvailable);
  }, []);

  const value = useMemo(
    () => ({
      appearance,
      theme,
      userAppearance,
      setAppearance,
      toggleTheme,
      brandAppearance,
      brandForced,
      brandTintAvailable,
      setBrandAppearance,
      isLockedByBrand,
    }),
    [
      appearance,
      theme,
      userAppearance,
      setAppearance,
      toggleTheme,
      brandAppearance,
      brandForced,
      brandTintAvailable,
      setBrandAppearance,
      isLockedByBrand,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
