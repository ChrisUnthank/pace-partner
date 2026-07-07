// coach-config.ts
// Single source of truth for the public coach/squad profile page.
// Every visual variant (8 combos of theme × style × nav) is driven by this
// object — layout and section components never fork per combination.

export interface CoachConfig {
  theme: "light" | "dark";
  style: "modern" | "traditional";
  nav: "top" | "sidebar";
  brandColor: string; // hex
  name: string;
  slug: string;
  tagline: string;
  disciplines: string[];
  heroImageUrl: string;
  logoInitials: string;
  teamName?: string;
  teamLogoUrl?: string;
  coachPhotoUrl?: string;
  stats: { label: string; value: string }[];
  bio: string;
  certifications: string[];
  sampleSessions: { name: string; target: string; purpose: string }[];
  galleryImages: string[];
  plans: {
    name: string;
    price: string;
    period: string;
    description: string;
    featured?: boolean;
  }[];
  testimonials: { quote: string; author: string }[];
  location: { city: string; venue?: string; remoteAvailable: boolean };
  contact: { email: string; phone?: string; instagram?: string; strava?: string };
}

export const defaultCoachConfig: CoachConfig = {
  theme: "light",
  style: "modern",
  nav: "top",
  brandColor: "#BD4130",
  name: "Marcus Webb",
  slug: "marcus-webb",
  tagline: "Track and interval-based coaching for runners chasing their next PR",
  disciplines: ["Track & Interval", "Marathon", "5K/10K"],
  heroImageUrl:
    "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80",
  logoInitials: "MW",
  stats: [
    { label: "Years coaching", value: "11" },
    { label: "Athletes coached", value: "38" },
    { label: "Boston qualifiers", value: "14" },
    { label: "Interval sessions/wk avg", value: "3" },
  ],
  bio: "Former 2:19 marathoner turned coach. I build plans around structured track and interval work, adjusted week to week based on how sessions actually go — not a generic template.",
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
    { quote: "The interval sessions actually match what I run on race day now.", author: "Sarah K. — 2:58 marathon debut" },
    { quote: "Every week is different because he's actually watching how I respond.", author: "Dev P. — first sub-3:30 marathon" },
  ],
  location: { city: "Melbourne, AU", venue: "Fawkner Park Track", remoteAvailable: true },
  contact: { email: "marcus@example.com", instagram: "@marcuswebbcoaching" },
};

function asArray<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v as object) as T[];
  return [];
}

export function coachRowToConfig(row: Record<string, any>): CoachConfig {
  const d = defaultCoachConfig;
  return {
    theme: row.theme === "dark" ? "dark" : "light",
    style: row.style === "traditional" ? "traditional" : "modern",
    nav: row.nav === "sidebar" ? "sidebar" : "top",
    brandColor: row.brand_color || d.brandColor,
    name: row.name || d.name,
    slug: row.slug || d.slug,
    tagline: row.tagline || "",
    disciplines: asArray<string>(row.disciplines),
    heroImageUrl: row.hero_image_url || d.heroImageUrl,
    logoInitials: row.logo_initials || initials(row.name || d.name),
    teamName: row.team_name || undefined,
    teamLogoUrl: row.logo_url || undefined,
    coachPhotoUrl: row.coach_photo_url || undefined,
    stats: asArray(row.stats).map((s: any) => ({
      label: s.label ?? s.key ?? "",
      value: String(s.value ?? s.stat ?? ""),
    })),
    bio: row.bio || "",
    certifications: asArray<string>(row.certifications),
    sampleSessions: asArray(row.sample_sessions).map((s: any) => ({
      name: s.name ?? "",
      target: s.target ?? "",
      purpose: s.purpose ?? "",
    })),
    galleryImages: asArray<string>(row.gallery_images),
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
    },
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
