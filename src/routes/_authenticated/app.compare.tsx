import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyAthlete, useMyRoles, useMyRawRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitCompare, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Search } from "lucide-react";
import { secToClock, paceFmt } from "@/lib/format";
import { predictTime } from "@/lib/race-predict";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export const Route = createFileRoute("/_authenticated/app/compare")({
  component: ComparePage,
});

type CompSession = {
  id: string;
  title: string;
  session_date: string;
  intent: string | null;
  structure: string | null;
  work_distance_m: number | null;
  work_time_s: number | null;
  work_avg_pace_sec_per_km: number | null;
  work_avg_hr: number | null;
};

type WorkStep = {
  session_id: string;
  step_order: number | null;
  reps: number | null;
  set_count: number | null;
  target_kind: string | null;
  target_distance_m: number | null;
  target_time_seconds: number | null;
};

// Builds a fingerprint for a session's work steps so two sessions with the
// same workout shape (e.g. "6x800m") group together even with small GPS/
// manual-entry variance — distances round to the nearest 50m, times to the
// nearest 15s, so 798m and 812m both bucket as "800m".
function workFingerprint(steps: WorkStep[]): string {
  return steps
    .slice()
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map((s) => {
      const target =
        s.target_kind === "distance"
          ? `d${Math.round((s.target_distance_m ?? 0) / 50) * 50}`
          : `t${Math.round((s.target_time_seconds ?? 0) / 15) * 15}`;
      return `${s.reps ?? 1}x${s.set_count ?? 1}@${target}`;
    })
    .join("|");
}

function intentLabel(v: string | null) {
  if (!v) return "—";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function ComparePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["compare-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const athleteId = isCoach ? selectedAthleteId : myAthlete?.id ?? "";

  const { data: sessions = [] } = useQuery({
    queryKey: ["compare-sessions", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select(
          "id, title, session_date, intent, structure, work_distance_m, work_time_s, work_avg_pace_sec_per_km, work_avg_hr",
        )
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .not("work_distance_m", "is", null)
        .not("work_time_s", "is", null)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompSession[];
    },
  });

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const { data: workSteps = [] } = useQuery({
    queryKey: ["compare-worksteps", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps")
        .select("session_id, step_order, reps, set_count, target_kind, target_distance_m, target_time_seconds")
        .in("session_id", sessionIds)
        .eq("kind", "work");
      if (error) throw error;
      return (data ?? []) as WorkStep[];
    },
  });

  // Fitness (CTL) trend for the athlete — pulled once the athlete's picked,
  // used later to check whether a pace improvement lines up with genuine
  // rising fitness or looks more like an isolated good day.
  const { data: loadHistory = [] } = useQuery({
    queryKey: ["compare-load", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl")
        .eq("athlete_id", athleteId)
        .order("load_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  function ctlNear(dateStr: string): number | null {
    // Latest CTL row on or before the given date — a session's date won't
    // always have its own load row (e.g. rest-day gaps), so this finds the
    // closest real reading at or before it.
    let best: { load_date: string; ctl: number | null } | null = null;
    for (const row of loadHistory) {
      if (row.load_date <= dateStr) best = row;
      else break;
    }
    return best?.ctl != null ? Math.round(Number(best.ctl)) : null;
  }

  const stepsBySession = useMemo(() => {
    const m = new Map<string, WorkStep[]>();
    for (const s of workSteps) {
      const arr = m.get(s.session_id) ?? [];
      arr.push(s);
      m.set(s.session_id, arr);
    }
    return m;
  }, [workSteps]);

  const { sameGroups, similarGroups } = useMemo(() => {
    const same = new Map<string, CompSession[]>();
    const similar = new Map<string, CompSession[]>();
    for (const s of sessions) {
      const fp = workFingerprint(stepsBySession.get(s.id) ?? []);
      const sameKey = `${s.intent}|${s.structure}|${fp}`;
      const simKey = `${s.intent}|${s.structure}`;
      (same.get(sameKey) ?? same.set(sameKey, []).get(sameKey)!).push(s);
      (similar.get(simKey) ?? similar.set(simKey, []).get(simKey)!).push(s);
    }
    const sameArr = Array.from(same.entries())
      .filter(([, v]) => v.length >= 2)
      .map(([key, v]) => ({ key, sessions: v }));
    const similarArr = Array.from(similar.entries())
      .filter(([, v]) => v.length >= 2)
      .map(([key, v]) => ({ key, sessions: v }));
    return { sameGroups: sameArr, similarGroups: similarArr };
  }, [sessions, stepsBySession]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  function selectGroup(group: CompSession[]) {
    setSelectedIds(new Set(group.map((s) => s.id)));
  }
  function toggleSession(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedSessions = useMemo(() => {
    return sessions
      .filter((s) => selectedIds.has(s.id))
      .slice()
      .sort((a, b) => a.session_date.localeCompare(b.session_date));
  }, [sessions, selectedIds]);

  const comparison = useMemo(() => {
    if (selectedSessions.length < 2) return null;
    const rows = selectedSessions.map((s) => {
      const km = Number(s.work_distance_m) / 1000;
      const predicted10k = km > 0 ? predictTime(Number(s.work_time_s), km, 10) : null;
      return { ...s, km, predicted10k, ctl: ctlNear(s.session_date) };
    });
    const first = rows[0];
    const last = rows[rows.length - 1];
    const chartData = rows.map((r) => ({
      date: r.session_date,
      predicted: r.predicted10k != null ? Math.round(r.predicted10k) : null,
    }));
    return { rows, first, last, chartData };
  }, [selectedSessions, loadHistory]);

  const narrative = useMemo(() => {
    if (!comparison) return null;
    const { first, last } = comparison;
    if (first.predicted10k == null || last.predicted10k == null) return null;

    const deltaSec = first.predicted10k - last.predicted10k; // positive = faster/improved
    const pct = (deltaSec / first.predicted10k) * 100;
    const ctlDelta = last.ctl != null && first.ctl != null ? last.ctl - first.ctl : null;
    const ctlPct = ctlDelta != null && first.ctl ? (ctlDelta / first.ctl) * 100 : null;

    const direction = deltaSec > 5 ? "improved" : deltaSec < -5 ? "declined" : "held steady";
    const paceLine = `Predicted 10K equivalent for this session type ${direction} from ${secToClock(first.predicted10k)} to ${secToClock(last.predicted10k)} between ${first.session_date} and ${last.session_date}${
      Math.abs(deltaSec) > 5 ? ` (${deltaSec > 0 ? "-" : "+"}${secToClock(Math.abs(deltaSec))}, ${Math.abs(pct).toFixed(1)}% ${deltaSec > 0 ? "faster" : "slower"})` : ""
    }.`;

    let fitnessLine = "";
    if (ctlDelta == null) {
      fitnessLine = "No Fitness (CTL) history available over this window to cross-check against.";
    } else if (deltaSec > 5 && ctlDelta > 0) {
      fitnessLine = `Fitness (CTL) also rose over the same window (${first.ctl} → ${last.ctl}), consistent with this being a genuine fitness gain rather than a one-off good day.`;
    } else if (deltaSec > 5 && ctlDelta <= 0) {
      fitnessLine = `Fitness (CTL) didn't rise correspondingly over this window (${first.ctl} → ${last.ctl}) — this improvement may reflect better pacing/efficiency, favourable conditions, or a particularly sharp day more than a broad fitness shift. Worth confirming with another comparable session before reading too much into it.`;
    } else if (deltaSec < -5 && ctlDelta < 0) {
      fitnessLine = `Fitness (CTL) also fell over this window (${first.ctl} → ${last.ctl}) — consistent with reduced training load, a taper, illness, or a recovery block, rather than a fitness concern on its own.`;
    } else if (deltaSec < -5 && ctlDelta >= 0) {
      fitnessLine = `Fitness (CTL) didn't fall over this window (${first.ctl} → ${last.ctl}) despite the slower result — worth checking conditions, fatigue, or readiness around the later session rather than assuming a fitness decline.`;
    } else {
      fitnessLine = `Fitness (CTL) moved from ${first.ctl} to ${last.ctl} over the same window.`;
    }

    return { paceLine, fitnessLine, deltaSec, pct };
  }, [comparison]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Compare Sessions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See how a repeated or similar session type has changed over time — and what that actually means for
            fitness and likely race performance, not just a pace number.
          </p>
        </div>

        {isCoach && (
          <div className="max-w-xs">
            <Label className="text-xs">Athlete</Label>
            <Select value={selectedAthleteId} onValueChange={setSelectedAthleteId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select an athlete" />
              </SelectTrigger>
              <SelectContent>
                {(roster ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!athleteId ? (
          <p className="text-sm text-muted-foreground">
            {isCoach ? "Select an athlete above to continue." : "No athlete profile linked."}
          </p>
        ) : sessions.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Not enough completed sessions with recorded work yet to compare — need at least 2.
          </p>
        ) : (
          <>
            {comparison && narrative && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {narrative.deltaSec > 5 ? (
                      <TrendingUp className="h-4 w-4 text-emerald-600" />
                    ) : narrative.deltaSec < -5 ? (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground" />
                    )}
                    What this means
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <p>{narrative.paceLine}</p>
                  <p className="text-muted-foreground">{narrative.fitnessLine}</p>
                </CardContent>
              </Card>
            )}

            {comparison && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Predicted 10K equivalent, over time</CardTitle>
                  <CardDescription>
                    Each selected session's work pace/distance projected onto a standard 10K via Riegel's formula —
                    the same engine behind the Pace/Race Predictor calculator.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={comparison.chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => secToClock(v)}
                          domain={["dataMin - 30", "dataMax + 30"]}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--background))",
                            border: "1px solid hsl(var(--border))",
                            fontSize: 12,
                          }}
                          formatter={(v: any) => [secToClock(Number(v)), "Predicted 10K"]}
                        />
                        <Line type="monotone" dataKey="predicted" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {comparison && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Sessions compared</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {comparison.rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{r.title}</div>
                          <div className="text-xs text-muted-foreground">{r.session_date}</div>
                        </div>
                        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                          <span>{r.km.toFixed(2)} km</span>
                          <span>{secToClock(Number(r.work_time_s))}</span>
                          <span>{paceFmt(r.work_avg_pace_sec_per_km)}</span>
                          {r.work_avg_hr != null && <span>{Math.round(r.work_avg_hr)} bpm</span>}
                          <Badge variant="outline">CTL {r.ctl ?? "—"}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Direct matches</CardTitle>
                  <CardDescription>Same intent, structure, and work-step shape — the closest apples-to-apples comparisons.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sameGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No repeated sessions detected yet.</p>
                  ) : (
                    sameGroups.map((g) => (
                      <button
                        key={g.key}
                        onClick={() => selectGroup(g.sessions)}
                        className="w-full text-left border rounded-md px-3 py-2 hover:bg-accent/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {intentLabel(g.sessions[0].intent)} · {g.sessions[0].structure}
                          </span>
                          <Badge variant="outline">{g.sessions.length} sessions</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {g.sessions[g.sessions.length - 1].session_date} → {g.sessions[0].session_date}
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Similar sessions</CardTitle>
                  <CardDescription>Same intent and structure type, but not an exact repeat — normalized via predicted equivalent, not raw pace.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {similarGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No comparable session types detected yet.</p>
                  ) : (
                    similarGroups.map((g) => (
                      <button
                        key={g.key}
                        onClick={() => selectGroup(g.sessions)}
                        className="w-full text-left border rounded-md px-3 py-2 hover:bg-accent/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {intentLabel(g.sessions[0].intent)} · {g.sessions[0].structure}
                          </span>
                          <Badge variant="outline">{g.sessions.length} sessions</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {g.sessions[g.sessions.length - 1].session_date} → {g.sessions[0].session_date}
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4" /> Compare specific sessions
                  </CardTitle>
                  {selectedIds.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                      Clear ({selectedIds.size})
                    </Button>
                  )}
                </div>
                <CardDescription>Pick any two or more sessions directly, regardless of auto-grouping.</CardDescription>
                <div className="relative mt-2">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by title…"
                    className="pl-8 h-9"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0 max-h-[360px] overflow-y-auto">
                <div className="divide-y">
                  {sessions
                    .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
                    .map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent/30 cursor-pointer"
                      >
                        <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleSession(s.id)} />
                        <span className="flex-1 min-w-0 truncate">{s.title}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{s.session_date}</span>
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                          {paceFmt(s.work_avg_pace_sec_per_km)}
                        </span>
                      </label>
                    ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
