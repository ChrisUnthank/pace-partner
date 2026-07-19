import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Menu, Mail, Phone, AtSign as Instagram, MapPin, Timer, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { CoachConfig } from "./coach-config";
import "./coach-profile-tokens.css";

// Nav/anchor entries. `key` maps to config.sections (null = always shown —
// Home and Contact are core structural sections, not toggleable). A section
// is only listed once it's both switched on AND actually has content, same
// rule each section component already uses to decide whether to render
// itself at all — this just keeps the nav in sync with that.
const ALL_SECTIONS = [
  { id: "home", label: "Home", key: null as const },
  { id: "about", label: "About", key: "about" as const },
  { id: "sessions", label: "Sample sessions", key: "sessions" as const },
  { id: "athletes", label: "Athletes", key: "athletes" as const },
  { id: "gallery", label: "Gallery", key: "gallery" as const },
  { id: "blog", label: "Blog", key: "blog" as const },
  { id: "plans", label: "Plans", key: "plans" as const },
  { id: "testimonials", label: "Testimonials", key: "testimonials" as const },
  { id: "contact", label: "Location & contact", key: null as const },
];

function visibleSections(config: CoachConfig) {
  return ALL_SECTIONS.filter((s) => {
    if (s.key === null) return true;
    if (!config.sections[s.key]) return false;
    switch (s.key) {
      case "about":
        return !!(config.bio || config.coachingPhilosophy || config.achievements.length);
      case "sessions":
        return config.sampleSessions.length > 0;
      case "athletes":
        return config.athletes.length > 0;
      case "gallery":
        return config.galleryImages.length > 0;
      case "blog":
        return config.blogPosts.length > 0;
      case "plans":
        return config.plans.length > 0;
      case "testimonials":
        return config.testimonials.length > 0;
      default:
        return true;
    }
  });
}

// Simple luminance check so `--on-brand` stays readable against any brand color.
function onColorFor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#FFFFFF";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#17181A" : "#FFFFFF";
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Google Maps supports a basic embeddable iframe via a plain search query URL —
// no API key or billing setup required, unlike the full Maps Embed API.
function mapEmbedUrl(location: CoachConfig["location"]): string | null {
  const query = [location.venue, location.city].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=13&output=embed`;
}

export interface CoachProfilePageProps {
  config: CoachConfig;
  /** Show the live theme/style/nav preview toggles. Dev-only, strip before shipping a fixed-config page. */
  showDevControls?: boolean;
  onConfigChange?: (next: CoachConfig) => void;
  /**
   * True when the viewer is confirmed to be this page's owner — e.g. the
   * coach clicking "Preview" from the editor while logged in as that
   * coach. Lets an unpublished page still render for its own coach
   * instead of the "not published yet" placeholder a normal visitor
   * would see. Deciding *who* the viewer is happens in the route that
   * renders this component (session/slug match), not in here.
   */
  isOwnerPreview?: boolean;
}

export function CoachProfilePage({ config, showDevControls, onConfigChange, isOwnerPreview }: CoachProfilePageProps) {
  const rootVars = useMemo(
    () =>
      ({
        "--brand": config.brandColor,
        "--on-brand": onColorFor(config.brandColor),
        // Falls back to the primary brand color when no secondary is set,
        // so every existing coach page (pre-dating this field) renders
        // exactly as it did before — nothing suddenly looks two-tone
        // unless a secondary color is actually chosen.
        "--brand-secondary": config.secondaryColor || config.brandColor,
        "--on-brand-secondary": onColorFor(config.secondaryColor || config.brandColor),
        // Inline styles win over the stylesheet's per-style --section-py,
        // so this overrides coach-profile-tokens.css's modern/traditional
        // default only when "compact" is explicitly chosen — no CSS file
        // changes needed.
        ...(config.density === "compact" ? { "--section-py": "2.5rem" } : {}),
      }) as React.CSSProperties,
    [config.brandColor, config.secondaryColor, config.density],
  );

  return (
    <div
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

function UnpublishedPlaceholder({ config }: { config: CoachConfig }) {
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
// Nav shells — the only thing that forks per `nav` value. Section content
// (<PageSections>) is identical either way.
// ---------------------------------------------------------------------------

function TopNavLayout({ config }: { config: CoachConfig }) {
  return (
    <div>
      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8 xl:max-w-7xl 2xl:max-w-[100rem]">
          <Logo config={config} />
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
            <InquiryCTA />
          </div>
          <MobileNavSheet config={config} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 md:px-8 xl:max-w-7xl 2xl:max-w-[100rem]">
        <PageSections config={config} />
      </main>
      <Footer config={config} />
    </div>
  );
}

function SidebarLayout({ config }: { config: CoachConfig }) {
  return (
    <div className="md:flex">
      {/* mobile top bar */}
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
        <InquiryCTA fullWidth />
      </aside>

      <main className="mx-auto min-w-0 max-w-4xl flex-1 px-4 md:px-10 xl:max-w-5xl 2xl:max-w-6xl">
        <PageSections config={config} />
        <Footer config={config} />
      </main>
    </div>
  );
}

function Logo({ config, showName }: { config: CoachConfig; showName?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {config.teamLogoUrl ? (
        <img
          src={config.teamLogoUrl}
          alt={config.teamName || config.name}
          className="h-9 w-9 object-cover"
          style={{ borderRadius: "var(--radius-sm)" }}
        />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center text-sm font-semibold"
          style={{ background: "var(--brand)", color: "var(--on-brand)", borderRadius: "var(--radius-sm)" }}
        >
          {config.logoInitials}
        </div>
      )}
      {showName && <span className="coach-heading text-sm">{config.teamName || config.name}</span>}
    </div>
  );
}

function InquiryCTA({ fullWidth }: { fullWidth?: boolean }) {
  return (
    <Button
      onClick={() => scrollToSection("contact")}
      className={fullWidth ? "w-full" : ""}
      style={{ background: "var(--brand)", color: "var(--on-brand)", borderRadius: "var(--radius-sm)" }}
    >
      Send inquiry
    </Button>
  );
}

function MobileNavSheet({ config }: { config: CoachConfig }) {
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
          <InquiryCTA fullWidth />
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sections — shared by both nav layouts
// ---------------------------------------------------------------------------

function PageSections({ config }: { config: CoachConfig }) {
  return (
    <>
      <Hero config={config} />
      {config.sections.stats && <Stats config={config} />}
      {config.sections.about && <About config={config} />}
      {config.sections.sessions && <SampleSessions config={config} />}
      {config.sections.athletes && <AthletesCoached config={config} />}
      {config.sections.gallery && <Gallery config={config} />}
      {config.sections.blog && <Blog config={config} />}
      {config.sections.plans && <Plans config={config} />}
      {config.sections.testimonials && <Testimonials config={config} />}
      <LocationContact config={config} />
      {config.sections.sponsors && <Sponsors config={config} />}
    </>
  );
}

function SectionHeading({ children, centered }: { children: React.ReactNode; centered?: boolean }) {
  return <h2 className={`coach-heading mb-8 text-2xl md:text-3xl ${centered ? "text-center" : ""}`}>{children}</h2>;
}

function Hero({ config }: { config: CoachConfig }) {
  const modern = config.style === "modern";
  const imageLeft = modern && config.heroImageSide === "left";
  // The wider track (1.1fr) always follows the text, whichever side it's
  // on — swapping which column is wider along with `order` below, rather
  // than just reordering, so text doesn't get squeezed into the narrower
  // track when the image moves to the left.
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
      <div
        className={
          modern
            ? `grid items-center gap-10 ${heroGridCols}`
            : "mx-auto max-w-3xl lg:max-w-4xl xl:max-w-5xl"
        }
      >
        {!modern && (
          <div className="relative mb-10">
            <img
              src={config.heroImageUrl}
              alt={config.name}
              className="coach-hero-image h-48 w-full object-cover sm:h-64 md:h-80"
            />
            {config.coachPhotoUrl && (
              <img
                src={config.coachPhotoUrl}
                alt={config.name}
                className="absolute -bottom-6 left-1/2 h-16 w-16 -translate-x-1/2 border-4 object-cover sm:-bottom-8 sm:h-20 sm:w-20"
                style={{ borderRadius: "999px", borderColor: "var(--bg)" }}
              />
            )}
          </div>
        )}
        <div className={modern ? (imageLeft ? "md:order-2" : "") : "mx-auto max-w-2xl px-4 pt-6 text-center sm:px-0"}>
          {config.teamName && (
            <div className="coach-heading mb-1 text-sm uppercase tracking-wide" style={{ color: "var(--brand)" }}>
              {config.teamName}
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
            <InquiryCTA />
            <Button
              variant="outline"
              onClick={() => scrollToSection("plans")}
              className="!border-[var(--brand-secondary)] !bg-[var(--bg-elevated)] !text-[var(--brand-secondary)] hover:!bg-[var(--brand-secondary)] hover:!text-[var(--on-brand-secondary)]"
              style={{
                background: "var(--bg-elevated) !important" as any,
                color: "var(--brand-secondary) !important" as any,
                borderColor: "var(--brand-secondary) !important" as any,
                borderRadius: "var(--radius-sm)",
              }}
            >
              View plans
            </Button>
          </div>
        </div>
        {modern && (
          <div className={`relative ${imageLeft ? "md:order-1" : ""}`}>
            <img
              src={config.heroImageUrl}
              alt={config.name}
              className="coach-hero-image h-72 w-full object-cover md:h-[26rem]"
            />
            {config.coachPhotoUrl && (
              <img
                src={config.coachPhotoUrl}
                alt={config.name}
                className="absolute -bottom-6 -left-6 h-20 w-20 border-4 object-cover"
                style={{ borderRadius: "var(--radius)", borderColor: "var(--bg)" }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stats({ config }: { config: CoachConfig }) {
  if (!config.stats.length) return null;
  return (
    <section className="border-t coach-divider py-10">
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {config.stats.map((s, i) => (
          <div key={s.label + i} className="text-center">
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
    </section>
  );
}

function About({ config }: { config: CoachConfig }) {
  if (!config.bio && !config.coachingPhilosophy && !config.achievements.length) return null;
  const traditional = config.style === "traditional";

  const bioBlock = config.bio && (
    <p className="whitespace-pre-line leading-relaxed" style={{ color: "var(--text-secondary)" }}>
      {config.bio}
    </p>
  );

  const certsBlock = config.certifications.length > 0 && (
    <div className={`mt-6 flex flex-wrap gap-2 ${traditional ? "justify-center" : ""}`}>
      {config.certifications.map((c) => (
        <span
          key={c}
          className="text-xs px-3 py-1 font-medium"
          style={{
            border: "1px solid var(--brand)",
            borderRadius: "var(--tag-radius)",
            color: "var(--brand)",
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );

  const philosophyBlock = config.coachingPhilosophy && (
    <div>
      <div className="coach-heading text-sm" style={{ color: "var(--brand)" }}>
        Coaching philosophy
      </div>
      <p className="mt-2 whitespace-pre-line leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {config.coachingPhilosophy}
      </p>
    </div>
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
      <section
        id="about"
        style={{
          paddingTop: "var(--section-py)",
          paddingBottom: "var(--section-py)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="mx-auto max-w-3xl lg:max-w-4xl xl:max-w-5xl text-center">
          <SectionHeading>About</SectionHeading>
          {bioBlock}
          {philosophyBlock && <div className="mt-6">{philosophyBlock}</div>}
          {achievementsBlock && <div className="mt-6">{achievementsBlock}</div>}
          {certsBlock}
        </div>
      </section>
    );
  }

  return (
    <section
      id="about"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <SectionHeading>About</SectionHeading>
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          {bioBlock}
          {certsBlock}
        </div>
        {(philosophyBlock || achievementsBlock) && (
          <div className="space-y-6">
            {philosophyBlock}
            {achievementsBlock}
          </div>
        )}
      </div>
    </section>
  );
}

function SampleSessions({ config }: { config: CoachConfig }) {
  if (!config.sampleSessions.length) return null;
  return (
    <section
      id="sessions"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <SectionHeading centered={config.style === "traditional"}>Sample sessions</SectionHeading>
      <div className="grid gap-4 md:grid-cols-3">
        {config.sampleSessions.map((s) => (
          <div key={s.name} className="coach-card p-5">
            <div className="flex items-center gap-2" style={{ color: "var(--brand)" }}>
              <Timer className="h-4 w-4" />
              <span className="coach-heading text-sm">{s.name}</span>
            </div>
            <div className="coach-mono mt-3 text-sm" style={{ color: "var(--text-primary)" }}>
              {s.target}
            </div>
            <div className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              {s.purpose}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AthletesCoached({ config }: { config: CoachConfig }) {
  if (!config.athletes.length) return null;
  return (
    <section
      id="athletes"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <SectionHeading centered={config.style === "traditional"}>Athletes coached</SectionHeading>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {config.athletes.map((a, i) => (
          <div key={a.name + i} className="text-center">
            {a.photoUrl ? (
              <img
                src={a.photoUrl}
                alt={a.name}
                className="mx-auto h-16 w-16 rounded-full object-cover"
                style={{ border: "1px solid var(--border)" }}
              />
            ) : (
              <div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
              >
                {a.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="mt-2 text-sm font-medium">{a.name}</div>
            {a.event && (
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {a.event}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Gallery({ config }: { config: CoachConfig }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!config.galleryImages.length) return null;
  return (
    <section
      id="gallery"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
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
    </section>
  );
}

function Blog({ config }: { config: CoachConfig }) {
  const [openPost, setOpenPost] = useState<CoachConfig["blogPosts"][number] | null>(null);
  if (!config.blogPosts.length) return null;
  return (
    <section
      id="blog"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
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
    </section>
  );
}

function Plans({ config }: { config: CoachConfig }) {
  if (!config.plans.length) return null;
  return (
    <section
      id="plans"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <SectionHeading centered={config.style === "traditional"}>Coaching plans</SectionHeading>
      <div className="grid gap-4 md:grid-cols-3">
        {config.plans.map((p) => (
          <div
            key={p.name}
            className="coach-card flex flex-col p-6"
            style={p.featured ? { borderColor: "var(--brand)", borderWidth: 2 } : undefined}
          >
            {p.featured && (
              <span
                className="mb-3 self-start text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--brand)" }}
              >
                Most popular
              </span>
            )}
            <div className="coach-heading text-lg">{p.name}</div>
            <div className="coach-mono mt-3 text-3xl">
              ${p.price}
              <span className="text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                /{p.period}
              </span>
            </div>
            <p className="mt-3 flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              {p.description}
            </p>
            <Button
              className="mt-6"
              onClick={() => scrollToSection("contact")}
              style={
                p.featured
                  ? { background: "var(--brand)", color: "var(--on-brand)", borderRadius: "var(--radius-sm)" }
                  : { borderRadius: "var(--radius-sm)" }
              }
              variant={p.featured ? "default" : "outline"}
            >
              Get started
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonials({ config }: { config: CoachConfig }) {
  if (!config.testimonials.length) return null;
  return (
    <section
      id="testimonials"
      style={{
        paddingTop: "var(--section-py)",
        paddingBottom: "var(--section-py)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <SectionHeading centered={config.style === "traditional"}>Testimonials</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        {config.testimonials.map((t) => (
          <div key={t.author} className="coach-card p-6">
            <p className="text-sm leading-relaxed">"{t.quote}"</p>
            <div
              className="mt-4 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              — {t.author}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LocationContact({ config }: { config: CoachConfig }) {
  const mapSrc = mapEmbedUrl(config.location);
  return (
    <section id="contact" style={{ paddingTop: "var(--section-py)", paddingBottom: "var(--section-py)" }}>
      <SectionHeading centered={config.style === "traditional"}>Location & contact</SectionHeading>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          {mapSrc ? (
            <iframe
              title="Location map"
              src={mapSrc}
              loading="lazy"
              className="h-48 w-full"
              style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
            />
          ) : (
            <div
              className="flex h-48 items-center justify-center text-sm"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--text-secondary)",
              }}
            >
              Add a city or venue to show a map
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4" style={{ color: "var(--brand)" }} />
            <span>{config.location.city}</span>
            {config.location.venue && <span style={{ color: "var(--text-secondary)" }}>· {config.location.venue}</span>}
          </div>
          <span className="coach-tag mt-3 inline-block px-3 py-1 text-xs font-medium">
            {config.location.remoteAvailable ? "In-person & remote/online" : "In-person only"}
          </span>
        </div>

        <div>
          <div className="space-y-2 text-sm">
            {config.contact.email && (
              <a href={`mailto:${config.contact.email}`} className="flex items-center gap-2 hover:opacity-70">
                <Mail className="h-4 w-4" style={{ color: "var(--brand)" }} /> {config.contact.email}
              </a>
            )}
            {config.contact.phone && (
              <a href={`tel:${config.contact.phone}`} className="flex items-center gap-2 hover:opacity-70">
                <Phone className="h-4 w-4" style={{ color: "var(--brand)" }} /> {config.contact.phone}
              </a>
            )}
            {config.contact.instagram && (
              <a
                href={`https://instagram.com/${config.contact.instagram.replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 hover:opacity-70"
              >
                <Instagram className="h-4 w-4" style={{ color: "var(--brand)" }} /> {config.contact.instagram}
              </a>
            )}
          </div>

          <InquiryForm config={config} />
        </div>
      </div>
    </section>
  );
}

function InquiryForm({ config }: { config: CoachConfig }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await (supabase.rpc as any)("submit_coach_inquiry", {
      p_slug: config.slug,
      p_name: name,
      p_email: email,
      p_discipline: discipline || null,
      p_message: message || null,
    });
    if (error) {
      setStatus("error");
      return;
    }

    // Best-effort email notification — don't block success on this failing,
    // since the inquiry + in-app notification are already saved either way.
    if (config.contact.email) {
      supabase.functions
        .invoke("send-coach-inquiry-email", {
          body: {
            to: config.contact.email,
            coachName: config.name,
            inquirerName: name,
            inquirerEmail: email,
            discipline,
            message,
          },
        })
        .catch(() => {
          // Silently ignore — the inquiry itself already succeeded.
        });
    }

    setStatus("sent");
    setName("");
    setEmail("");
    setDiscipline("");
    setMessage("");
  }

  if (status === "sent") {
    return (
      <div
        className="mt-6 rounded-md p-4 text-sm"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
      >
        Thanks — your message has been sent. {config.name.split(" ")[0]} will be in touch soon.
      </div>
    );
  }

  const inputStyle = {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-elevated)",
  };

  return (
    <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
      <input
        placeholder="Name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 text-sm"
        style={inputStyle}
      />
      <input
        type="email"
        placeholder="Email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2 text-sm"
        style={inputStyle}
      />
      <select
        value={discipline}
        onChange={(e) => setDiscipline(e.target.value)}
        className="w-full px-3 py-2 text-sm"
        style={inputStyle}
      >
        <option value="">Discipline</option>
        {config.disciplines.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      <textarea
        placeholder="Message"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-3 py-2 text-sm"
        style={inputStyle}
      />
      {status === "error" && (
        <p className="text-xs" style={{ color: "#DC2626" }}>
          Something went wrong sending your message — please try again.
        </p>
      )}
      <Button
        type="submit"
        disabled={status === "sending"}
        className="w-full"
        style={{ background: "var(--brand)", color: "var(--on-brand)", borderRadius: "var(--radius-sm)" }}
      >
        {status === "sending" ? "Sending…" : "Send inquiry"}
      </Button>
    </form>
  );
}

function Sponsors({ config }: { config: CoachConfig }) {
  if (!config.sponsors.length) return null;
  return (
    <section id="sponsors" className="border-t coach-divider py-10">
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
    </section>
  );
}

function Footer({ config }: { config: CoachConfig }) {
  return (
    <footer className="border-t coach-divider py-8 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
      <div className="flex justify-center">
        <Logo config={config} />
      </div>
      <div className="mt-3">{config.name}</div>
      <div className="mt-1">Powered by TrackCoach</div>
      <div className="mt-1">app.co/c/{config.slug}</div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Dev-only preview controls — remove this component once a coach's page is
// embedded with a fixed config.
// ---------------------------------------------------------------------------

function DevControls({ config, onChange }: { config: CoachConfig; onChange?: (next: CoachConfig) => void }) {
  if (!onChange) return null;
  return (
    <div className="sticky top-0 z-50 flex flex-wrap gap-3 border-b bg-black/90 px-4 py-2 text-white">
      <ToggleSelect
        label="theme"
        value={config.theme}
        options={["light", "dark"]}
        onChange={(v) => onChange({ ...config, theme: v as CoachConfig["theme"] })}
      />
      <ToggleSelect
        label="style"
        value={config.style}
        options={["modern", "traditional"]}
        onChange={(v) => onChange({ ...config, style: v as CoachConfig["style"] })}
      />
      <ToggleSelect
        label="nav"
        value={config.nav}
        options={["top", "sidebar"]}
        onChange={(v) => onChange({ ...config, nav: v as CoachConfig["nav"] })}
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
