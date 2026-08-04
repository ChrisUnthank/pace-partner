import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  CalendarRange,
  Users,
  User2,
  LogOut,
  Home,
  BookmarkCheck,
  LineChart,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Zap,
  HeartPulse,
  Clock,
  Backpack,
  Megaphone,
  MessageSquare,
  MessageCircle,
  Trophy,
  Gauge,
  Calculator,
  GitCompare,
  IdCard,
  FileText,
  Flag,
  Globe,
  Map as MapIcon,
  PersonStanding,
  UserCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { useQuery } from "@tanstack/react-query";
import { useViewMode } from "@/lib/view-mode";

type NavLeaf = { to: string; label: string; icon: any; show: boolean };
type NavBucket = { id: string; label: string; icon: any; children: NavLeaf[] };
// Unified ordering type — lets standalone links (leaves) and accordion
// groups (buckets) interleave in one render pass instead of always
// rendering "all leaves, then all buckets" as two separate blocks. Needed
// once Health & Vitals had to sit between the Metrics and Performances
// buckets rather than up with Home/Athletes/Coaching Hub.
type NavEntry = ({ kind: "leaf" } & NavLeaf) | ({ kind: "bucket" } & NavBucket);

// Plain path.startsWith(to) treats routes as string prefixes, not path
// segments — "/app/coaching-hub" starts with the literal characters
// "/app/coach", so the Coach Profile link (and its Community bucket) was
// lighting up on every Coaching Hub visit. Same class of bug hits
// "/app/athletes" vs "/app/athlete". Requiring either an exact match or a
// real "/" boundary after `to` fixes both without touching route paths.
// "/app" itself is a special case — literally every route is nested under
// it, so it only ever counts as active on an exact match.
function isPathActive(current: string, to: string): boolean {
  if (to === "/app") return current === "/app";
  return current === to || current.startsWith(to + "/");
}

export function AppShell({ children, fullWidth = false }: { children: ReactNode; fullWidth?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  // View-mode flags — use these (not isCoach/isAthlete) for anything that
  // decides WHICH VIEW to show. For a single-role user these always equal
  // their real role; for a dual-role user (coach who's also an athlete)
  // they follow the header toggle below instead, so the sidebar and every
  // page that reads them shows one coherent view at a time rather than a
  // merged coach+athlete nav neither role actually wants.
  const { isCoachView, isAthleteView, isDualRole, viewMode, setViewMode } = useViewMode();
  // Parent Portal: deliberately narrow. Most existing "show: true" items
  // below were written back when only coach/athlete existed, so "true"
  // effectively meant "either of the two roles that existed" — now that
  // parent is a real role too, those need to explicitly exclude it rather
  // than silently start showing pages that assume a coach's roster or an
  // athlete's own data exists for the signed-in user.
  const isParent = roles.includes("parent");
  const isCoachOrAthlete = isCoach || isAthlete;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  // Manual open/close overrides per bucket — a bucket is open if the user
  // explicitly opened it OR the current route falls inside it (see
  // isBucketActive below), UNLESS the user explicitly closed it, in which
  // case that closure wins even while active. Undefined = no override yet,
  // defer entirely to "is this bucket active".
  const [bucketOverrides, setBucketOverrides] = useState<Map<string, boolean>>(new Map());

  const { data: coachProfile } = useQuery({
    queryKey: ["my-coach-profile-slug", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coach_profiles")
        .select("slug")
        .eq("coach_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // Standalone top-level items — these deliberately stay outside any
  // bucket. Athletes already has its own Overview + AthleteSubnav pattern
  // once you're inside a specific athlete, so it doesn't need a second
  // layer of grouping here. Account is login/settings/subscription only —
  // not a bucket, just like Home and Athletes. Deliberately renamed from
  // "Profile" — that word was doing double (triple, really) duty against
  // the public Athlete Profile Page and Performance Profile/Athlete
  // Intelligence, which made it genuinely ambiguous in conversation and
  // in nav. Athlete-specific training data that used to live here (Zone
  // Boundaries, Goals, Seasons) moved to the athlete's own Athlete Info
  // page instead — see the new /app/athlete-info nav item below.
  //
  // Account stays standalone too, but renders after everything else (its
  // original position at the end of the nav) rather than up top with
  // Home/Athletes — it's the account-settings page, not a frequent
  // destination the way Home is.
  const accountItems: NavLeaf[] = [{ to: "/app/account", label: "Account", icon: User2, show: true }];

  // Single ordered list — this array's order IS the sidebar's visual
  // order, so leaves and buckets can be interleaved (Health & Vitals sits
  // after the Metrics bucket and before Performances, per Chris's ask,
  // rather than being grouped with the other standalone leaves up top).
  const navEntries: NavEntry[] = [
    { kind: "leaf", to: "/app", label: "Home", icon: Home, show: true },
    { kind: "leaf", to: "/app/athletes", label: "Athletes", icon: Users, show: isCoachView },
    // Self-service equivalent of the coach's "Athletes" roster above —
    // never both visible at once (the two flags are mutually exclusive).
    // Redirects to this athlete's own Athlete Info tabs (Athlete
    // Information / Physiological Metrics / Athlete DNA / Goals), the
    // same page a coach sees for any one athlete on their roster, instead
    // of a separate bespoke self-service page. Identity/Goals/Zones/
    // Seasons moved here from the old Profile/Account page.
    { kind: "leaf", to: "/app/athlete-info", label: "Athlete Info", icon: UserCircle2, show: isAthleteView },
    // Coaching Hub: session templates, plan templates, active plans — and
    // room to grow into a session library / phase builder later. Gets its
    // own Overview + tab-strip (BucketTabStrip, same component the
    // sidebar buckets use) rather than living inside the Training
    // accordion, since — like Athletes — it has a real landing dashboard
    // to earn that treatment, not just a handful of unrelated tools.
    { kind: "leaf", to: "/app/coaching-hub", label: "Coaching Hub", icon: BookmarkCheck, show: isCoachView },
    {
      kind: "bucket",
      id: "training",
      label: "Training",
      icon: CalendarDays,
      children: [
        { to: "/app/sessions", label: "Sessions", icon: CalendarDays, show: isCoachOrAthlete },
        { to: "/app/sessions/calendar", label: "Calendar", icon: CalendarRange, show: isCoachOrAthlete },
        // Open to everyone — coach, athlete, and parent alike. This is
        // also what surfaces the Training bucket in a parent's sidebar
        // for the first time, since Sessions/Calendar stay hidden from
        // them. (Daily Log moved to Health & Vitals; My Schedule moved
        // to the new Locker area.)
        { to: "/app/training-schedule", label: "Training Schedule", icon: Clock, show: true },
        // Placeholder page for now (coming soon) — placed here rather than
        // its own bucket since a route library is fundamentally a training-
        // planning tool, same audience as Sessions/Calendar/Schedule.
        { to: "/app/maps", label: "Maps & Routes", icon: MapIcon, show: isCoachOrAthlete },
      ],
    },
    {
      kind: "bucket",
      id: "metrics",
      label: "Metrics",
      icon: LineChart,
      children: [
        { to: "/app/analytics", label: "Analytics", icon: LineChart, show: isCoachOrAthlete },
        { to: "/app/zones", label: "Zones", icon: Gauge, show: isAthleteView || isCoachView },
        // Placeholder page for now (coming soon) — grouped with the other
        // athlete-performance-data pages rather than Health & Vitals,
        // since form/gait metrics sit alongside pace/HR/load analysis
        // rather than being a wellbeing or injury-log concern.
        { to: "/app/biomechanics", label: "Biomechanics", icon: PersonStanding, show: isAthleteView || isCoachView },
        { to: "/app/compare", label: "Compare", icon: GitCompare, show: isCoachOrAthlete },
        { to: "/app/reports", label: "Reports", icon: FileText, show: isCoachOrAthlete },
        // Was fully built (Pace/Race Predictor, Starting Fitness) but never
        // wired into any nav — reachable only by typing the URL directly.
        // Added here since both existing calculators are Metrics-shaped
        // tools (pace/fitness estimation), same audience as the rest of
        // this bucket.
        { to: "/app/calculators", label: "Calculators", icon: Calculator, show: isCoachOrAthlete },
      ],
    },
    // Health & Vitals: daily log, diet/fuel, recovery, injury management,
    // bicarb, lactate — a cross-cutting per-athlete area. Sits right after
    // Metrics and before Performances/Community, rather than up with
    // Athletes/Coaching Hub. Coach and athlete both see it; a coach
    // reaches a specific athlete's data via the Health tab on that
    // athlete's own view (AthleteSubnav), same as Zones/Analytics. Own
    // Overview + tab-strip, same pattern as Coaching Hub.
    { kind: "leaf", to: "/app/health", label: "Health & Vitals", icon: HeartPulse, show: isCoachOrAthlete },
    // Locker: personal schedule, gear, credentials, event entries — same
    // standalone-leaf-with-its-own-tab-strip treatment as Health & Vitals
    // and Coaching Hub. Athlete/parent only for now, matching what My
    // Schedule (now its first tab) has always been restricted to — not
    // coach-visible, since the schedule itself mixes in private personal
    // calendar entries. Revisit this visibility once Gear is built, since
    // a coach may reasonably want to see an athlete's gear/usage even
    // though the Schedule tab stays private.
    { kind: "leaf", to: "/app/my-schedule", label: "Locker", icon: Backpack, show: isAthleteView || isParent },
    {
      kind: "bucket",
      id: "performances",
      label: "Performances",
      icon: Trophy,
      children: [
        // Coach-visible too: both index pages are already fully coach-aware
        // (all-athletes listing, per-athlete filter, AthleteSubnav when
        // filtered) — these were show: isAthlete only, which is why coaches
        // had no sidebar path to Races/Race Tactics at all.
        { to: "/app/races", label: "Races", icon: Trophy, show: isCoachOrAthlete },
        { to: "/app/race-tactics", label: "Race Tactics", icon: Flag, show: isCoachOrAthlete },
        // Coach-created shared events linking several athletes' results to
        // the same real race — see race_events. Athlete-visible too (not
        // isCoachView-only) since an athlete linked to a coach-created
        // event should be able to see how they placed among teammates,
        // not just their own single result.
        { to: "/app/race-events", label: "Race Events", icon: Users, show: isCoachOrAthlete },
      ],
    },
    {
      kind: "bucket",
      id: "community",
      label: "Community",
      icon: MessageSquare,
      children: [
        { to: "/app/noticeboard", label: "Noticeboard", icon: Megaphone, show: true },
        { to: "/app/group-chat", label: "Group Chat", icon: MessageCircle, show: true },
        // Messages stays 1:1 coach<->athlete for now — no parent
        // "observer" concept exists on direct_messages yet, so kept out
        // of the parent portal's scope rather than exposing a broken/
        // empty inbox.
        { to: "/app/messages", label: "Messages", icon: MessageSquare, show: isCoachOrAthlete },
        { to: "/app/coach", label: "Coach Profile", icon: IdCard, show: isCoachView },
        { to: "/app/athlete", label: "Athlete Page", icon: Globe, show: isAthleteView },
      ],
    },
  ];

  const visibleAccountItems = accountItems.filter((n) => n.show);
  // Buckets drop hidden children first; empty buckets and hidden leaves
  // are then filtered out — same visibility rules as before, just applied
  // across one interleaved list instead of two separate ones.
  const visibleEntries: NavEntry[] = navEntries
    .map((e) => (e.kind === "bucket" ? { ...e, children: e.children.filter((c) => c.show) } : e))
    .filter((e) => (e.kind === "bucket" ? e.children.length > 0 : e.show));

  function isBucketActive(bucket: NavBucket) {
    return bucket.children.some((c) => isPathActive(path, c.to));
  }

  function isBucketOpen(bucket: NavBucket) {
    const override = bucketOverrides.get(bucket.id);
    if (override !== undefined) return override;
    return isBucketActive(bucket);
  }

  function toggleBucket(bucket: NavBucket) {
    setBucketOverrides((prev) => {
      const next = new Map(prev);
      next.set(bucket.id, !isBucketOpen(bucket));
      return next;
    });
  }

  // Breadcrumb label — longest-matching `to` wins (rather than relying on
  // array order) so e.g. "/app/sessions/calendar" resolves to "Calendar"
  // and not the shorter "/app/sessions" → "Sessions" match.
  const allLeaves = useMemo(
    () => [...visibleEntries.flatMap((e) => (e.kind === "bucket" ? e.children : [e])), ...visibleAccountItems],
    [visibleEntries, visibleAccountItems],
  );
  const crumb = (() => {
    const matches = allLeaves.filter((n) => isPathActive(path, n.to));
    if (matches.length === 0) return "Strider";
    return matches.reduce((best, n) => (n.to.length > best.to.length ? n : best)).label;
  })();

  // Mobile bottom nav: buckets collapse to a single tap target — their
  // first visible child — since a bottom bar can't show an expanded
  // accordion. Tapping it lands on that page, whose own top tab-strip
  // (added in phase 2) lets you switch to a sibling from there. Order
  // mirrors the sidebar's visibleEntries, so Health still lands between
  // Metrics and Performances here too.
  const mobileItems: (NavLeaf & { bucketActive?: boolean })[] = [
    ...visibleEntries.map((e) =>
      e.kind === "bucket"
        ? { to: e.children[0].to, label: e.label, icon: e.icon, show: true, bucketActive: isBucketActive(e) }
        : e,
    ),
    ...visibleAccountItems,
  ];

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 sticky top-0 h-screen overflow-y-auto brand-scrollbar print:hidden",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("h-14 flex items-center border-b border-border", collapsed ? "justify-center" : "px-5")}>
          <Link to="/app" className="flex items-center gap-2 group">
            <span className="w-7 h-7 grid place-items-center rounded-md bg-[var(--accent-red)] shadow-[0_0_18px_-4px_var(--accent-red)]">
              <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
            </span>
            {!collapsed && (
              <span className="font-display text-base font-extrabold tracking-tight uppercase">Strider</span>
            )}
          </Link>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {/* Single interleaved pass — order comes straight from
              visibleEntries, so Health & Vitals (a leaf) renders between
              the Metrics and Performances buckets exactly as listed above. */}
          {visibleEntries.map((entry) => {
            if (entry.kind === "leaf") {
              const active = isPathActive(path, entry.to);
              return (
                <Link
                  key={entry.to}
                  to={entry.to}
                  title={collapsed ? entry.label : undefined}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                    collapsed ? "justify-center h-10" : "px-3 h-10",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent-red)]" />
                  )}
                  <entry.icon className={cn("h-4 w-4", active && "text-[var(--accent-red)]")} />
                  {!collapsed && <span>{entry.label}</span>}
                </Link>
              );
            }

            // Bucket — accordion. When the sidebar itself is collapsed to
            // icon-only width, it falls back to acting like a flat icon
            // link to its first child (an accordion can't really work at
            // 64px wide) rather than being unusable.
            const bucket = entry;
            const active = isBucketActive(bucket);
            const open = collapsed ? false : isBucketOpen(bucket);

            if (collapsed) {
              const first = bucket.children[0];
              return (
                <Link
                  key={bucket.id}
                  to={first.to}
                  title={bucket.label}
                  className={cn(
                    "relative flex items-center justify-center h-10 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent-red)]" />
                  )}
                  <bucket.icon className={cn("h-4 w-4", active && "text-[var(--accent-red)]")} />
                </Link>
              );
            }

            return (
              <div key={bucket.id}>
                <button
                  type="button"
                  onClick={() => toggleBucket(bucket)}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-3 h-10 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                  )}
                  aria-expanded={open}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent-red)]" />
                  )}
                  <bucket.icon className={cn("h-4 w-4", active && "text-[var(--accent-red)]")} />
                  <span className="flex-1 text-left">{bucket.label}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                  <div className="ml-3.5 pl-3 border-l border-border space-y-0.5 py-0.5">
                    {bucket.children.map((n) => {
                      const childActive = isPathActive(path, n.to);
                      return (
                        <Link
                          key={n.to}
                          to={n.to}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] font-medium transition-colors",
                            childActive
                              ? "bg-sidebar-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                          )}
                        >
                          <n.icon className={cn("h-3.5 w-3.5", childActive && "text-[var(--accent-red)]")} />
                          <span>{n.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone account item (Profile) — same simple link style as
              Home/Athletes, deliberately rendered after the buckets since
              it's a settings destination, not a frequent one. */}
          {visibleAccountItems.map((n) => {
            const active = isPathActive(path, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center h-10" : "px-3 h-10",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--accent-red)]" />
                )}
                <n.icon className={cn("h-4 w-4", active && "text-[var(--accent-red)]")} />
                {!collapsed && <span>{n.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "w-full flex items-center gap-2 h-9 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors",
              collapsed ? "justify-center" : "px-3",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" /> Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/app" className="md:hidden flex items-center gap-2">
              <span className="w-6 h-6 grid place-items-center rounded-md bg-[var(--accent-red)]">
                <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
              </span>
            </Link>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <span>Strider</span>
              <span className="text-border">/</span>
              <span className="text-foreground">{crumb}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            {isDualRole && (
              <div
                className="hidden sm:flex items-center rounded-md border border-border p-0.5 text-[11px] font-bold uppercase tracking-wider"
                role="group"
                aria-label="View as"
              >
                <button
                  type="button"
                  onClick={() => setViewMode("coach")}
                  className={cn(
                    "px-2.5 h-6 rounded transition-colors",
                    viewMode === "coach"
                      ? "bg-[var(--accent-red)] text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Coach
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("athlete")}
                  className={cn(
                    "px-2.5 h-6 rounded transition-colors",
                    viewMode === "athlete"
                      ? "bg-[var(--accent-red)] text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Athlete
                </button>
              </div>
            )}
            {isParent && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5">
                Parent view
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[180px]">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Mobile nav — was a fixed bottom bar with icon+label (labels
            wrapping to a second line to fit); now icon-only and moved to
            sit right below the header instead, per direct request. Icon-
            only buys enough width that every top-level item — including
            collapsed bucket entries — fits in one row without crowding,
            and `title` on each Link keeps the label available on a
            long-press/tooltip rather than dropping it entirely.
            `sticky top-14` stacks it directly under the header (which is
            itself `sticky top-0`, 56px/h-14 tall) — both scroll together
            as one fixed-feeling top cluster, standard stacked-sticky-bars
            behavior, no separate fixed-position bookkeeping needed. Since
            it's no longer pinned out-of-flow at the bottom, `main` no
            longer needs the old bottom padding reserved to clear it. */}
        <nav
          className="md:hidden sticky top-14 z-10 border-b border-border bg-background/95 backdrop-blur-md flex print:hidden"
        >
          {mobileItems.map((n) => {
            const active = n.bucketActive ?? isPathActive(path, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                title={n.label}
                aria-label={n.label}
                className={cn(
                  "flex-1 min-w-0 flex items-center justify-center py-2.5",
                  active ? "text-[var(--accent-red)]" : "text-muted-foreground",
                )}
              >
                <n.icon className="h-4.5 w-4.5 shrink-0" strokeWidth={active ? 2.5 : 2} />
              </Link>
            );
          })}
        </nav>

        <main
          className={cn(
            "flex-1 px-4 md:px-8 py-6 md:py-8 w-full mx-auto print:p-0 print:max-w-none",
            fullWidth ? "max-w-none" : "max-w-7xl",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
