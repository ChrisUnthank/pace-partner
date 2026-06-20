import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { metersFmt, secToClock } from "@/lib/format";
import { ReadinessBadge } from "./app.index";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId")({
  component: AthleteDetail,
});

function AthleteDetail() {
  const { athleteId } = Route.useParams();

  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).single();
      if (error) throw error; return data;
    },
  });

  const { data: pbs } = useQuery({
    queryKey: ["pbs", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("performances").select("*")
        .eq("athlete_id", athleteId).order("performance_date", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const { data: load } = useQuery({
    queryKey: ["load-recent", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_load_daily").select("*")
        .eq("athlete_id", athleteId).order("load_date", { ascending: false }).limit(14);
      return data ?? [];
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["athlete-sessions", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("sessions").select("*")
        .eq("athlete_id", athleteId).order("session_date", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  if (!athlete) return <AppShell><p>Loading…</p></AppShell>;
  const today = load?.[0];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Link to="/app/athletes" className="text-sm text-muted-foreground underline">← Athletes</Link>
          <div className="flex items-center justify-between mt-2">
            <div>
              <h1 className="text-2xl font-bold">{athlete.name}</h1>
              <p className="text-sm text-muted-foreground">{athlete.primary_event ?? "—"}</p>
            </div>
            <ReadinessBadge status={today?.readiness_status as any} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle>Training load (14 days)</CardTitle></CardHeader>
            <CardContent className="p-0">
              {!load || load.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No load data yet.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs"><tr><th className="text-left p-2">Date</th><th>Load</th><th>CTL</th><th>ATL</th><th>TSB</th></tr></thead>
                  <tbody>
                    {load.map((d: any) => (
                      <tr key={d.load_date} className="border-t">
                        <td className="p-2">{d.load_date}</td>
                        <td className="text-center">{d.combined_load?.toFixed?.(0) ?? "—"}</td>
                        <td className="text-center">{d.ctl?.toFixed?.(0) ?? "—"}</td>
                        <td className="text-center">{d.atl?.toFixed?.(0) ?? "—"}</td>
                        <td className="text-center">{d.tsb?.toFixed?.(0) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Personal bests</CardTitle></CardHeader>
            <CardContent className="p-0">
              {!pbs || pbs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No performances logged.</p> : (
                <div className="divide-y">
                  {pbs.map((p: any) => (
                    <div key={p.id} className="px-3 py-2 flex justify-between text-sm">
                      <span>{metersFmt(p.distance_m)} {p.is_pb && <span className="text-xs text-emerald-600 ml-1">PB</span>}</span>
                      <span className="tabular-nums">{secToClock(p.time_seconds)}</span>
                      <span className="text-xs text-muted-foreground">{p.performance_date}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Recent sessions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!sessions || sessions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No sessions.</p> : (
              <div className="divide-y">
                {sessions.map((s: any) => (
                  <Link key={s.id} to="/app/sessions/$sessionId" params={{ sessionId: s.id }}
                    className="flex justify-between px-4 py-2 text-sm hover:bg-accent/40">
                    <span>{s.session_date} · {s.title}</span>
                    <span className="text-xs text-muted-foreground">{s.completed_at ? "Done" : "Planned"}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}