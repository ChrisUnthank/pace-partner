import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LayoutGrid, IdCard, Gauge, CalendarRange, CalendarDays, LineChart, Trophy, Globe, HeartPulse, PersonStanding } from "lucide-react";

export type AthleteSubnavTab =
  | "overview"
  | "health"
  | "calendar"
  | "sessions"
  | "analytics"
  | "biomechanics"
  | "performance-profile"
  | "zones"
  | "races"
  | "athlete-page";

// Shared tab strip for every page reached from an athlete's full view —
// Overview, Calendar, Sessions, Analytics, Biomechanics, Health,
// Performance Profile, Zones, Races, and the athlete's public Athlete
// Page. Lets a coach jump directly from any one of these to any other,
// rather than only being able to navigate back to Overview and out
// again. Race Tactics deliberately isn't a tab here — it's reached via
// a prominent link on the Races page instead, since it's conceptually a
// sub-area of race results, not a peer of it.
export function AthleteSubnav({ athleteId, active }: { athleteId: string; active: AthleteSubnavTab }) {
  // The Athlete Page tab needs to know whether this athlete already has a
  // public page (link straight to it) or not (fall back to the
  // create/open picker, pre-filtered to this athlete).
  const { data: athletePage } = useQuery({
    queryKey: ["athlete-subnav-page", athleteId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("athlete_profiles")
        .select("slug")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return data as { slug: string } | null;
    },
  });

  const tabs: {
    key: AthleteSubnavTab;
    label: string;
    icon: any;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }[] = [
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
    athletePage?.slug
      ? { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete/$slug", params: { slug: athletePage.slug } }
      : { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete", search: { athleteId } },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-border overflow-x-auto no-scrollbar -mb-px">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            to={t.to as any}
            params={t.params as any}
            search={t.search as any}
            title={t.label}
            aria-label={t.label}
            className={cn(
              "relative flex items-center justify-center h-9 w-10 shrink-0 rounded-t-md transition-colors",
              isActive ? "text-[var(--accent-red)]" : "text-foreground hover:bg-accent/50",
            )}
          >
            {/* Icon-only — no text label. Active page is still obvious at a
                glance from the red color, a bolder stroke weight (the
                closest lucide equivalent of "bold" on an outline icon),
                and the underline bar below; inactive tabs stay plain
                white/foreground rather than dimmed, since red is reserved
                for "this is where you are". */}
            <t.icon className="h-4 w-4" strokeWidth={isActive ? 2.75 : 2} />
            {isActive && <span className="absolute left-1.5 right-1.5 -bottom-[1px] h-[2px] rounded-full bg-[var(--accent-red)]" />}
          </Link>
        );
      })}
    </div>
  );
}
