import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useMyRawRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { metersFmt, secToClock } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { Plus, CalendarDays } from "lucide-react";
import { ActivityIcon } from "@/lib/activity-icon";
import { useState, useMemo } from "react";
import { BulkFitUpload } from "@/components/bulk-fit-upload";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/sessions/")({
  component: SessionsList,
});

function SessionsList() {
  const { user } = useAuthUser();
  const { data: roles = [], isLoading: rolesLoading } = useMyRoles();
  const { data: rawRoles = [], isLoading: rawRolesLoading } = useMyRawRoles();
  const { data: athlete, isLoading: athleteLoading } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");
  const identityReady = !!user && !rolesLoading && !rawRolesLoading && !athleteLoading;
  const [filterAthlete, setFilterAthlete] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

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

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions-list", athleteIds],
    enabled: identityReady && !!athleteIds && athleteIds.length > 0,
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

  const filtered = useMemo(() => {
    return (sessions ?? []).filter((s: any) => {
      if (filterAthlete !== "all" && s.athlete_id !== filterAthlete) return false;
      if (filterStatus === "done" && !s.completed_at) return false;
      if (filterStatus === "planned" && s.completed_at) return false;
      return true;
    });
  }, [sessions, filterAthlete, filterStatus]);

  const athleteOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions ?? []) {
      if (!map.has(s.athlete_id)) map.set(s.athlete_id, s.athletes?.name ?? "Unknown");
    }
    return Array.from(map.entries());
  }, [sessions]);

  const loading = !identityReady || athleteIdsLoading || (athleteIds && athleteIds.length > 0 && sessionsLoading);

  return (
    <AppShell>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/app/sessions/calendar"><CalendarDays className="h-4 w-4 mr-1" /> Calendar</Link></Button>
          <Button asChild><Link to="/app/sessions/new"><Plus className="h-4 w-4 mr-1" /> New session</Link></Button>
        </div>
      </div>

      {(isCoach || athlete) && athleteOptions.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          <Select value={filterAthlete} onValueChange={setFilterAthlete}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="All athletes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All athletes</SelectItem>
              {athleteOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="done">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Recent</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading sessions…</p>
          ) : !filtered || filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No sessions match the current filter.</p>
          ) : (
            <div className="divide-y">
              {filtered.map((s: any) => (
                <Link key={s.id} to="/app/sessions/$sessionId" params={{ sessionId: s.id }}
                  className="flex items-center justify-between px-4 py-3 hover:bg-accent/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <ActivityIcon session={s} size={18} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {s.session_date} · {s.athletes?.name} · {sessionClassificationLabel(s)}
                    </div>
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

      {athlete && <div className="mt-6"><BulkFitUpload athleteId={athlete.id} /></div>}
    </AppShell>
  );
}