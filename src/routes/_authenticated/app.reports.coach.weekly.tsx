import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { metersFmt, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Printer, Mail, Users } from "lucide-react";

// NOTE: this file's actual path is app.reports.coach.weekly.tsx (dots),
// serving /app/reports/coach/weekly — the createFileRoute string below
// must match that exactly, or the route silently drops from the tree.
export const Route = createFileRoute("/_authenticated/app/reports/coach/weekly")({
  component: CoachRosterSummaryPage,
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
  const d = new Date(Date.UTC(y, m, 0));
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

function CoachRosterSummaryPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

  const [periodType, setPeriodType] = useState<PeriodType>("weekly");
  const [anchor, setAnchor] = useState(todayISO());
  const [customFrom, setCustomFrom] = useState(weekStartMonday(todayISO()));
  const [customTo, setCustomTo] = useState(todayISO());

  const periodStart =
    periodType === "weekly" ? weekStartMonday(anchor) : periodType === "monthly" ? monthStart(anchor) : customFrom;
  const periodEnd =
    periodType === "weekly" ? addDaysISO(periodStart, 6) : periodType === "monthly" ? monthEnd(anchor) : customTo;
  const periodValid = periodStart <= periodEnd;
  const isPastOrCurrentDay = (d: string) => d <= todayISO();

  const [generated, setGenerated] = useState(false);
  const [emailTo, setEmailTo] = useState(user?.email ?? "");
  const [sending, setSending] = useState(false);

  const { data: roster } = useQuery({
    queryKey: ["coach-roster-summary-roster", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });
  const athleteIds = (roster ?? []).map((a: any) => a.id);

  const enabled = generated && athleteIds.length > 0 && periodValid;

  const { data: sessions, isFetching: loading } = useQuery({
    queryKey: ["coach-report-sessions", athleteIds.join(","), periodStart, periodEnd],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("athlete_id, total_distance_m, total_time_seconds, rpe, completed_at, is_planned, session_date")
        .in("athlete_id", athleteIds)
        .gte("session_date", periodStart)
        .lte("session_date", periodEnd);
      return data ?? [];
    },
  });

  const { data: distanceRows } = useQuery({
    queryKey: ["coach-report-distance", athleteIds.join(","), periodStart],
    enabled: enabled && periodType === "weekly",
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_weekly_distance" as any)
        .select("*")
        .in("athlete_id", athleteIds)
        .eq("week_start", periodStart);
      return (data ?? []) as any[];
    },
  });

  const { data: loadRows } = useQuery({
    queryKey: ["coach-report-load", athleteIds.join(","), periodStart, periodEnd],
    enabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_load_daily")
        .select("*")
        .in("athlete_id", athleteIds)
        .gte("load_date", periodStart)
        .lte("load_date", periodEnd)
        .order("load_date", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const rows = useMemo(() => {
    const list = roster ?? [];
    const sessionsByAthlete = new Map<string, any[]>();
    for (const s of sessions ?? []) {
      const arr = sessionsByAthlete.get(s.athlete_id) ?? [];
      arr.push(s);
      sessionsByAthlete.set(s.athlete_id, arr);
    }
    const distanceByAthlete = new Map((distanceRows ?? []).map((r: any) => [r.athlete_id, r]));
    const lastLoadByAthlete = new Map<string, any>();
    for (const r of loadRows ?? []) lastLoadByAthlete.set(r.athlete_id, r);

    return list.map((a: any) => {
      const athleteSessions = sessionsByAthlete.get(a.id) ?? [];
      const completed = athleteSessions.filter((s) => s.completed_at);
      const missed = athleteSessions.filter(
        (s) => s.is_planned && !s.completed_at && isPastOrCurrentDay(s.session_date),
      );
      const rpes = completed.map((s) => s.rpe).filter((v) => v != null);
      const avgRpe = rpes.length ? rpes.reduce((x: number, y: number) => x + y, 0) / rpes.length : null;
      const distanceRow = periodType === "weekly" ? distanceByAthlete.get(a.id) : null;
      const distance = distanceRow?.distance_m ?? completed.reduce((x: number, s: any) => x + (s.total_distance_m ?? 0), 0);
      const load = lastLoadByAthlete.get(a.id);

      const flags: string[] = [];
      if (athleteSessions.length === 0) flags.push("No sessions logged");
      if (missed.length > 0) flags.push(`${missed.length} missed`);
      if (load?.tsb != null && load.tsb < -25) flags.push("High fatigue (TSB)");

      return {
        id: a.id,
        name: a.name,
        plannedCount: athleteSessions.length,
        completedCount: completed.length,
        distance,
        avgRpe,
        tsb: load?.tsb ?? null,
        flags,
      };
    });
  }, [roster, sessions, distanceRows, loadRows, periodType]);

  const totals = useMemo(() => {
    const totalDistance = rows.reduce((a, r) => a + (r.distance ?? 0), 0);
    const totalSessions = rows.reduce((a, r) => a + r.completedCount, 0);
    const flaggedCount = rows.filter((r) => r.flags.length > 0).length;
    return { athletes: rows.length, totalDistance, totalSessions, flaggedCount };
  }, [rows]);

  async function sendEmail() {
    if (!emailTo) {
      toast.error("Enter an email address");
      return;
    }
    setSending(true);
    const el = document.getElementById("coach-report-printable");
    const html = `<div style="font-family: Arial, sans-serif; color:#111; max-width:720px;">${el?.innerHTML ?? ""}</div>`;
    const { error } = await supabase.functions.invoke("send-report-email", {
      body: {
        to: emailTo,
        subject: `Coach Roster Summary — ${formatDateLong(periodStart)} – ${formatDateLong(periodEnd)}`,
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

  if (!isCoach) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">This report is only available to coaches.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl print:max-w-none">
        <div className="flex items-center gap-2 print:hidden">
          <Users className="h-5 w-5 text-[var(--accent-red)]" />
          <h1 className="text-2xl font-bold">Coach Roster Summary</h1>
        </div>

        <Card className="print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Report settings</CardTitle>
            <CardDescription>Roster-wide, one row per athlete. Nothing here is AI-written.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-4 gap-3 items-end">
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

            <Button onClick={() => setGenerated(true)} disabled={athleteIds.length === 0 || !periodValid}>
              Generate report
            </Button>
            {!periodValid && <p className="text-xs text-destructive sm:col-span-4">"From" must be before "To".</p>}
          </CardContent>
        </Card>

        {generated && periodValid && (
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

            {loading ? (
              <p className="text-sm text-muted-foreground">Building report…</p>
            ) : (
              <div id="coach-report-printable" className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold">Coach Roster Summary — {periodLabel(periodType)}</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatDateLong(periodStart)} – {formatDateLong(periodEnd)}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatBox label="Athletes" value={String(totals.athletes)} />
                  <StatBox label="Roster distance" value={metersFmt(totals.totalDistance)} />
                  <StatBox label="Sessions completed" value={String(totals.totalSessions)} />
                  <StatBox label="Flagged" value={String(totals.flaggedCount)} />
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">By athlete</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {rows.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">No athletes on your roster.</p>
                    ) : (
                      <div className="divide-y">
                        {rows.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                            <div className="min-w-0">
                              <div className="font-medium truncate">{r.name}</div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {r.flags.map((f) => (
                                  <Badge key={f} variant="outline" className="text-[10px] border-amber-500/50 text-amber-600">
                                    {f}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="text-right shrink-0 text-xs text-muted-foreground">
                              <div>
                                {r.completedCount}/{r.plannedCount} sessions · {metersFmt(r.distance)}
                              </div>
                              <div>
                                {r.avgRpe != null ? `Avg RPE ${r.avgRpe.toFixed(1)}` : "No RPE data"}
                                {r.tsb != null ? ` · TSB ${Math.round(r.tsb)}` : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

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

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-extrabold tabular-nums mt-1">{value}</div>
    </div>
  );
}
