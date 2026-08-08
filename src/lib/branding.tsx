import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { useTheme, isBrandAppearance, isDarkAppearance, type Appearance } from "@/lib/theme";

// ---------------------------------------------------------------------------
// White-label branding (Update 39)
//
// A premium coach can replace the Strider name, logo, and colours inside the
// authenticated app. Per the Update 38 decision, an athlete is part of their
// coach's brand, so branding CASCADES: that coach's athletes (and their linked
// parents) see it too when they log in.
//
// All of the who-gets-whose-branding logic — and the entitlement check —
// lives server-side in the SECURITY DEFINER `get_effective_branding()` RPC.
// This file deliberately does NOT re-derive any of it. If this returns a
// branding object, the server has already decided the caller is entitled to
// see it; if it returns null, the app renders as plain Strider.
//
// IMPORTANT: this is presentation only. Nothing here gates data access, and
// nothing here should ever be used as a permission check.
// ---------------------------------------------------------------------------

export interface Branding {
  coachUserId: string;
  appName: string | null;
  logoUrl: string | null;
  logoMarkUrl: string | null;
  logoInitials: string | null;
  brandColor: string | null;
  /** Optional second accent. Drives sidebar/nav chrome and --chart-2. */
  secondaryColor: string | null;
  /** Destructive/danger actions. Null falls back to the stock Strider red. */
  dangerColor: string | null;
  defaultTheme: "user" | Appearance;
  forceTheme: boolean;
  supportEmail: string | null;
  /** True when the person looking at it is the coach who owns the brand. */
  isOwner: boolean;
}

/** Cached so the blocking pre-paint script in __root.tsx can apply the brand
 *  before first paint, rather than flashing Strider red on every page load
 *  while the RPC round-trips. Cleared whenever branding resolves to null (and
 *  on sign-out — see AppShell) so a stale brand can't bleed across accounts
 *  on a shared device.
 *
 *  The cache stores the COMPUTED CSS VARIABLE MAPS alongside the raw branding,
 *  so the pre-paint script is a dumb key/value applier. That's deliberate: the
 *  tinting maths below is far too long to duplicate inside an inline <script>
 *  string, and a duplicated copy would silently drift. */
export const BRAND_CACHE_KEY = "strider:brand";

interface CachedBranding extends Branding {
  /** Appearance-independent colour variables (brand, secondary, danger). */
  _vars: Record<string, string>;
  /** Tinted surface variables, keyed by brand appearance. */
  _surfaces: Partial<Record<"brand-dark" | "brand-light", Record<string, string>>>;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidHex(hex: string | null | undefined): boolean {
  return !!hex && HEX_RE.test(hex);
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r0, g0, b0] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r0) h = ((g0 - b0) / d) % 6;
  else if (max === g0) h = (b0 - r0) / d + 2;
  else h = (r0 - g0) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = L - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Relative-luminance pick between white and near-black text for text sitting
 * ON a given colour. Without this, a coach choosing a pale brand (yellow,
 * mint, sky) gets invisible white text on every primary button and badge.
 */
export function readableForeground(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#111111" : "#ffffff";
}

/** Rough WCAG-ish contrast ratio against white, used only to warn a coach in
 *  the editor that their chosen colour will be hard to read. Not a hard block
 *  — some brands genuinely are pale, and the foreground flip above already
 *  handles the worst of it. */
export function contrastRatioWithWhite(hex: string): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  const L = 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  return 1.05 / (L + 0.05);
}

/** Perceptual-ish distance between two hex colours, 0-441. Used to warn when
 *  the danger colour is too close to the brand colour to read as a different
 *  thing. Plain RGB euclidean rather than a proper Lab deltaE — this only has
 *  to catch "these are basically the same red". */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// ---------------------------------------------------------------------------
// Variable maps
// ---------------------------------------------------------------------------

// Every variable this module is allowed to set. Kept as one list because it's
// also the CLEAR list — anything not enumerated here would be left stranded on
// <html> when branding is turned off, which is exactly how a "brand won't go
// away after I disabled it" bug happens.
const MANAGED_VARS = [
  // primary
  "--accent-red", "--primary", "--ring", "--chart-1",
  "--primary-foreground",
  // secondary → sidebar/nav chrome + second chart series
  "--sidebar-primary", "--sidebar-ring", "--chart-2",
  "--brand-secondary", "--brand-secondary-foreground", "--sidebar-primary-foreground",
  // danger
  "--destructive", "--destructive-foreground",
  // tinted surfaces
  "--background", "--foreground",
  "--card", "--card-foreground",
  "--popover", "--popover-foreground",
  "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground",
  "--accent", "--accent-foreground",
  "--border", "--input",
  "--sidebar", "--sidebar-foreground",
  "--sidebar-accent", "--sidebar-accent-foreground",
  "--sidebar-border",
] as const;

/**
 * The appearance-independent colour variables.
 *
 * PRIMARY drives buttons, CTAs, the focus ring, and the first chart series.
 *
 * SECONDARY drives the SIDEBAR AND NAV CHROME plus the second chart series —
 * the same primary-CTA / secondary-chrome split the public coach page already
 * uses. When no secondary is set it simply repeats the primary, so a
 * single-colour brand looks exactly as it did before.
 *
 * DANGER is separate from both. A delete button has to stay distinguishable
 * from ordinary branded chrome, which it can't if it shares a token with the
 * brand — that's the whole reason this isn't just "--destructive follows
 * --primary".
 */
export function buildBrandVars(b: Pick<Branding, "brandColor" | "secondaryColor" | "dangerColor">): Record<string, string> {
  const out: Record<string, string> = {};

  if (isValidHex(b.brandColor)) {
    const p = b.brandColor!;
    const fg = readableForeground(p);
    out["--accent-red"] = p;
    out["--primary"] = p;
    out["--ring"] = p;
    out["--chart-1"] = p;
    out["--primary-foreground"] = fg;
    // Secondary falls back to primary, so these are always defined once a
    // primary exists — they're overwritten just below if a secondary is set.
    out["--sidebar-primary"] = p;
    out["--sidebar-ring"] = p;
    out["--sidebar-primary-foreground"] = fg;
    out["--brand-secondary"] = p;
    out["--brand-secondary-foreground"] = fg;
  }

  if (isValidHex(b.secondaryColor)) {
    const s = b.secondaryColor!;
    const fg = readableForeground(s);
    out["--sidebar-primary"] = s;
    out["--sidebar-ring"] = s;
    out["--sidebar-primary-foreground"] = fg;
    out["--brand-secondary"] = s;
    out["--brand-secondary-foreground"] = fg;
    out["--chart-2"] = s;
  }

  if (isValidHex(b.dangerColor)) {
    const d = b.dangerColor!;
    out["--destructive"] = d;
    out["--destructive-foreground"] = readableForeground(d);
  }

  return out;
}

/**
 * Brand Dark / Brand Light surface palette.
 *
 * Takes the brand's HUE and rebuilds the neutral surface ladder around it at
 * heavily reduced saturation, so a blue brand gives near-navy panels rather
 * than a saturated blue page. The lightness values mirror the existing oklch
 * ladder in styles.css so spacing and hierarchy between background / card /
 * border stay exactly where they were — only the hue moves.
 *
 * Saturation is CAPPED, not scaled from the brand: a neon brand and a muted
 * one produce equally restrained surfaces. A greyscale brand (saturation 0)
 * produces an identical result to the neutral palette, which is correct.
 */
export function buildSurfaceVars(brandHex: string, dark: boolean): Record<string, string> {
  const { h, s } = hexToHsl(brandHex);
  // Cap first, then scale. Light surfaces need MORE saturation than dark ones,
  // not less — the first pass at this used a lower multiplier for light and
  // the result was indistinguishable from plain white. Near-white values have
  // very little room to carry hue, so they need the extra saturation just to
  // read as tinted at all.
  const base = Math.min(s, 45);
  const surf = dark ? base * 0.40 : base * 0.62;
  const text = dark ? base * 0.12 : base * 0.16;

  const C = (l: number) => hslToHex(h, surf, l);
  const T = (l: number) => hslToHex(h, text, l);

  if (dark) {
    return {
      "--background": C(7),
      "--foreground": T(97),
      "--card": C(12),
      "--card-foreground": T(97),
      "--popover": C(12),
      "--popover-foreground": T(97),
      "--secondary": C(16),
      "--secondary-foreground": T(97),
      "--muted": C(14),
      "--muted-foreground": T(62),
      "--accent": C(16),
      "--accent-foreground": T(97),
      "--border": C(21),
      "--input": C(21),
      "--sidebar": C(9),
      "--sidebar-foreground": T(97),
      "--sidebar-accent": C(15),
      "--sidebar-accent-foreground": T(97),
      "--sidebar-border": C(21),
    };
  }
  // Note the card ceiling is 99, not 100: HSL lightness 100 is pure white
  // whatever the hue, so a card at 100 would silently drop the tint and make
  // Brand Light identical to plain Light on every panel in the app.
  return {
    "--background": C(96),
    "--foreground": T(13),
    "--card": C(99),
    "--card-foreground": T(13),
    "--popover": C(99),
    "--popover-foreground": T(13),
    "--secondary": C(94),
    "--secondary-foreground": T(13),
    "--muted": C(92),
    "--muted-foreground": T(43),
    "--accent": C(94),
    "--accent-foreground": T(13),
    "--border": C(86),
    "--input": C(86),
    "--sidebar": C(94),
    "--sidebar-foreground": T(13),
    "--sidebar-accent": C(90),
    "--sidebar-accent-foreground": T(13),
    "--sidebar-border": C(86),
  };
}

/** Applies a computed variable map to <html>, clearing anything managed that
 *  isn't in it. Inline styles on the element beat both `:root` and `.dark`
 *  class rules on specificity, so this overrides the design-system palette
 *  without touching styles.css — and clearing restores the stock palette
 *  exactly, with no leftovers. */
export function applyVars(vars: Record<string, string>) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  MANAGED_VARS.forEach((v) => {
    const next = vars[v];
    if (next) el.style.setProperty(v, next);
    else el.style.removeProperty(v);
  });
}

/** The full variable set for a given branding + appearance combination. */
export function resolveVars(b: Branding | null, appearance: Appearance): Record<string, string> {
  if (!b) return {};
  const vars = buildBrandVars(b);
  if (isBrandAppearance(appearance) && isValidHex(b.brandColor)) {
    Object.assign(vars, buildSurfaceVars(b.brandColor!, isDarkAppearance(appearance)));
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function cacheBranding(b: Branding | null) {
  if (typeof window === "undefined") return;
  try {
    if (!b) {
      window.localStorage.removeItem(BRAND_CACHE_KEY);
      return;
    }
    const payload: CachedBranding = {
      ...b,
      _vars: buildBrandVars(b),
      _surfaces: isValidHex(b.brandColor)
        ? {
            "brand-dark": buildSurfaceVars(b.brandColor!, true),
            "brand-light": buildSurfaceVars(b.brandColor!, false),
          }
        : {},
    };
    window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota — the app still works, it just flashes on load */
  }
}

export function clearBrandingCache() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(BRAND_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
  applyVars({});
}

export function readCachedBranding(): Branding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Branding) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface BrandingContextValue {
  branding: Branding | null;
  /** True once a real, entitled, enabled brand has been resolved. */
  isBranded: boolean;
  /** What to call the product in chrome — brand name, or "Strider". */
  appName: string;
  /** Non-removable attribution is shown whenever branding is active. */
  showPoweredBy: boolean;
  isLoading: boolean;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthUser();
  const { setBrandAppearance, appearance } = useTheme();

  const { data, isLoading } = useQuery({
    queryKey: ["effective-branding", user?.id],
    enabled: !!user,
    // Branding changes rarely and repaints the whole app when it does, so
    // there's no reason to refetch it on every window focus.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Seeded from the pre-paint cache so the very first render already has
    // the right name/logo instead of rendering "Strider" for one frame.
    initialData: () => readCachedBranding() ?? undefined,
    // Treat the cache as already stale so it paints instantly on mount but
    // still revalidates straight away. Without this, initialData counts as
    // fresh-as-of-now and staleTime above would keep a just-revoked or
    // just-changed brand on screen for five minutes.
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_effective_branding");
      if (error) throw error;
      return (data as Branding | null) ?? null;
    },
  });

  const branding = (data ?? null) as Branding | null;
  const isBranded = !!branding;

  // Persist. Runs on every change, including the change to null when a coach
  // turns branding off or an entitlement lapses.
  useEffect(() => {
    if (isLoading && !branding) return;
    cacheBranding(branding);
  }, [branding, isLoading]);

  // Paint. Depends on appearance as well as branding, because the tinted
  // surface palette differs between Brand Dark and Brand Light — switching
  // appearance has to recompute, not just toggle a class.
  useEffect(() => {
    if (isLoading && !branding) return;
    applyVars(resolveVars(branding, appearance));
  }, [branding, appearance, isLoading]);

  // Hand the brand's appearance preference to the theme layer. Precedence
  // between this and the person's own choice is resolved there, not here.
  useEffect(() => {
    const t = branding?.defaultTheme;
    const brandAppearance =
      t === "dark" || t === "light" || t === "brand-dark" || t === "brand-light" ? (t as Appearance) : null;
    setBrandAppearance(brandAppearance, !!branding?.forceTheme, isValidHex(branding?.brandColor));
  }, [branding?.defaultTheme, branding?.forceTheme, branding?.brandColor, setBrandAppearance]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      isBranded,
      appName: branding?.appName?.trim() || "Strider",
      showPoweredBy: isBranded,
      isLoading,
    }),
    [branding, isBranded, isLoading],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/** Safe to call outside the provider (e.g. on public/marketing routes) —
 *  falls back to plain Strider rather than throwing, since branding is
 *  cosmetic and a missing provider shouldn't take a page down. */
export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (ctx) return ctx;
  return { branding: null, isBranded: false, appName: "Strider", showPoweredBy: false, isLoading: false };
}
