import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyRawRoles, useMyAthlete, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/format";
import { ReadinessBadge } from "@/components/readiness-badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { findProactiveFlags, generateWeeklySummary } from "@/lib/ai.functions";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/")({
  component: AppHome,
});

function AppHome() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: athlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const isManager = rawRoles.includes("manager");

  // Auto-redirect athletes to Today on first visit
  useEffect(() => {
    if (!rolesLoading && isAthlete && !isCoach) {
      navigate({ to: "/app/today", replace: true });
    }
  }, [rolesLoading, isAthlete, isCoach, navigate]);

  const { data: roster } = useQuery({
    queryKey: ["roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data, error } = await supabase
          .from("athletes")
          .select("id, name, primary_event")
          .order("name");
        if (error) throw error;
        return (data ?? []).map((a) => ({ athlete_id: a.id, athletes: a }));
      }
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
          <ProactiveFlagsCard />
        )}

        {isCoach && roster && roster.length > 0 && (
          <WeeklySummariesGrid athleteIds={roster.map((r: any) => r.athlete_id)} names={Object.fromEntries(roster.map((r: any) => [r.athlete_id, r.athletes?.name]))} />
        )}

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
                        className="flex items-center justify-between py-3 hover:bg-accent/50 px-2 rounded">
                        <div>
                          <div className="font-medium">{r.athletes?.name}</div>
                          <div className="text-xs text-muted-foreground">{r.athletes?.primary_event ?? "—"}</div>
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

        {isAthlete && athlete && (
          <Card>
            <CardHeader><CardTitle>Quick links</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild><Link to="/app/today">Today's session & check-in</Link></Button>
              <Button asChild variant="outline"><Link to="/app/sessions">All sessions</Link></Button>
              <Button asChild variant="outline"><Link to="/app/profile">PBs & zones</Link></Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
