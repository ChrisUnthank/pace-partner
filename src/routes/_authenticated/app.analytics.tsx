import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles } from "@/lib/use-auth";
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
  const since = isoDaysAgo(14);

  const { data: roster } = useQuery({
    queryKey: ["analytics-roster", user?.id],
    enabled: !!user,
    queryFn: async () => {
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

  const zoneRollup = useMemo(() => {
    const buckets = new Map<string, number>();
    const rows: any[] = (zoneTime as any) ?? [];
    const hr = rows.filter((r) => r.source === "hr");
    const src = hr.length ? hr : rows.filter((r) => r.source === "pace");
    for (const r of src) {
      buckets.set(r.zone as string, (buckets.get(r.zone as string) ?? 0) + Number(r.seconds ?? 0));
    }
    const order = ["recovery", "easy", "steady", "threshold", "vo2", "rep", "sprint"];
    return order
      .filter((z) => buckets.has(z))
      .map((zone) => ({ zone, minutes: Math.round((buckets.get(zone) ?? 0) / 60) }));
  }, [zoneTime]);

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

        <Card>
          <CardHeader>
            <CardTitle>Time in zone</CardTitle>
            <CardDescription>Total minutes per intensity zone in this range.</CardDescription>
          </CardHeader>
          <CardContent>
            {zoneRollup.length === 0 ? (
              <p className="text-sm text-muted-foreground">No zone data yet — log sessions with HR or pace.</p>
            ) : (
              <div className="h-[200px] w-full">
                <ResponsiveContainer>
                  <BarChart data={zoneRollup} layout="vertical" margin={{ top: 6, right: 12, left: 24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} width={70} />
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Bar dataKey="minutes" name="min" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
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