import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReadinessBadge } from "@/components/readiness-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart as RLineChart,
  Line,
  Area,
  Bar,
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, ArrowRight, ChevronLeft, AlertTriangle } from "lucide-react";

const RANGES = {
  "4w": { days: 28, label: "4 weeks" },
  "3m": { days: 91, label: "3 months" },
  "6m": { days: 182, label: "6 months" },
  "all": { days: 2000, label: "All time" },
} as const;
type RangeKey = keyof typeof RANGES;

const searchSchema = z.object({
  athleteId: z.string().optional(),
  range: z.enum(["4w", "3m", "6m", "all"]).optional(),
});

export const Route = createFileRoute("/_authenticated/app/analytics")({
  validateSearch: searchSchema,
  component: AnalyticsPage,
});

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(dateStr: string) {
  // ISO year-week (YYYY-Www)
  const d = new Date(dateStr + "T00:00:00Z");
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function AnalyticsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const range: RangeKey = (search.range ?? "3m") as RangeKey;

  // Athlete view if athleteId is set, or if user is athlete-only
  const selectedAthleteId = search.athleteId ?? (!isCoach ? myAthlete?.id : undefined);

  function setRange(r: RangeKey) {
    navigate({ search: (prev: any) => ({ ...prev, range: r }) });
  }

  if (isCoach && !selectedAthleteId) {
    return (
      <AppShell>
        <CoachRoster range={range} onRangeChange={setRange} />
      </AppShell>
    );
  }

  if (!selectedAthleteId) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No athlete profile yet.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AthleteAnalytics athleteId={selectedAthleteId} range={range} onRangeChange={setRange} showBack={isCoach} />
    </AppShell>
  );
}

// ---------- Coach roster ----------

function CoachRoster({ range, onRangeChange }: { range: RangeKey; onRangeChange: (r: RangeKey) => void }) {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const since = isoDaysAgo(14);

  const { data: roster } = useQuery({
    queryKey: ["analytics-roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase
          .from("athletes")
          .select("id, name, primary_event")
          .order("name");
        return (data ?? []).map((a: any) => ({ athlete_id: a.id, athletes: a }));
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, primary_event)")
        .eq("coach_user_id", user!.id);
      return data ?? [];
    },
  });

  const athleteIds = roster?.map((r: any) => r.athlete_id) ?? [];

  const { data: rosterLoad } = useQuery({
    queryKey: ["analytics-roster-load", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("athlete_id, load_date, ctl, atl, tsb, readiness_status, readiness_score, confidence")
        .in("athlete_id", athleteIds)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: lastSessions } = useQuery({
    queryKey: ["analytics-roster-last", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, athlete_id, title, session_date")
        .in("athlete_id", athleteIds)
        .not("completed_at", "is", null)
        .order("session_date", { ascending: false })
        .limit(athleteIds.length * 5);
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    if (!roster) return [];
    return roster
      .map((r: any) => {
        const a = r.athletes;
        const load = (rosterLoad ?? []).filter((x: any) => x.athlete_id === r.athlete_id);
        const latest = load[load.length - 1];
        const trend = ctlSlopeDirection(load.map((x: any) => Number(x.ctl)).filter((n) => !Number.isNaN(n)));
        const last = (lastSessions ?? []).find((s: any) => s.athlete_id === r.athlete_id);
        return {
          athleteId: r.athlete_id,
          name: a?.name ?? "—",
          event: a?.primary_event ?? null,
          readinessStatus: latest?.readiness_status ?? null,
          readinessScore: latest?.readiness_score ?? null,
          confidence: latest?.confidence ?? null,
          trend,
          lastSession: last,
        };
      })
      .sort((a, b) => severity(b.readinessStatus) - severity(a.readinessStatus));
  }, [roster, rosterLoad, lastSessions]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Roster analytics</h1>
          <p className="text-sm text-muted-foreground">Readiness band and 14-day fitness trend for every athlete.</p>
        </div>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>

      <Card>
        <CardContent className="p-0">
          {!rows.length ? (
            <p className="p-6 text-sm text-muted-foreground">No athletes yet.</p>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <Link
                  key={row.athleteId}
                  to="/app/analytics"
                  search={{ athleteId: row.athleteId, range }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{row.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {row.lastSession
                        ? `Last: ${row.lastSession.session_date} · ${row.lastSession.title ?? "Session"}`
                        : "No sessions yet"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ReadinessBadge
                      status={row.readinessStatus as any}
                      score={row.readinessScore as any}
                      confidence={row.confidence as any}
                    />
                  </div>
                  <div className="shrink-0 w-28 flex items-center justify-end gap-1 text-sm">
                    <TrendArrow direction={row.trend} />
                    <span className="text-xs text-muted-foreground capitalize">{row.trend}</span>
                    {row.trend === "declining" && row.readinessStatus === "red" && (
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function severity(status: string | null) {
  if (status === "red") return 3;
  if (status === "amber") return 2;
  if (status === "green") return 1;
  return 0;
}

function ctlSlopeDirection(values: number[]): "improving" | "stable" | "declining" {
  if (values.length < 3) return "stable";
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  if (slope > 0.3) return "improving";
  if (slope < -0.3) return "declining";
  return "stable";
}

function TrendArrow({ direction }: { direction: "improving" | "stable" | "declining" }) {
  if (direction === "improving") return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
  if (direction === "declining") return <ArrowDownRight className="h-4 w-4 text-rose-600" />;
  return <ArrowRight className="h-4 w-4 text-muted-foreground" />;
}

// ---------- Athlete analytics ----------

function AthleteAnalytics({
  athleteId,
  range,
  onRangeChange,
  showBack,
}: {
  athleteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  showBack: boolean;
}) {
  const days = RANGES[range].days;
  const since = isoDaysAgo(days);

  const { data: athlete } = useQuery({
    queryKey: ["analytics-athlete", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athletes").select("id, name, primary_event").eq("id", athleteId).maybeSingle();
      return data;
    },
  });

  const { data: load } = useQuery({
    queryKey: ["analytics-load", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl, atl, tsb, training_load, readiness_status, readiness_score, confidence")
        .eq("athlete_id", athleteId)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: fatigue } = useQuery({
    queryKey: ["analytics-fatigue", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_fatigue")
        .select("efficiency_score, session_id, sessions!inner(session_date, athlete_id)")
        .eq("sessions.athlete_id", athleteId)
        .gte("sessions.session_date", since)
        .not("efficiency_score", "is", null);
      return data ?? [];
    },
  });

  const { data: weeklyDist } = useQuery({
    queryKey: ["analytics-weekly-distance", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_weekly_distance" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("week_start", since)
        .order("week_start", { ascending: true });
      return data ?? [];
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["analytics-zone-time", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_time_weekly" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .gte("week_start", since)
        .order("week_start", { ascending: true });
      return data ?? [];
    },
  });

  const { data: intentRollup } = useQuery({
    queryKey: ["analytics-intent-time", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("intent, total_time_seconds, day_type")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", since);
      return data ?? [];
    },
  });

  const { data: stepVolume } = useQuery({
    queryKey: ["analytics-step-volume", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("interval_results")
        .select("step_id, actual_time_seconds, actual_distance_m, steps!inner(kind, sessions!inner(athlete_id, session_date, completed_at))")
        .eq("steps.sessions.athlete_id", athleteId)
        .not("steps.sessions.completed_at", "is", null)
        .gte("steps.sessions.session_date", since);
      return data ?? [];
    },
  });

  // Fallback: for completed sessions with no per-rep results, use planned step targets so the
  // "Volume by Session Component" chart still shows manually-entered sessions.
  const { data: stepTargets } = useQuery({
    queryKey: ["analytics-step-targets", athleteId, since],
    queryFn: async () => {
      const { data } = await supabase
        .from("steps")
        .select("id, kind, reps, set_count, target_distance_m, target_time_seconds, sessions!inner(athlete_id, session_date, completed_at)")
        .eq("sessions.athlete_id", athleteId)
        .not("sessions.completed_at", "is", null)
        .gte("sessions.session_date", since);
      return data ?? [];
    },
  });

  const { data: physio } = useQuery({
    queryKey: ["analytics-physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data;
    },
  });

  const latest = load?.[load.length - 1];

  // Weekly training load
  const weeklyLoad = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of load ?? []) {
      const wk = isoWeekKey(r.load_date as string);
      buckets.set(wk, (buckets.get(wk) ?? 0) + Number(r.training_load ?? 0));
    }
    return Array.from(buckets.entries()).map(([week, value]) => ({ week, value: Math.round(value) }));
  }, [load]);

  // Weekly avg efficiency (the only new aggregation)
  const weeklyEfficiency = useMemo(() => {
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const r of fatigue ?? []) {
      const date = (r as any).sessions?.session_date;
      if (!date || r.efficiency_score == null) continue;
      const wk = isoWeekKey(date);
      const cur = buckets.get(wk) ?? { sum: 0, n: 0 };
      cur.sum += Number(r.efficiency_score);
      cur.n += 1;
      buckets.set(wk, cur);
    }
    return Array.from(buckets.entries())
      .map(([week, { sum, n }]) => ({ week, value: Math.round(sum / n) }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [fatigue]);

  const weeklyDistData = (weeklyDist ?? []).map((r: any) => ({
    week: isoWeekKey(r.week_start),
    km: Math.round((Number(r.distance_m ?? 0) / 1000) * 10) / 10,
  }));

  const zoneBuckets = useMemo(() => {
    const make = (source: "hr" | "pace") => {
      const sec = new Map<string, number>();
      const m = new Map<string, number>();
      for (const r of ((zoneTime as any) ?? []).filter((x: any) => x.source === source)) {
        sec.set(r.zone, (sec.get(r.zone) ?? 0) + Number(r.seconds ?? 0));
        m.set(r.zone, (m.get(r.zone) ?? 0) + Number(r.meters ?? 0));
      }
      const order = ["z1", "z2", "z3", "z4", "z5"];
      return order.map((zone) => ({
        zone: zone.toUpperCase(),
        minutes: Math.round((sec.get(zone) ?? 0) / 60),
        km: Math.round(((m.get(zone) ?? 0) / 1000) * 10) / 10,
      }));
    };
    return { hr: make("hr"), pace: make("pace") };
  }, [zoneTime]);

  const intentData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of (intentRollup as any[]) ?? []) {
      if (!r.intent || r.day_type !== "training") continue;
      buckets.set(r.intent, (buckets.get(r.intent) ?? 0) + Number(r.total_time_seconds ?? 0));
    }
    const order = ["easy", "aerobic", "tempo", "threshold", "vo2", "anaerobic", "speed"];
    return order
      .filter((k) => buckets.has(k))
      .map((intent) => ({
        intent: intent.charAt(0).toUpperCase() + intent.slice(1),
        minutes: Math.round((buckets.get(intent) ?? 0) / 60),
      }));
  }, [intentRollup]);

  const kindVolume = useMemo(() => {
    const sec = new Map<string, number>();
    const m = new Map<string, number>();
    const stepsWithActuals = new Set<string>();
    for (const r of (stepVolume as any[]) ?? []) {
      const kind = r.steps?.kind ?? "work";
      sec.set(kind, (sec.get(kind) ?? 0) + Number(r.actual_time_seconds ?? 0));
      m.set(kind, (m.get(kind) ?? 0) + Number(r.actual_distance_m ?? 0));
      if (r.step_id) stepsWithActuals.add(r.step_id);
    }
    // Fallback for manually-entered sessions: when a step has no per-rep results at all,
    // attribute its planned target volume to the right kind so the chart isn't empty.
    for (const s of (stepTargets as any[]) ?? []) {
      if (stepsWithActuals.has(s.id)) continue;
      const reps = Number(s.reps ?? 1);
      const setCount = Number(s.set_count ?? 1);
      const kind = s.kind ?? "work";
      const td = Number(s.target_distance_m ?? 0) * reps * setCount;
      const tt = Number(s.target_time_seconds ?? 0) * reps * setCount;
      if (td > 0) m.set(kind, (m.get(kind) ?? 0) + td);
      if (tt > 0) sec.set(kind, (sec.get(kind) ?? 0) + tt);
    }
    const order = ["warmup", "work", "strides", "recovery", "cooldown"];
    return order
      .filter((k) => (sec.get(k) ?? 0) > 0 || (m.get(k) ?? 0) > 0)
      .map((kind) => ({
        kind: kind.charAt(0).toUpperCase() + kind.slice(1),
        minutes: Math.round((sec.get(kind) ?? 0) / 60),
        km: Math.round(((m.get(kind) ?? 0) / 1000) * 10) / 10,
      }));
  }, [stepVolume, stepTargets]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {showBack && (
            <Link to="/app/analytics" search={{ range }} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
              <ChevronLeft className="h-3.5 w-3.5" /> Back to roster
            </Link>
          )}
          <h1 className="text-2xl font-bold mt-1">{athlete?.name ?? "Analytics"}</h1>
          <div className="mt-1">
            <ReadinessBadge
              status={latest?.readiness_status as any}
              score={latest?.readiness_score as any}
              confidence={latest?.confidence as any}
            />
          </div>
        </div>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>

      {/* PMC */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Management Chart</CardTitle>
          <CardDescription>Fitness (CTL), fatigue (ATL), form (TSB) over {RANGES[range].label.toLowerCase()}.</CardDescription>
        </CardHeader>
        <CardContent>
          {!load || load.length < 3 ? (
            <p className="text-sm text-muted-foreground">Building baseline — keep logging sessions and daily check-ins.</p>
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer>
                <ComposedChart data={load} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="load_date" tick={{ fontSize: 11 }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" />
                  <Area type="monotone" dataKey="tsb" name="Form (TSB)" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} />
                  <Line type="monotone" dataKey="ctl" name="Fitness (CTL)" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="atl" name="Fatigue (ATL)" stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Weekly training load</CardTitle>
            <CardDescription>Sum of session load per ISO week.</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyLoad.length === 0 ? (
              <p className="text-sm text-muted-foreground">No training load recorded yet.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <BarChart data={weeklyLoad} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Bar dataKey="value" name="Load" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Within-session fatigue trend</CardTitle>
            <CardDescription>Average efficiency score across interval sessions, by week. Higher = holding pace better late.</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyEfficiency.length < 2 ? (
              <p className="text-sm text-muted-foreground">Complete a few interval sessions to see this trend.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <RLineChart data={weeklyEfficiency} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Line type="monotone" dataKey="value" name="Efficiency" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                  </RLineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weekly distance</CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyDistData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No distance logged in this range.</p>
            ) : (
              <div className="h-[200px] w-full">
                <ResponsiveContainer>
                  <BarChart data={weeklyDistData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Bar dataKey="km" name="km" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <ZoneBarCard title="Time in HR Zone" description="Minutes per HR zone in this range." data={zoneBuckets.hr} dataKey="minutes" unit="min" color="#ef4444" />
        <ZoneBarCard title="Time in Pace Zone" description="Minutes per pace zone (anchored to 5K pace)." data={zoneBuckets.pace} dataKey="minutes" unit="min" color="#3b82f6" />
        <ZoneBarCard title="Distance in HR Zone" description="Kilometres per HR zone in this range." data={zoneBuckets.hr} dataKey="km" unit="km" color="#ef4444" />
        <ZoneBarCard title="Distance in Pace Zone" description="Kilometres per pace zone in this range." data={zoneBuckets.pace} dataKey="km" unit="km" color="#3b82f6" />

        <Card>
          <CardHeader>
            <CardTitle>Time by Training Intent</CardTitle>
            <CardDescription>Session-level total time grouped by planned intent.</CardDescription>
          </CardHeader>
          <CardContent>
            {intentData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed training sessions in this range.</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer>
                  <BarChart data={intentData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="intent" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Bar dataKey="minutes" name="min" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <VolumePieCard data={kindVolume} />
      </div>

      {/* Physio */}
      <Card>
        <CardHeader>
          <CardTitle>Physiological profile</CardTitle>
          <CardDescription>From PBs, age, and training age.</CardDescription>
        </CardHeader>
        <CardContent>
          {!physio || physio.status !== "ok" ? (
            <p className="text-sm text-muted-foreground">{physio?.coaching_note ?? "Log PBs at two or more distances to generate a profile."}</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div className="flex items-center gap-4">
                <PieSplit aerobic={Number(physio.aerobic_pct ?? 0)} anaerobic={Number(physio.anaerobic_pct ?? 0)} />
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-3 rounded bg-emerald-500" /> Aerobic
                    <span className="font-semibold tabular-nums ml-1">{Number(physio.aerobic_pct)}%</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="h-2 w-3 rounded bg-rose-500" /> Anaerobic
                    <span className="font-semibold tabular-nums ml-1">{Number(physio.anaerobic_pct)}%</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Archetype</div>
                <div className="font-semibold">{physio.archetype}</div>
                {physio.speed_reserve_pct != null && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Speed reserve: <span className="tabular-nums">{physio.speed_reserve_pct}%</span> ({physio.speed_reserve_bucket})
                  </div>
                )}
              </div>
              {physio.coaching_note && (
                <p className="sm:col-span-2 text-sm leading-relaxed border-l-2 pl-3 text-muted-foreground">
                  {physio.coaching_note}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <div className="flex items-center gap-1">
      <div className="hidden sm:flex border rounded-md overflow-hidden">
        {(Object.keys(RANGES) as RangeKey[]).map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`px-3 py-1.5 text-xs ${value === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
          >
            {k === "all" ? "All" : k.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="sm:hidden">
        <Select value={value} onValueChange={(v) => onChange(v as RangeKey)}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <SelectItem key={k} value={k}>{RANGES[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
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

function ZoneBarCard({
  title, description, data, dataKey, unit, color,
}: {
  title: string;
  description: string;
  data: { zone: string; minutes: number; km: number }[];
  dataKey: "minutes" | "km";
  unit: string;
  color: string;
}) {
  const hasData = data.some((d) => Number(d[dataKey]) > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">No zone data yet — complete sessions with HR or pace logged.</p>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Bar dataKey={dataKey} name={unit} fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_COLORS: Record<string, string> = {
  Warmup: "#0ea5e9",
  Work: "#ef4444",
  Strides: "#f59e0b",
  Recovery: "#64748b",
  Cooldown: "#10b981",
};

function VolumePieCard({ data }: { data: { kind: string; minutes: number; km: number }[] }) {
  const [mode, setMode] = useState<"minutes" | "km">("minutes");
  const hasData = data.some((d) => Number(d[mode]) > 0);
  const total = data.reduce((a, d) => a + Number(d[mode]), 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Weekly Volume by Session Component</CardTitle>
            <CardDescription>
              Share of {mode === "minutes" ? "time" : "distance"} across warmup, work, strides, recovery, and cooldown.
            </CardDescription>
          </div>
          <div className="flex border rounded-md overflow-hidden text-xs">
            <button
              onClick={() => setMode("minutes")}
              className={`px-2.5 py-1 ${mode === "minutes" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >Time</button>
            <button
              onClick={() => setMode("km")}
              className={`px-2.5 py-1 ${mode === "km" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >Distance</button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">No logged step volume yet.</p>
        ) : (
          <>
            <div className="h-[220px] w-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey={mode}
                    nameKey="kind"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {data.map((d) => (
                      <Cell key={d.kind} fill={KIND_COLORS[d.kind] ?? "#8b5cf6"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v: any, n: any) => {
                      const pct = total ? Math.round((Number(v) / total) * 100) : 0;
                      return [`${v} ${mode === "minutes" ? "min" : "km"} (${pct}%)`, n];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {mode === "km" && (
              <p className="text-xs text-muted-foreground mt-2">
                Includes warmup/cooldown to show how volume is split. Will exceed the headline "Weekly distance" number, which intentionally excludes warmup/cooldown.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}