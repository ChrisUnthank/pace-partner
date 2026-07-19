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
