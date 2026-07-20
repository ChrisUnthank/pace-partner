import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LayoutGrid, IdCard, Gauge, CalendarDays, LineChart, Trophy, Flag, Globe } from "lucide-react";

export type AthleteSubnavTab =
  | "overview"
  | "performance-profile"
  | "zones"
  | "calendar"
  | "analytics"
  | "races"
  | "race-tactics"
  | "athlete-page";

// Shared tab strip for every page reached from an athlete's full view —
// Overview, Performance Profile, Calendar, Analytics, Races, Race Tactics,
// and the athlete's public Athlete Page. Lets a coach jump directly from
// any one of these to any other, rather than only being able to navigate
// back to Overview and out again.
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
    {
      key: "performance-profile",
      label: "Performance Profile",
      icon: IdCard,
      to: "/app/athletes/$athleteId/performance-profile",
      params: { athleteId },
    },
    { key: "zones", label: "Zones", icon: Gauge, to: "/app/zones", search: { athleteId } },
    { key: "calendar", label: "Calendar", icon: CalendarDays, to: "/app/sessions/calendar", search: { athleteId } },
    { key: "analytics", label: "Analytics", icon: LineChart, to: "/app/analytics", search: { athleteId } },
    { key: "races", label: "Races", icon: Trophy, to: "/app/races", search: { athleteId } },
    { key: "race-tactics", label: "Race Tactics", icon: Flag, to: "/app/race-tactics", search: { athleteId } },
    athletePage?.slug
      ? { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete/$slug", params: { slug: athletePage.slug } }
      : { key: "athlete-page", label: "Athlete Page", icon: Globe, to: "/app/athlete", search: { athleteId } },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-border overflow-x-auto -mb-px">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            to={t.to as any}
            params={t.params as any}
            search={t.search as any}
            className={cn(
              "relative flex items-center gap-1.5 px-3 h-9 text-sm font-medium whitespace-nowrap shrink-0 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className={cn("h-3.5 w-3.5", isActive && "text-[var(--accent-red)]")} />
            {t.label}
            {isActive && <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] rounded-full bg-[var(--accent-red)]" />}
          </Link>
        );
      })}
    </div>
  );
}
