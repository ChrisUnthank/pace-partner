import {
  LayoutGrid,
  IdCard,
  Gauge,
  CalendarRange,
  CalendarDays,
  LineChart,
  Trophy,
  Globe,
  HeartPulse,
  PersonStanding,
} from "lucide-react";

// Same ten destinations as AthleteSubnav (the tab strip shown once a coach
// is already inside a single athlete's pages), just rendered as a bare icon
// row wherever a coach needs to jump straight to any one of them without
// opening the athlete first — currently the Roster page and the Home
// dashboard's "Your athletes" widget. Shared here rather than duplicated
// per file, since both call sites need the exact same nine destinations to
// stay in sync as AthleteSubnav evolves. No "active tab" concept here
// (unlike AthleteSubnav) — every icon always renders the same (red)
// regardless of which page you're currently on.
export function athleteNavTabs(athleteId: string, slug?: string | null) {
  return [
    { key: "overview", label: "Overview", icon: LayoutGrid, to: "/app/athletes/$athleteId", params: { athleteId } },
    { key: "calendar", label: "Calendar", icon: CalendarRange, to: "/app/sessions/calendar", search: { athleteId } },
    { key: "sessions", label: "Sessions", icon: CalendarDays, to: "/app/sessions", search: { athleteId } },
    { key: "analytics", label: "Analytics", icon: LineChart, to: "/app/analytics", search: { athleteId } },
    { key: "biomechanics", label: "Biomechanics", icon: PersonStanding, to: "/app/biomechanics", search: { athleteId } },
    { key: "health", label: "Health", icon: HeartPulse, to: "/app/health", search: { athleteId } },
    {
      key: "performance-profile",
      label: "Performance Profile",
      icon: IdCard,
      to: "/app/athletes/$athleteId/performance-profile",
      params: { athleteId },
    },
    { key: "zones", label: "Zones", icon: Gauge, to: "/app/zones", search: { athleteId } },
    { key: "races", label: "Races", icon: Trophy, to: "/app/races", search: { athleteId } },
    slug
      ? { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete/$slug", params: { slug } }
      : { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete", search: { athleteId } },
  ] as const;
}
