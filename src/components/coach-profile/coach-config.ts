// coach-config.ts
// Single source of truth for the public coach/squad profile page.
// Every visual variant (8 combos of theme × style × nav) is driven by this
// object — layout and section components never fork per combination.

export interface CoachConfig {
  theme: "light" | "dark";
  style: "modern" | "traditional";
  nav: "top" | "sidebar";
  brandColor: string; // hex
  // Optional second brand color for a two-tone identity — used for
  // secondary CTAs and to alternate the Stats strip's number color.
  // Falls back to brandColor everywhere it's used when not set.
  secondaryColor?: string;
  // Which side the hero image sits on for the "modern" style. Has no
  // effect on "traditional" (image is always stacked above, centered).
  heroImageSide: "left" | "right";
  // Section spacing preset — independent of theme/style, so a coach can
  // tighten up a page that feels too spaced-out without changing anything
  // else about the look.
  density: "comfortable" | "compact";
  // When true, every other content section gets a subtly different
  // background (--bg-alt: light grey on the light theme, darker grey on
  // dark) to visually separate sections without borders. Purely cosmetic
  // — off by default so existing pages render unchanged.
  alternateSectionBackgrounds: boolean;
  // Display order for the reorderable content sections (everything except
  // Hero, which is always first, and the footer, which is always last).
  // Always contains exactly the keys in DEFAULT_SECTION_ORDER — see
  // normalizeSectionOrder() for how a saved order is reconciled against
  // that list (handles both older rows saved before a section existed,
  // and any unrecognized/stale key).
  sectionOrder: string[];
  name: string;
  teamName?: string;
  slug: string;
  tagline: string;
  disciplines: string[];
  heroImageUrl: string;
  // Focal point as a percentage pair (0-100 each) — passed straight
  // through to CSS object-position on the hero <img>. {x:50,y:50} is
  // dead center, today's existing behavior with no override.
  heroImagePosition: { x: number; y: number };
  coachPhotoUrl?: string;
  logoInitials: string;
  teamLogoUrl?: string;
  stats: { label: string; value: string }[];
  bio: string;
  coachingPhilosophy?: string;
  achievements: string[];
  certifications: string[];
  sampleSessions: { name: string; target: string; purpose: string }[];
  galleryImages: string[];
  // Layout controls — columns per row, crop shape, and per-image focal
  // point (keyed by image URL, only meaningful for non-"auto" aspects).
  // A missing entry in galleryImagePositions means center (50/50).
  galleryColumns: 2 | 3 | 4;
  galleryAspect: "square" | "portrait" | "landscape" | "auto";
  galleryImagePositions: Record<string, { x: number; y: number }>;
  plans: {
    name: string;
    price: string;
    period: string;
    description: string;
    featured?: boolean;
  }[];
  testimonials: { quote: string; author: string }[];
  athletes: { name: string; event?: string; photoUrl?: string }[];
  location: { city: string; venue?: string; remoteAvailable: boolean };
  contact: {
    email: string;
    phone?: string;
    instagram?: string;
    strava?: string;
    facebook?: string;
    twitter?: string;
    youtube?: string;
    tiktok?: string;
    website?: string;
  };
  // Whether the public page is live. false = only the coach (via the
  // editor's Preview link) can see it; visitors get a "not published yet"
  // placeholder instead of the full page.
  isPublished: boolean;
  // Per-section show/hide toggles. Hero and Location & contact are always
  // shown (core structural sections) — everything else can be switched
  // off by the coach even if it has content.
  sections: {
    stats: boolean;
    about: boolean;
    sessions: boolean;
    athletes: boolean;
    gallery: boolean;
    blog: boolean;
    plans: boolean;
    testimonials: boolean;
    sponsors: boolean;
  };
  sponsors: { name: string; logoUrl?: string; websiteUrl?: string }[];
  blogPosts: {
    id: string;
    title: string;
    excerpt: string;
    content: string;
    coverImageUrl?: string;
    publishedAt?: string;
  }[];
}

// Every section defaults to visible — this is an opt-out model, not
// opt-in, so existing coach pages (and any DB row missing the column, or
// missing individual keys within it) keep showing everything they already
// showed before this feature existed.
export const DEFAULT_SECTIONS_ENABLED: CoachConfig["sections"] = {
  stats: true,
  about: true,
  sessions: true,
  athletes: true,
  gallery: true,
  blog: true,
  plans: true,
  testimonials: true,
  sponsors: true,
};

// Every reorderable content section (i.e. everything except Hero, which
// is always first, and the footer, which is always last). This exact key
// list is the single source of truth for what can be reordered — both
// CoachProfilePage.tsx (rendering) and the editor's drag-to-reorder list
// key off it, so they can't drift apart.
export const DEFAULT_SECTION_ORDER = [
  "stats",
  "about",
  "sessions",
  "athletes",
  "gallery",
  "blog",
  "plans",
  "testimonials",
  "contact",
  "sponsors",
] as const;

// Human-readable labels for each orderable section — shared between the
// editor's reorder list and (for "contact", which has no dedicated
// content card) anywhere else a label is needed.
export const SECTION_ORDER_LABELS: Record<(typeof DEFAULT_SECTION_ORDER)[number], string> = {
  stats: "Stats",
  about: "About",
  sessions: "Sample sessions",
  athletes: "Athletes coached",
  gallery: "Gallery",
  blog: "Blog",
  plans: "Coaching plans",
  testimonials: "Testimonials",
  contact: "Location & contact",
  sponsors: "Sponsors",
};

// Reconciles a saved order against the current canonical key list:
// - drops any key that's no longer recognized (stale/renamed section)
// - appends any canonical key missing from the saved order (e.g. a row
//   saved before "sponsors" existed) at the end, so a newly-added section
//   type doesn't silently vanish just because it predates this feature
// Always returns every canonical key exactly once.
export function normalizeSectionOrder(saved: unknown): string[] {
  const canonical: string[] = [...DEFAULT_SECTION_ORDER];
  const savedArr = Array.isArray(saved) ? (saved as string[]).filter((k) => canonical.includes(k)) : [];
  const missing = canonical.filter((k) => !savedArr.includes(k));
  return [...savedArr, ...missing];
}

// ---------------------------------------------------------------------------
// Default / sample content — matches the brief's example persona.
// Used for local dev preview and as a fallback while a real row loads.
// ---------------------------------------------------------------------------

export const defaultCoachConfig: CoachConfig = {
  theme: "light",
  style: "modern",
  nav: "top",
  brandColor: "#BD4130",
  secondaryColor: "#2E5266",
  heroImageSide: "right",
  density: "comfortable",
  alternateSectionBackgrounds: false,
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  name: "Marcus Webb",
  slug: "marcus-webb",
  tagline: "Track and interval-based coaching for runners chasing their next PR",
  disciplines: ["Track & Interval", "Marathon", "5K/10K"],
  heroImageUrl: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80",
  heroImagePosition: { x: 50, y: 50 },
  logoInitials: "MW",
  stats: [
    { label: "Years coaching", value: "11" },
    { label: "Athletes coached", value: "38" },
    { label: "Boston qualifiers", value: "14" },
    { label: "Interval sessions/wk avg", value: "3" },
  ],
  bio: "Former 2:19 marathoner turned coach. I build plans around structured track and interval work, adjusted week to week based on how sessions actually go — not a generic template.",
  coachingPhilosophy:
    "Training should be adapted to the athlete in front of you, not the other way around. Every session is a data point — I adjust week to week based on how the body is actually responding, not just what the plan says on paper.",
  achievements: ["2x Olympian, 3000m Steeplechase", "14 Boston Marathon qualifiers coached", "PB: 2:19:04 marathon"],
  certifications: ["USATF Level 2", "USOPC SafeSport"],
  sampleSessions: [
    { name: "8 × 400m", target: "5K pace, 90s jog recovery", purpose: "Speed and turnover" },
    { name: "5 × 1000m", target: "Threshold pace, 2min float recovery", purpose: "Lactate threshold" },
    { name: "Track ladder", target: "200-400-800-400-200m, descending recovery", purpose: "VO2max development" },
  ],
  galleryImages: [
    "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800&q=80",
    "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&q=80",
    "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=800&q=80",
    "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=800&q=80",
  ],
  galleryColumns: 3,
  galleryAspect: "square",
  galleryImagePositions: {},
  plans: [
    { name: "Foundation", price: "89", period: "mo", description: "Monthly check-in" },
    {
      name: "Guided",
      price: "179",
      period: "mo",
      description: "Weekly adjustments + race tactics",
      featured: true,
    },
    { name: "Full access", price: "299", period: "mo", description: "Daily contact + biomechanics review" },
  ],
  testimonials: [
    {
      quote: "The interval sessions actually match what I run on race day now.",
      author: "Sarah K. — 2:58 marathon debut",
    },
    {
      quote: "Every week is different because he's actually watching how I respond.",
      author: "Dev P. — first sub-3:30 marathon",
    },
  ],
  athletes: [
    { name: "Sarah K.", event: "Marathon" },
    { name: "Dev P.", event: "5000m" },
  ],
  location: { city: "Melbourne, AU", venue: "Fawkner Park Track", remoteAvailable: true },
  contact: { email: "marcus@example.com", instagram: "@marcuswebbcoaching" },
  isPublished: true,
  sections: DEFAULT_SECTIONS_ENABLED,
  sponsors: [
    { name: "Fawkner Running Co.", logoUrl: "", websiteUrl: "https://example.com" },
  ],
  blogPosts: [
    {
      id: "sample-1",
      title: "Why I program 3 interval sessions a week, not 5",
      excerpt: "More isn't always better — how I decide how much structured work an athlete can actually absorb.",
      content:
        "More isn't always better. The biggest mistake I see athletes make when they start structuring their own training is loading up on quality work because it feels productive — but recovery is where the adaptation actually happens.\n\nI cap most marathon and half-marathon athletes at 3 interval-quality sessions a week, with everything else easy or moderate. That's usually enough stimulus to drive fitness gains without digging a hole you can't climb out of before the next hard session.",
      publishedAt: "2026-06-01",
    },
  ],
};

// ---------------------------------------------------------------------------
// Map a `coach_profiles` Supabase row onto CoachConfig.
// Keeps the DB shape (snake_case, jsonb columns that may arrive as objects
// or arrays) decoupled from the component's prop shape.
// ---------------------------------------------------------------------------

function asArray<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v as object) as T[];
  return [];
}

export function coachRowToConfig(
  row: Record<string, any>,
  athletes: { name: string; event?: string; photoUrl?: string }[] = [],
  blogPosts: CoachConfig["blogPosts"] = [],
): CoachConfig {
  const d = defaultCoachConfig;
  return {
    theme: row.theme === "dark" ? "dark" : "light",
    style: row.style === "traditional" ? "traditional" : "modern",
    nav: row.nav === "sidebar" ? "sidebar" : "top",
    brandColor: row.brand_color || d.brandColor,
    secondaryColor: row.secondary_color || undefined,
    heroImageSide: row.hero_image_side === "left" ? "left" : "right",
    density: row.section_density === "compact" ? "compact" : "comfortable",
    alternateSectionBackgrounds: !!row.alternate_section_backgrounds,
    sectionOrder: normalizeSectionOrder(row.section_order),
    name: row.name || d.name,
    teamName: row.team_name || undefined,
    slug: row.slug || d.slug,
    tagline: row.tagline || "",
    disciplines: asArray<string>(row.disciplines),
    heroImageUrl: row.hero_image_url || d.heroImageUrl,
    heroImagePosition: {
      x: typeof row.hero_image_position_x === "number" ? row.hero_image_position_x : 50,
      y: typeof row.hero_image_position_y === "number" ? row.hero_image_position_y : 50,
    },
    coachPhotoUrl: row.coach_photo_url || undefined,
    logoInitials: row.logo_initials || initials(row.name || d.name),
    teamLogoUrl: row.logo_url || undefined,
    stats: asArray(row.stats).map((s: any) => ({
      label: s.label ?? s.key ?? "",
      value: String(s.value ?? s.stat ?? ""),
    })),
    bio: row.bio || "",
    coachingPhilosophy: row.coaching_philosophy || undefined,
    achievements: asArray<string>(row.achievements),
    certifications: asArray<string>(row.certifications),
    sampleSessions: asArray(row.sample_sessions).map((s: any) => ({
      name: s.name ?? "",
      target: s.target ?? "",
      purpose: s.purpose ?? "",
    })),
    galleryImages: asArray<string>(row.gallery_images),
    galleryColumns: [2, 3, 4].includes(row.gallery_columns) ? row.gallery_columns : 3,
    galleryAspect: ["square", "portrait", "landscape", "auto"].includes(row.gallery_aspect)
      ? row.gallery_aspect
      : "square",
    galleryImagePositions: row.gallery_image_positions && typeof row.gallery_image_positions === "object"
      ? row.gallery_image_positions
      : {},
    plans: asArray(row.plans).map((p: any) => ({
      name: p.name ?? p.title ?? "",
      price: String(p.price ?? ""),
      period: p.period ?? p.interval ?? "mo",
      description: p.description ?? "",
      featured: !!p.featured,
    })),
    testimonials: asArray(row.testimonials).map((t: any) => ({
      quote: t.quote ?? t.text ?? t.body ?? "",
      author: t.author ?? t.name ?? "",
    })),
    athletes,
    location: {
      city: row.location?.city ?? "",
      venue: row.location?.venue,
      remoteAvailable: !!row.location?.remoteAvailable,
    },
    contact: {
      email: row.contact?.email,
      phone: row.contact?.phone,
      instagram: row.contact?.instagram,
      strava: row.contact?.strava,
      facebook: row.contact?.facebook,
      twitter: row.contact?.twitter,
      youtube: row.contact?.youtube,
      tiktok: row.contact?.tiktok,
      website: row.contact?.website,
    },
    isPublished: !!row.is_published,
    // Merge over the defaults key-by-key rather than replacing wholesale —
    // a row saved before a new section (e.g. "blog") existed won't have
    // that key in its jsonb yet, and it should still default to visible
    // rather than silently disappearing.
    sections: { ...DEFAULT_SECTIONS_ENABLED, ...(row.sections_enabled || {}) },
    sponsors: asArray(row.sponsors).map((s: any) => ({
      name: s.name ?? "",
      logoUrl: s.logo_url ?? s.logoUrl ?? undefined,
      websiteUrl: s.website_url ?? s.websiteUrl ?? undefined,
    })),
    blogPosts,
  };
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
