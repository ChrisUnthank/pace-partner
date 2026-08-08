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

// The exact set of tokens the brand colour takes over. Kept as one list so
// there's a single place to audit.
//
// --destructive is DELIBERATELY ABSENT. In the stock palette it happens to
// equal --accent-red, which makes it look like it belongs here; it doesn't.
// "Delete this athlete" must read as danger even when the brand colour is
// green, and must not read as danger-coloured chrome when the brand is red.
const BRAND_COLOR_VARS = [
  "--accent-red",
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--chart-1",
] as const;

const BRAND_FOREGROUND_VARS = ["--primary-foreground", "--sidebar-primary-foreground"] as const;

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

/** Applies (or clears) the brand colour on <html>. Inline styles on the
 *  element beat both `:root` and `.dark` class rules on specificity, so this
 *  overrides the design-system palette without touching styles.css — and
 *  clearing it restores the stock palette exactly, with no leftovers. */
export function applyBrandColor(hex: string | null) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (isValidHex(hex)) {
    const fg = readableForeground(hex!);
    BRAND_COLOR_VARS.forEach((v) => el.style.setProperty(v, hex!));
    BRAND_FOREGROUND_VARS.forEach((v) => el.style.setProperty(v, fg));
  } else {
    BRAND_COLOR_VARS.forEach((v) => el.style.removeProperty(v));
    BRAND_FOREGROUND_VARS.forEach((v) => el.style.removeProperty(v));
  }
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
  applyBrandColor(null);
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
    applyBrandColor(branding?.brandColor ?? null);
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
