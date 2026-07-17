import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { metersFmt, secToClock, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Printer, Mail, FileText } from "lucide-react";

// NOTE: this file's actual path is app.reports.athlete.weekly.tsx (dots),
// serving /app/reports/athlete/weekly — the createFileRoute string below
// must match that exactly, or the route silently drops from the tree.
export const Route = createFileRoute("/_authenticated/app/reports/athlete/weekly")({
  component: AthleteReportPage,
});

type PeriodType = "weekly" | "monthly" | "custom";

function weekStartMonday(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthStart(dateStr: string) {
  return dateStr.slice(0, 7) + "-01";
}
function monthEnd(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}
function formatDateLong(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function periodLabel(type: PeriodType) {
  if (type === "weekly") return "Weekly";
  if (type === "monthly") return "Monthly";
  return "Custom period";
}

// Session type vocabulary — mirrors sessions.intent (the same values
// session-files.functions.ts's classifier and the Training Plans
// effort_type→intent mapping already produce), plus "cross_train" and a
// catch-all "other" for anything with no intent set (rest days, unclassified
// manual entries). Shared shape for both the type-breakdown bars here and
// the per-athlete mini graph on the coach report.
// Same 6-zone palette used everywhere else (Zones card, calendar,
// session/race analysis) — was previously a separate, uncoordinated color
// set here, and was also missing "aerobic" and "anaerobic" as valid
// categories entirely (a session classified as either would silently never
// show up in the breakdown below, which is why "Easy" sessions that
// actually classified as Z2/aerobic looked like they'd vanished).
const SESSION_TYPES: { key: string; label: string; color: string }[] = [
  { key: "easy", label: "Easy", color: "#34d399" },
  { key: "aerobic", label: "Aerobic", color: "#38bdf8" },
  { key: "tempo", label: "Tempo", color: "#fbbf24" },
  { key: "threshold", label: "Threshold", color: "#f97316" },
  { key: "vo2", label: "VO2", color: "#ef4444" },
  { key: "anaerobic", label: "Anaerobic", color: "#9333ea" },
  { key: "cross_train", label: "Cross-train", color: "#94a3b8" },
  { key: "other", label: "Other", color: "#d6d3d1" },
];
// Distance/time per type, so pace can be shown per type rather than one
// blended overall number — averaging an easy run's pace with a VO2
// interval's pace produces a figure that doesn't actually represent either
// of them. Warmup, cooldown, and recovery ARE included (they're real
// continuous effort, same as the classifier already treats them) — only
// genuinely stopped/idle time is excluded, via total_moving_time_seconds
// (elapsed time minus detected real stops), the same "moving time" the
// session Overview page's own Total Avg Pace already prefers, for the
// same reason: a shoe-change pause or a gap between merged files shouldn't
// make the pace look slower than the athlete actually ran.
function sessionTypeStats(sessions: any[]): Record<string, { count: number; distance: number; time: number }> {
  const stats: Record<string, { count: number; distance: number; time: number }> = {};
  for (const s of sessions) {
    const key = s.intent ?? (s.day_type === "cross_training" ? "cross_train" : "other");
    const cur = stats[key] ?? { count: 0, distance: 0, time: 0 };
    cur.count += 1;
    cur.distance += Number(s.total_distance_m ?? 0);
    cur.time += Number(s.total_moving_time_seconds ?? s.total_time_seconds ?? 0);
    stats[key] = cur;
  }
  return stats;
}

function AthleteReportPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const { data: roster } = useQuery({
    queryKey: ["reports-roster", user?.id, isCoach],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [athleteId, setAthleteId] = useState<string>("");
  const activeAthleteId = athleteId || myAthlete?.id || "";
  const activeAthleteName =
    activeAthleteId === myAthlete?.id ? myAthlete?.name : (roster ?? []).find((a: any) => a.id === activeAthleteId)?.name;

  const [periodType, setPeriodType] = useState<PeriodType>("weekly");
  const [anchor, setAnchor] = useState(todayISO());
  const [customFrom, setCustomFrom] = useState(weekStartMonday(todayISO()));
  const [customTo, setCustomTo] = useState(todayISO());

  const periodStart =
    periodType === "weekly" ? weekStartMonday(anchor) : periodType === "monthly" ? monthStart(anchor) : customFrom;
  const periodEnd =
    periodType === "weekly" ? addDaysISO(periodStart, 6) : periodType === "monthly" ? monthEnd(anchor) : customTo;
  const periodValid = periodStart <= periodEnd;

  const [generated, setGenerated] = useState(false);
  const [emailTo, setEmailTo] = useState(user?.email ?? "");
  const [sending, setSending] = useState(false);

  const enabled = generated && !!activeAthleteId && periodValid;

  const { data: sessions, isFetching: sessionsLoading } = useQuery({
    queryKey: ["report-sessions", activeAthleteId, periodStart, periodEnd],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, title, session_date, total_distance_m, total_time_seconds, total_moving_time_seconds, rpe, completed_at, day_type, intent")
        .eq("athlete_id", activeAthleteId)
        .gte("session_date", periodStart)
        .lte("session_date", periodEnd)
        .order("session_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: weeklyDistanceRow } = useQuery({
    queryKey: ["report-weekly-distance", activeAthleteId, periodStart],
    enabled: enabled && periodType === "weekly",
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_weekly_distance" as any)
        .select("*")
        .eq("athlete_id", activeAthleteId)
        .eq("week_start", periodStart)
        .maybeSingle();
      return data as any;
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["report-zone-time", activeAthleteId, periodStart, periodEnd],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_zone_time_weekly" as any)
        .select("*")
        .eq("athlete_id", activeAthleteId)
        .gte("week_start", weekStartMonday(periodStart))
        .lte("week_start", periodEnd);
      return (data ?? []) as any[];
    },
  });

  const { data: loadRows } = useQuery({
    queryKey: ["report-load", activeAthleteId, periodStart, periodEnd],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("*")
        .eq("athlete_id", activeAthleteId)
        .gte("load_date", periodStart)
        .lte("load_date", periodEnd)
        .order("load_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: allPerformances } = useQuery({
    queryKey: ["report-performances", activeAthleteId],
    enabled,
    queryFn: async () => {
      const { data } = await supabase.from("performances").select("*").eq("athlete_id", activeAthleteId);
      return data ?? [];
    },
  });

  const { data: feelRows } = useQuery({
    queryKey: ["report-feel", activeAthleteId, periodStart, periodEnd, (sessions ?? []).map((s: any) => s.id).join(",")],
    enabled: enabled && (sessions ?? []).length > 0,
    queryFn: async () => {
      const ids = (sessions ?? []).map((s: any) => s.id);
      if (ids.length === 0) return [];
      const { data } = await supabase.from("session_insights").select("session_id, feel_score").in("session_id", ids);
      return data ?? [];
    },
  });

  const periodPbs = useMemo(() => {
    if (!allPerformances) return [];
    const bestByKey = new Map<string, number>();
    for (const p of allPerformances) {
      if (p.time_seconds == null) continue;
      const key = `${p.distance_m}-${p.race_type ?? "none"}`;
      const cur = bestByKey.get(key);
      if (cur == null || p.time_seconds < cur) bestByKey.set(key, p.time_seconds);
    }
    return allPerformances.filter((p: any) => {
      if (p.performance_date < periodStart || p.performance_date > periodEnd) return false;
      const key = `${p.distance_m}-${p.race_type ?? "none"}`;
      return bestByKey.get(key) === p.time_seconds;
    });
  }, [allPerformances, periodStart, periodEnd]);

  const stats = useMemo(() => {
    const list = sessions ?? [];
    const completed = list.filter((s: any) => s.completed_at);
    const totalDistance =
      periodType === "weekly"
        ? (weeklyDistanceRow?.distance_m ?? completed.reduce((a, s) => a + (s.total_distance_m ?? 0), 0))
        : completed.reduce((a: number, s: any) => a + (s.total_distance_m ?? 0), 0);
    const totalTime = completed.reduce(
      (a: number, s: any) => a + (s.total_moving_time_seconds ?? s.total_time_seconds ?? 0),
      0,
    );
    const rpes = completed.map((s: any) => s.rpe).filter((v: any) => v != null);
    const avgRpe = rpes.length ? rpes.reduce((a: number, b: number) => a + b, 0) / rpes.length : null;
    const feels = (feelRows ?? []).map((r: any) => r.feel_score).filter((v: any) => v != null);
    const avgFeel = feels.length ? feels.reduce((a: number, b: number) => a + b, 0) / feels.length : null;
    const periodLoad = (loadRows ?? []).reduce((a: number, r: any) => a + (Number(r.training_load) || 0), 0);
    const lastLoadRow = (loadRows ?? [])[(loadRows ?? []).length - 1];
    return {
      total: list.length,
      completedCount: completed.length,
      totalDistance,
      totalTime,
      avgPace: totalDistance > 0 && totalTime > 0 ? (totalTime / totalDistance) * 1000 : null,
      avgRpe,
      avgFeel,
      periodLoad,
      ctl: lastLoadRow?.ctl ?? null,
      atl: lastLoadRow?.atl ?? null,
      tsb: lastLoadRow?.tsb ?? null,
    };
  }, [sessions, weeklyDistanceRow, feelRows, loadRows, periodType]);

  const typeStats = useMemo(() => sessionTypeStats((sessions ?? []).filter((s: any) => s.completed_at)), [sessions]);

  const paceZones = (zoneTime ?? []).filter((r: any) => r.source === "pace");
  const hrZones = (zoneTime ?? []).filter((r: any) => r.source === "hr");

  async function sendEmail() {
    if (!emailTo) {
      toast.error("Enter an email address");
      return;
    }
    setSending(true);
    const el = document.getElementById("report-printable");
    const html = `<div style="font-family: Arial, sans-serif; color:#111; max-width:640px;">${el?.innerHTML ?? ""}</div>`;
    const { error } = await supabase.functions.invoke("send-report-email", {
      body: {
        to: emailTo,
        subject: `${activeAthleteName ?? "Athlete"} — Report (${formatDateLong(periodStart)} – ${formatDateLong(periodEnd)})`,
        html,
      },
    });
    setSending(false);
    if (error) {
      toast.error(`Send failed: ${error.message ?? "check that a sending domain is configured"}`);
      return;
    }
    toast.success("Report emailed");
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl print:max-w-none">
        <div className="flex items-center gap-2 print:hidden">
          <FileText className="h-5 w-5 text-[var(--accent-red)]" />
          <h1 className="text-2xl font-bold">Athlete Report</h1>
        </div>

        <Card className="print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Report settings</CardTitle>
            <CardDescription>
              Pick an athlete and a time frame, then generate. Nothing here is AI-written — every number is pulled
              straight from recorded data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-4 gap-3 items-end">
            {isCoach && (
              <div>
                <Label className="text-xs">Athlete</Label>
                <Select value={activeAthleteId} onValueChange={(v) => { setAthleteId(v); setGenerated(false); }}>
                  <SelectTrigger><SelectValue placeholder="Pick athlete" /></SelectTrigger>
                  <SelectContent>
                    {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                    {(roster ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Time frame</Label>
              <Select value={periodType} onValueChange={(v) => { setPeriodType(v as PeriodType); setGenerated(false); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom dates</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodType !== "custom" ? (
              <div>
                <Label className="text-xs">{periodType === "weekly" ? "Any day in the week" : "Any day in the month"}</Label>
                <Input type="date" value={anchor} onChange={(e) => { setAnchor(e.target.value); setGenerated(false); }} />
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setGenerated(false); }} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setGenerated(false); }} />
                </div>
              </>
            )}

            <Button onClick={() => setGenerated(true)} disabled={!activeAthleteId || !periodValid}>
              Generate report
            </Button>
            {!periodValid && <p className="text-xs text-destructive sm:col-span-4">"From" must be before "To".</p>}
          </CardContent>
        </Card>

        {generated && activeAthleteId && periodValid && (
          <>
            <div className="flex items-center gap-2 print:hidden">
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
              </Button>
              <Input
                className="w-56 h-9"
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="Send to email"
              />
              <Button size="sm" variant="outline" disabled={sending} onClick={sendEmail}>
                <Mail className="h-4 w-4 mr-1" /> {sending ? "Sending…" : "Email report"}
              </Button>
            </div>

            {sessionsLoading ? (
              <p className="text-sm text-muted-foreground">Building report…</p>
            ) : (
              <div id="report-printable" className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold">{activeAthleteName ?? "Athlete"} — {periodLabel(periodType)} Report</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatDateLong(periodStart)} – {formatDateLong(periodEnd)}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatBox label="Sessions" value={`${stats.completedCount}/${stats.total}`} sub="completed / planned" />
                  <StatBox label="Distance" value={metersFmt(stats.totalDistance)} />
                  <StatBox label="Time" value={secToClock(stats.totalTime)} />
                  <StatBox label="Total load" value={stats.periodLoad ? String(Math.round(stats.periodLoad)) : "—"} />
                  <StatBox label="Fitness" value={stats.ctl != null ? String(Math.round(stats.ctl)) : "—"} />
                  <StatBox label="Form" value={stats.tsb != null ? String(Math.round(stats.tsb)) : "—"} />
                  <StatBox label="Fatigue" value={stats.atl != null ? String(Math.round(stats.atl)) : "—"} />
                </div>

                <TypeBreakdownCard stats={typeStats} />

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Sessions in this period</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    {!sessions?.length ? (
                      <p className="p-4 text-sm text-muted-foreground">No sessions logged in this period.</p>
                    ) : (
                      <div className="divide-y max-h-[420px] overflow-y-auto print:max-h-none print:overflow-visible">
                        {sessions.map((s: any) => (
                          <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{s.session_date.slice(5)}</span>
                            <TypeDot type={s.intent ?? (s.day_type === "cross_training" ? "cross_train" : "other")} />
                            <span className="min-w-0 flex-1 truncate font-medium">{s.title ?? "Untitled session"}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground w-16 text-right">
                              {metersFmt(s.total_distance_m ?? 0)}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground w-14 text-right">
                              {secToClock(s.total_moving_time_seconds ?? s.total_time_seconds ?? 0)}
                            </span>
                            <span
                              className={`shrink-0 w-4 text-center ${s.completed_at ? "text-emerald-600" : "text-muted-foreground/50"}`}
                              title={s.completed_at ? "Completed" : "Not completed"}
                            >
                              {s.completed_at ? "✓" : "·"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {(paceZones.length > 0 || hrZones.length > 0) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <ZoneTable title="Pace zones" rows={paceZones} />
                    <ZoneTable title="HR zones" rows={hrZones} />
                  </div>
                )}

                {periodPbs.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Personal bests in this period</CardTitle></CardHeader>
                    <CardContent className="space-y-1">
                      {periodPbs.map((p: any) => (
                        <div key={p.id} className="text-sm flex justify-between">
                          <span>{metersFmt(p.distance_m)} · {p.event_name ?? p.performance_date}</span>
                          <span className="font-medium tabular-nums">{secToClock(p.time_seconds)}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <p className="text-xs text-muted-foreground print:mt-8">
                  Generated {new Date().toLocaleString("en-AU")} — compiled directly from recorded training data, no AI summarization.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-extrabold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function TypeDot({ type }: { type: string }) {
  const t = SESSION_TYPES.find((x) => x.key === type) ?? SESSION_TYPES[SESSION_TYPES.length - 1];
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} title={t.label} />;
}

function TypeBreakdownCard({ stats }: { stats: Record<string, { count: number; distance: number; time: number }> }) {
  const total = Object.values(stats).reduce((a, b) => a + b.count, 0);
  const present = SESSION_TYPES.filter((t) => (stats[t.key]?.count ?? 0) > 0);
  if (total === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sessions by type</CardTitle>
        <CardDescription>Pace shown per type — an overall blended pace across easy and hard sessions isn't a meaningful number.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {present.map((t) => {
          const s = stats[t.key];
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          const avgPace = s.distance > 0 && s.time > 0 ? (s.time / s.distance) * 1000 : null;
          return (
            <div key={t.key} className="flex items-center gap-2 text-sm">
              <TypeDot type={t.key} />
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{t.label}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full" style={{ width: `${pct}%`, backgroundColor: t.color }} />
              </div>
              <span className="w-16 text-right tabular-nums text-xs text-muted-foreground">
                {avgPace ? `${secToClock(avgPace)}/km` : "—"}
              </span>
              <span className="w-6 text-right tabular-nums text-xs">{s.count}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ZoneTable({ title, rows }: { title: string; rows: any[] }) {
  const order = ["z1", "z2", "z3", "z4", "z5"];
  const byZone = new Map<string, number>();
  for (const r of rows) byZone.set(r.zone, (byZone.get(r.zone) ?? 0) + (Number(r.seconds) || 0));
  const totalSec = Array.from(byZone.values()).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {order.map((z) => {
          const sec = byZone.get(z) ?? 0;
          const pct = totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0;
          return (
            <div key={z} className="flex items-center gap-2 text-sm">
              <span className="w-8 uppercase text-xs text-muted-foreground">{z}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-[var(--accent-red)]" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-16 text-right tabular-nums text-xs">{secToClock(sec)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
