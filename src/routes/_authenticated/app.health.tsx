import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyAthlete, useMyRoles, useCoachRoster } from "@/lib/use-auth";
import { useEffectiveRole } from "@/lib/view-mode";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { healthEventLabel } from "@/lib/health-events";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { BucketTabStrip, HEALTH_TABS, healthTabsFor } from "@/components/bucket-tab-strip";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { todayISO } from "@/lib/format";
import { AlertTriangle, Search, Apple, Bath, Bandage, FlaskConical, TestTube2, HeartPulse, ClipboardList } from "lucide-react";
import { useLactateSessionPoints, useLactateSpotChecks } from "./app.lactate";

const searchSchema = z.object({
  // Present when a coach arrives via a specific athlete's tab strip —
  // shows that athlete's own snapshot instead of the roster overview.
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/health")({
  validateSearch: searchSchema,
  component: HealthPage,
});

function daysAgo(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T00:00:00").getTime();
  const now = new Date(todayISO() + "T00:00:00").getTime();
  return Math.round((now - then) / 86400000);
}

function HealthPage() {
  const search = Route.useSearch();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { isCoachView } = useEffectiveRole();

  // Coach arriving for a specific athlete (via that athlete's tab strip) —
  // same snapshot the athlete sees for themselves below, just
  // parameterized by the given athleteId instead of the logged-in user's
  // own athlete row, plus the AthleteSubnav for further navigation. Left
  // on the real isCoach role — an explicit athleteId in the URL is a
  // deliberate coach action and should keep working regardless of this
  // coach's own header toggle state.
  if (isCoach && search.athleteId) {
    return (
      <AppShell fullWidth>
        <CoachAthleteHealthView athleteId={search.athleteId} />
      </AppShell>
    );
  }

  // Coaches get a roster overview instead of the self-service snapshot
  // below — same page, same nav entry, branching by role like Zones and
  // Analytics already do. Uses the effective view (isCoachView), not the
  // raw role — see the identical fix on Zones for why.
  if (isCoachView) {
    return (
      <AppShell fullWidth>
        <CoachHealthRoster />
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <AthleteHealthView />
    </AppShell>
  );
}

// ----------------------------------------------------------------------------
// Shared: latest vitals + check-in snapshot for one athlete
// ----------------------------------------------------------------------------

function useLatestHealthSnapshot(athleteId: string | undefined) {
  return useQuery({
    queryKey: ["latest-health-snapshot", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const [{ data: v, error: vErr }, { data: c, error: cErr }] = await Promise.all([
        supabase
          .from("daily_vitals")
          .select("*")
          .eq("athlete_id", athleteId!)
          .order("vitals_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("daily_checkins")
          .select("*")
          .eq("athlete_id", athleteId!)
          .order("checkin_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (vErr) throw vErr;
      if (cErr) throw cErr;
      return { vitals: v as any, checkin: c as any };
    },
  });
}

function HealthSnapshotCard({ snapshot }: { snapshot: { vitals: any; checkin: any } | undefined }) {
  const v = snapshot?.vitals;
  const c = snapshot?.checkin;
  const lastDate = [v?.vitals_date, c?.checkin_date].filter(Boolean).sort().pop();

  if (!lastDate) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">No vitals logged yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          Latest entry
          <span className="text-sm font-normal text-muted-foreground">
            {new Date(lastDate + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </CardTitle>
        <CardDescription>Sleep, resting HR, weight, and soreness from Daily Log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Sleep" value={v?.sleep_hours != null ? `${v.sleep_hours}h` : "—"} />
          <Stat label="Resting HR" value={v?.resting_hr != null ? `${v.resting_hr} bpm` : "—"} />
          <Stat label="Weight" value={v?.weight_kg != null ? `${v.weight_kg} kg` : "—"} />
          <Stat label="Soreness" value={c?.soreness != null ? `${c.soreness}/5` : "—"} />
        </div>
        {c?.injury_flag && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Injury concern flagged</p>
              {c.injury_notes && <p className="text-xs text-muted-foreground mt-0.5">{c.injury_notes}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Per-tab summary tiles — one small card per Health tab (Daily Log, Diet &
// Fuel, Recovery, Injury Management, Bicarb, Lactate), each just showing
// its single most-recent entry with a link through to the full page. Kept
// deliberately lightweight — the full detail/history/forms already live on
// each tab's own page; this is a glance, not a duplicate of it.
// ----------------------------------------------------------------------------

function SummaryTile({
  icon: Icon,
  title,
  to,
  athleteId,
  children,
}: {
  icon: any;
  title: string;
  to: string;
  athleteId: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Icon className="h-4 w-4 text-muted-foreground" /> {title}
          </span>
          <Link
            to={to}
            search={{ athleteId } as any}
            className="text-xs font-medium text-[var(--accent-red)] hover:underline whitespace-nowrap"
          >
            Open →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function fmtShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Deliberately separate from HealthSnapshotCard ("Latest entry") above —
// that card is the detailed, prominent vitals readout; this is the same
// glance-plus-link tile every other Health area gets, for the same
// reason: consistency, and an actual "Open →" straight into Daily Log
// itself, which the snapshot card never had.
function DailyLogSummary({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["health-overview-daily-log", athleteId],
    queryFn: async () => {
      const [{ data: v, error: vErr }, { data: c, error: cErr }] = await Promise.all([
        supabase
          .from("daily_vitals")
          .select("vitals_date, sleep_hours, resting_hr")
          .eq("athlete_id", athleteId)
          .order("vitals_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("daily_checkins")
          .select("checkin_date, soreness")
          .eq("athlete_id", athleteId)
          .order("checkin_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (vErr) throw vErr;
      if (cErr) throw cErr;
      return { vitals: v as any, checkin: c as any };
    },
  });

  const lastDate = [data?.vitals?.vitals_date, data?.checkin?.checkin_date].filter(Boolean).sort().pop();

  return (
    <SummaryTile icon={ClipboardList} title="Daily Log" to="/app/daily-log" athleteId={athleteId}>
      {lastDate ? (
        <>
          <div className="text-muted-foreground text-xs mb-1">{fmtShortDate(lastDate)}</div>
          <div className="font-medium">
            {data?.vitals?.sleep_hours != null ? `${data.vitals.sleep_hours}h sleep` : "No sleep logged"}
            {data?.vitals?.resting_hr != null && ` · ${data.vitals.resting_hr} bpm`}
            {data?.checkin?.soreness != null && ` · soreness ${data.checkin.soreness}/5`}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">No daily log entries yet.</p>
      )}
    </SummaryTile>
  );
}

function DietFuelSummary({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["health-overview-nutrition", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_nutrition")
        .select("nutrition_date, calories, carbs_g")
        .eq("athlete_id", athleteId)
        .order("nutrition_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <SummaryTile icon={Apple} title="Diet & Fuel" to="/app/diet-fuel" athleteId={athleteId}>
      {data ? (
        <>
          <div className="text-muted-foreground text-xs mb-1">{fmtShortDate(data.nutrition_date)}</div>
          <div className="font-medium">
            {data.calories != null ? `${data.calories} kcal` : "No calories logged"}
            {data.carbs_g != null && ` · ${data.carbs_g}g carbs`}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">No nutrition logged yet.</p>
      )}
    </SummaryTile>
  );
}

function RecoverySummary({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["health-overview-recovery", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recovery_sessions")
        .select("session_date, modality, duration_minutes")
        .eq("athlete_id", athleteId)
        .order("session_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <SummaryTile icon={Bath} title="Recovery" to="/app/recovery" athleteId={athleteId}>
      {data ? (
        <>
          <div className="text-muted-foreground text-xs mb-1">{fmtShortDate(data.session_date)}</div>
          <div className="font-medium capitalize">
            {data.modality.replace("_", " ")}
            {data.duration_minutes != null && ` · ${data.duration_minutes} min`}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">No recovery sessions logged yet.</p>
      )}
    </SummaryTile>
  );
}

function InjurySummary({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["health-overview-injuries", athleteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("injuries")
        .select("body_part, side, status, kind, illness_type, is_chronic, training_impact, training_modifications")
        .eq("athlete_id", athleteId)
        .neq("status", "resolved")
        .order("onset_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <SummaryTile icon={Bandage} title="Injury & Illness" to="/app/injuries" athleteId={athleteId}>
      {!data || data.length === 0 ? (
        <p className="text-muted-foreground">Nothing active.</p>
      ) : (
        <div className="space-y-1">
          {data.slice(0, 3).map((i, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span className="capitalize font-medium truncate">{healthEventLabel(i)}</span>
              <Badge variant={i.status === "active" ? "destructive" : "secondary"} className="text-[10px] shrink-0">
                {i.status}
              </Badge>
            </div>
          ))}
          {data.length > 3 && <div className="text-xs text-muted-foreground">+{data.length - 3} more</div>}
        </div>
      )}
    </SummaryTile>
  );
}

function BicarbSummary({ athleteId }: { athleteId: string }) {
  const { data } = useQuery({
    queryKey: ["health-overview-bicarb", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bicarb_log")
        .select("log_date, dose_g, product")
        .eq("athlete_id", athleteId)
        .order("log_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <SummaryTile icon={FlaskConical} title="Bicarb" to="/app/bicarb" athleteId={athleteId}>
      {data ? (
        <>
          <div className="text-muted-foreground text-xs mb-1">{fmtShortDate(data.log_date)}</div>
          <div className="font-medium">
            {data.dose_g != null ? `${data.dose_g}g` : "Dose not logged"}
            {data.product && ` · ${data.product}`}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">No bicarb use logged yet.</p>
      )}
    </SummaryTile>
  );
}

function LactateSummary({ athleteId }: { athleteId: string }) {
  // Reuses the Lactate page's own hooks (session-derived readings +
  // spot checks) rather than re-implementing that three-step
  // sessions -> steps -> interval_results join here too.
  const { data: points } = useLactateSessionPoints(athleteId);
  const { data: spotChecks } = useLactateSpotChecks(athleteId);

  const latest = useMemo(() => {
    const fromSessions = (points ?? []).map((p) => ({ date: p.sessionDate, mmol: p.mmol, label: p.sessionTitle }));
    const fromSpot = (spotChecks ?? []).map((s: any) => ({
      date: s.check_date as string,
      mmol: Number(s.mmol),
      label: s.context || "Spot check",
    }));
    const all = [...fromSessions, ...fromSpot].filter((r) => r.date);
    if (all.length === 0) return null;
    return all.sort((a, b) => ((a.date as string) < (b.date as string) ? 1 : -1))[0];
  }, [points, spotChecks]);

  return (
    <SummaryTile icon={TestTube2} title="Lactate" to="/app/lactate" athleteId={athleteId}>
      {latest ? (
        <>
          <div className="text-muted-foreground text-xs mb-1">{fmtShortDate(latest.date as string)}</div>
          <div className="font-medium">
            {latest.mmol.toFixed(1)} mmol · {latest.label}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">No lactate readings yet.</p>
      )}
    </SummaryTile>
  );
}

// Groups the six tiles above into one responsive grid — shared by both
// the athlete's own view and a coach viewing one specific athlete, so the
// two stay in lockstep rather than risking drift between two separate
// copies of the same six queries.
function HealthOverviewExtras({ athleteId }: { athleteId: string }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <DailyLogSummary athleteId={athleteId} />
      <DietFuelSummary athleteId={athleteId} />
      <RecoverySummary athleteId={athleteId} />
      <InjurySummary athleteId={athleteId} />
      <BicarbSummary athleteId={athleteId} />
      <LactateSummary athleteId={athleteId} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Athlete self-service snapshot
// ----------------------------------------------------------------------------

function AthleteHealthView() {
  const { data: athlete, isLoading: athleteLoading } = useMyAthlete();
  const { data: snapshot, isLoading } = useLatestHealthSnapshot(athlete?.id);

  if (athleteLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!athlete)
    return (
      <p className="text-sm">
        No athlete profile linked. Visit <Link to="/app/account" className="underline">Account</Link>.
      </p>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
          style={{ background: "var(--accent-red)" }}
        >
          <HeartPulse className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
          <h1 className="text-2xl font-bold leading-tight">Health & Vitals</h1>
          <p className="text-sm text-muted-foreground mt-1">Vitals, recovery, and injury status in one place.</p>
        </div>
      </div>
      <BucketTabStrip items={healthTabsFor(athlete.id)} active="/app/health" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <HealthSnapshotCard snapshot={snapshot} />}
      <HealthOverviewExtras athleteId={athlete.id} />
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">Log today's vitals, sessions, and end-of-day note.</p>
          <Link
            to="/app/daily-log"
            className="text-sm font-medium text-[var(--accent-red)] hover:underline whitespace-nowrap"
          >
            Open Daily Log →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Coach: one athlete's snapshot (arrived via AthleteSubnav)
// ----------------------------------------------------------------------------

function CoachAthleteHealthView({ athleteId }: { athleteId: string }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: athlete } = useQuery({
    queryKey: ["health-athlete-name", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("id, name").eq("id", athleteId).single();
      if (error) throw error;
      return data as any;
    },
  });
  const { data: roster } = useCoachRoster();
  const { data: myAthlete } = useMyAthlete();
  const { data: snapshot, isLoading } = useLatestHealthSnapshot(athleteId);

  const rosterAthletes = useMemo(() => (roster ?? []).map((r: any) => r.athletes).filter(Boolean), [roster]);

  return (
    <div className="space-y-3">
      {/* Row 1 — breadcrumb + athlete subnav on the left, athlete picker on
          the right. Same pattern as Calendar/Analytics/Performance
          Profile so a coach always finds the athlete switcher in the same
          spot. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
            <Link to="/app/athletes" className="hover:text-foreground">
              Athletes
            </Link>
            <span className="text-border">/</span>
            <Link to="/app/athletes/$athleteId" params={{ athleteId }} className="hover:text-foreground">
              {athlete?.name ?? "Athlete"}
            </Link>
          </div>
          <AthleteSubnav athleteId={athleteId} active="health" />
        </div>
        <div className="shrink-0">
          <CoachAthletePicker
            roster={rosterAthletes}
            myAthlete={myAthlete as any}
            value={athleteId}
            onChange={(v) => navigate({ search: (p: any) => ({ ...p, athleteId: v }) })}
          />
        </div>
      </div>

      {/* Row 2 — icon + eyebrow heading (always "Health & Vitals", never
          the athlete's name), matching the roster-overview heading below. */}
      <div className="flex items-center gap-3">
        <div
          className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
          style={{ background: "var(--accent-red)" }}
        >
          <HeartPulse className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
          <h1 className="text-2xl font-bold leading-tight">Health & Vitals</h1>
        </div>
      </div>

      <BucketTabStrip items={healthTabsFor(athleteId)} active="/app/health" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <HealthSnapshotCard snapshot={snapshot} />}
      <HealthOverviewExtras athleteId={athleteId} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Coach: roster overview
// ----------------------------------------------------------------------------

function CoachHealthRoster() {
  const { data: roster } = useCoachRoster();
  const [search, setSearch] = useState("");

  const athletes = useMemo(() => (roster ?? []).map((r: any) => r.athletes).filter(Boolean), [roster]);
  const athleteIds = useMemo(() => athletes.map((a: any) => a.id), [athletes]);

  const { data: vitalsRows } = useQuery({
    queryKey: ["roster-latest-vitals", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_vitals")
        .select("athlete_id, vitals_date")
        .in("athlete_id", athleteIds)
        .order("vitals_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: checkinRows } = useQuery({
    queryKey: ["roster-latest-checkins", athleteIds.join(",")],
    enabled: athleteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_checkins")
        .select("athlete_id, checkin_date, injury_flag")
        .in("athlete_id", athleteIds)
        .order("checkin_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Most recent log date (vitals or check-in, whichever is newer) and
  // whether the most recent check-in flagged an injury concern. Both
  // queries arrive newest-first, so the first check-in row seen per
  // athlete is their latest — later (older) rows for the same athlete are
  // ignored rather than overwriting the flag.
  const summaryByAthlete = useMemo(() => {
    const map = new Map<string, { lastDate: string | null; injuryFlag: boolean }>();
    for (const id of athleteIds) map.set(id, { lastDate: null, injuryFlag: false });
    for (const r of vitalsRows ?? []) {
      const cur = map.get(r.athlete_id);
      if (cur && (!cur.lastDate || r.vitals_date > cur.lastDate)) cur.lastDate = r.vitals_date;
    }
    const seenCheckin = new Set<string>();
    for (const r of checkinRows ?? []) {
      const cur = map.get(r.athlete_id);
      if (!cur) continue;
      if (!cur.lastDate || r.checkin_date > cur.lastDate) cur.lastDate = r.checkin_date;
      if (!seenCheckin.has(r.athlete_id)) {
        seenCheckin.add(r.athlete_id);
        cur.injuryFlag = !!r.injury_flag;
      }
    }
    return map;
  }, [vitalsRows, checkinRows, athleteIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? athletes.filter((a: any) => a.name?.toLowerCase().includes(q)) : athletes;
    return [...list].sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [athletes, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <HeartPulse className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Wellbeing</div>
            <h1 className="text-2xl font-bold leading-tight">Health & Vitals</h1>
            <p className="text-sm text-muted-foreground mt-1">Latest log date and injury flags across your roster.</p>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" className="pl-8 h-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              {athletes.length === 0 ? "No athletes on your roster yet." : "No athletes match that search."}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((a: any) => {
                const summary = summaryByAthlete.get(a.id);
                const age = daysAgo(summary?.lastDate ?? null);
                return (
                  <Link
                    key={a.id}
                    to="/app/health"
                    search={{ athleteId: a.id } as any}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-sidebar-accent/40 transition-colors"
                  >
                    <span className="font-medium text-sm">{a.name}</span>
                    <div className="flex items-center gap-2">
                      {summary?.injuryFlag && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" /> Injury
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {age === null ? "No entries yet" : age === 0 ? "Logged today" : `${age}d ago`}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
