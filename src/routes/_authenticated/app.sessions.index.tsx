import { createFileRoute, Link } from "@tanstack/react-router";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useMyRawRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock } from "@/lib/format";
import { sessionClassificationLabel, SESSION_INTENTS, INTENT_LABEL, DAY_TYPE_LABEL } from "@/lib/session-categories";
import { Plus, CalendarDays, Upload, Users } from "lucide-react";
import { ActivityIcon } from "@/lib/activity-icon";
import { useState, useMemo, useEffect } from "react";
import { BulkFitUpload } from "@/components/bulk-fit-upload";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { sessionColorClass } from "@/components/calendar-day-cell";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ReadinessBadge } from "@/components/readiness-badge";
import { BucketTabStrip, TRAINING_TABS } from "@/components/bucket-tab-strip";

const searchSchema = z.object({
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/sessions/")({
  validateSearch: searchSchema,
  component: SessionsList,
});

const PAGE_SIZE = 10;

// Race/Recovery/Cross-training/Rest days have no `intent` value at all
// (that column only ever gets set for day_type "training") — same
// exclusion the Analytics "Time by Training Intent" chart already had to
// account for. Included in the same filter dropdown as the training
// intents, just matched against day_type instead of intent.
const NON_TRAINING_DAY_TYPES = ["race", "recovery", "cross_training", "rest"] as const;

// "6:42 PM" style local time for a session, converted via the athlete's own
// timezone (falls back to UTC, matching the same fallback used server-side
// in session-files.functions.ts, so a display and a classification never
// disagree about which zone "no timezone set" means).
function formatLocalTime(iso: string, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone || "UTC",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function SessionsList() {
  const search = Route.useSearch();
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const isAthlete = roles.includes("athlete");
  const { data: rawRoles = [], isLoading: rawRolesLoading } = useMyRawRoles();
  const { data: athlete, isLoading: athleteLoading } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");
  const identityReady = !!user && !rolesLoading && !rawRolesLoading && !athleteLoading;
  const [filterAthlete, setFilterAthlete] = useState<string>(search.athleteId ?? "all");
  // Re-syncs whenever the URL's athleteId changes underneath this page —
  // e.g. arriving here via the Calendar page's "List view" link for a
  // specific athlete — rather than only reading it once on mount.
  useEffect(() => {
    if (search.athleteId) setFilterAthlete(search.athleteId);
  }, [search.athleteId]);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterIntent, setFilterIntent] = useState<string>("all");

  const { data: athleteIds, isLoading: athleteIdsLoading } = useQuery({
    queryKey: ["visible-athlete-ids", user?.id, isCoach, isManager, athlete?.id],
    enabled: identityReady,
    queryFn: async () => {
      const ids: string[] = [];
      if (athlete) ids.push(athlete.id);
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id");
        for (const r of data ?? []) ids.push(r.id);
      } else if (isCoach) {
        const { data } = await supabase.from("coach_athletes").select("athlete_id").eq("coach_user_id", user!.id);
        for (const r of data ?? []) ids.push(r.athlete_id);
      }
      return Array.from(new Set(ids));
    },
  });

  // Athlete names for the filter dropdown come from their own lightweight query now,
  // independent of whatever page/filter of sessions happens to be loaded — previously
  // this was derived from the loaded sessions themselves, which broke as soon as
  // pagination meant "loaded sessions" was no longer the full list.
  const { data: athleteNameRows } = useQuery({
    queryKey: ["visible-athlete-names", (athleteIds ?? []).join(",")],
    enabled: !!athleteIds && athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").in("id", athleteIds!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const athleteOptions = useMemo(
    () => (athleteNameRows ?? []).map((a: any) => [a.id, a.name] as [string, string]),
    [athleteNameRows],
  );

  // "This week" quick stats + readiness, for the logged-in athlete's own view (a coach
  // browsing a roster of athletes doesn't have one single "current athlete" to summarize,
  // so this only renders when `athlete` — the logged-in user's own athlete profile — exists).
  const weekStartISO = useMemo(() => {
    const now = new Date();
    const day = now.getDay() || 7; // Mon=1 .. Sun=7
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  }, []);

  const { data: weekSessions } = useQuery({
    queryKey: ["sessions-week-summary", athlete?.id, weekStartISO],
    enabled: !!athlete,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("total_distance_m, total_time_seconds, completed_at")
        .eq("athlete_id", athlete!.id)
        .gte("session_date", weekStartISO);
      if (error) throw error;
      return data ?? [];
    },
  });

  const weekSummary = useMemo(() => {
    let distanceM = 0;
    let timeS = 0;
    let done = 0;
    for (const s of weekSessions ?? []) {
      if (s.completed_at) {
        distanceM += Number(s.total_distance_m ?? 0);
        timeS += Number(s.total_time_seconds ?? 0);
        done += 1;
      }
    }
    return { distanceM, timeS, done, total: (weekSessions ?? []).length };
  }, [weekSessions]);

  const { data: latestLoad } = useQuery({
    queryKey: ["sidebar-latest-load", athlete?.id],
    enabled: !!athlete,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("readiness_status, readiness_score, confidence")
        .eq("athlete_id", athlete!.id)
        .order("load_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Real, server-side pagination — 10 sessions per page, filtered at the query level
  // (not client-side afterwards), so "Show more" and the athlete/status filters both
  // keep working correctly no matter how many months or years of history an athlete
  // has. The old approach fetched up to 100 rows and filtered/displayed them all in
  // the browser, which doesn't scale and doesn't actually reduce anything shown.
  const {
    data: sessionPages,
    isLoading: sessionsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["sessions-list", (athleteIds ?? []).join(","), filterAthlete, filterStatus, filterIntent],
    enabled: identityReady && !!athleteIds && athleteIds.length > 0,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const ids = filterAthlete === "all" ? athleteIds! : [filterAthlete];
      let q = supabase
        .from("sessions")
        .select("*, athletes(name, timezone)", { count: "exact" })
        .in("athlete_id", ids)
        .order("session_date", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (filterStatus === "done") q = q.not("completed_at", "is", null);
      if (filterStatus === "planned") q = q.is("completed_at", null);
      // filterIntent is either "all", "intent:<value>" (training-day
      // intents — easy/aerobic/.../vo2/etc) or "daytype:<value>" (Race/
      // Recovery/Cross-training/Rest, which have no intent value at all).
      if (filterIntent !== "all") {
        const [kind, value] = filterIntent.split(":");
        if (kind === "intent") q = q.eq("intent", value);
        else if (kind === "daytype") q = q.eq("day_type", value);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0, nextOffset: pageParam + PAGE_SIZE };
    },
    getNextPageParam: (lastPage) => (lastPage.nextOffset < lastPage.count ? lastPage.nextOffset : undefined),
  });

  const sessions = useMemo(() => (sessionPages?.pages ?? []).flatMap((p) => p.rows), [sessionPages]);
  const totalCount = sessionPages?.pages?.[sessionPages.pages.length - 1]?.count ?? 0;

  // Real clock start-time for each loaded session, e.g. "6:42 PM" next to the date
  // — the `sessions` row itself only ever stores a date, not a time; the actual
  // recorded start instant lives on session_files (one row per uploaded file).
  // Batched into a single extra query keyed off whichever sessions are currently
  // loaded, rather than one query per row. Manually-created sessions with no
  // uploaded file simply have no time to show, which is correct.
  const sessionIds = useMemo(() => sessions.map((s: any) => s.id), [sessions]);
  const { data: sessionStartTimes } = useQuery({
    queryKey: ["session-start-times", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_files")
        .select("session_id, started_at")
        .in("session_id", sessionIds)
        .not("started_at", "is", null);
      if (error) throw error;
      const earliest = new Map<string, string>();
      for (const f of data ?? []) {
        if (!f.session_id || !f.started_at) continue;
        const existing = earliest.get(f.session_id);
        if (!existing || new Date(f.started_at).getTime() < new Date(existing).getTime()) {
          earliest.set(f.session_id, f.started_at);
        }
      }
      return earliest;
    },
  });

  // Bug fix: the query only ever sorted by session_date, so two sessions on the same
  // day (e.g. an AM run and a PM run) landed in whatever order Postgres happened to
  // return ties in — usually insertion order, which meant a PM session uploaded before
  // its own AM session that day would show up first. This re-sorts same-day sessions
  // by their actual recorded clock time (earliest first), using the start times just
  // fetched above. Sessions with no recorded time (manual entries) sort after ones
  // with a known time on the same day, since there's nothing to compare them against.
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a: any, b: any) => {
      if (a.session_date !== b.session_date) {
        return a.session_date < b.session_date ? 1 : -1; // newest day first
      }
      const at = sessionStartTimes?.get(a.id);
      const bt = sessionStartTimes?.get(b.id);
      const aVal = at ? new Date(at).getTime() : Infinity;
      const bVal = bt ? new Date(bt).getTime() : Infinity;
      return aVal - bVal; // earlier clock time first (AM before PM)
    });
  }, [sessions, sessionStartTimes]);

  const loading = !identityReady || athleteIdsLoading || (athleteIds && athleteIds.length > 0 && sessionsLoading);

  return (
    <AppShell>
      {isCoach && filterAthlete !== "all" && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            <Link to="/app/athletes" className="hover:text-foreground">
              Athletes
            </Link>
            <span className="text-border">/</span>
            <Link to="/app/athletes/$athleteId" params={{ athleteId: filterAthlete }} className="hover:text-foreground">
              {athleteOptions.find(([id]) => id === filterAthlete)?.[1] ?? "Athlete"}
            </Link>
          </div>
          <AthleteSubnav athleteId={filterAthlete} active="sessions" />
          <div className="mt-4" />
        </>
      )}
      {!(isCoach && filterAthlete !== "all") && (
        <div className="mb-4">
          <BucketTabStrip
            items={TRAINING_TABS.filter((t) => t.to !== "/app/daily-log" || isAthlete)}
            active="/app/sessions"
          />
        </div>
      )}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Sessions</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Action buttons: shown first on mobile (so nothing needs scrolling to reach),
            moved to a right-hand sidebar column on larger screens. */}
        <div className="order-1 lg:order-2 lg:col-span-1">
          <div className="flex flex-row lg:flex-col gap-2 lg:sticky lg:top-4">
            <Button asChild variant="outline" className="flex-1 lg:flex-none lg:w-full lg:justify-start">
              <Link
                to="/app/sessions/calendar"
                search={filterAthlete !== "all" ? ({ athleteId: filterAthlete } as any) : undefined}
              >
                <CalendarDays className="h-4 w-4 mr-1.5" /> Calendar
              </Link>
            </Button>
            <Button asChild className="flex-1 lg:flex-none lg:w-full lg:justify-start">
              <Link to="/app/sessions/new">
                <Plus className="h-4 w-4 mr-1.5" /> New session
              </Link>
            </Button>
            {athlete && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="flex-1 lg:flex-none lg:w-full lg:justify-start">
                    <Upload className="h-4 w-4 mr-1.5" /> Upload
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader className="sr-only">
                    <DialogTitle>Bulk upload FIT or GPX files</DialogTitle>
                    <DialogDescription>Upload one or more FIT or GPX files to create sessions.</DialogDescription>
                  </DialogHeader>
                  <BulkFitUpload athleteId={athlete.id} />
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* This week + readiness — only meaningful for the logged-in user's own athlete
              profile, not a coach browsing a roster of several athletes at once. */}
          {athlete && (
            <Card className="mt-3">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">This week</CardTitle>
                  <ReadinessBadge
                    status={latestLoad?.readiness_status as any}
                    score={latestLoad?.readiness_score as any}
                    confidence={latestLoad?.confidence as any}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance</span>
                  <span className="font-medium">{metersFmt(weekSummary.distanceM)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium">{secToClock(weekSummary.timeS)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sessions</span>
                  <span className="font-medium">
                    {weekSummary.done}/{weekSummary.total}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {(isCoach || athlete) && athleteOptions.length > 1 && (
            <Card className="mt-3 border-[var(--accent-red)]/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-[var(--accent-red)]" /> Athlete
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Select value={filterAthlete} onValueChange={setFilterAthlete}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="All athletes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All athletes</SelectItem>
                    {athleteOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="done">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Intent</Label>
                  <Select value={filterIntent} onValueChange={setFilterIntent}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="All intents" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All intents</SelectItem>
                      <SelectGroup>
                        <SelectLabel>Training</SelectLabel>
                        {SESSION_INTENTS.map((i) => (
                          <SelectItem key={i} value={`intent:${i}`}>
                            {INTENT_LABEL[i]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Day type</SelectLabel>
                        {NON_TRAINING_DAY_TYPES.map((d) => (
                          <SelectItem key={d} value={`daytype:${d}`}>
                            {DAY_TYPE_LABEL[d]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="order-2 lg:order-1 lg:col-span-3 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Recent</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">Loading sessions…</p>
              ) : !sortedSessions || sortedSessions.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No sessions match the current filter.</p>
              ) : (
                <>
                  <div className="divide-y">
                    {sortedSessions.map((s: any) => {
                      const startedAt = sessionStartTimes?.get(s.id);
                      const localTime = startedAt ? formatLocalTime(startedAt, s.athletes?.timezone) : null;
                      return (
                        <Link
                          key={s.id}
                          to="/app/sessions/$sessionId"
                          params={{ sessionId: s.id }}
                          className="flex items-stretch gap-3 hover:bg-accent/40 overflow-hidden"
                        >
                          <span className={cn("w-1.5 shrink-0", sessionColorClass(s))} />
                          <div className="flex-1 flex items-center justify-between gap-2 py-3 pr-4 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <ActivityIcon session={s} size={18} className="text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-medium truncate">{s.title}</span>
                                  {s.athletes?.name && (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 text-[10px] font-bold uppercase tracking-wide"
                                    >
                                      {s.athletes.name}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, {
                                    weekday: "long",
                                  })}
                                  , {s.session_date}
                                  {localTime ? ` · ${localTime}` : ""} · {sessionClassificationLabel(s)}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 items-center text-sm">
                              {s.total_distance_m && (
                                <span className="text-muted-foreground">{metersFmt(s.total_distance_m)}</span>
                              )}
                              {s.total_time_seconds && (
                                <span className="text-muted-foreground">{secToClock(s.total_time_seconds)}</span>
                              )}
                              <Badge variant={s.completed_at ? "default" : "outline"}>
                                {s.completed_at ? "Done" : "Planned"}
                              </Badge>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>

                  <div className="flex flex-col items-center gap-2 p-4 border-t">
                    <p className="text-xs text-muted-foreground">
                      Showing {sortedSessions.length} of {totalCount} session{totalCount === 1 ? "" : "s"}
                    </p>
                    {hasNextPage && (
                      <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                        {isFetchingNextPage ? "Loading…" : "Show 10 more"}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
