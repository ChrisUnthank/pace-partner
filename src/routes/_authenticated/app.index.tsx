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
import { ClipboardList, CalendarDays, Megaphone, MessageSquare } from "lucide-react";
import { listPosts } from "@/lib/noticeboard.functions";

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

  const { data: myProfile } = useQuery({
    queryKey: ["my-profile-image", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("profile_image_url, full_name").eq("id", user!.id).maybeSingle();
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
        .in("athlete_id", roster!.map((r) => r.athlete_id))
        .eq("load_date", today);
      if (error) throw error;
      return data;
    },
  });

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
        </div>

        {!rolesLoading && rawRoles.length === 0 && (
          <Card>
            <CardHeader><CardTitle>Set up your role</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Pick how you'll use Strider.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={async () => {
                  const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "athlete" });
                  if (error) { toast.error(error.message); return; }
                  const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", user!.id).maybeSingle();
                  if (!existing) {
                    await supabase.from("athletes").insert({ user_id: user!.id, name: user!.email ?? "Athlete", created_by: user!.id });
                  }
                  window.location.reload();
                }}>I'm an Athlete</Button>
                <Button variant="outline" onClick={async () => {
                  const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "coach" });
                  if (error) { toast.error(error.message); return; }
                  window.location.reload();
                }}>I'm a Coach</Button>
                <Button variant="outline" onClick={async () => {
                  const { error } = await supabase.from("user_roles").insert({ user_id: user!.id, role: "manager" });
                  if (error) { toast.error(error.message); return; }
                  window.location.reload();
                }}>I'm a Manager</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isCoach && (
          <DashboardAlertsPanel />
        )}

        {isCoach && <RecentReviewsCard />}

        {isCoach && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Your athletes</CardTitle>
              <Button asChild size="sm" variant="outline"><Link to="/app/athletes">Manage</Link></Button>
            </CardHeader>
            <CardContent>
              {!roster || roster.length === 0 ? (
                <p className="text-sm text-muted-foreground">No athletes yet. <Link to="/app/athletes" className="underline">Add your first one</Link>.</p>
              ) : (
                <div className="divide-y">
                  {roster.map((r: any) => {
                    const ready = readiness?.find((x) => x.athlete_id === r.athlete_id);
                    return (
                      <Link key={r.athlete_id} to="/app/athletes/$athleteId" params={{ athleteId: r.athlete_id }}
                        className="flex items-center justify-between py-3 hover:bg-accent/50 px-2 rounded gap-3">
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
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isAthlete && athlete && !isCoach && (
          <AthleteHome athleteId={athlete.id} />
        )}
        {isAthlete && athlete && isCoach && (
          <Card>
            <CardHeader><CardTitle>Quick links</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild><Link to="/app/daily-log">Open Daily Log</Link></Button>
              <Button asChild variant="outline"><Link to="/app/sessions">All sessions</Link></Button>
              <Button asChild variant="outline"><Link to="/app/profile">PBs & zones</Link></Button>
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
      const { data } = await supabase.from("daily_vitals")
        .select("sleep_hours, resting_hr, hydration")
        .eq("athlete_id", athleteId).eq("vitals_date", today).maybeSingle();
      return data;
    },
  });

  const { data: readiness } = useQuery({
    queryKey: ["home-readiness", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_load_daily")
        .select("readiness_status, readiness_score, confidence")
        .eq("athlete_id", athleteId).eq("load_date", today).maybeSingle();
      return data;
    },
  });

  const { data: nextSession } = useQuery({
    queryKey: ["home-next-session", athleteId, today],
    queryFn: async () => {
      const { data } = await supabase.from("sessions")
        .select("id, title, session_date, day_type, intent, activity_type")
        .eq("athlete_id", athleteId)
        .gte("session_date", today)
        .is("completed_at", null)
        .order("session_date", { ascending: true })
        .limit(1).maybeSingle();
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
      <Card>
        <CardHeader><CardTitle>Today</CardTitle></CardHeader>
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
              <Link to="/app/daily-log" className="text-xs underline text-muted-foreground">Log vitals to see readiness</Link>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Sleep" value={vitals?.sleep_hours != null ? `${vitals.sleep_hours}h` : "—"} />
            <Stat label="Resting HR" value={vitals?.resting_hr != null ? `${vitals.resting_hr}` : "—"} />
            <Stat label="Hydration" value={vitals?.hydration != null ? `${vitals.hydration}/5` : "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Next session</CardTitle></CardHeader>
        <CardContent>
          {nextSession ? (
            <Link to="/app/sessions/$sessionId" params={{ sessionId: nextSession.id }}
              className="flex items-center justify-between gap-3 hover:bg-accent/50 rounded p-2 -m-2">
              <div className="flex items-center gap-2 min-w-0">
                <ActivityIcon session={nextSession as any} size={20} className="text-muted-foreground shrink-0" />
                <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{relativeDate(nextSession.session_date)}</div>
                <div className="font-medium truncate">{nextSession.title ?? "Session"}</div>
                </div>
              </div>
              <div className="flex gap-1">
                {nextSession.day_type && <Badge variant="outline" className="capitalize">{String(nextSession.day_type).replace("_", " ")}</Badge>}
                {nextSession.intent && <Badge variant="outline" className="capitalize">{nextSession.intent}</Badge>}
              </div>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No upcoming sessions scheduled.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickTile to="/app/daily-log" icon={ClipboardList} label="Daily Log" />
        <QuickTile to="/app/sessions" icon={CalendarDays} label="Sessions" />
        <QuickTile to="/app/noticeboard" icon={Megaphone} label="Noticeboard" />
        <QuickTile to="/app/messages" icon={MessageSquare} label="Messages" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent notices</CardTitle>
          <Button asChild size="sm" variant="ghost"><Link to="/app/noticeboard">View all</Link></Button>
        </CardHeader>
        <CardContent>
          {!posts || posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent notices.</p>
          ) : (
            <div className="divide-y">
              {posts.map((p: any) => (
                <Link key={p.id} to="/app/noticeboard"
                  className="flex items-center justify-between py-2 gap-3 hover:bg-accent/50 rounded px-2 -mx-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate text-sm">{p.title}</div>
                    <div className="text-xs text-muted-foreground">{p.author_name} · {formatRelative(p.created_at)}</div>
                  </div>
                  <Badge variant="outline" className="capitalize text-[10px]">{(p.post_type ?? "").replace("_", " ")}</Badge>
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

function QuickTile({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to} className="rounded-lg border border-border p-4 flex flex-col items-center justify-center gap-2 hover:bg-accent/50 transition-colors">
      <Icon className="h-5 w-5 text-[var(--accent-red)]" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}

function relativeDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
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