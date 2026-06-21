import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock } from "@/lib/format";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/sessions/")({
  component: SessionsList,
});

function SessionsList() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: athlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const { data: athleteIds } = useQuery({
    queryKey: ["visible-athlete-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const ids: string[] = [];
      if (athlete) ids.push(athlete.id);
      if (isCoach) {
        const { data } = await supabase.from("coach_athletes").select("athlete_id").eq("coach_user_id", user!.id);
        for (const r of data ?? []) ids.push(r.athlete_id);
      }
      return Array.from(new Set(ids));
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["sessions-list", athleteIds],
    enabled: !!athleteIds && athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*, athletes(name)")
        .in("athlete_id", athleteIds!)
        .order("session_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <Link to="/app/sessions/new"><Button><Plus className="h-4 w-4 mr-1" /> New session</Button></Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!sessions || sessions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <div className="divide-y">
              {sessions.map((s: any) => (
                <Link key={s.id} to="/app/sessions/$sessionId" params={{ sessionId: s.id }}
                  className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.session_date} · {s.athletes?.name} · {sessionClassificationLabel(s)}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center text-sm">
                    {s.total_distance_m && <span className="text-muted-foreground">{metersFmt(s.total_distance_m)}</span>}
                    {s.total_time_seconds && <span className="text-muted-foreground">{secToClock(s.total_time_seconds)}</span>}
                    <Badge variant={s.completed_at ? "default" : "outline"}>{s.completed_at ? "Done" : "Planned"}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}