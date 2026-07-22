import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CalendarDays, CalendarRange, ClipboardList, BookmarkCheck, LayoutGrid, Clock, CalendarHeart, HeartPulse, Apple, Bath, Bandage, FlaskConical, TestTube2, Footprints, IdCard } from "lucide-react";

export type BucketTabItem = {
  to: string;
  label: string;
  icon: any;
  // Optional search params, same pattern AthleteSubnav uses for tabs that
  // need to carry e.g. ?athleteId= through the link.
  search?: Record<string, string>;
};

// Shared tab-set definitions — single source of truth so Training's pages
// and Coaching Hub's pages import the same array rather than each
// redeclaring it, which would risk drifting apart (e.g. one page's strip
// missing a tab the others have).
export const TRAINING_TABS: BucketTabItem[] = [
  { to: "/app/sessions", label: "Sessions", icon: CalendarDays },
  { to: "/app/sessions/calendar", label: "Calendar", icon: CalendarRange },
  // Open to everyone (coach, athlete, and parent) — unlike the other
  // Training tabs, this one isn't filtered by role at the call sites.
  { to: "/app/training-schedule", label: "Training Schedule", icon: Clock },
];

export const COACHING_HUB_TABS: BucketTabItem[] = [
  { to: "/app/coaching-hub", label: "Overview", icon: LayoutGrid },
  { to: "/app/templates", label: "Session Templates", icon: BookmarkCheck },
  { to: "/app/plans", label: "Plans", icon: CalendarRange },
];

// Locker — personal schedule (moved from Training), plus gear,
// credentials, and event entries as each gets built. Schedule is the only
// tab so far, so this strip won't actually render yet (BucketTabStrip
// hides itself at length <= 1) until Gear lands.
export const LOCKER_TABS: BucketTabItem[] = [
  { to: "/app/my-schedule", label: "Schedule", icon: CalendarHeart },
  { to: "/app/gear", label: "Gear", icon: Footprints },
  { to: "/app/credentials", label: "Credentials", icon: IdCard },
];

// Health & Vitals — Daily Log moved here from Training (it's the
// day-to-day vitals/soreness/injury log, not a training-load page). More
// tabs (Diet & Fuel, Recovery, Injury Management, Bicarb, Lactate) get
// appended here as each is built, same incremental pattern Coaching Hub
// followed with its own tabs.
export const HEALTH_TABS: BucketTabItem[] = [
  { to: "/app/health", label: "Overview", icon: HeartPulse },
  { to: "/app/daily-log", label: "Daily Log", icon: ClipboardList },
  { to: "/app/diet-fuel", label: "Diet & Fuel", icon: Apple },
  { to: "/app/recovery", label: "Recovery", icon: Bath },
  { to: "/app/injuries", label: "Injury Management", icon: Bandage },
  { to: "/app/bicarb", label: "Bicarb", icon: FlaskConical },
  { to: "/app/lactate", label: "Lactate", icon: TestTube2 },
];

// Generic sibling-switcher for pages grouped under one of the sidebar's
// accordion buckets (Training / Metrics / Performances / Community).
// Deliberately NOT athlete-scoped — AthleteSubnav already covers that
// case for pages reached from a specific athlete's context. This is for
// the bucket-level grouping introduced alongside the sidebar accordion.
//
// Exists mainly for mobile, where the bottom nav can only show one tap
// target per bucket (its first child) — this strip is how someone gets
// to a sibling page from there. Doubles as a quick desktop shortcut too,
// so it always renders, not just on small screens.
export function BucketTabStrip({ items, active }: { items: BucketTabItem[]; active: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (items.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 print:hidden">
      {items.map((item) => {
        const isActive = item.to === active || path === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            search={item.search as any}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 h-8 text-xs font-medium transition-colors shrink-0",
              isActive
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
