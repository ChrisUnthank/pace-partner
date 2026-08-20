import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Apple, Bandage, Bath, CalendarDays, CalendarRange, ClipboardList, Clock, FlaskConical, Footprints, HeartPulse, IdCard, NotebookPen, TestTube2, Ticket , Droplet } from "lucide-react";

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

// Deliberately EMPTY.
//
// Coaching moved from a leaf-plus-tab-strip to a grouped sidebar bucket
// ("Build training" / "Squad admin"). Keeping the strip as well would put the
// same five links on screen twice, with neither one authoritative.
//
// Emptied rather than removed, and the pages left importing it, because
// BucketTabStrip already returns null at length <= 1 — so every Coaching page
// loses its strip from this single change. Editing five route files to delete
// the import would touch five more files through a sync that has been
// silently merging rather than replacing them, and the risk of that outweighs
// tidying up an unused import.
//
// If Coaching ever needs a strip again, repopulate here.
export const COACHING_HUB_TABS: BucketTabItem[] = [];

// Locker — personal schedule (moved from Training), plus gear,
// credentials, and event entries as each gets built. Schedule is the only
// tab so far, so this strip won't actually render yet (BucketTabStrip
// hides itself at length <= 1) until Gear lands.
export const LOCKER_TABS: BucketTabItem[] = [
  { to: "/app/my-schedule", label: "Diary", icon: NotebookPen },
  { to: "/app/gear", label: "Gear", icon: Footprints },
  { to: "/app/credentials", label: "Credentials", icon: IdCard },
  { to: "/app/event-entries", label: "Event Entries", icon: Ticket },
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
  { to: "/app/injuries", label: "Injury & Illness", icon: Bandage },
  // Bloods, Lactate and Bicarb collapsed behind one entry. Eight tabs had
  // stopped being a navigation aid — the strip scrolls on a phone, so the
  // last two were effectively hidden anyway.
  { to: "/app/bloods", label: "Lab", icon: TestTube2 },
];

// The three pages behind "Lab".
//
// NOT "Testing", which was the first choice and was wrong: `time_trial` is
// an established session intent in this app, and zone-calculator.ts already
// talks about "a lab test, a time trial, or a coach's judgement". A tab
// called Testing would collide with a concept that already exists and means
// something else entirely — a coach looking for their athlete's test results
// could reasonably land there expecting time trials.
//
// "Lab" also earns the bicarb page in a way "Biomarkers" would not. A blood
// panel and a lactate step test are measurements; a bicarb log is a protocol
// trial — a dose, a timing, and how the athlete responded. The lab is where
// you run things on an athlete and write down what happened, which covers
// all three without stretching.
export const LAB_TABS: BucketTabItem[] = [
  { to: "/app/bloods", label: "Bloods", icon: Droplet },
  { to: "/app/lactate", label: "Lactate", icon: TestTube2 },
  { to: "/app/bicarb", label: "Bicarb", icon: FlaskConical },
];

export function labTabsFor(athleteId?: string): BucketTabItem[] {
  return LAB_TABS.map((t) => ({ ...t, search: athleteId ? { athleteId } : undefined }));
}

// HEALTH_TABS' links never carried an athleteId through, even though
// BucketTabItem.search existed for exactly this — so a coach switching
// from, say, Injury Management to Diet & Fuel silently dropped whichever
// athlete they were looking at and landed back on their own (or nobody's)
// data. Every Health & Vitals sub-page should build its tab list through
// this helper instead of using the bare HEALTH_TABS constant directly.
export function healthTabsFor(athleteId?: string): BucketTabItem[] {
  return HEALTH_TABS.map((t) => ({ ...t, search: athleteId ? { athleteId } : undefined }));
}

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
