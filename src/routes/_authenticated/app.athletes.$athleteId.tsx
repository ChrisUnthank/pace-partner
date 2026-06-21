import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { metersFmt, secToClock } from "@/lib/format";
import { paceFmt } from "@/lib/format";
import { ReadinessBadge } from "@/components/readiness-badge";
import { toast } from "sonner";
import { RefreshCw, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId")({
  component: AthleteDetail,
});

function AthleteDetail() {
  const { athleteId } = Route.useParams();
  const qc = useQueryClient();

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

  const { data: weeklyDist } = useQuery({
    queryKey: ["weekly-distance", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_weekly_distance" as any).select("*")
        .eq("athlete_id", athleteId).order("week_start", { ascending: false }).limit(4);
      return data ?? [];
    },
  });

  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_zone_profiles").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data;
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
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/app/sessions/calendar" search={{ athleteId } as any}>
                  <CalendarDays className="h-4 w-4 mr-1" /> Calendar
                </Link>
              </Button>
              <ReadinessBadge
                status={today?.readiness_status as any}
                score={today?.readiness_score as any}
                confidence={today?.confidence as any}
              />
            </div>
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

        <PhysiologyCard athleteId={athleteId} />

        <IdentityCard athlete={athlete} />

        <ZoneBoundariesCard profile={zoneProfile} />

        <Card>
          <CardHeader>
            <CardTitle>Weekly distance</CardTitle>
            <CardDescription>Excludes warm-up Run-throughs (steps flagged not to count).</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!weeklyDist || weeklyDist.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No distance logged yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs"><tr><th className="text-left p-2">Week of</th><th className="text-right p-2 pr-4">Distance</th></tr></thead>
                <tbody>
                  {weeklyDist.map((w: any) => (
                    <tr key={w.week_start} className="border-t">
                      <td className="p-2">{w.week_start}</td>
                      <td className="text-right p-2 pr-4 tabular-nums">{metersFmt(Number(w.distance_m))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

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

function PhysiologyCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data;
    },
  });

  async function refresh() {
    const { error } = await supabase.rpc("recompute_physio_profile", { _athlete_id: athleteId });
    if (error) toast.error(error.message);
    else { toast.success("Profile refreshed"); qc.invalidateQueries({ queryKey: ["physio", athleteId] }); }
  }

  if (isLoading) return null;
  const insufficient = !profile || profile.status !== "ok";
  const aer = Number(profile?.aerobic_pct ?? 0);
  const an = Number(profile?.anaerobic_pct ?? 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Physiological profile</CardTitle>
          <CardDescription>
            Derived from PBs, age & training age. Refines as more PBs are logged.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {insufficient ? (
          <p className="text-sm text-muted-foreground">{profile?.coaching_note ?? "No profile yet — log PBs at two or more distances."}</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div className="flex items-center gap-4">
                <PieSplit aerobic={aer} anaerobic={an} />
                <div className="text-sm">
                  <div className="flex items-center gap-2"><span className="h-2 w-3 rounded bg-emerald-500" />Aerobic <span className="font-semibold tabular-nums ml-1">{aer}%</span></div>
                  <div className="flex items-center gap-2 mt-1"><span className="h-2 w-3 rounded bg-rose-500" />Anaerobic <span className="font-semibold tabular-nums ml-1">{an}%</span></div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Archetype</div>
                <div className="font-semibold">{profile.archetype}</div>
                {profile.speed_reserve_pct != null && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Speed reserve: <span className="tabular-nums">{profile.speed_reserve_pct}%</span> ({profile.speed_reserve_bucket})
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm leading-relaxed border-l-2 pl-3 text-muted-foreground">{profile.coaching_note}</p>
            <div className="text-[10px] text-muted-foreground">Updated {profile.updated_at?.slice(0, 10)}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PieSplit({ aerobic, anaerobic }: { aerobic: number; anaerobic: number }) {
  const total = aerobic + anaerobic || 1;
  const aerAngle = (aerobic / total) * 360;
  return (
    <div
      className="h-20 w-20 rounded-full"
      style={{ background: `conic-gradient(rgb(16 185 129) 0 ${aerAngle}deg, rgb(244 63 94) ${aerAngle}deg 360deg)` }}
      aria-label={`${aerobic}% aerobic, ${anaerobic}% anaerobic`}
    />
  );
}