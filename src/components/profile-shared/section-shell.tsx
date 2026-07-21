// section-shell.tsx
// Genuinely generic pieces shared between CoachProfilePage.tsx and
// AthleteProfilePage.tsx — extracted here because they don't reference
// anything coach- or athlete-specific, so duplicating them would just be
// two copies of the same code drifting apart over time.
//
// Deliberately NOT included here: nav chrome (header/sidebar/footer/
// mobile sheet/dev controls). Those differ enough between a coach page
// (team logo, "Send inquiry" CTA) and an athlete page (personal photo,
// "Support" CTA) that forcing them through one shared component right
// now would mean guessing at the right abstraction boundary from a
// single example. Once both pages have been live for a bit and the real
// differences are obvious, that's the natural next extraction — flagged,
// not done blindly here.

import type React from "react";
import { Mail, Phone, AtSign, Globe } from "lucide-react";

// Minimal structural shape both CoachConfig and AthleteConfig already
// satisfy — TypeScript checks this by shape, not by name, so neither
// config type needs to import or extend anything from here.
export interface ProfileThemeVars {
  brandColor: string;
  secondaryColor?: string;
  density: "comfortable" | "compact";
}

// Simple luminance check so `--on-brand` stays readable against any brand color.
export function onColorFor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#FFFFFF";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#17181A" : "#FFFFFF";
}

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function computeRootVars(config: ProfileThemeVars): React.CSSProperties {
  return {
    "--brand": config.brandColor,
    "--on-brand": onColorFor(config.brandColor),
    "--brand-secondary": config.secondaryColor || config.brandColor,
    "--on-brand-secondary": onColorFor(config.secondaryColor || config.brandColor),
    ...(config.density === "compact" ? { "--section-py": "2.5rem" } : {}),
  } as React.CSSProperties;
}

// Every content section renders through this: a full-width <section> (so
// its background — normal or --bg-alt — spans edge to edge) with a
// constrained inner wrapper (so content lines up under the header/nav).
// "strip" is for thin, border-top strips with fixed padding (Stats,
// Sponsors-style rows); "section" is everything else.
export function SectionShell({
  id,
  altBg,
  variant = "section",
  noBorderBottom,
  children,
}: {
  id?: string;
  altBg?: boolean;
  variant?: "section" | "strip";
  noBorderBottom?: boolean;
  children: React.ReactNode;
}) {
  const inner = <div className="mx-auto max-w-6xl px-4 md:px-8 xl:max-w-7xl 2xl:max-w-[100rem]">{children}</div>;
  if (variant === "strip") {
    return (
      <section
        id={id}
        className="border-t coach-divider py-10"
        style={altBg ? { background: "var(--bg-alt)" } : undefined}
      >
        {inner}
      </section>
    );
  }
  return (
    <section
      id={id}
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: noBorderBottom ? undefined : "1px solid var(--border)",
        ...(altBg ? { background: "var(--bg-alt)" } : {}),
      }}
    >
      {inner}
    </section>
  );
}

export function SectionHeading({ children, centered }: { children: React.ReactNode; centered?: boolean }) {
  return <h2 className={`coach-heading mb-8 text-2xl md:text-3xl ${centered ? "text-center" : ""}`}>{children}</h2>;
}

// Shared gallery layout helpers — used by both Coach and Athlete pages'
// Gallery section so the columns/aspect/reposition mechanism can't drift
// between the two.
export function galleryGridClass(columns: 2 | 3 | 4): string {
  // Always 2-up on the smallest screens regardless of the chosen column
  // count — 3 or 4 columns on a phone would make each tile too small to
  // be worth showing.
  switch (columns) {
    case 2:
      return "grid grid-cols-2 gap-3";
    case 4:
      return "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4";
    default:
      return "grid grid-cols-2 gap-3 md:grid-cols-3";
  }
}

export function galleryAspectClass(aspect: "square" | "portrait" | "landscape" | "auto"): string {
  switch (aspect) {
    case "portrait":
      return "aspect-[3/4]";
    case "landscape":
      return "aspect-[4/3]";
    case "auto":
      return ""; // natural aspect ratio, no crop — image sizes itself
    default:
      return "aspect-square";
  }
}

export function galleryImagePosition(
  positions: Record<string, { x: number; y: number }>,
  url: string,
): { x: number; y: number } {
  return positions[url] ?? { x: 50, y: 50 };
}

// ---------------------------------------------------------------------------
// Contact / social links — genuinely shared between both pages, same
// reasoning as everything else in this file. Structural typing again (see
// ProfileThemeVars above): both CoachConfig["contact"] and
// AthleteConfig["contact"] satisfy this shape without needing to import
// or extend anything from here.
//
// Deliberately no brand-mark icons — matches the existing convention
// already in place (Instagram uses a plain AtSign glyph, Strava uses a
// plain "S" badge, not their logos) rather than introducing a different
// visual language for the new platforms.
// ---------------------------------------------------------------------------
export interface ProfileContactLinks {
  email?: string;
  phone?: string;
  instagram?: string; // handle, with or without leading @
  strava?: string; // full profile URL
  facebook?: string; // full page URL
  twitter?: string; // handle, with or without leading @ (x.com)
  youtube?: string; // full channel URL
  tiktok?: string; // handle, with or without leading @
  website?: string; // full URL
}

function PlatformBadge({ letters }: { letters: string }) {
  return (
    <span className="h-4 w-4 shrink-0 text-center text-xs font-bold" style={{ color: "var(--brand)" }}>
      {letters}
    </span>
  );
}

const linkClass = "flex items-center gap-2 hover:opacity-70";

export function ContactLinks({ contact }: { contact: ProfileContactLinks }) {
  return (
    <div className="space-y-2 text-sm">
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={linkClass}>
          <Mail className="h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} /> {contact.email}
        </a>
      )}
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={linkClass}>
          <Phone className="h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} /> {contact.phone}
        </a>
      )}
      {contact.instagram && (
        <a
          href={`https://instagram.com/${contact.instagram.replace(/^@/, "")}`}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          <AtSign className="h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} /> {contact.instagram}
        </a>
      )}
      {contact.facebook && (
        <a href={contact.facebook} target="_blank" rel="noreferrer" className={linkClass}>
          <PlatformBadge letters="f" /> Facebook
        </a>
      )}
      {contact.twitter && (
        <a
          href={`https://x.com/${contact.twitter.replace(/^@/, "")}`}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          <PlatformBadge letters="X" /> {contact.twitter}
        </a>
      )}
      {contact.youtube && (
        <a href={contact.youtube} target="_blank" rel="noreferrer" className={linkClass}>
          <PlatformBadge letters="YT" /> YouTube
        </a>
      )}
      {contact.tiktok && (
        <a
          href={`https://tiktok.com/@${contact.tiktok.replace(/^@/, "")}`}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          <PlatformBadge letters="TT" /> {contact.tiktok}
        </a>
      )}
      {contact.strava && (
        <a href={contact.strava} target="_blank" rel="noreferrer" className={linkClass}>
          <PlatformBadge letters="S" /> Strava
        </a>
      )}
      {contact.website && (
        <a href={contact.website} target="_blank" rel="noreferrer" className={linkClass}>
          <Globe className="h-4 w-4 shrink-0" style={{ color: "var(--brand)" }} /> Website
        </a>
      )}
    </div>
  );
}

// True if any contact/social field has a value — shared by both pages'
// nav-visibility and section early-return checks, so a page with e.g.
// only TikTok filled in (no email/instagram/strava) doesn't silently
// hide its own contact section or nav link.
export function hasAnyContactLink(contact: ProfileContactLinks): boolean {
  return !!(
    contact.email ||
    contact.phone ||
    contact.instagram ||
    contact.strava ||
    contact.facebook ||
    contact.twitter ||
    contact.youtube ||
    contact.tiktok ||
    contact.website
  );
}
