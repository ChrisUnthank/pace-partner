import { useQuery } from "@tanstack/react-query";
import { useMyRoles } from "@/lib/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardAlertsPanel } from "@/components/dashboard-alerts-panel";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@tanstack/react-router";

export default function DashboardPage() {
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

  if (!isCoach) {
    return (
      <AppShell>
        <div className="text-sm text-muted-foreground">Athlete home (unchanged)</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <CoachHome />
    </AppShell>
  );
}

function CoachHome() {
  // ✅ athletes
  const { data: athletes = [] } = useQuery({
    queryKey: ["coach-athletes"],
    queryFn: async () => {
      const { data } = await supabase.from("athletes").select("id, name, profile_image_url");

      return data ?? [];
    },
  });

  // ✅ recent sessions
  const { data: sessions = [] } = useQuery({
    queryKey: ["coach-sessions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, athlete_id, total_distance_m, total_time_seconds, rpe, completed_at, day_type")
        .order("completed_at", { ascending: false });

      return data ?? [];
    },
  });

  // ✅ helper
  function latestSession(athleteId: string) {
    return sessions.find((s) => s.athlete_id === athleteId);
  }

  function getStatus(session: any) {
    if (!session) return "none";
    if (!session.completed_at) return "info";
    if (session.rpe >= 8) return "warning";
    return "good";
  }

  const totalSessions = sessions.length;
  const flagged = sessions.filter((s) => s.rpe >= 8).length;

  return (
    <div className="space-y-4">
      {/* ✅ HEADER */}
      <div>
        <h1 className="text-2xl font-bold">Welcome back, Coach</h1>
        <p className="text-sm text-muted-foreground">Quick overview of your athletes</p>
      </div>

      {/* ✅ SUMMARY BAR */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Sessions</div>
            <div className="text-lg font-semibold">{totalSessions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Athletes</div>
            <div className="text-lg font-semibold">{athletes.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Flagged</div>
            <div className="text-lg font-semibold text-amber-500">{flagged}</div>
          </CardContent>
        </Card>
      </div>

      {/* ✅ ALERTS PANEL (kept but compact) */}
      <DashboardAlertsPanel />

      {/* ✅ ✅ ATHLETE GRID (BIG FIX) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {athletes.map((athlete) => {
          const session = latestSession(athlete.id);
          const status = getStatus(session);

          return (
            <Card key={athlete.id}>
              <CardContent className="pt-4 space-y-3">
                {/* ✅ HEADER */}
                <div className="flex items-center gap-3">
                  <UserAvatar name={athlete.name} imageUrl={athlete.profile_image_url} size="md" />

                  <div>
                    <div className="font-semibold">{athlete.name}</div>

                    <div
                      className={`text-xs ${
                        status === "good"
                          ? "text-emerald-500"
                          : status === "warning"
                            ? "text-amber-500"
                            : "text-muted-foreground"
                      }`}
                    >
                      {status === "good" && "On track ✅"}
                      {status === "warning" && "High fatigue ⚠️"}
                      {status === "info" && "No completed session"}
                      {status === "none" && "No data"}
                    </div>
                  </div>
                </div>

                {/* ✅ MINI METRICS */}
                {session && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>RPE: {session.rpe ?? "—"}</div>

                    <div>Distance: {Math.round((session.total_distance_m ?? 0) / 1000)} km</div>
                  </div>
                )}

                {/* ✅ ACTION */}
                {session && (
                  <Link
                    to="/app/sessions/$sessionId"
                    params={{ sessionId: session.id }}
                    className="text-sm text-blue-500 underline"
                  >
                    View session
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
