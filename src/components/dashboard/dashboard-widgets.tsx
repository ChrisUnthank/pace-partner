import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { todayISO } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReadinessBadge } from "@/components/readiness-badge";
import { DashboardAlertsList } from "@/components/dashboard-alerts-panel";
import { UserAvatar } from "@/components/user-avatar";
import { RecentReviewsCard } from "@/components/recent-reviews-card";
import { CoachChat } from "@/components/coach-chat";
import { GenerateReviewCard } from "@/components/generate-review-card";
import { AthleteSummaryPanel } from "@/components/athlete-summary-panel";
import { YearlyLoadStrip } from "@/components/yearly-load-strip";
import { ActivityIcon } from "@/lib/activity-icon";
import { listPosts } from "@/lib/noticeboard.functions";
import { listMessageContacts } from "@/lib/messages.functions";
import { athleteNavTabs } from "@/lib/athlete-nav-tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listDashboardAlerts, type DashAlert } from "@/lib/dashboard-alerts.functions";
import {
  ClipboardList,
  CalendarDays,
  Megaphone,
  MessageSquare,
  MessageCircle,
  IdCard,
  Trophy,
  CalendarRange,
  LineChart,
  ArrowRight,
  HeartPulse,
  Backpack,
  AlertTriangle,
  Sparkles,
  BookmarkCheck,
  ChevronDown,
} from "lucide-react";

// ---------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------

// Animates a number counting up on mount/change — used for the squad
// readiness counts. Deliberately hand-rolled (no new dependency) rather
// than pulling in a motion library for one effect.
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 500;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular-nums">{display}</span>;
}

function relativeDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function QuickTile({
  to,
  icon: Icon,
  label,
  badge,
  params,
  search,
}: {
  to: string;
  icon: any;
  label: string;
  badge?: number;
  params?: Record<string, string>;
  search?: Record<string, string>;
}) {
  return (
    <Link
      to={to as any}
      params={params as any}
      search={search as any}
      className="relative rounded-lg border border-border p-4 flex flex-col items-center justify-center gap-2 transition-colors hover:bg-accent/50 hover:border-[var(--accent-red)]/30"
    >
      {!!badge && (
        <span className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent-red)] text-[10px] font-bold text-white flex items-center justify-center">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      <Icon className="h-5 w-5 text-[var(--accent-red)]" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}

function BigLinkCard({ to, icon: Icon, title, description }: { to: string; icon: any; title: string; description: string }) {
  return (
    <Link to={to} className="group block">
      <Card className="h-full transition-colors hover:border-[var(--accent-red)]/40 hover:bg-sidebar-accent/30">
        <CardContent className="p-5 flex items-center gap-4">
          <span className="shrink-0 w-11 h-11 rounded-lg bg-[var(--accent-red)]/10 grid place-items-center">
            <Icon className="h-5 w-5 text-[var(--accent-red)]" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-1.5">
              {title}
              <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// Shared roster + readiness queries — several coach widgets need these.
// Query keys match what the page used before this was split into
// widgets, so react-query dedupes the network call across whichever
// widgets are visible rather than each fetching its own copy.
function useHomeRoster() {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  return useQuery({
    queryKey: ["roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data, error } = await supabase
          .from("athletes")
          .select("id, name, primary_event, profile_image_url, last_log_at")
          .order("name");
        if (error) throw error;
        return (data ?? []).map((a) => ({ athlete_id: a.id, athletes: a }));
      }
      const { data, error } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, primary_event, profile_image_url, last_log_at)")
        .eq("coach_user_id", user!.id);
      if (error) throw error;
      return data;
    },
  });
}

function useRosterReadiness(roster: any[] | undefined) {
  return useQuery({
    queryKey: ["roster-readiness", roster?.map((r) => r.athlete_id).join(",")],
    enabled: !!roster && roster.length > 0,
    queryFn: async () => {
      const today = todayISO();
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("athlete_id, readiness_status, readiness_score, confidence, combined_load, ctl, atl, tsb")
        .in(
          "athlete_id",
          roster!.map((r) => r.athlete_id),
        )
        .eq("load_date", today);
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------
// Coach widgets
// ---------------------------------------------------------------------

export function QuickActionsWidget() {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <BigLinkCard to="/app/sessions/calendar" icon={CalendarRange} title="Calendar" description="See what's planned, day by day." />
      <BigLinkCard to="/app/analytics" icon={LineChart} title="Analytics" description="Trends, load, and progress over time." />
    </div>
  );
}

// Was QuickTilesWidget (Messages/Noticeboard/Athletes/Health & Vitals) —
// Athletes and Health & Vitals moved out to their own dedicated widgets, so
// this narrows to exactly the sidebar's Community bucket: Messages,
// Noticeboard, Group Chat, and the coach's own public Profile Page (same
// slug-or-create-flow pattern AthleteSubnav uses for the Athlete Page tab).
export function CommunityWidget() {
  const { user } = useAuthUser();
  const listContacts = useServerFn(listMessageContacts);
  const { data: contacts } = useQuery({
    queryKey: ["msg-contacts-home"],
    queryFn: () => listContacts(),
  });
  const unreadCount = (contacts ?? []).reduce((sum: number, c: any) => sum + (c.unread ?? 0), 0);

  // Same query key AppShell uses for its own coach-profile-slug lookup, so
  // this dedupes against that call instead of firing a second one.
  const { data: coachProfile } = useQuery({
    queryKey: ["my-coach-profile-slug", user?.id],
    enabled: !!user,
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

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <QuickTile to="/app/messages" icon={MessageSquare} label="Messages" badge={unreadCount} />
      <QuickTile to="/app/noticeboard" icon={Megaphone} label="Noticeboard" />
      <QuickTile to="/app/group-chat" icon={MessageCircle} label="Group Chat" />
      {coachProfile?.slug ? (
        <QuickTile to="/app/coach/$slug" params={{ slug: coachProfile.slug }} icon={IdCard} label="Profile Page" />
      ) : (
        <QuickTile to="/app/coach" icon={IdCard} label="Profile Page" />
      )}
    </div>
  );
}

// Covers the Coaching Hub sidebar leaf — previously the only widget-grid
// coverage for it was none at all.
export function CoachingHubWidget() {
  return (
    <BigLinkCard
      to="/app/coaching-hub"
      icon={BookmarkCheck}
      title="Coaching Hub"
      description="Session templates, plan templates, and active plans."
    />
  );
}

// Covers the Health & Vitals sidebar leaf. Shows a live active-injury
// count across the roster when there's anything worth flagging, same
// query shape as the roster-wide injury flag on the Athletes page, so the
// two stay consistent with each other.
export function HealthVitalsWidget() {
  const { data: roster } = useHomeRoster();
  const { data: injuryCount } = useQuery({
    queryKey: ["home-injury-count", roster?.map((r) => r.athlete_id).join(",")],
    enabled: !!roster && roster.length > 0,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("injuries")
        .select("id", { count: "exact", head: true })
        .in(
          "athlete_id",
          roster!.map((r) => r.athlete_id),
        )
        .neq("status", "resolved");
      if (error) throw error;
      return count ?? 0;
    },
  });
  const description = injuryCount
    ? `${injuryCount} active injur${injuryCount === 1 ? "y" : "ies"} across your roster.`
    : "Daily logs, injuries, and recovery across your roster.";
  return <BigLinkCard to="/app/health" icon={HeartPulse} title="Health & Vitals" description={description} />;
}

function last14Days(): string[] {
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// TrainingPeaks-style 14-day activity strip — one dot per day, filled red
// when a completed session lands on that date, a faint outline otherwise,
// with today marked by a ring rather than a different fill color (keeps
// "logged today" and "today, nothing yet" visually distinct at a glance).
function ActivityStrip({ activeDates }: { activeDates: Set<string> | undefined }) {
  const days = last14Days();
  const today = todayISO();
  return (
    <div className="flex items-center gap-[3px]" title="Activity, last 14 days">
      {days.map((d) => {
        const active = activeDates?.has(d);
        const isToday = d === today;
        return (
          <span
            key={d}
            className={`h-2 w-2 rounded-full shrink-0 ${
              active ? "bg-[var(--accent-red)]" : "bg-border"
            } ${isToday ? "ring-2 ring-[var(--accent-red)]/35 ring-offset-1 ring-offset-background" : ""}`}
          />
        );
      })}
    </div>
  );
}

export function YourAthletesWidget() {
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { data: roster } = useHomeRoster();
  const { data: readiness } = useRosterReadiness(roster);

  // Public Athlete Page slugs, batched the same way the Roster page does
  // it — needed so each row's "Athlete Page" icon can link straight to the
  // existing public page when one exists, same as the Roster page and
  // AthleteSubnav.
  const athleteIds = (roster ?? []).map((r: any) => r.athlete_id);
  const { data: profileSlugs } = useQuery({
    queryKey: ["roster-athlete-slugs", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_profiles")
        .select("athlete_id, slug")
        .in("athlete_id", athleteIds);
      if (error) throw error;
      const m = new Map<string, string>();
      for (const p of data ?? []) m.set(p.athlete_id, p.slug);
      return m;
    },
  });

  // Last 14 days of completed sessions per athlete, batched for the whole
  // roster — feeds the TrainingPeaks-style activity dot strip on each row.
  const { data: activityByAthlete } = useQuery({
    queryKey: ["home-roster-activity-14d", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const since = last14Days()[0];
      const { data, error } = await supabase
        .from("sessions")
        .select("athlete_id, session_date, completed_at")
        .in("athlete_id", athleteIds)
        .gte("session_date", since)
        .not("completed_at", "is", null);
      if (error) throw error;
      const m = new Map<string, Set<string>>();
      for (const s of data ?? []) {
        if (!m.has(s.athlete_id)) m.set(s.athlete_id, new Set());
        m.get(s.athlete_id)!.add(s.session_date);
      }
      return m;
    },
  });

  // Same query key + shape DashboardAlertsList/CoachingInsightsWidget
  // already use for this exact call — sharing it here is a safe dedup
  // (identical function, identical DashAlert[] shape) rather than the
  // roster/readiness key collisions fixed earlier, which mixed two
  // different shapes under one key.
  const listAlertsFn = useServerFn(listDashboardAlerts);
  const { data: alerts } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: () => listAlertsFn(),
  });
  const alertsByAthlete = new Map<string, DashAlert[]>();
  for (const a of (alerts ?? []) as DashAlert[]) {
    if (!alertsByAthlete.has(a.athlete_id)) alertsByAthlete.set(a.athlete_id, []);
    alertsByAthlete.get(a.athlete_id)!.push(a);
  }

  const selectedAthlete = roster?.find((r: any) => r.athlete_id === selectedAthleteId)?.athletes ?? null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Your athletes</CardTitle>
          {/* Solid button + icon (same ClipboardList icon the Community
              widget's old Athletes tile used) so this reads as the clear,
              obvious way into full roster management, not a secondary
              ghost/outline action. */}
          <Button asChild size="sm">
            <Link to="/app/athletes">
              <ClipboardList className="h-4 w-4 mr-1.5" />
              Manage Athletes
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {!roster || roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No athletes yet.{" "}
              <Link to="/app/athletes" className="underline">
                Add your first one
              </Link>
              .
            </p>
          ) : (
            <div className="divide-y max-h-[420px] overflow-y-auto brand-scrollbar pr-1">
              {roster.map((r: any) => {
                const ready = readiness?.find((x) => x.athlete_id === r.athlete_id);
                const slug = profileSlugs?.get(r.athlete_id) ?? null;
                const tabs = athleteNavTabs(r.athlete_id, slug);
                const athleteAlerts = alertsByAthlete.get(r.athlete_id) ?? [];
                return (
                  <div
                    key={r.athlete_id}
                    onClick={() => navigate({ to: "/app/athletes/$athleteId", params: { athleteId: r.athlete_id } })}
                    className={`flex flex-col gap-2 py-3 px-2 rounded gap-y-1 cursor-pointer hover:bg-accent/40 ${
                      selectedAthleteId === r.athlete_id ? "bg-accent/60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          // Keeps opening Quick View, not Full View — same
                          // one deliberate exception as the Roster page's
                          // matching row (see app.athletes.index.tsx).
                          e.stopPropagation();
                          setSelectedAthleteId(r.athlete_id);
                        }}
                        title="Quick view"
                        className="flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity"
                      >
                        <UserAvatar name={r.athletes?.name} imageUrl={r.athletes?.profile_image_url} size="sm" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{r.athletes?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {r.athletes?.primary_event ?? "—"}
                            {r.athletes?.last_log_at && <> · last log {formatRelative(r.athletes.last_log_at)}</>}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        {athleteAlerts.length > 0 && (
                          <span
                            title={athleteAlerts.map((a) => a.title).join(" · ")}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {athleteAlerts.length}
                          </span>
                        )}
                        <ReadinessBadge
                          status={ready?.readiness_status as any}
                          score={ready?.readiness_score as any}
                          confidence={ready?.confidence as any}
                        />
                        {/* Same sub-page jump strip as the Roster page —
                            one icon per athlete page, always red. Own
                            stopPropagation so a click here goes to that
                            specific sub-page, not the row's Full-View
                            fallback. */}
                        <div
                          className="flex items-center gap-0.5 overflow-x-auto no-scrollbar"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {tabs.map((t) => (
                            <Button
                              key={t.key}
                              asChild
                              size="icon"
                              variant="ghost"
                              title={t.label}
                              className="h-7 w-7 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)]"
                            >
                              <Link to={t.to as any} params={(t as any).params as any} search={(t as any).search as any}>
                                <t.icon className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* TrainingPeaks-style 14-day activity dot strip —
                        second line, indented to line up under the name
                        rather than crowding the identity/status row above. */}
                    <div className="pl-11">
                      <ActivityStrip activeDates={activityByAthlete?.get(r.athlete_id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick-view — a fixed side panel (Sheet), same as the Roster
          page's, rather than an in-flow block that used to render below
          the whole list — on a longer roster that meant scrolling down
          past the list to see it. */}
      <Sheet open={!!selectedAthlete} onOpenChange={(o) => !o && setSelectedAthleteId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto brand-scrollbar">
          <SheetHeader>
            <SheetTitle className="sr-only">Athlete quick view</SheetTitle>
          </SheetHeader>
          <AthleteSummaryPanel athlete={selectedAthlete} embedded onClose={() => setSelectedAthleteId(null)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

// Combines the old separate Squad Readiness and Needs Attention widgets
// into one card — the readiness counts row sits above the flagged-athletes
// list, both under a single "Coaching Insights" header. Built as
// independent sections (readiness row, then the alerts list) rather than
// one interleaved block, specifically so a third section can be added
// later without restructuring what's already here.
export function CoachingInsightsWidget() {
  const { data: roster } = useHomeRoster();
  const { data: readiness } = useRosterReadiness(roster);

  const counts = { green: 0, amber: 0, red: 0 };
  (readiness ?? []).forEach((r: any) => {
    if (r.readiness_status && counts[r.readiness_status as "green" | "amber" | "red"] !== undefined) {
      counts[r.readiness_status as "green" | "amber" | "red"]++;
    }
  });
  const loggedToday = (readiness ?? []).length;

  // Same ["dashboard-alerts"] query key DashboardAlertsList itself uses
  // below — React Query dedupes this against that component's own fetch,
  // so this is just reading the already-fetched cache, not a second
  // network request. Only needed here for the collapsed-state count badge.
  const listAlertsFn = useServerFn(listDashboardAlerts);
  const { data: alerts } = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: () => listAlertsFn(),
  });
  const alertCount = (alerts as DashAlert[] | undefined)?.length ?? 0;

  // Defaults expanded — collapsing is a new option, not a new default,
  // so nobody's homepage silently starts hiding something they're used
  // to seeing.
  const [attentionExpanded, setAttentionExpanded] = useState(true);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> Coaching Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {roster && roster.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-sm rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <AnimatedNumber value={counts.green} /> ready
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 ml-2" />
              <AnimatedNumber value={counts.amber} /> caution
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 ml-2" />
              <AnimatedNumber value={counts.red} /> recover
            </div>
            <span className="text-muted-foreground">
              · <AnimatedNumber value={loggedToday} /> of {roster.length} logged today
            </span>
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={() => setAttentionExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
              {alertCount > 0 && (
                <Badge variant="secondary" className="ml-1 normal-case font-normal">
                  {alertCount}
                </Badge>
              )}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${attentionExpanded ? "" : "-rotate-90"}`} />
          </button>
          {attentionExpanded && <DashboardAlertsList embedded />}
        </div>
      </CardContent>
    </Card>
  );
}

export function UpcomingRacesWidget() {
  const { data: roster } = useHomeRoster();
  const { data: upcomingRaces } = useQuery({
    queryKey: ["upcoming-races", roster?.map((r) => r.athlete_id).join(",")],
    enabled: !!roster && roster.length > 0,
    queryFn: async () => {
      const today = todayISO();
      const twoWeeksOut = new Date();
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, session_date, athlete_id")
        .in(
          "athlete_id",
          roster!.map((r) => r.athlete_id),
        )
        .eq("day_type", "race")
        .gte("session_date", today)
        .lte("session_date", twoWeeksOut.toISOString().slice(0, 10))
        .order("session_date", { ascending: true })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-[var(--accent-red)]" /> Upcoming races
        </CardTitle>
      </CardHeader>
      <CardContent className={upcomingRaces && upcomingRaces.length > 0 ? "space-y-1" : undefined}>
        {!upcomingRaces || upcomingRaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in the next two weeks.</p>
        ) : (
          upcomingRaces.map((race: any) => {
            const athleteName = roster?.find((r) => r.athlete_id === race.athlete_id)?.athletes?.name;
            return (
              // race.id here is a sessions.id (this queries the sessions
              // table), so it links to the session page, not
              // /app/races/$raceId (which takes a performances.id — an
              // upcoming race has no performances row yet).
              <Link
                key={race.id}
                to="/app/sessions/$sessionId"
                params={{ sessionId: race.id }}
                className="flex items-center justify-between py-1.5 text-sm hover:bg-accent/50 rounded px-1 -mx-1"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{race.title ?? "Race"}</div>
                  <div className="text-xs text-muted-foreground truncate">{athleteName}</div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{relativeDate(race.session_date)}</span>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function RecentReviewsWidget() {
  return <RecentReviewsCard />;
}

// Was a fixed block outside the widget grid entirely (app.index.tsx),
// always pinned to the bottom of the page regardless of layout
// customization — same content, same dual-role-only gate, now a real
// widget so it can be moved, resized (via its catalog span), or hidden
// like everything else.
export function QuickLinksSelfWidget() {
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const isAthlete = rawRoles.includes("athlete");
  const isCoach = rawRoles.includes("coach") || rawRoles.includes("manager");

  if (!(isAthlete && athlete && isCoach)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick links</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/app/daily-log">Open Daily Log</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app/health">Health &amp; Vitals</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app/my-schedule">Locker</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app/sessions">All sessions</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app/races">Races &amp; PBs</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app/zones">Zones</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Athlete widgets
// ---------------------------------------------------------------------

export function AthleteLoadStripWidget({ athleteId }: { athleteId: string }) {
  return (
    <div>
      <YearlyLoadStrip athleteId={athleteId} compact />
      <div className="flex justify-end mt-1">
        <Link to="/app/analytics" className="text-xs text-muted-foreground hover:text-foreground underline">
          Open in Analytics →
        </Link>
      </div>
    </div>
  );
}

export function AthleteTodayWidget({ athleteId }: { athleteId: string }) {
  const today = todayISO();

  const { data: vitals } = useQuery({
    queryKey: ["home-vitals", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_vitals")
        .select("sleep_hours, resting_hr, hydration")
        .eq("athlete_id", athleteId)
        .eq("vitals_date", today)
        .maybeSingle();
      return data;
    },
  });

  const { data: readiness } = useQuery({
    queryKey: ["home-readiness", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("readiness_status, readiness_score, confidence")
        .eq("athlete_id", athleteId)
        .eq("load_date", today)
        .maybeSingle();
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Readiness</div>
          {readiness?.readiness_status ? (
            <ReadinessBadge
              status={readiness.readiness_status as any}
              score={readiness.readiness_score as any}
              confidence={readiness.confidence as any}
            />
          ) : (
            <Link to="/app/daily-log" className="text-xs underline text-muted-foreground">
              Log vitals to see readiness
            </Link>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Sleep" value={vitals?.sleep_hours != null ? `${vitals.sleep_hours}h` : "—"} />
          <Stat label="Resting HR" value={vitals?.resting_hr != null ? `${vitals.resting_hr}` : "—"} />
          <Stat label="Hydration" value={vitals?.hydration != null ? `${vitals.hydration}/5` : "—"} />
        </div>
      </CardContent>
    </Card>
  );
}

// Personal, simpler equivalent of the coach's Needs Attention widget —
// just this one athlete, no dismiss/severity machinery. Renders nothing
// when there's genuinely nothing to flag, same philosophy as the coach
// version's "all on track" state — deliberately kept as an invisible
// grid slot rather than an empty-state card, since "nothing wrong" isn't
// something worth taking up space to say.
export function AthleteAttentionWidget({ athleteId }: { athleteId: string }) {
  const { data: injuries } = useQuery({
    queryKey: ["home-injuries", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("injuries")
        .select("body_part, side, status")
        .eq("athlete_id", athleteId)
        .neq("status", "resolved");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: soonEvent } = useQuery({
    queryKey: ["home-next-event", athleteId],
    queryFn: async () => {
      const today = todayISO();
      const soon = new Date();
      soon.setDate(soon.getDate() + 7);
      const { data, error } = await supabase
        .from("event_entries")
        .select("event_name, event_date")
        .eq("athlete_id", athleteId)
        .gte("event_date", today)
        .lte("event_date", soon.toISOString().slice(0, 10))
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: wornGear } = useQuery({
    queryKey: ["home-gear-retirement", athleteId],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("gear_items")
        .select("id, brand, model, nickname, retirement_target_km")
        .eq("athlete_id", athleteId)
        .eq("is_retired", false)
        .not("retirement_target_km", "is", null);
      if (error) throw error;
      if (!items || items.length === 0) return [] as any[];
      const ids = items.map((i) => i.id);
      const { data: links, error: linkErr } = await supabase
        .from("session_gear")
        .select("gear_id, sessions(total_distance_m)")
        .in("gear_id", ids);
      if (linkErr) throw linkErr;
      const usage = new Map<string, number>();
      for (const l of (links ?? []) as any[]) {
        const m = Number(l.sessions?.total_distance_m ?? 0);
        usage.set(l.gear_id, (usage.get(l.gear_id) ?? 0) + m);
      }
      return items
        .map((i: any) => ({ ...i, km: (usage.get(i.id) ?? 0) / 1000 }))
        .filter((i: any) => i.km >= Number(i.retirement_target_km) * 0.9);
    },
  });

  const hasAnything = (injuries?.length ?? 0) > 0 || !!soonEvent || (wornGear?.length ?? 0) > 0;
  if (!hasAnything) return null;

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Worth a look
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {(injuries ?? []).map((i: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-2">
            <span className="capitalize truncate">
              Active injury — {i.body_part} {i.side && i.side !== "n/a" ? `(${i.side})` : ""}
            </span>
            <Link to="/app/injuries" className="text-xs text-[var(--accent-red)] hover:underline shrink-0">
              Open →
            </Link>
          </div>
        ))}
        {soonEvent && (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              {soonEvent.event_name} — {relativeDate(soonEvent.event_date)}
            </span>
            <Link to="/app/event-entries" className="text-xs text-[var(--accent-red)] hover:underline shrink-0">
              Open →
            </Link>
          </div>
        )}
        {(wornGear ?? []).map((g: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {g.nickname || `${g.brand} ${g.model}`} — {g.km.toFixed(0)}/{g.retirement_target_km}km
            </span>
            <Link to="/app/gear" className="text-xs text-[var(--accent-red)] hover:underline shrink-0">
              Open →
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AthleteNextSessionWidget({ athleteId }: { athleteId: string }) {
  const today = todayISO();
  const { data: nextSession } = useQuery({
    queryKey: ["home-next-session", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, title, session_date, day_type, intent, activity_type")
        .eq("athlete_id", athleteId)
        .gte("session_date", today)
        .is("completed_at", null)
        .order("session_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next session</CardTitle>
      </CardHeader>
      <CardContent>
        {nextSession ? (
          <Link
            to="/app/sessions/$sessionId"
            params={{ sessionId: nextSession.id }}
            className="flex items-center justify-between gap-3 hover:bg-accent/50 rounded p-2 -m-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ActivityIcon session={nextSession as any} size={20} className="text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{relativeDate(nextSession.session_date)}</div>
                <div className="font-medium truncate">{nextSession.title ?? "Session"}</div>
              </div>
            </div>
            <div className="flex gap-1">
              {nextSession.day_type && (
                <Badge variant="outline" className="capitalize">
                  {String(nextSession.day_type).replace("_", " ")}
                </Badge>
              )}
              {nextSession.intent && (
                <Badge variant="outline" className="capitalize">
                  {nextSession.intent}
                </Badge>
              )}
            </div>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming sessions scheduled.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AthleteQuickTilesWidget() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
      <QuickTile to="/app/daily-log" icon={ClipboardList} label="Daily Log" />
      <QuickTile to="/app/sessions" icon={CalendarDays} label="Sessions" />
      <QuickTile to="/app/health" icon={HeartPulse} label="Health & Vitals" />
      <QuickTile to="/app/my-schedule" icon={Backpack} label="Locker" />
      <QuickTile to="/app/noticeboard" icon={Megaphone} label="Noticeboard" />
      <QuickTile to="/app/messages" icon={MessageSquare} label="Messages" />
    </div>
  );
}

export function AthleteRecentNoticesWidget({ athleteId }: { athleteId: string }) {
  const list = useServerFn(listPosts);
  const { data: posts } = useQuery({
    queryKey: ["home-notices", athleteId],
    queryFn: async () => (await list()).slice(0, 3),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent notices</CardTitle>
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/noticeboard">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {!posts || posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent notices.</p>
        ) : (
          <div className="divide-y">
            {posts.map((p: any) => (
              <Link
                key={p.id}
                to="/app/noticeboard"
                className="flex items-center justify-between py-2 gap-3 hover:bg-accent/50 rounded px-2 -mx-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate text-sm">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.author_name} · {formatRelative(p.created_at)}
                  </div>
                </div>
                <Badge variant="outline" className="capitalize text-[10px]">
                  {(p.post_type ?? "").replace("_", " ")}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// AI Coach chat + AI Reviews — athlete's own self-service versions of
// what a coach already sees on the athlete detail page. Both underlying
// components (CoachChat, GenerateReviewCard) take only an athleteId and
// were already written generically enough to work unmodified here — no
// athlete-specific branching needed inside either component, and no RLS
// changes needed (chat-thread and review policies already permit a user
// acting on an athleteId that resolves to their own athletes.user_id).
export function AthleteAiCoachWidget({ athleteId }: { athleteId: string }) {
  return <CoachChat athleteId={athleteId} />;
}

export function AthleteAiReviewsWidget({ athleteId }: { athleteId: string }) {
  return <GenerateReviewCard athleteId={athleteId} />;
}
