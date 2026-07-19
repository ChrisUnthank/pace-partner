import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Menu, Mail, AtSign as Instagram, Heart, Trophy, X } from "lucide-react";
import { SECTION_ORDER_LABELS, type AthleteConfig } from "./athlete-config";
import {
  SectionShell,
  SectionHeading,
  scrollToSection,
  computeRootVars,
} from "@/components/profile-shared/section-shell";
// Reuses the coach page's CSS tokens as-is — same [data-coach-root] theme
// system (light/dark × modern/traditional), just applied to a
// [data-athlete-root] wrapper. See the note on the root element below for
// why the selector name stays "coach-root" rather than being renamed.
import "@/components/coach-profile/coach-profile-tokens.css";

const NAV_EXCLUDED = new Set(["stats", "sponsors", "donate"]);

function isSectionOn(config: AthleteConfig, key: string): boolean {
  return !!(config.sections as Record<string, boolean>)[key];
}

const SECTION_HAS_CONTENT: Record<string, (config: AthleteConfig) => boolean> = {
  stats: (c) => c.stats.length > 0,
  about: (c) => !!(c.bio || c.achievements.length),
  goal: (c) => !!c.goal,
  results: (c) => c.personalBests.length > 0 || c.recentResults.length > 0,
  trainingPartners: (c) => c.trainingPartners.length > 0,
  gallery: (c) => c.galleryImages.length > 0,
  blog: (c) => c.blogPosts.length > 0,
  sponsors: (c) => c.sponsors.length > 0,
  donate: (c) => !!c.donate,
  contact: (c) => !!(c.contact.email || c.contact.instagram || c.contact.strava),
};
function sectionHasContent(config: AthleteConfig, key: string): boolean {
  return SECTION_HAS_CONTENT[key]?.(config) ?? true;
}

function visibleSections(config: AthleteConfig) {
  const items = config.sectionOrder
    .filter((key) => !NAV_EXCLUDED.has(key))
    .filter((key) => isSectionOn(config, key) && sectionHasContent(config, key))
    .map((key) => ({ id: key, label: SECTION_ORDER_LABELS[key as keyof typeof SECTION_ORDER_LABELS] ?? key }));
  return [{ id: "home", label: "Home" }, ...items];
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const secStr = s < 10 ? `0${s.toFixed(s % 1 ? 1 : 0)}` : s.toFixed(s % 1 ? 1 : 0);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${secStr}`;
  return `${m}:${secStr}`;
}
function formatDistance(m: number): string {
  if (m === 1609) return "Mile";
  if (m % 1000 === 0) return `${m / 1000}k`;
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}k`;
}

export interface AthleteProfilePageProps {
  config: AthleteConfig;
  showDevControls?: boolean;
  onConfigChange?: (next: AthleteConfig) => void;
  /** Same reasoning as CoachProfilePage's isOwnerPreview — the athlete
   * (or their coach) viewing their own unpublished page still sees it;
   * the public route decides who counts as the owner, not this component. */
  isOwnerPreview?: boolean;
}

export function AthleteProfilePage({
  config,
  showDevControls,
  onConfigChange,
  isOwnerPreview,
}: AthleteProfilePageProps) {
  const rootVars = useMemo(
    () => computeRootVars(config),
    [config.brandColor, config.secondaryColor, config.density],
  );

  return (
    <div
      // Reuses coach-profile-tokens.css's [data-coach-root] selector on
      // purpose rather than a separate [data-athlete-root] stylesheet —
      // it's the exact same theme system (same CSS variable names,
      // same light/dark × modern/traditional axes), and duplicating that
      // file just to rename the attribute would be a second copy to keep
      // in sync for zero benefit. If the two pages' visual language ever
      // needs to diverge, that's the point to fork the CSS file too.
      data-coach-root
      data-theme={config.theme}
      data-style={config.style}
      data-nav={config.nav}
      style={rootVars}
      className="min-h-screen"
    >
      {showDevControls && <DevControls config={config} onChange={onConfigChange} />}

      {!config.isPublished && !isOwnerPreview ? (
        <UnpublishedPlaceholder config={config} />
      ) : config.nav === "sidebar" ? (
        <SidebarLayout config={config} />
      ) : (
        <TopNavLayout config={config} />
      )}
    </div>
  );
}

function UnpublishedPlaceholder({ config }: { config: AthleteConfig }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo config={config} />
      <div className="coach-heading mt-6 text-xl">{config.name}'s page isn't published yet</div>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        Check back soon.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav shells
// ---------------------------------------------------------------------------

function TopNavLayout({ config }: { config: AthleteConfig }) {
  return (
    <div>
      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8 xl:max-w-7xl 2xl:max-w-[100rem]">
          <Logo config={config} showName />
          <nav className="hidden items-center gap-6 md:flex">
            {visibleSections(config).map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className="text-sm hover:opacity-70"
                style={{ color: "var(--text-secondary)" }}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="hidden md:block">
            <ContactCTA config={config} />
          </div>
          <MobileNavSheet config={config} />
        </div>
      </header>
      <main>
        <PageSections config={config} />
      </main>
      <Footer config={config} />
    </div>
  );
}

function SidebarLayout({ config }: { config: AthleteConfig }) {
  return (
    <div className="md:flex">
      <div
        className="flex items-center justify-between border-b px-4 py-3 md:hidden"
        style={{ borderColor: "var(--border)" }}
      >
        <Logo config={config} />
        <MobileNavSheet config={config} />
      </div>

      <aside
        className="hidden w-64 shrink-0 flex-col justify-between border-r px-6 py-8 md:sticky md:top-0 md:flex md:h-screen"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <Logo config={config} showName />
          <nav className="mt-10 flex flex-col gap-4">
            {visibleSections(config).map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className="text-left text-sm hover:opacity-70"
                style={{ color: "var(--text-secondary)" }}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
        <ContactCTA config={config} fullWidth />
      </aside>

      <main className="min-w-0 flex-1">
        <PageSections config={config} />
        <Footer config={config} />
      </main>
    </div>
  );
}

function Logo({ config, showName }: { config: AthleteConfig; showName?: boolean }) {
  const initials = config.name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-2">
      {config.photoUrl ? (
        <img
          src={config.photoUrl}
          alt={config.name}
          className="h-9 w-9 rounded-full object-cover"
          style={{ border: "1px solid var(--border)" }}
        />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: "var(--brand)", color: "var(--on-brand)" }}
        >
          {initials}
        </div>
      )}
      {showName && <span className="coach-heading text-sm">{config.name}</span>}
    </div>
  );
}

// "Contact" here just scrolls to the Contact section (or, if it's hidden,
// falls through to the mailto link directly) — unlike the coach page,
// there's no inquiry form to jump to, so this is a link/scroll, not a
// button that opens a form.
function ContactCTA({ fullWidth }: { config?: AthleteConfig; fullWidth?: boolean }) {
  return (
    <Button
      onClick={() => scrollToSection("contact")}
      className={fullWidth ? "w-full" : ""}
      style={{ background: "var(--brand)", color: "var(--on-brand)", borderRadius: "var(--radius-sm)" }}
    >
      Get in touch
    </Button>
  );
}

function MobileNavSheet({ config }: { config: AthleteConfig }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
        <nav className="mt-10 flex flex-col gap-5">
          {visibleSections(config).map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setOpen(false);
                scrollToSection(s.id);
              }}
              className="text-left text-base"
            >
              {s.label}
            </button>
          ))}
          <ContactCTA fullWidth />
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function PageSections({ config }: { config: AthleteConfig }) {
  return (
    <>
      <Hero config={config} />
      <StripedSections config={config} />
    </>
  );
}

const SECTION_NODE_REGISTRY: Record<
  string,
  (config: AthleteConfig, altBg: boolean, isLast: boolean) => React.ReactNode
> = {
  stats: (config, altBg) => <Stats config={config} altBg={altBg} />,
  about: (config, altBg, isLast) => <About config={config} altBg={altBg} isLast={isLast} />,
  goal: (config, altBg, isLast) => <CurrentGoal config={config} altBg={altBg} isLast={isLast} />,
  results: (config, altBg, isLast) => <Results config={config} altBg={altBg} isLast={isLast} />,
  trainingPartners: (config, altBg, isLast) => <TrainingPartners config={config} altBg={altBg} isLast={isLast} />,
  gallery: (config, altBg, isLast) => <Gallery config={config} altBg={altBg} isLast={isLast} />,
  blog: (config, altBg, isLast) => <Blog config={config} altBg={altBg} isLast={isLast} />,
  sponsors: (config, altBg) => <Sponsors config={config} altBg={altBg} />,
  donate: (config, altBg) => <Donate config={config} altBg={altBg} />,
  contact: (config, altBg, isLast) => <Contact config={config} altBg={altBg} isLast={isLast} />,
};

function StripedSections({ config }: { config: AthleteConfig }) {
  const visibleKeys = config.sectionOrder.filter((key) => isSectionOn(config, key) && sectionHasContent(config, key));
  return (
    <>
      {visibleKeys.map((key, i) => {
        const render = SECTION_NODE_REGISTRY[key];
        if (!render) return null;
        const altBg = config.alternateSectionBackgrounds && i % 2 === 1;
        const isLast = i === visibleKeys.length - 1;
        return <div key={key}>{render(config, altBg, isLast)}</div>;
      })}
    </>
  );
}

function Hero({ config }: { config: AthleteConfig }) {
  const modern = config.style === "modern";
  const imageLeft = modern && config.heroImageSide === "left";
  const heroGridCols = imageLeft ? "md:grid-cols-[1fr_1.1fr]" : "md:grid-cols-[1.1fr_1fr]";
  return (
    <section
      id="home"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 md:px-8 xl:max-w-7xl 2xl:max-w-[100rem]">
        <div className={modern ? `grid items-center gap-10 ${heroGridCols}` : ""}>
          {!modern && config.heroImageUrl && (
            <div className="relative mb-10">
              <img
                src={config.heroImageUrl}
                alt={config.name}
                className="coach-hero-image h-56 w-full object-cover sm:h-72 md:h-96"
              />
              {config.photoUrl && (
                <img
                  src={config.photoUrl}
                  alt={config.name}
                  className="absolute -bottom-6 left-1/2 h-16 w-16 -translate-x-1/2 border-4 object-cover sm:-bottom-8 sm:h-20 sm:w-20"
                  style={{ borderRadius: "999px", borderColor: "var(--bg)" }}
                />
              )}
            </div>
          )}
          <div
            className={
              modern
                ? imageLeft
                  ? "md:order-2"
                  : ""
                : "mx-auto max-w-3xl lg:max-w-4xl px-4 pt-6 text-center sm:px-0"
            }
          >
            {config.primaryEvent && (
              <div className="coach-heading mb-1 text-sm uppercase tracking-wide" style={{ color: "var(--brand)" }}>
                {config.primaryEvent}
              </div>
            )}
            <h1 className="coach-heading text-3xl sm:text-4xl md:text-5xl">{config.name}</h1>
            <p className="mt-4 text-lg" style={{ color: "var(--text-secondary)" }}>
              {config.tagline}
            </p>
            <div className={`mt-5 flex flex-wrap gap-2 ${modern ? "" : "justify-center"}`}>
              {config.disciplines.map((d) => (
                <span key={d} className="coach-tag px-3 py-1 text-xs font-medium">
                  {d}
                </span>
              ))}
            </div>
            <div className={`mt-8 flex flex-wrap gap-3 ${modern ? "" : "justify-center"}`}>
              <ContactCTA />
              {config.donate && (
                <Button
                  variant="outline"
                  onClick={() => scrollToSection("donate")}
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--brand-secondary)",
                    borderColor: "var(--brand-secondary)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <Heart className="mr-2 h-4 w-4" /> Support
                </Button>
              )}
            </div>
          </div>
          {modern && config.heroImageUrl && (
            <div className={`relative ${imageLeft ? "md:order-1" : ""}`}>
              <img
                src={config.heroImageUrl}
                alt={config.name}
                className="coach-hero-image h-72 w-full object-cover md:h-[26rem]"
              />
              {config.photoUrl && (
                <img
                  src={config.photoUrl}
                  alt={config.name}
                  className={`absolute -bottom-6 h-20 w-20 border-4 object-cover ${imageLeft ? "-right-6" : "-left-6"}`}
                  style={{ borderRadius: "var(--radius)", borderColor: "var(--bg)" }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stats({ config, altBg }: { config: AthleteConfig; altBg?: boolean }) {
  if (!config.stats.length) return null;
  return (
    <SectionShell variant="strip" altBg={altBg}>
      <div className="flex flex-wrap justify-center gap-x-10 gap-y-6">
        {config.stats.map((s, i) => (
          <div key={s.label + i} className="min-w-20 max-w-32 text-center">
            <div
              className="coach-mono coach-heading text-3xl"
              style={{ color: i % 2 === 0 ? "var(--brand)" : "var(--brand-secondary)" }}
            >
              {s.value}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function About({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  if (!config.bio && !config.achievements.length) return null;
  const traditional = config.style === "traditional";
  const bioBlock = config.bio && (
    <p className="whitespace-pre-line leading-relaxed" style={{ color: "var(--text-secondary)" }}>
      {config.bio}
    </p>
  );
  const achievementsBlock = config.achievements.length > 0 && (
    <div>
      <div className="coach-heading text-sm" style={{ color: "var(--brand)" }}>
        Achievements
      </div>
      <ul
        className={`mt-2 space-y-1 text-sm ${traditional ? "list-none" : "list-disc pl-5"}`}
        style={{ color: "var(--text-secondary)" }}
      >
        {config.achievements.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </div>
  );

  if (traditional) {
    return (
      <SectionShell id="about" altBg={altBg} noBorderBottom={isLast}>
        <div className="mx-auto max-w-3xl lg:max-w-4xl xl:max-w-5xl text-center">
          <SectionHeading>About</SectionHeading>
          {bioBlock}
          {achievementsBlock && <div className="mt-6">{achievementsBlock}</div>}
        </div>
      </SectionShell>
    );
  }
  return (
    <SectionShell id="about" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading>About</SectionHeading>
      <div className="grid gap-10 md:grid-cols-2">
        <div>{bioBlock}</div>
        {achievementsBlock && <div>{achievementsBlock}</div>}
      </div>
    </SectionShell>
  );
}

function CurrentGoal({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  const g = config.goal;
  if (!g) return null;
  const countdown = (() => {
    if (!g.raceDate) return null;
    const days = Math.round(
      (new Date(g.raceDate + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000,
    );
    if (days < 0) return null;
    if (days === 0) return "Today";
    if (days < 14) return `${days} days away`;
    return `${Math.round(days / 7)} weeks away`;
  })();
  return (
    <SectionShell id="goal" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={config.style === "traditional"}>Current goal</SectionHeading>
      <div className={`coach-card mx-auto max-w-2xl p-6 ${config.style === "traditional" ? "text-center" : ""}`}>
        <div className="flex items-center gap-2" style={{ color: "var(--brand)" }}>
          <Trophy className="h-4 w-4" />
          <span className="coach-heading text-sm">{g.title}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {g.distanceM && <span className="coach-mono text-2xl">{formatDistance(g.distanceM)}</span>}
          {g.targetTimeSeconds && (
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Target: {formatTime(g.targetTimeSeconds)}
            </span>
          )}
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {g.raceDate &&
            new Date(g.raceDate + "T00:00:00").toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          {countdown && ` · ${countdown}`}
        </div>
        {g.notes && (
          <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            {g.notes}
          </p>
        )}
      </div>
    </SectionShell>
  );
}

function Results({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  if (!config.personalBests.length && !config.recentResults.length) return null;
  const centered = config.style === "traditional";
  return (
    <SectionShell id="results" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={centered}>Personal bests &amp; results</SectionHeading>
      {config.personalBests.length > 0 && (
        <div className={`mb-10 flex flex-wrap gap-x-10 gap-y-6 ${centered ? "justify-center" : ""}`}>
          {config.personalBests.map((pb, i) => (
            <div key={pb.distanceM + "-" + i} className="min-w-24 text-center">
              <div
                className="coach-mono coach-heading text-2xl"
                style={{ color: i % 2 === 0 ? "var(--brand)" : "var(--brand-secondary)" }}
              >
                {formatTime(pb.timeSeconds)}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {formatDistance(pb.distanceM)}
              </div>
            </div>
          ))}
        </div>
      )}
      {config.recentResults.length > 0 && (
        <div className="space-y-2">
          {config.recentResults.map((r) => (
            <div
              key={r.id}
              className="coach-card flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="coach-mono font-semibold">{formatTime(r.timeSeconds)}</span>
                <span style={{ color: "var(--text-secondary)" }}>{formatDistance(r.distanceM)}</span>
                {r.isPb && (
                  <span className="coach-tag px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">PB</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                {r.eventName && <span>{r.eventName}</span>}
                {r.overallPlace && <span>#{r.overallPlace}</span>}
                <span>
                  {new Date(r.performanceDate + "T00:00:00").toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function TrainingPartners({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  if (!config.trainingPartners.length) return null;
  return (
    <SectionShell id="trainingPartners" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={config.style === "traditional"}>Training partners</SectionHeading>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {config.trainingPartners.map((p, i) => (
          <div key={(p.id ?? p.name) + i} className="text-center">
            {p.photoUrl ? (
              <img
                src={p.photoUrl}
                alt={p.name}
                className="mx-auto h-16 w-16 rounded-full object-cover"
                style={{ border: "1px solid var(--border)" }}
              />
            ) : (
              <div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
              >
                {p.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="mt-2 text-sm font-medium">{p.name}</div>
            {p.event && (
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {p.event}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function Gallery({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!config.galleryImages.length) return null;
  return (
    <SectionShell id="gallery" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={config.style === "traditional"}>Gallery</SectionHeading>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {config.galleryImages.map((src, i) => (
          <button
            key={src + i}
            onClick={() => setOpen(src)}
            className="aspect-square overflow-hidden"
            style={{ borderRadius: "var(--radius-sm)" }}
          >
            <img src={src} loading="lazy" alt="" className="h-full w-full object-cover transition hover:scale-105" />
          </button>
        ))}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setOpen(null)}
        >
          <button className="absolute right-6 top-6 text-white" onClick={() => setOpen(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={open} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </SectionShell>
  );
}

function Blog({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  const [openPost, setOpenPost] = useState<AthleteConfig["blogPosts"][number] | null>(null);
  if (!config.blogPosts.length) return null;
  return (
    <SectionShell id="blog" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={config.style === "traditional"}>Blog</SectionHeading>
      <div className="grid gap-6 md:grid-cols-3">
        {config.blogPosts.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpenPost(p)}
            className="coach-card overflow-hidden text-left transition hover:opacity-90"
          >
            {p.coverImageUrl && (
              <div className="aspect-video w-full overflow-hidden">
                <img src={p.coverImageUrl} alt={p.title} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="p-5">
              {p.publishedAt && (
                <div className="coach-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                  {new Date(p.publishedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              )}
              <div className="coach-heading mt-1 text-base">{p.title}</div>
              <p className="mt-2 line-clamp-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                {p.excerpt}
              </p>
              <span className="mt-3 inline-block text-xs font-semibold" style={{ color: "var(--brand)" }}>
                Read more →
              </span>
            </div>
          </button>
        ))}
      </div>
      {openPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
          onClick={() => setOpenPost(null)}
        >
          <div
            className="max-h-full w-full max-w-2xl overflow-y-auto rounded-md p-6 sm:p-8"
            style={{ background: "var(--bg-elevated)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="float-right"
              onClick={() => setOpenPost(null)}
              aria-label="Close"
              style={{ color: "var(--text-secondary)" }}
            >
              <X className="h-5 w-5" />
            </button>
            {openPost.coverImageUrl && (
              <img
                src={openPost.coverImageUrl}
                alt={openPost.title}
                className="mb-4 aspect-video w-full rounded-md object-cover"
              />
            )}
            <h3 className="coach-heading text-2xl">{openPost.title}</h3>
            {openPost.publishedAt && (
              <div className="coach-mono mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {new Date(openPost.publishedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            )}
            <div
              className="mt-4 whitespace-pre-line text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {openPost.content}
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function Sponsors({ config, altBg }: { config: AthleteConfig; altBg?: boolean }) {
  if (!config.sponsors.length) return null;
  return (
    <SectionShell id="sponsors" variant="strip" altBg={altBg}>
      <div
        className="text-center text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-secondary)" }}
      >
        Proudly supported by
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-8">
        {config.sponsors.map((s, i) => {
          const content = s.logoUrl ? (
            <img
              src={s.logoUrl}
              alt={s.name}
              className="h-10 w-auto object-contain grayscale transition hover:grayscale-0"
            />
          ) : (
            <span className="coach-heading text-sm">{s.name}</span>
          );
          return s.websiteUrl ? (
            <a
              key={s.name + i}
              href={s.websiteUrl}
              target="_blank"
              rel="noreferrer"
              title={s.name}
              className="opacity-80 transition hover:opacity-100"
            >
              {content}
            </a>
          ) : (
            <span key={s.name + i} title={s.name} className="opacity-80">
              {content}
            </span>
          );
        })}
      </div>
    </SectionShell>
  );
}

function Donate({ config, altBg }: { config: AthleteConfig; altBg?: boolean }) {
  if (!config.donate) return null;
  return (
    <SectionShell id="donate" variant="strip" altBg={altBg}>
      <div className="flex flex-col items-center gap-3 text-center">
        <Heart className="h-6 w-6" style={{ color: "var(--brand-secondary)" }} />
        <div className="coach-heading text-lg">Support {config.name.split(" ")[0]}</div>
        <p className="max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
          {config.donate.label || "Training, travel, and race fees add up — every bit helps."}
        </p>
        <a href={config.donate.url} target="_blank" rel="noreferrer">
          <Button style={{ background: "var(--brand-secondary)", color: "var(--on-brand-secondary)", borderRadius: "var(--radius-sm)" }}>
            <Heart className="mr-2 h-4 w-4" /> Support
          </Button>
        </a>
      </div>
    </SectionShell>
  );
}

function Contact({ config, altBg, isLast }: { config: AthleteConfig; altBg?: boolean; isLast?: boolean }) {
  const { email, instagram, strava } = config.contact;
  if (!email && !instagram && !strava) return null;
  return (
    <SectionShell id="contact" altBg={altBg} noBorderBottom={isLast}>
      <SectionHeading centered={config.style === "traditional"}>Get in touch</SectionHeading>
      <div
        className={`mx-auto flex max-w-md flex-col gap-3 text-sm ${config.style === "traditional" ? "items-center" : ""}`}
      >
        {email && (
          <a href={`mailto:${email}`} className="flex items-center gap-2 hover:opacity-70">
            <Mail className="h-4 w-4" style={{ color: "var(--brand)" }} /> {email}
          </a>
        )}
        {instagram && (
          <a
            href={`https://instagram.com/${instagram.replace(/^@/, "")}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 hover:opacity-70"
          >
            <Instagram className="h-4 w-4" style={{ color: "var(--brand)" }} /> {instagram}
          </a>
        )}
        {strava && (
          <a
            href={strava}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 hover:opacity-70"
          >
            <span className="h-4 w-4 text-center text-xs font-bold" style={{ color: "var(--brand)" }}>
              S
            </span>
            Strava
          </a>
        )}
      </div>
    </SectionShell>
  );
}

function Footer({ config }: { config: AthleteConfig }) {
  return (
    <footer className="border-t coach-divider py-8 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
      <div className="flex justify-center">
        <Logo config={config} />
      </div>
      <div className="mt-3">{config.name}</div>
      <div className="mt-1">
        Powered by{" "}
        <a href="/" className="underline hover:opacity-70">
          Strider
        </a>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Dev-only preview controls
// ---------------------------------------------------------------------------

function DevControls({ config, onChange }: { config: AthleteConfig; onChange?: (next: AthleteConfig) => void }) {
  if (!onChange) return null;
  return (
    <div className="sticky top-0 z-50 flex flex-wrap gap-3 border-b bg-black/90 px-4 py-2 text-white">
      <ToggleSelect
        label="theme"
        value={config.theme}
        options={["light", "dark"]}
        onChange={(v) => onChange({ ...config, theme: v as AthleteConfig["theme"] })}
      />
      <ToggleSelect
        label="style"
        value={config.style}
        options={["modern", "traditional"]}
        onChange={(v) => onChange({ ...config, style: v as AthleteConfig["style"] })}
      />
      <ToggleSelect
        label="nav"
        value={config.nav}
        options={["top", "sidebar"]}
        onChange={(v) => onChange({ ...config, nav: v as AthleteConfig["nav"] })}
      />
    </div>
  );
}

function ToggleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="opacity-60">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-28 bg-white text-black">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
