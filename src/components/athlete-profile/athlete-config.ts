// athlete-config.ts
// Single source of truth for the public athlete profile page — same role
// coach-config.ts plays for the coach page, deliberately mirroring its
// shape (interface / defaults / DB-row mapper / section-order helpers) so
// the two stay easy to maintain side by side rather than drifting apart.
//
// Key structural difference from coach-config.ts: an athlete's identity
// (name, photo, primary event) already lives on the `athletes` table,
// used throughout the rest of the app — athlete_profiles only stores
// page-specific fields (tagline, theme, section toggles, etc.), so
// athleteRowToConfig() takes BOTH rows rather than one.

export interface AthletePersonalBest {
  distanceM: number;
  timeSeconds: number;
  eventName?: string;
  raceType?: string;
  performanceDate?: string;
}

export interface AthleteRaceResult {
  id: string;
  distanceM: number;
  timeSeconds: number;
  eventName?: string;
  performanceDate: string;
  overallPlace?: number;
  isPb: boolean;
}

export interface AthleteGoal {
  title: string;
  raceDate?: string;
  distanceM?: number;
  targetTimeSeconds?: number;
  notes?: string;
}

export interface AthleteConfig {
  theme: "light" | "dark";
  style: "modern" | "traditional";
  nav: "top" | "sidebar";
  brandColor: string;
  secondaryColor?: string;
  heroImageSide: "left" | "right";
  density: "comfortable" | "compact";
  alternateSectionBackgrounds: boolean;
  sectionOrder: string[];

  // Identity — sourced from the `athletes` table, not athlete_profiles.
  name: string;
  primaryEvent?: string;
  photoUrl?: string;
  club?: string;

  // Who coaches this athlete — auto-derived from coach_athletes, not
  // stored on athlete_profiles and not editable here (factual, not
  // curated, unlike trainingPartners). slug/isPublished let the page
  // link to a coach's own public page when they have one live; when a
  // coach hasn't published a page, their name still shows, just as
  // plain text rather than a link.
  coaches: { name: string; teamName?: string; slug?: string; isPublished: boolean }[];

  slug: string;
  tagline: string;
  disciplines: string[];
  heroImageUrl: string;
  heroImagePosition: { x: number; y: number };
  bio: string;
  achievements: string[];
  stats: { label: string; value: string }[];

  galleryImages: string[];
  sponsors: { name: string; logoUrl?: string; websiteUrl?: string }[];
  donate?: { label?: string; url: string };

  // Auto-derived from `performances` where context = 'race' and
  // is_public = true (see the public route) — personalBests is the best
  // time per distance, recentResults is the chronological list. Both
  // empty arrays if the athlete hasn't opted any results in yet.
  personalBests: AthletePersonalBest[];
  recentResults: AthleteRaceResult[];

  // The athlete's current primary active goal, pulled live from
  // athlete_goals (same table GoalsCard already reads/writes) — not
  // stored on athlete_profiles, so it can't go stale.
  goal: AthleteGoal | null;

  // Squad-mates auto-derived from shared coaches, plus manual additions,
  // minus manually-hidden auto entries — all three combined into one
  // final list by the caller (public route / editor), not here.
  trainingPartners: { id?: string; name: string; event?: string; photoUrl?: string }[];

  blogPosts: {
    id: string;
    title: string;
    excerpt: string;
    content: string;
    coverImageUrl?: string;
    publishedAt?: string;
  }[];

  contact: { email?: string; phone?: string; instagram?: string; strava?: string };

  isPublished: boolean;
  sections: {
    stats: boolean;
    about: boolean;
    results: boolean;
    goal: boolean;
    trainingPartners: boolean;
    gallery: boolean;
    blog: boolean;
    sponsors: boolean;
    donate: boolean;
    contact: boolean;
  };
}

export const DEFAULT_SECTIONS_ENABLED: AthleteConfig["sections"] = {
  stats: true,
  about: true,
  results: true,
  goal: true,
  trainingPartners: true,
  gallery: true,
  blog: true,
  sponsors: true,
  donate: true,
  contact: true,
};

// Every reorderable content section — Hero is always first, footer always
// last, same convention as the coach page's DEFAULT_SECTION_ORDER.
export const DEFAULT_SECTION_ORDER = [
  "stats",
  "about",
  "goal",
  "results",
  "trainingPartners",
  "gallery",
  "blog",
  "sponsors",
  "donate",
  "contact",
] as const;

export const SECTION_ORDER_LABELS: Record<(typeof DEFAULT_SECTION_ORDER)[number], string> = {
  stats: "Stats",
  about: "About",
  goal: "Current goal",
  results: "Personal bests & results",
  trainingPartners: "Training partners",
  gallery: "Gallery",
  blog: "Blog",
  sponsors: "Sponsors",
  donate: "Support / donate",
  contact: "Contact",
};

// Same reconciliation logic as coach-config.ts's normalizeSectionOrder —
// drop unrecognized keys, append any canonical key missing from a saved
// order (e.g. a row saved before a section existed) at the end.
export function normalizeSectionOrder(saved: unknown): string[] {
  const canonical: string[] = [...DEFAULT_SECTION_ORDER];
  const savedArr = Array.isArray(saved) ? (saved as string[]).filter((k) => canonical.includes(k)) : [];
  const missing = canonical.filter((k) => !savedArr.includes(k));
  return [...savedArr, ...missing];
}

function asArray<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v as object) as T[];
  return [];
}

// ---------------------------------------------------------------------------
// Default / sample content — used for local dev preview and as a fallback
// while a real row loads.
// ---------------------------------------------------------------------------

export const defaultAthleteConfig: AthleteConfig = {
  theme: "light",
  style: "modern",
  nav: "top",
  brandColor: "#2E5266",
  secondaryColor: "#BD4130",
  heroImageSide: "right",
  density: "comfortable",
  alternateSectionBackgrounds: false,
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  name: "Sarah Kim",
  primaryEvent: "1500m",
  photoUrl: undefined,
  club: "Fawkner Park Athletics Club",
  coaches: [{ name: "Marcus Webb", teamName: "redLINE Running", slug: "marcus-webb", isPublished: true }],
  slug: "sarah-kim",
  tagline: "Chasing a sub-4:10 1500m and a spot on the state team",
  disciplines: ["Track", "1500m", "5000m"],
  heroImageUrl: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80",
  heroImagePosition: { x: 50, y: 50 },
  bio: "Middle-distance runner training under redLINE Running. Full-time student, training twice a day when the block calls for it.",
  achievements: ["State championships finalist, 1500m", "Personal best: 4:19.8 (1500m)"],
  stats: [
    { label: "PB 1500m", value: "4:19.8" },
    { label: "PB 5000m", value: "17:42" },
    { label: "Races this year", value: "9" },
  ],
  galleryImages: [],
  sponsors: [],
  donate: undefined,
  personalBests: [
    { distanceM: 1500, timeSeconds: 259.8, eventName: "State Championships", performanceDate: "2026-03-14" },
    { distanceM: 5000, timeSeconds: 1062, eventName: "Autumn Classic", performanceDate: "2026-05-02" },
  ],
  recentResults: [
    {
      id: "sample-1",
      distanceM: 1500,
      timeSeconds: 262.1,
      eventName: "Regional Open",
      performanceDate: "2026-06-20",
      overallPlace: 3,
      isPb: false,
    },
  ],
  goal: {
    title: "State Championships",
    raceDate: "2026-09-12",
    distanceM: 1500,
    targetTimeSeconds: 250,
  },
  trainingPartners: [],
  blogPosts: [],
  contact: { email: "sarah@example.com", instagram: "@sarahkimruns" },
  isPublished: true,
  sections: DEFAULT_SECTIONS_ENABLED,
};

// ---------------------------------------------------------------------------
// Map an `athlete_profiles` row + its parent `athletes` row (+ separately
// -fetched derived data) onto AthleteConfig.
// ---------------------------------------------------------------------------

export function athleteRowToConfig(
  profileRow: Record<string, any>,
  athleteRow: Record<string, any>,
  extras: {
    personalBests?: AthletePersonalBest[];
    recentResults?: AthleteRaceResult[];
    trainingPartners?: AthleteConfig["trainingPartners"];
    blogPosts?: AthleteConfig["blogPosts"];
    goal?: AthleteGoal | null;
    coaches?: AthleteConfig["coaches"];
  } = {},
): AthleteConfig {
  const d = defaultAthleteConfig;
  return {
    theme: profileRow.theme === "dark" ? "dark" : "light",
    style: profileRow.style === "traditional" ? "traditional" : "modern",
    nav: profileRow.nav === "sidebar" ? "sidebar" : "top",
    brandColor: profileRow.brand_color || d.brandColor,
    secondaryColor: profileRow.secondary_color || undefined,
    heroImageSide: profileRow.hero_image_side === "left" ? "left" : "right",
    density: profileRow.section_density === "compact" ? "compact" : "comfortable",
    alternateSectionBackgrounds: !!profileRow.alternate_section_backgrounds,
    sectionOrder: normalizeSectionOrder(profileRow.section_order),

    name: athleteRow.name || d.name,
    primaryEvent: athleteRow.primary_event || undefined,
    photoUrl: athleteRow.profile_image_url || undefined,
    club: athleteRow.club || undefined,
    coaches: extras.coaches ?? [],

    slug: profileRow.slug || d.slug,
    tagline: profileRow.tagline || "",
    disciplines: asArray<string>(profileRow.disciplines),
    heroImageUrl: profileRow.hero_image_url || d.heroImageUrl,
    heroImagePosition: {
      x: typeof profileRow.hero_image_position_x === "number" ? profileRow.hero_image_position_x : 50,
      y: typeof profileRow.hero_image_position_y === "number" ? profileRow.hero_image_position_y : 50,
    },
    bio: profileRow.bio || "",
    achievements: asArray<string>(profileRow.achievements),
    stats: asArray(profileRow.stats).map((s: any) => ({
      label: s.label ?? "",
      value: String(s.value ?? ""),
    })),
    galleryImages: asArray<string>(profileRow.gallery_images),
    sponsors: asArray(profileRow.sponsors).map((s: any) => ({
      name: s.name ?? "",
      logoUrl: s.logo_url ?? s.logoUrl ?? undefined,
      websiteUrl: s.website_url ?? s.websiteUrl ?? undefined,
    })),
    donate:
      profileRow.donate_url
        ? { label: profileRow.donate_label || undefined, url: profileRow.donate_url }
        : undefined,

    personalBests: extras.personalBests ?? [],
    recentResults: extras.recentResults ?? [],
    goal: extras.goal ?? null,
    trainingPartners: extras.trainingPartners ?? [],
    blogPosts: extras.blogPosts ?? [],

    contact: {
      email: profileRow.contact?.email,
      phone: profileRow.contact?.phone,
      instagram: profileRow.contact?.instagram,
      strava: profileRow.contact?.strava,
    },

    isPublished: !!profileRow.is_published,
    sections: { ...DEFAULT_SECTIONS_ENABLED, ...(profileRow.sections_enabled || {}) },
  };
}
