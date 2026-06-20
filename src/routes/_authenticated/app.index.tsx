import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/")({
  component: AppHome,
});

function AppHome() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const { data: athlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");

  // Auto-redirect athletes to Today on first visit
  useEffect(() => {
    if (!rolesLoading && isAthlete && !isCoach) {
      navigate({ to: "/app/today", replace: true });
    }
  }, [rolesLoading, isAthlete, isCoach, navigate]);

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, primary_event)")
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
        .select("athlete_id, readiness_status, combined_load, ctl, atl, tsb")
        .in("athlete_id", roster!.map((r) => r.athlete_id))
        .eq("load_date", today);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-muted-foreground text-sm">
            {isCoach && isAthlete ? "Coach & Athlete" : isCoach ? "Coach view" : isAthlete ? "Athlete view" : "Choose a role to get started"}
          </p>
        </div>

        {!rolesLoading && roles.length === 0 && (
          <Card>
            <CardHeader><CardTitle>Set up your role</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Pick how you'll use Strider.</p>
              <div className="flex gap-2">
                <Button onClick={async () => {
                  await supabase.from("user_roles").upsert({ user_id: user!.id, role: "athlete" });
                  const { data: existing } = await supabase.from("athletes").select("id").eq("user_id", user!.id).maybeSingle();
                  if (!existing) {
                    await supabase.from("athletes").insert({ user_id: user!.id, name: user!.email ?? "Athlete", created_by: user!.id });
                  }
                  window.location.reload();
                }}>I'm an Athlete</Button>
                <Button variant="outline" onClick={async () => {
                  await supabase.from("user_roles").upsert({ user_id: user!.id, role: "coach" });
                  window.location.reload();
                }}>I'm a Coach</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isCoach && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Your athletes</CardTitle>
              <Link to="/app/athletes"><Button size="sm" variant="outline">Manage</Button></Link>
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
                        className="flex items-center justify-between py-3 hover:bg-accent/50 px-2 rounded">
                        <div>
                          <div className="font-medium">{r.athletes?.name}</div>
                          <div className="text-xs text-muted-foreground">{r.athletes?.primary_event ?? "—"}</div>
                        </div>
                        <ReadinessBadge status={ready?.readiness_status as any} />
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isAthlete && athlete && (
          <Card>
            <CardHeader><CardTitle>Quick links</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link to="/app/today"><Button>Today's session & check-in</Button></Link>
              <Link to="/app/sessions"><Button variant="outline">All sessions</Button></Link>
              <Link to="/app/profile"><Button variant="outline">PBs & zones</Button></Link>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

export function ReadinessBadge({ status }: { status?: "green" | "amber" | "red" | null }) {
  if (!status) return <Badge variant="outline">—</Badge>;
  const map = {
    green: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
    amber: { label: "Caution", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
    red: { label: "Recover", cls: "bg-red-500/15 text-red-700 border-red-500/30" },
  } as const;
  const s = map[status];
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}