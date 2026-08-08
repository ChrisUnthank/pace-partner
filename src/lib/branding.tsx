import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { useTheme, type Theme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// White-label branding (Update 39)
//
// A premium coach can replace the Strider name, logo, and brand colour inside
// the authenticated app. Per the Update 38 decision, an athlete is part of
// their coach's brand, so branding CASCADES: that coach's athletes (and their
// linked parents) see it too when they log in.
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
  /** Optional accent. Drives --brand-secondary and --chart-2. */
  secondaryColor: string | null;
  /** Destructive/danger actions. Null falls back to the stock Strider red. */
  dangerColor: string | null;
  defaultTheme: "user" | "dark" | "light";
  forceTheme: boolean;
  supportEmail: string | null;
  /** True when the person looking at it is the coach who owns the brand. */
  isOwner: boolean;
}

/** Cached so the blocking pre-paint script in __root.tsx can apply the brand
 *  before first paint, rather than flashing Strider red on every page load
 *  while the RPC round-trips. Cleared whenever branding resolves to null (and
 *  on sign-out — see AppShell) so a stale brand can't bleed across accounts
 *  on a shared device. */
export const BRAND_CACHE_KEY = "strider:brand";

// The exact sets of tokens each configured colour takes over. Kept as lists so
// there's a single place to audit what a brand can and can't repaint.
//
// --destructive is NOT in the primary list. Danger is its own colour (see
// DANGER_* below): a delete button has to stay distinguishable from ordinary
// branded chrome, which a shared token can't guarantee.
const BRAND_COLOR_VARS = [
  "--accent-red",
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--chart-1",
] as const;

const BRAND_FOREGROUND_VARS = ["--primary-foreground", "--sidebar-primary-foreground"] as const;

// Secondary accent. --brand-secondary is a token added in styles.css for this
// (usable as `bg-brand-secondary`); --chart-2 is the existing "second series"
// slot. Deliberately NOT --secondary, which is shadcn's muted SURFACE token —
// a bright colour there would repaint every secondary button solid.
const SECONDARY_COLOR_VARS = ["--brand-secondary", "--chart-2"] as const;
const SECONDARY_FOREGROUND_VARS = ["--brand-secondary-foreground"] as const;

// Danger. Defaults to Strider red when unset, which is what the stock palette
// already resolves to — so leaving it blank changes nothing.
const DANGER_COLOR_VARS = ["--destructive"] as const;
const DANGER_FOREGROUND_VARS = ["--destructive-foreground"] as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidHex(hex: string | null | undefined): boolean {
  return !!hex && HEX_RE.test(hex);
}

/**
 * Relative-luminance pick between white and near-black text for text sitting
 * ON the brand colour. Without this, a coach choosing a pale brand (yellow,
 * mint, sky) gets invisible white text on every primary button and badge.
 *
 * NOTE: the same calculation is duplicated, inlined, in the pre-paint script
 * in __root.tsx. It has to be — that script runs before any module loads.
 * If the threshold changes here, change it there too.
 */
export function readableForeground(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#111111" : "#ffffff";
}

/** Rough WCAG-ish contrast ratio, used only to warn a coach in the editor
 *  that their chosen colour will be hard to read. Not a hard block — some
 *  brands genuinely are pale, and the foreground flip above already handles
 *  the worst of it. */
export function contrastRatioWithWhite(hex: string): number {
  const h = hex.replace("#", "");
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * chan(parseInt(h.slice(0, 2), 16)) +
    0.7152 * chan(parseInt(h.slice(2, 4), 16)) +
    0.0722 * chan(parseInt(h.slice(4, 6), 16));
  return (1.0 + 0.05) / (L + 0.05);
}

/** Perceptual-ish distance between two hex colours, 0-441. Used to warn a
 *  coach when their danger colour is too close to their brand colour to read
 *  as a different thing. Plain RGB euclidean rather than a proper Lab deltaE —
 *  this only has to catch "these are basically the same red", and a real
 *  colour-science dependency isn't worth it for a warning string. */
export function colorDistance(a: string, b: string): number {
  const rgb = (h: string) => {
    const x = h.replace("#", "");
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function setOrClear(
  vars: readonly string[],
  fgVars: readonly string[],
  hex: string | null | undefined,
) {
  const el = document.documentElement;
  if (isValidHex(hex)) {
    const fg = readableForeground(hex!);
    vars.forEach((v) => el.style.setProperty(v, hex!));
    fgVars.forEach((v) => el.style.setProperty(v, fg));
  } else {
    vars.forEach((v) => el.style.removeProperty(v));
    fgVars.forEach((v) => el.style.removeProperty(v));
  }
}

/** Applies (or clears) all three brand colours on <html>. Inline styles on the
 *  element beat both `:root` and `.dark` class rules on specificity, so this
 *  overrides the design-system palette without touching styles.css — and
 *  clearing it restores the stock palette exactly, with no leftovers.
 *
 *  Each colour clears independently: a coach who sets a primary but no
 *  secondary gets the stock secondary back, not a stale one from a previous
 *  save. */
export function applyBrandColors(b: Pick<Branding, "brandColor" | "secondaryColor" | "dangerColor"> | null) {
  if (typeof document === "undefined") return;
  setOrClear(BRAND_COLOR_VARS, BRAND_FOREGROUND_VARS, b?.brandColor);
  setOrClear(SECONDARY_COLOR_VARS, SECONDARY_FOREGROUND_VARS, b?.secondaryColor);
  setOrClear(DANGER_COLOR_VARS, DANGER_FOREGROUND_VARS, b?.dangerColor);
}

export function cacheBranding(b: Branding | null) {
  if (typeof window === "undefined") return;
  try {
    if (b) window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(b));
    else window.localStorage.removeItem(BRAND_CACHE_KEY);
  } catch {
    /* private mode / quota — the app still works, it just flashes on load */
  }
}

export function clearBrandingCache() {
  cacheBranding(null);
  applyBrandColors(null);
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
  const { setBrandTheme } = useTheme();

  const { data, isLoading } = useQuery({
    queryKey: ["effective-branding", user?.id],
    enabled: !!user,
    // Branding changes rarely and repaints the whole app when it does, so
    // there's no reason to refetch it on every window focus.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Seeded from the pre-paint cache so the very first render already has
    // the right name/logo instead of rendering "Strider" for one frame and
    // then swapping.
    initialData: () => readCachedBranding() ?? undefined,
    // Treat the cache as already stale so it paints instantly on mount but
    // still revalidates against the server straight away. Without this,
    // initialData counts as fresh-as-of-now and staleTime above would keep a
    // just-revoked or just-changed brand on screen for five minutes.
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_effective_branding");
      if (error) throw error;
      return (data as Branding | null) ?? null;
    },
  });

  const branding = (data ?? null) as Branding | null;
  const isBranded = !!branding;

  // Persist + paint. Runs on every change, including the change to null when
  // a coach turns branding off or an entitlement lapses — which is what
  // actually restores the stock palette rather than leaving it stuck.
  useEffect(() => {
    if (isLoading && !branding) return;
    cacheBranding(branding);
    applyBrandColors(branding);
  }, [branding, isLoading]);

  // Hand the brand's appearance preference to the theme layer. Precedence
  // between this and the person's own choice is resolved there, not here.
  useEffect(() => {
    const t = branding?.defaultTheme;
    const brandTheme: Theme | null = t === "dark" || t === "light" ? t : null;
    setBrandTheme(brandTheme, !!branding?.forceTheme);
  }, [branding?.defaultTheme, branding?.forceTheme, setBrandTheme]);

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
