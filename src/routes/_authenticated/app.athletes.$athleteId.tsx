import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { metersFmt, secToClock } from "@/lib/format";
import { paceFmt } from "@/lib/format";
import { ReadinessBadge } from "@/components/readiness-badge";
import { VitalsPanel } from "@/components/vitals-panel";
import { CoachChat } from "@/components/coach-chat";
import { toast } from "sonner";
import { RefreshCw, CalendarDays } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { GenerateReviewCard } from "@/components/generate-review-card";
import { AthleteReminderSettings } from "@/components/reminder-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONE_OPTIONS, guessLocalTimezone } from "@/lib/timezones";
import { ZoneBoundariesCard } from "@/components/zone-boundaries-card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/app/athletes/$athleteId")({
  component: AthleteDetail,
});

// Monday of the ISO week containing this date — matches the bucketing the
// old athlete_weekly_distance view used for its week_start column.
function weekStartMonday(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function raceTypeLabel(rt: string) {
  switch (rt) {
    case "track":
      return "Track";
    case "road":
      return "Road";
    case "cross_country":
      return "XC";
    default:
      return rt;
  }
}

function formatChartDate(dateStr: string) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// Athlete's primary event is free text (e.g. "1500m", "5km") — pull a
// distance out of it so the progression chart can default to it.
function primaryEventDistanceM(text: string | null | undefined): number | null {
  if (!text) return null;
  const e = text.trim().toLowerCase();

  if (/^1\s*mile$/i.test(e)) return 1609;

  const km = e.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (km) return Math.round(Number(km[1]) * 1000);

  const m = e.match(/(\d+)\s*m/i);
  if (m) return Number(m[1]);

  return null;
}

function AthleteDetail() {
  const { athleteId } = Route.useParams();
  const qc = useQueryClient();

  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: pbs } = useQuery({
    queryKey: ["pbs", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("performance_date", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // Separate from `pbs` above (which stays capped at 20 for the "Personal
  // bests" list) — the progression chart wants full history per event, not
  // just the most recent 20 performances overall.
  const { data: progressionPerformances } = useQuery({
    queryKey: ["progression-performances", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("performance_date", { ascending: false });
      return data ?? [];
    },
  });

  const { data: load } = useQuery({
    queryKey: ["load-recent", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("load_date", { ascending: false })
        .limit(14);
      return data ?? [];
    },
  });

  // Volume per load_date: sum actual distance from interval_results joined via sessions on that date,
  // falling back to planned target distance from steps for sessions without actuals.
  const { data: volumeByDate } = useQuery({
    queryKey: ["volume-by-date", athleteId],
    queryFn: async () => {
      const { data: sessRows } = await supabase
        .from("sessions")
        .select("id, session_date, total_distance_m, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      const map = new Map<string, number>();
      const sessIds = (sessRows ?? []).map((s: any) => s.id);
      let actualBySession = new Map<string, number>();
      if (sessIds.length > 0) {
        const { data: steps } = await supabase
          .from("steps")
          .select("id, session_id, target_distance_m, reps, set_count")
          .in("session_id", sessIds);
        const stepToSession = new Map<string, string>();
        const plannedBySession = new Map<string, number>();
        for (const st of steps ?? []) {
          stepToSession.set(st.id, st.session_id);
          const planned = Number(st.target_distance_m ?? 0) * Number(st.reps ?? 1) * Number(st.set_count ?? 1);
          plannedBySession.set(st.session_id, (plannedBySession.get(st.session_id) ?? 0) + planned);
        }
        const stepIds = (steps ?? []).map((s: any) => s.id);
        if (stepIds.length > 0) {
          const { data: irs } = await supabase
            .from("interval_results")
            .select("step_id, actual_distance_m")
            .in("step_id", stepIds);
          for (const r of irs ?? []) {
            const sid = stepToSession.get(r.step_id);
            if (!sid) continue;
            actualBySession.set(sid, (actualBySession.get(sid) ?? 0) + Number(r.actual_distance_m ?? 0));
          }
        }
        for (const s of sessRows ?? []) {
          let m = actualBySession.get(s.id) ?? 0;
          if (m === 0 && s.total_distance_m) m = Number(s.total_distance_m);
          if (m === 0 && !s.completed_at) m = plannedBySession.get(s.id) ?? 0;
          if (m > 0) map.set(s.session_date, (map.get(s.session_date) ?? 0) + m);
        }
      }
      return map;
    },
  });

  // Recent sessions — a 7-day window rather than an arbitrary row count, to
  // match the "N days" framing Training load already uses.
  const { data: sessions } = useQuery({
    queryKey: ["athlete-sessions-7d", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .order("session_date", { ascending: false });
      return data ?? [];
    },
  });

  // Weekly distance, computed the same way as the Training load volume above
  // (actual distance from interval_results, falling back to planned target
  // for non-completed sessions) but summed across every step in the session
  // — warmup, work, strides, and cooldown alike. Replaces the old
  // athlete_weekly_distance view, which excluded certain warm-up
  // "run-through" steps from the total.
  const { data: weeklyDistance } = useQuery({
    queryKey: ["weekly-distance-all-steps", athleteId],
    queryFn: async () => {
      const since = new Date(Date.now() - 8 * 7 * 86400000).toISOString().slice(0, 10);

      const { data: sessRows } = await supabase
        .from("sessions")
        .select("id, session_date, total_distance_m, completed_at")
        .eq("athlete_id", athleteId)
        .gte("session_date", since);

      const weekTotals = new Map<string, number>();
      const sessIds = (sessRows ?? []).map((s: any) => s.id);
      let actualBySession = new Map<string, number>();
      let plannedBySession = new Map<string, number>();

      if (sessIds.length > 0) {
        const { data: steps } = await supabase
          .from("steps")
          .select("id, session_id, target_distance_m, reps, set_count")
          .in("session_id", sessIds);

        const stepToSession = new Map<string, string>();

        for (const st of steps ?? []) {
          stepToSession.set(st.id, st.session_id);
          const planned = Number(st.target_distance_m ?? 0) * Number(st.reps ?? 1) * Number(st.set_count ?? 1);
          plannedBySession.set(st.session_id, (plannedBySession.get(st.session_id) ?? 0) + planned);
        }

        const stepIds = (steps ?? []).map((s: any) => s.id);

        if (stepIds.length > 0) {
          const { data: irs } = await supabase
            .from("interval_results")
            .select("step_id, actual_distance_m")
            .in("step_id", stepIds);

          for (const r of irs ?? []) {
            const sid = stepToSession.get(r.step_id);
            if (!sid) continue;
            actualBySession.set(sid, (actualBySession.get(sid) ?? 0) + Number(r.actual_distance_m ?? 0));
          }
        }
      }

      for (const s of sessRows ?? []) {
        let m = actualBySession.get(s.id) ?? 0;
        if (m === 0 && s.total_distance_m) m = Number(s.total_distance_m);
        if (m === 0 && !s.completed_at) m = plannedBySession.get(s.id) ?? 0;
        if (m > 0) {
          const week = weekStartMonday(s.session_date);
          weekTotals.set(week, (weekTotals.get(week) ?? 0) + m);
        }
      }

      return Array.from(weekTotals.entries())
        .map(([week_start, distance_m]) => ({ week_start, distance_m }))
        .sort((a, b) => b.week_start.localeCompare(a.week_start))
        .slice(0, 6);
    },
  });

  // Current best time per (distance, race type) — computed from the full,
  // unlimited performance history so it's accurate even if the actual PB
  // predates the most recent 20 rows shown in the "Personal bests" list.
  const currentBests = useMemo(() => {
    const map = new Map<string, number>();

    for (const p of progressionPerformances ?? []) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type}`;
      const cur = map.get(key);

      if (cur == null || p.time_seconds < cur) {
        map.set(key, p.time_seconds);
      }
    }

    return map;
  }, [progressionPerformances]);

  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_profiles")
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return data;
    },
  });

  if (!athlete)
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  const today = load?.[0];

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <Link
            to="/app/athletes"
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            ← Roster
          </Link>
          <div className="flex items-end justify-between gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-4">
              <UserAvatar name={athlete.name} imageUrl={(athlete as any).profile_image_url} size="xl" />
              <div>
                <h1 className="font-display text-4xl font-extrabold tracking-tight leading-none">{athlete.name}</h1>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {athlete.primary_event ?? "Unassigned event"}
                </p>
              </div>
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

        <IdentityCard athlete={athlete} athleteId={athleteId} />

        <ZoneBoundariesCard athleteId={athleteId} profile={zoneProfile} />

        <PhysiologyCard athleteId={athleteId} />

        {/* Side-by-side stat cards instead of a long vertical stack. items-stretch (grid's
            default) makes each row's two cards match height — Training load/Personal bests
            share row 1's height, Weekly distance/Recent sessions share row 2's — rather than
            each card sizing purely to its own content. */}
        <div className="grid md:grid-cols-2 gap-4 items-stretch">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Training load (14 days)</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
              {!load || load.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No load data yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th>Volume</th>
                      <th>Load</th>
                      <th>CTL</th>
                      <th>ATL</th>
                      <th>TSB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.map((d: any) => (
                      <tr key={d.load_date} className="border-t">
                        <td className="p-2">{d.load_date}</td>
                        <td className="text-center tabular-nums">
                          {(() => {
                            const m = volumeByDate?.get(d.load_date);
                            return m ? `${(m / 1000).toFixed(1)} km` : "—";
                          })()}
                        </td>
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

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Personal bests</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
              {!pbs || pbs.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No performances logged.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {pbs.map((p: any) => {
                      const key = `${p.distance_m}-${p.race_type}`;
                      const bestTime = currentBests.get(key);
                      const isCurrentPB = p.time_seconds != null && bestTime != null && p.time_seconds === bestTime;
                      const isPastPB = !isCurrentPB && p.is_pb;

                      return (
                        <tr key={p.id} className="border-t">
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {metersFmt(p.distance_m)}
                              {isCurrentPB && (
                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
                                  PB
                                </Badge>
                              )}
                              {isPastPB && (
                                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">
                                  Past PB
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                            {secToClock(p.time_seconds)}
                          </td>
                          <td className="py-2 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                            {p.performance_date}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Weekly distance</CardTitle>
              <CardDescription>Every step in the session — warm-up, work, strides and cooldown.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
              {!weeklyDistance || weeklyDistance.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No distance logged yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left p-2">Week of</th>
                      <th className="text-right p-2 pr-4">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyDistance.map((w: any) => (
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

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Recent sessions (7 days)</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
              {!sessions || sessions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No sessions in the last 7 days.</p>
              ) : (
                <div className="divide-y">
                  {sessions.map((s: any) => (
                    <Link
                      key={s.id}
                      to="/app/sessions/$sessionId"
                      params={{ sessionId: s.id }}
                      className="flex justify-between px-4 py-2 text-sm hover:bg-accent/40"
                    >
                      <span>
                        {s.session_date} · {s.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{s.completed_at ? "Done" : "Planned"}</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Vitals history</CardTitle>
              <CardDescription>Athlete's logged daily vitals.</CardDescription>
            </CardHeader>
            <CardContent>
              <VitalsPanel athleteId={athleteId} readOnly />
            </CardContent>
          </Card>
        </div>

        {/* Full width, matching how the progression chart appears on the athlete's own profile page */}
        <PerformanceProgressionCard
          performances={progressionPerformances ?? []}
          primaryEvent={athlete?.primary_event}
        />

        <CoachChat athleteId={athleteId} athleteName={athlete?.name ?? undefined} />
        <GenerateReviewCard athleteId={athleteId} />
        <AthleteReminderSettings athleteId={athleteId} />
      </div>
    </AppShell>
  );
}

function PerformanceProgressionCard({
  performances,
  primaryEvent,
}: {
  performances: any[];
  primaryEvent?: string | null;
}) {
  const [selectedEventKey, setSelectedEventKey] = useState<string>("");
  const primaryDistanceM = useMemo(() => primaryEventDistanceM(primaryEvent), [primaryEvent]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; distance_m: number }>();

    for (const p of performances) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${metersFmt(p.distance_m)} · ${raceTypeLabel(p.race_type)}`,
          distance_m: p.distance_m,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.distance_m - b.distance_m);
  }, [performances]);

  useEffect(() => {
    if (eventOptions.length === 0) {
      if (selectedEventKey) setSelectedEventKey("");
      return;
    }

    // Already have a valid selection (either the coach picked one, or a
    // prior run of this effect already set the default) — don't stomp on it.
    if (eventOptions.some((opt) => opt.key === selectedEventKey)) return;

    if (primaryDistanceM != null) {
      const matches = eventOptions.filter((opt) => opt.distance_m === primaryDistanceM);
      const preferred = matches.find((opt) => opt.key.endsWith("-track")) ?? matches[0];

      if (preferred) {
        setSelectedEventKey(preferred.key);
        return;
      }
    }

    setSelectedEventKey(eventOptions[0].key);
  }, [eventOptions, selectedEventKey, primaryDistanceM]);

  const chartData = useMemo(() => {
    if (!selectedEventKey) return [];

    return performances
      .filter((p) => `${p.distance_m}-${p.race_type}` === selectedEventKey && p.time_seconds != null)
      .slice()
      .sort((a, b) => a.performance_date.localeCompare(b.performance_date))
      .map((p) => ({ date: p.performance_date, seconds: p.time_seconds }));
  }, [performances, selectedEventKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance progression</CardTitle>
        <CardDescription>Race times over time, by event — same view as the athlete's own profile page.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {eventOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timed performances logged yet.</p>
        ) : (
          <>
            <Select value={selectedEventKey} onValueChange={setSelectedEventKey}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select event" />
              </SelectTrigger>
              <SelectContent>
                {eventOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {chartData.length > 1 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 11 }} />
                    <YAxis
                      reversed
                      tickFormatter={(v) => secToClock(v)}
                      tick={{ fontSize: 11 }}
                      width={55}
                      domain={["dataMin", "dataMax"]}
                    />
                    <Tooltip formatter={(value: number) => [secToClock(value), "Time"]} />
                    <Line type="monotone" dataKey="seconds" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Need at least 2 performances for this event to chart progression.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PhysiologyCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_physio_profile")
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return data;
    },
  });

  async function refresh() {
    const { error } = await supabase.rpc("recompute_physio_profile", { _athlete_id: athleteId });
    if (error) toast.error(error.message);
    else {
      toast.success("Profile refreshed");
      qc.invalidateQueries({ queryKey: ["physio", athleteId] });
    }
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
          <CardDescription>Derived from PBs, age & training age. Refines as more PBs are logged.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {insufficient ? (
          <p className="text-sm text-muted-foreground">
            {profile?.coaching_note ?? "No profile yet — log PBs at two or more distances."}
          </p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div className="flex items-center gap-4">
                <PieSplit aerobic={aer} anaerobic={an} />
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-3 rounded bg-emerald-500" />
                    Aerobic <span className="font-semibold tabular-nums ml-1">{aer}%</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="h-2 w-3 rounded bg-rose-500" />
                    Anaerobic <span className="font-semibold tabular-nums ml-1">{an}%</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Archetype</div>
                <div className="font-semibold">{profile.archetype}</div>
                {profile.speed_reserve_pct != null && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Speed reserve: <span className="tabular-nums">{profile.speed_reserve_pct}%</span> (
                    {profile.speed_reserve_bucket})
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

function IdentityCard({ athlete, athleteId }: { athlete: any; athleteId: string }) {
  const qc = useQueryClient();
  const ageYears = athlete?.dob
    ? Math.floor((Date.now() - new Date(athlete.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  const { data: latestVitals } = useQuery({
    queryKey: ["latest_vitals", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_vitals" as any)
        .select("weight_kg, vitals_date")
        .eq("athlete_id", athleteId)
        .not("weight_kg", "is", null)
        .order("vitals_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
  });

  const weightDisplay =
    latestVitals?.weight_kg != null
      ? `${Number(latestVitals.weight_kg).toFixed(1)} kg`
      : athlete?.weight != null
        ? `${Number(athlete.weight).toFixed(1)} kg (baseline)`
        : "not yet logged";

  const rows: Array<[string, string]> = [
    ["Name", athlete?.name ?? "—"],
    ["Sex", athlete?.sex ?? "—"],
    ["Date of birth", athlete?.dob ? `${athlete.dob}${ageYears != null ? ` (${ageYears}y)` : ""}` : "—"],
    ["Training age", athlete?.training_age_years != null ? `${athlete.training_age_years} yrs` : "—"],
    ["Primary event", athlete?.primary_event ?? "—"],
    ["Weight", weightDisplay],
    ["HR max", athlete?.hr_max != null ? `${athlete.hr_max} bpm` : "—"],
    ["HR rest", athlete?.hr_rest != null ? `${athlete.hr_rest} bpm` : "—"],
  ];

  // The one editable field on this otherwise read-only card. This is the
  // timezone that actually drives how this athlete's uploaded sessions get
  // classified (Morning/Afternoon/Evening) and how local session times get
  // displayed — was previously never settable anywhere for a coach editing
  // an athlete directly, so new athletes silently sat on UTC. Saves
  // immediately on change, same pattern as other single-field selects
  // elsewhere in the app (e.g. reassigning a session step's kind).
  async function saveTimezone(tz: string) {
    const { error } = await supabase
      .from("athletes")
      .update({ timezone: tz } as any)
      .eq("id", athleteId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Time zone updated");
    qc.invalidateQueries({ queryKey: ["athlete", athleteId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athlete profile</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b py-1">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between items-center border-b py-1 sm:col-span-2">
            <dt className="text-muted-foreground">Time zone</dt>
            <dd>
              <Select value={athlete?.timezone ?? guessLocalTimezone()} onValueChange={saveTimezone}>
                <SelectTrigger className="h-7 w-[220px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((z) => (
                    <SelectItem key={z.value} value={z.value}>
                      {z.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
