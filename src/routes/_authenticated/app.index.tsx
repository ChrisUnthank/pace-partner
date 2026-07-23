import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyRawRoles, useMyAthlete, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/format";
import { ReadinessBadge } from "@/components/readiness-badge";
import { toast } from "sonner";
import { DashboardAlertsPanel } from "@/components/dashboard-alerts-panel";
import { UserAvatar } from "@/components/user-avatar";
import { RecentReviewsCard } from "@/components/recent-reviews-card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, CalendarDays, Megaphone, MessageSquare, Trophy, CalendarRange, LineChart, ArrowRight, HeartPulse, Backpack, AlertTriangle, Plus } from "lucide-react";
import { listPosts } from "@/lib/noticeboard.functions";
import { listMessageContacts } from "@/lib/messages.functions";
import { ActivityIcon } from "@/lib/activity-icon";
import { AthleteSummaryPanel } from "@/components/athlete-summary-panel";
import { YearlyLoadStrip } from "@/components/yearly-load-strip";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/app/")({
  component: AppHome,
});

function AppHome() {
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const isManager = rawRoles.includes("manager");
  // Clicking an athlete in "Your athletes" opens the same quick-look
  // summary panel used on the Athletes page, instead of navigating away.
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const { data: myProfile } = useQuery({
    queryKey: ["my-profile-image", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("profile_image_url, full_name")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id, isManager],
    enabled: !!user && isCoach,
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

  const { data: readiness } = useQuery({
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

  const readinessCounts = { green: 0, amber: 0, red: 0 };
  (readiness ?? []).forEach((r: any) => {
    if (r.readiness_status && readinessCounts[r.readiness_status as "green" | "amber" | "red"] !== undefined) {
      readinessCounts[r.readiness_status as "green" | "amber" | "red"]++;
    }
  });
  const loggedTodayCount = (readiness ?? []).length;

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

  const listContacts = useServerFn(listMessageContacts);
  const { data: contacts } = useQuery({
    queryKey: ["msg-contacts-home"],
    enabled: isCoach,
    queryFn: () => listContacts(),
  });
  const unreadCount = (contacts ?? []).reduce((sum: number, c: any) => sum + (c.unread ?? 0), 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <UserAvatar
            name={(myProfile as any)?.full_name ?? athlete?.name ?? user?.email ?? ""}
            imageUrl={(myProfile as any)?.profile_image_url ?? (athlete as any)?.profile_image_url}
            size="lg"
          />
          <div>
            <h1 className="text-2xl font-bold">Welcome back</h1>
            <p className="text-muted-foreground text-sm">
              {(() => {
                const labels: string[] = [];
                if (isManager) labels.push("Manager");
                if (rawRoles.includes("coach")) labels.push("Coach");
                if (isAthlete) labels.push("Athlete");
                return labels.length ? `${labels.join(" & ")} view` : "Choose a role to get started";
              })()}
            </p>
          </div>
          {/* One-click path into the session builder from the coach's
              landing page — previously the only routes there were sidebar →
              Training → Sessions → New session, or via a calendar day. */}
          {isCoach && (
            <Button asChild size="sm" className="ml-auto">
              <Link to="/app/sessions/new">
                <Plus className="h-4 w-4 mr-1" />
                New session
              </Link>
            </Button>
          )}
        </div>

        {!rolesLoading && rawRoles.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Set up your role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Pick how you'll use Strider.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "athlete" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    const { data: existing } = await supabase
                      .from("athletes")
                      .select("id")
                      .eq("user_id", user!.id)
                      .maybeSingle();
                    if (!existing) {
                      await supabase
                        .from("athletes")
                        .insert({ user_id: user!.id, name: user!.email ?? "Athlete", created_by: user!.id });
                    }
                    window.location.reload();
                  }}
                >
                  I'm an Athlete
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "coach" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    window.location.reload();
                  }}
                >
                  I'm a Coach
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "manager" });
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    window.location.reload();
                  }}
                >
                  I'm a Manager
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Prominent, shared regardless of role — the two places most
            people land here to get to. Deliberately just link cards (not
            embedded calendar/chart content) per the plan for this rebuild;
            an embedded preview is a reasonable future add if this proves
            not to be enough on its own. */}
        {!rolesLoading && rawRoles.length > 0 && <TopLinksRow />}

        {isCoach && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <QuickTile to="/app/messages" icon={MessageSquare} label="Messages" badge={unreadCount} />
            <QuickTile to="/app/noticeboard" icon={Megaphone} label="Noticeboard" />
            <QuickTile to="/app/athletes" icon={ClipboardList} label="Athletes" />
            <QuickTile to="/app/health" icon={HeartPulse} label="Health & Vitals" />
          </div>
        )}

        {isCoach && roster && roster.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              {readinessCounts.green} ready
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 ml-2" />
              {readinessCounts.amber} caution
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 ml-2" />
              {readinessCounts.red} recover
            </div>
            <span className="text-muted-foreground">
              · {loggedTodayCount} of {roster.length} logged today
            </span>
          </div>
        )}

        {isCoach && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Your athletes</CardTitle>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/athletes">Manage</Link>
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
                    <div className="divide-y max-h-[560px] overflow-y-auto">
                      {roster.map((r: any) => {
                        const ready = readiness?.find((x) => x.athlete_id === r.athlete_id);
                        return (
                          <button
                            key={r.athlete_id}
                            type="button"
                            onClick={() => setSelectedAthleteId(r.athlete_id)}
                            className={`w-full flex items-center justify-between py-3 hover:bg-accent/50 px-2 rounded gap-3 text-left ${
                              selectedAthleteId === r.athlete_id ? "bg-accent/60" : ""
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <UserAvatar name={r.athletes?.name} imageUrl={r.athletes?.profile_image_url} size="sm" />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{r.athletes?.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {r.athletes?.primary_event ?? "—"}
                                  {r.athletes?.last_log_at && <> · last log {formatRelative(r.athletes.last_log_at)}</>}
                                </div>
                              </div>
                            </div>
                            <ReadinessBadge
                              status={ready?.readiness_status as any}
                              score={ready?.readiness_score as any}
                              confidence={ready?.confidence as any}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6 lg:col-span-1">
              {selectedAthleteId && (
                <AthleteSummaryPanel
                  athlete={roster?.find((r: any) => r.athlete_id === selectedAthleteId)?.athletes ?? null}
                  onClose={() => setSelectedAthleteId(null)}
                />
              )}

              <DashboardAlertsPanel />

              {upcomingRaces && upcomingRaces.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Trophy className="h-4 w-4 text-[var(--accent-red)]" /> Upcoming races
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {upcomingRaces.map((race: any) => {
                      const athleteName = roster?.find((r) => r.athlete_id === race.athlete_id)?.athletes?.name;
                      return (
                        // race.id here is a sessions.id (this card queries the
                        // sessions table), so it must link to the session page.
                        // Previously pointed at /app/races/$raceId, which takes
                        // a performances.id — an upcoming race has no
                        // performances row yet, so every click 404'd.
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
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {relativeDate(race.session_date)}
                          </span>
                        </Link>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              <RecentReviewsCard />
            </div>
          </div>
        )}

        {isAthlete && athlete && !isCoach && <AthleteHome athleteId={athlete.id} />}
        {isAthlete && athlete && isCoach && (
          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/app/daily-log">Open Daily Log</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/health">Health & Vitals</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/my-schedule">Locker</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/sessions">All sessions</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/profile">PBs & zones</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function AthleteHome({ athleteId }: { athleteId: string }) {
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

  const list = useServerFn(listPosts);
  const { data: posts } = useQuery({
    queryKey: ["home-notices", athleteId],
    queryFn: async () => (await list()).slice(0, 3),
  });

  return (
    <div className="space-y-4">
      {/* Year-at-a-glance weekly training strip (compact) — the full
          interactive version lives at the top of Analytics; this one links
          through to it. */}
      <div>
        <YearlyLoadStrip athleteId={athleteId} compact />
        <div className="flex justify-end mt-1">
          <Link to="/app/analytics" className="text-xs text-muted-foreground hover:text-foreground underline">
            Open in Analytics →
          </Link>
        </div>
      </div>
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

      <AthleteAttentionCard athleteId={athleteId} />

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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <QuickTile to="/app/daily-log" icon={ClipboardList} label="Daily Log" />
        <QuickTile to="/app/sessions" icon={CalendarDays} label="Sessions" />
        <QuickTile to="/app/health" icon={HeartPulse} label="Health & Vitals" />
        <QuickTile to="/app/my-schedule" icon={Backpack} label="Locker" />
        <QuickTile to="/app/noticeboard" icon={Megaphone} label="Noticeboard" />
        <QuickTile to="/app/messages" icon={MessageSquare} label="Messages" />
      </div>

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
    </div>
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

// Prominent, shared Calendar + Analytics row — these are the two
// destinations most people land on Home to reach, so they get their own
// larger cards rather than blending into the smaller QuickTile grid
// below. Same destinations for every role; Calendar/Analytics already
// scope their own content by who's viewing.
function TopLinksRow() {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <BigLinkCard
        to="/app/sessions/calendar"
        icon={CalendarRange}
        title="Calendar"
        description="See what's planned, day by day."
      />
      <BigLinkCard
        to="/app/analytics"
        icon={LineChart}
        title="Analytics"
        description="Trends, load, and progress over time."
      />
    </div>
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

// Athlete-facing equivalent of the coach's "Needs Attention" panel — but
// personal (just this one athlete, not a roster loop) and simpler (no
// dismiss/severity machinery, just a short list), since it's read
// directly rather than through the coach alerts server function. Renders
// nothing at all when there's genuinely nothing to flag, same philosophy
// as the coach panel's "all on track" state.
function AthleteAttentionCard({ athleteId }: { athleteId: string }) {
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

function QuickTile({ to, icon: Icon, label, badge }: { to: string; icon: any; label: string; badge?: number }) {
  return (
    <Link
      to={to}
      className="relative rounded-lg border border-border p-4 flex flex-col items-center justify-center gap-2 hover:bg-accent/50 transition-colors"
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
