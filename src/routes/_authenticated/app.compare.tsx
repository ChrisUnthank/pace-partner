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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import {
  GitCompare,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  AlertTriangle,
  Target,
  Info,
  Layers,
} from "lucide-react";
import { secToClock, paceFmt } from "@/lib/format";
import { TERRAIN_VALUES, TERRAIN_LABEL, type Terrain } from "@/lib/session-categories";
import { REFERENCE_DISTANCES } from "@/lib/race-predict";
import {
  resolveReferencePace,
  repMetrics,
  metresPerBeat,
  buildVerdict,
  type ComparePerformance,
  type CompareRep,
  type CompareSide,
  type RepMetrics,
  type VerdictTone,
} from "@/lib/compare-metrics";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/app/compare")({
  component: ComparePage,
});

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type CompSession = {
  id: string;
  title: string;
  session_date: string;
  time_of_day: string | null;
  intent: string | null;
  structure: string | null;
  work_distance_m: number | null;
  work_time_s: number | null;
  work_avg_pace_sec_per_km: number | null;
  work_avg_hr: number | null;
  work_avg_cadence: number | null;
  rpe: number | null;
  average_temp_c: number | null;
  wind_kph: number | null;
  weather: string | null;
  terrain: string | null;
  altitude_m: number | null;
};

type WorkStep = {
  id: string;
  session_id: string;
  kind: string;
  step_order: number | null;
  reps: number | null;
  set_count: number | null;
  target_kind: string | null;
  target_distance_m: number | null;
  target_time_seconds: number | null;
};

/* ------------------------------------------------------------------ */
/* Small display helpers                                               */
/* ------------------------------------------------------------------ */

// The six events a middle-distance squad actually toggles between day to
// day. Everything else in REFERENCE_DISTANCES stays reachable through the
// "Other distance" dropdown beside them — this row exists purely so the
// common case is one visible click rather than a hidden select.
const QUICK_EVENTS = ["800m", "1500m", "1 Mile", "3000m", "5000m", "10K"];

function describeStep(s: WorkStep): string {
  const amt =
    s.target_kind === "distance"
      ? (s.target_distance_m ?? 0) >= 1000
        ? `${((s.target_distance_m ?? 0) / 1000).toFixed((s.target_distance_m ?? 0) % 1000 === 0 ? 0 : 2)}km`
        : `${Math.round(s.target_distance_m ?? 0)}m`
      : secToClock(s.target_time_seconds ?? 0);
  const reps = (s.reps ?? 1) * (s.set_count ?? 1);
  return reps > 1 ? `${reps} x ${amt}` : amt;
}

function workoutLabel(work: WorkStep[], recovery: WorkStep[]): string {
  if (work.length === 0) return "—";
  const workDesc = work
    .slice()
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map(describeStep)
    .join(" + ");
  if (recovery.length === 0) return workDesc;
  const recDesc = describeStep(recovery[0]);
  return `${workDesc} w/ ${recDesc} recovery`;
}

// Fingerprint so two sessions with the same workout shape (e.g. "6x800m")
// group together even with small GPS/manual-entry variance — distances
// round to the nearest 50m, times to the nearest 15s.
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

// Surface handling. sessions.terrain uses the shared controlled vocabulary
// in session-categories.ts (track/road/trail/path/grass/treadmill/mixed),
// but plenty of older or auto-imported sessions have it unset — those get
// bucketed under a single explicit "Not set" key rather than being silently
// dropped from the filter, so a coach can still find them.
const UNSET_SURFACE = "__unset__";

function surfaceKey(v: string | null | undefined): string {
  return v && v.length > 0 ? v : UNSET_SURFACE;
}

function surfaceLabel(v: string | null | undefined): string {
  if (!v || v.length === 0) return "Not set";
  return TERRAIN_LABEL[v as Terrain] ?? v;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toneClass(tone: VerdictTone) {
  if (tone === "positive") return "text-emerald-600";
  if (tone === "caution") return "text-amber-600";
  return "text-muted-foreground";
}

function toneDot(tone: VerdictTone) {
  if (tone === "positive") return "bg-emerald-500";
  if (tone === "caution") return "bg-amber-500";
  return "bg-muted-foreground/40";
}

/* ------------------------------------------------------------------ */
/* Diff row                                                            */
/* ------------------------------------------------------------------ */

function DiffRow({
  label,
  hint,
  a,
  b,
  format,
  betterIsLower,
  flatThreshold = 0,
  deltaFormat,
}: {
  label: string;
  hint?: string;
  a: number | null;
  b: number | null;
  format: (v: number) => string;
  /** null = neither direction is inherently better (e.g. cadence, temperature). */
  betterIsLower: boolean | null;
  flatThreshold?: number;
  deltaFormat?: (v: number) => string;
}) {
  const delta = a != null && b != null ? b - a : null;
  const flat = delta != null && Math.abs(delta) <= flatThreshold;
  const tone: "good" | "bad" | "flat" | "none" =
    delta == null || betterIsLower == null ? "none" : flat ? "flat" : betterIsLower === delta < 0 ? "good" : "bad";

  const deltaText =
    delta == null
      ? "—"
      : flat
        ? "no change"
        : `${delta > 0 ? "+" : "−"}${(deltaFormat ?? format)(Math.abs(delta))}`;

  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground leading-tight">{hint}</div>}
      </div>
      <div className="text-right tabular-nums">{a == null ? "—" : format(a)}</div>
      <div className="text-right tabular-nums font-medium">{b == null ? "—" : format(b)}</div>
      <div
        className={`text-right tabular-nums text-xs ${
          tone === "good"
            ? "text-emerald-600 font-medium"
            : tone === "bad"
              ? "text-amber-600 font-medium"
              : "text-muted-foreground"
        }`}
      >
        {deltaText}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ComparePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["compare-v2-roster", user?.id, isCoach, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const athleteId = isCoach ? selectedAthleteId : (myAthlete?.id ?? "");

  const { data: sessions = [] } = useQuery({
    queryKey: ["compare-v2-sessions", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select(
          "id, title, session_date, time_of_day, intent, structure, work_distance_m, work_time_s, work_avg_pace_sec_per_km, work_avg_hr, work_avg_cadence, rpe, average_temp_c, wind_kph, weather, terrain, altitude_m",
        )
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .not("work_distance_m", "is", null)
        .not("work_time_s", "is", null)
        .order("session_date", { ascending: false })
        .order("time_of_day", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CompSession[];
    },
  });

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  const { data: workSteps = [] } = useQuery({
    queryKey: ["compare-v2-worksteps", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps")
        .select(
          "id, session_id, kind, step_order, reps, set_count, target_kind, target_distance_m, target_time_seconds",
        )
        .in("session_id", sessionIds)
        .in("kind", ["work", "recovery"]);
      if (error) throw error;
      return (data ?? []) as unknown as WorkStep[];
    },
  });

  // Training-load history. The DB columns are still named ctl/tsb (that's
  // the schema), but nothing user-facing on this page says "CTL", "ATL",
  // "TSB" or "TSS" any more — they're surfaced as Fitness and Form, the
  // plain-language names used everywhere else in Strider.
  const { data: loadHistory = [] } = useQuery({
    queryKey: ["compare-v2-load", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("load_date, ctl, tsb")
        .eq("athlete_id", athleteId)
        .order("load_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  function loadNear(dateStr: string): { fitness: number | null; form: number | null } {
    let best: { load_date: string; ctl: number | null; tsb: number | null } | null = null;
    for (const row of loadHistory as any[]) {
      if (row.load_date <= dateStr) best = row;
      else break;
    }
    return {
      fitness: best?.ctl != null ? Math.round(Number(best.ctl)) : null,
      form: best?.tsb != null ? Math.round(Number(best.tsb)) : null,
    };
  }

  const { data: fatigueRows = [] } = useQuery({
    queryKey: ["compare-v2-fatigue", sessionIds.join(",")],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_fatigue")
        .select("session_id, efficiency_score")
        .in("session_id", sessionIds)
        .not("efficiency_score", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const efficiencyBySession = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of fatigueRows as any[]) {
      const arr = m.get(r.session_id) ?? [];
      arr.push(Number(r.efficiency_score));
      m.set(r.session_id, arr);
    }
    const out = new Map<string, number>();
    for (const [id, vals] of m) out.set(id, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
    return out;
  }, [fatigueRows]);

  const workStepIds = useMemo(() => workSteps.filter((s) => s.kind === "work").map((s) => s.id), [workSteps]);

  const { data: repResults = [] } = useQuery({
    queryKey: ["compare-v2-reps", workStepIds.join(",")],
    enabled: workStepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results")
        .select(
          "step_id, set_number, rep_number, actual_distance_m, actual_time_seconds, actual_pace_sec_per_km, hr_avg, hr_end, hr_end_recovery, cadence",
        )
        .in("step_id", workStepIds)
        .order("set_number", { ascending: true })
        .order("rep_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CompareRep[];
    },
  });

  const repMetricsBySession = useMemo(() => {
    const stepToSession = new Map(workSteps.filter((s) => s.kind === "work").map((s) => [s.id, s.session_id]));
    const grouped = new Map<string, CompareRep[]>();
    for (const r of repResults) {
      const sid = stepToSession.get(r.step_id);
      if (!sid) continue;
      const arr = grouped.get(sid) ?? [];
      arr.push(r);
      grouped.set(sid, arr);
    }
    const out = new Map<string, RepMetrics>();
    for (const [sid, reps] of grouped) out.set(sid, repMetrics(reps));
    return out;
  }, [repResults, workSteps]);

  // Real race results — the only legitimate anchor for anything expressed
  // in race terms on this page.
  const { data: performances = [] } = useQuery({
    queryKey: ["compare-v2-performances", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select(
          "id, event_name, performance_date, distance_m, time_seconds, race_type, context, excluded_from_pb",
        )
        .eq("athlete_id", athleteId)
        .not("distance_m", "is", null)
        .not("time_seconds", "is", null)
        .order("performance_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ComparePerformance[];
    },
  });

  const { workBySession, recoveryBySession } = useMemo(() => {
    const work = new Map<string, WorkStep[]>();
    const recovery = new Map<string, WorkStep[]>();
    for (const s of workSteps) {
      const m = s.kind === "recovery" ? recovery : work;
      const arr = m.get(s.session_id) ?? [];
      arr.push(s);
      m.set(s.session_id, arr);
    }
    return { workBySession: work, recoveryBySession: recovery };
  }, [workSteps]);

  /* ---------------- surface (terrain) filtering --------------------- */

  // Empty set = no filter applied (all surfaces). Kept as an explicit set
  // rather than a single value so a coach can, say, pool Track + Grass
  // while excluding Treadmill.
  const [surfaceFilter, setSurfaceFilter] = useState<Set<string>>(new Set());
  // When on, surface becomes part of the auto-grouping key, so "6 x 1km on
  // the track" and "6 x 1km on the road" are offered as two separate
  // repeats instead of one mixed group. This is the whole point of the
  // feature, so it defaults on.
  const [groupBySurface, setGroupBySurface] = useState(true);

  // Only offer surfaces this athlete actually has sessions on — ordered by
  // the shared vocabulary so the buttons don't reshuffle as data changes.
  const availableSurfaces = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const k = surfaceKey(s.terrain);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ordered: { key: string; count: number }[] = [];
    for (const t of TERRAIN_VALUES) {
      const c = counts.get(t);
      if (c) ordered.push({ key: t, count: c });
    }
    // Anything in the column that isn't in the controlled vocabulary
    // (legacy free-text) still gets a button rather than disappearing.
    for (const [k, c] of counts) {
      if (k === UNSET_SURFACE) continue;
      if (!(TERRAIN_VALUES as readonly string[]).includes(k)) ordered.push({ key: k, count: c });
    }
    const unset = counts.get(UNSET_SURFACE);
    if (unset) ordered.push({ key: UNSET_SURFACE, count: unset });
    return ordered;
  }, [sessions]);

  function toggleSurface(key: string) {
    setSurfaceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Filtering only affects what's OFFERED for selection — it deliberately
  // does not silently drop sessions a coach has already picked, which would
  // make the results change under them. Anything already selected that
  // spans surfaces is flagged in the results instead.
  const filteredSessions = useMemo(
    () => (surfaceFilter.size === 0 ? sessions : sessions.filter((s) => surfaceFilter.has(surfaceKey(s.terrain)))),
    [sessions, surfaceFilter],
  );

  const { sameGroups, similarGroups } = useMemo(() => {
    const same = new Map<string, CompSession[]>();
    const similar = new Map<string, CompSession[]>();
    for (const s of filteredSessions) {
      const fp = workFingerprint(workBySession.get(s.id) ?? []);
      const surf = groupBySurface ? surfaceKey(s.terrain) : "any";
      const sameKey = `${s.intent}|${s.structure}|${fp}|${surf}`;
      const simKey = `${s.intent}|${s.structure}|${surf}`;
      (same.get(sameKey) ?? same.set(sameKey, []).get(sameKey)!).push(s);
      (similar.get(simKey) ?? similar.set(simKey, []).get(simKey)!).push(s);
    }
    const build = (m: Map<string, CompSession[]>) =>
      Array.from(m.entries())
        .filter(([, v]) => v.length >= 2)
        .map(([key, v]) => {
          const surfaces = Array.from(new Set(v.map((x) => surfaceKey(x.terrain))));
          return { key, sessions: v, surfaces };
        });
    return { sameGroups: build(same), similarGroups: build(similar) };
  }, [filteredSessions, workBySession, groupBySurface]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [targetKm, setTargetKm] = useState(5);

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

  const selectedSessions = useMemo(
    () =>
      sessions
        .filter((s) => selectedIds.has(s.id))
        .slice()
        .sort((a, b) => a.session_date.localeCompare(b.session_date)),
    [sessions, selectedIds],
  );

  const targetLabel = REFERENCE_DISTANCES.find((r) => Math.abs(r.km - targetKm) < 0.001)?.label ?? `${targetKm}km`;

  /* ---------------- reference pace (real results only) -------------- */

  const referencePace = useMemo(() => resolveReferencePace(performances, targetKm), [performances, targetKm]);

  /* ---------------- enriched rows ----------------------------------- */

  const rows = useMemo(() => {
    return selectedSessions.map((s) => {
      const distanceM = num(s.work_distance_m);
      const timeS = num(s.work_time_s);
      const reps = repMetricsBySession.get(s.id) ?? null;
      const { fitness, form } = loadNear(s.session_date);

      // Prefer the session-level work pace, but fall back to distance/time
      // so a session without the derived column still charts.
      const pace =
        num(s.work_avg_pace_sec_per_km) ?? (distanceM != null && timeS != null && distanceM > 0 ? timeS / (distanceM / 1000) : null);

      const mpb = metresPerBeat(distanceM, timeS, num(s.work_avg_hr));
      const relPct = referencePace != null && pace != null && pace > 0 ? (referencePace.paceSecPerKm / pace) * 100 : null;

      return {
        session: s,
        distanceM,
        timeS,
        pace,
        avgHr: num(s.work_avg_hr),
        cadence: num(s.work_avg_cadence) ?? reps?.avgCadence ?? null,
        rpe: num(s.rpe),
        efficiency: efficiencyBySession.get(s.id) ?? null,
        fitness,
        form,
        reps,
        mpb,
        relPct,
        shape: workoutLabel(workBySession.get(s.id) ?? [], recoveryBySession.get(s.id) ?? []),
      };
    });
  }, [
    selectedSessions,
    repMetricsBySession,
    efficiencyBySession,
    loadHistory,
    referencePace,
    workBySession,
    recoveryBySession,
  ]);

  type Row = (typeof rows)[number];

  // Which two sessions are the headline pair. Defaults to earliest vs
  // latest of the selection; a coach can pin either side explicitly when
  // more than two are selected.
  const [pinnedAId, setPinnedAId] = useState<string | null>(null);
  const [pinnedBId, setPinnedBId] = useState<string | null>(null);

  const pair = useMemo(() => {
    if (rows.length < 2) return null;
    const a = rows.find((r) => r.session.id === pinnedAId) ?? rows[0];
    let b = rows.find((r) => r.session.id === pinnedBId) ?? rows[rows.length - 1];
    if (b.session.id === a.session.id) b = rows[rows.length - 1].session.id === a.session.id ? rows[0] : rows[rows.length - 1];
    if (b.session.id === a.session.id) return null;
    return { a, b };
  }, [rows, pinnedAId, pinnedBId]);

  function toSide(r: Row): CompareSide {
    return {
      dateLabel: r.session.session_date,
      paceSecPerKm: r.pace,
      avgHr: r.avgHr,
      distanceM: r.distanceM,
      timeSeconds: r.timeS,
      metresPerBeat: r.mpb,
      fadePct: r.reps?.fadePct ?? null,
      spreadPct: r.reps?.spreadPct ?? null,
      hrDropBpm: r.reps?.avgHrDrop ?? null,
      efficiency: r.efficiency,
      cadence: r.cadence,
      rpe: r.rpe,
      fitness: r.fitness,
      form: r.form,
      tempC: num(r.session.average_temp_c),
      windKph: num(r.session.wind_kph),
      weather: r.session.weather,
      terrain: r.session.terrain,
      altitudeM: num(r.session.altitude_m),
      relPctOfRacePace: r.relPct,
    };
  }

  const verdict = useMemo(() => (pair ? buildVerdict(toSide(pair.a), toSide(pair.b)) : null), [pair]);

  /* ---------------- chart data -------------------------------------- */

  const trendData = useMemo(
    () =>
      rows.map((r) => ({
        date: r.session.session_date,
        pace: r.pace,
        hr: r.avgHr,
        mpb: r.mpb,
        relPct: r.relPct,
      })),
    [rows],
  );

  const repChartData = useMemo(() => {
    if (!pair) return [];
    const aPaces = pair.a.reps?.paces ?? [];
    const bPaces = pair.b.reps?.paces ?? [];
    const n = Math.max(aPaces.length, bPaces.length);
    if (n === 0) return [];
    return Array.from({ length: n }, (_, i) => ({
      rep: `Rep ${i + 1}`,
      a: aPaces[i] ?? null,
      b: bPaces[i] ?? null,
    }));
  }, [pair]);

  const shapesDiffer = useMemo(() => {
    const shapes = new Set(selectedSessions.map((s) => workFingerprint(workBySession.get(s.id) ?? [])));
    return shapes.size > 1;
  }, [selectedSessions, workBySession]);

  const shapeExamples = useMemo(
    () => Array.from(new Set(rows.map((r) => r.shape))),
    [rows],
  );

  // Surfaces present in the CURRENT SELECTION (not the filter) — a coach can
  // still hand-pick a track session against a road session, so this warns
  // rather than prevents. Treadmill vs track vs trail can easily be worth
  // 10–20s/km on identical effort, which would otherwise read as a fitness
  // change in the verdict above.
  const selectionSurfaces = useMemo(
    () => Array.from(new Set(rows.map((r) => surfaceKey(r.session.terrain)))),
    [rows],
  );
  const surfacesDiffer = selectionSurfaces.length > 1;
  const surfacesUnknown = selectionSurfaces.length === 1 && selectionSurfaces[0] === UNSET_SURFACE;

  /* ---------------- render ------------------------------------------ */

  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <GitCompare className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
            <h1 className="text-2xl font-bold leading-tight">Compare Sessions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Put two sessions side by side and see what actually changed — pace, cost, durability across the set, and
              the surface and conditions they were run on.
            </p>
          </div>
        </div>

        {isCoach && (
          <div className="max-w-xs">
            <Label className="text-xs">Athlete</Label>
            <div className="mt-1">
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete as any}
                value={selectedAthleteId}
                onChange={setSelectedAthleteId}
              />
            </div>
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
            {/* ---------- Reference event ---------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" /> Reference event
                </CardTitle>
                <CardDescription>
                  Pick the event you're coaching towards. Session paces below are shown as a percentage of the
                  athlete's <strong>real race pace</strong> at this distance, so a threshold session and a VO2 session
                  can be read on the same scale. This is a normalisation against a result they've actually run — it is
                  deliberately <em>not</em> a race prediction.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_EVENTS.map((label) => {
                      const ref = REFERENCE_DISTANCES.find((r) => r.label === label);
                      if (!ref) return null;
                      const active = Math.abs(ref.km - targetKm) < 0.001;
                      return (
                        <Button
                          key={label}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-9 px-3.5 text-sm font-semibold"
                          onClick={() => setTargetKm(ref.km)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="w-[190px]">
                    <Label className="text-[11px] text-muted-foreground">Other distance</Label>
                    <Select value={String(targetKm)} onValueChange={(v) => setTargetKm(Number(v))}>
                      <SelectTrigger className="mt-1 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REFERENCE_DISTANCES.map((r) => (
                          <SelectItem key={r.label} value={String(r.km)}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {referencePace == null ? (
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">No usable race result to anchor {targetLabel} against</p>
                      <p className="text-muted-foreground mt-0.5">
                        Relative-to-race-pace figures are hidden rather than estimated. Log a race result at (or near)
                        this distance under Performances and it will appear here. Everything else on this page —
                        session-vs-session pace, heart rate, durability, conditions — works without it.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {targetLabel} race pace
                      </div>
                      <div className="text-lg font-bold tabular-nums">{paceFmt(referencePace.paceSecPerKm)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Equivalent {targetLabel}
                      </div>
                      <div className="text-lg font-bold tabular-nums">
                        {secToClock(referencePace.equivalentTimeSeconds)}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={referencePace.source === "exact" ? "default" : "outline"} className="text-[10px]">
                          {referencePace.source === "exact" ? "Real result at this distance" : "Converted from a real result"}
                        </Badge>
                        {referencePace.stale && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/50">
                            {Math.round(referencePace.monthsOld)} months old
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on {referencePace.basis.event_name ?? "a logged result"} —{" "}
                        {referencePace.basisKm >= 1
                          ? `${referencePace.basisKm.toFixed(referencePace.basisKm % 1 === 0 ? 0 : 2)}km`
                          : `${Math.round(referencePace.basisKm * 1000)}m`}{" "}
                        in {secToClock(Number(referencePace.basis.time_seconds))} on{" "}
                        {referencePace.basis.performance_date}.
                        {referencePace.source === "converted" && (
                          <>
                            {" "}
                            Converted race-to-race using{" "}
                            {referencePace.exponentSource === "personal"
                              ? `an exponent fitted from this athlete's own results (${referencePace.exponent.toFixed(3)})`
                              : "the standard equivalency exponent (1.06)"}
                            .
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ---------- Session picker ---------- */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4" /> Choose sessions to compare
                  </CardTitle>
                  {selectedIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedIds(new Set());
                        setPinnedAId(null);
                        setPinnedBId(null);
                      }}
                    >
                      Clear ({selectedIds.size})
                    </Button>
                  )}
                </div>
                <CardDescription>
                  Filter to one surface for a true like-for-like read, then start from an auto-detected repeat or pick
                  sessions by hand. Two or more.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {availableSurfaces.length > 0 && (
                  <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Layers className="h-3.5 w-3.5" />
                        Surface
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={groupBySurface}
                          onCheckedChange={(v) => setGroupBySurface(v === true)}
                        />
                        Keep surfaces in separate groups
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={surfaceFilter.size === 0 ? "default" : "outline"}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setSurfaceFilter(new Set())}
                      >
                        All surfaces
                      </Button>
                      {availableSurfaces.map((s2) => (
                        <Button
                          key={s2.key}
                          type="button"
                          size="sm"
                          variant={surfaceFilter.has(s2.key) ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => toggleSurface(s2.key)}
                        >
                          {surfaceLabel(s2.key === UNSET_SURFACE ? null : s2.key)}
                          <span className="ml-1.5 opacity-60 tabular-nums">{s2.count}</span>
                        </Button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {surfaceFilter.size === 0
                        ? groupBySurface
                          ? "All surfaces shown. Repeats are grouped per surface, so track 1km reps are offered separately from road 1km reps."
                          : "All surfaces shown, and pooled together into the same groups — a group may mix track and road."
                        : `Showing ${Array.from(surfaceFilter).map((k) => surfaceLabel(k === UNSET_SURFACE ? null : k)).join(", ")} only. Sessions you've already selected stay selected.`}
                    </p>
                  </div>
                )}

                <Tabs defaultValue="direct">
                  <TabsList>
                    <TabsTrigger value="direct">Direct repeats ({sameGroups.length})</TabsTrigger>
                    <TabsTrigger value="similar">Similar type ({similarGroups.length})</TabsTrigger>
                    <TabsTrigger value="all">All sessions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="direct" className="mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Same intent, structure and work-step shape — the closest apples-to-apples comparisons.
                    </p>
                    {sameGroups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No repeated sessions detected yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto brand-scrollbar pr-1">
                        {sameGroups.map((g) => (
                          <button
                            key={g.key}
                            onClick={() => selectGroup(g.sessions)}
                            className="w-full text-left border rounded-md px-3 py-2 hover:bg-accent/40 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {intentLabel(g.sessions[0].intent)} ·{" "}
                                {workoutLabel(
                                  workBySession.get(g.sessions[0].id) ?? [],
                                  recoveryBySession.get(g.sessions[0].id) ?? [],
                                )}
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <Badge variant="secondary" className="text-[10px]">
                                  {g.surfaces.length === 1
                                    ? surfaceLabel(g.surfaces[0] === UNSET_SURFACE ? null : g.surfaces[0])
                                    : `${g.surfaces.length} surfaces`}
                                </Badge>
                                <Badge variant="outline">{g.sessions.length} sessions</Badge>
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {g.sessions[g.sessions.length - 1].session_date} → {g.sessions[0].session_date}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="similar" className="mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Same intent and structure, but not an exact repeat — rep length may differ, which is flagged in
                      the results.
                    </p>
                    {similarGroups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No comparable session types detected yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto brand-scrollbar pr-1">
                        {similarGroups.map((g) => (
                          <button
                            key={g.key}
                            onClick={() => selectGroup(g.sessions)}
                            className="w-full text-left border rounded-md px-3 py-2 hover:bg-accent/40 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {intentLabel(g.sessions[0].intent)} · e.g.{" "}
                                {workoutLabel(
                                  workBySession.get(g.sessions[0].id) ?? [],
                                  recoveryBySession.get(g.sessions[0].id) ?? [],
                                )}
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <Badge variant="secondary" className="text-[10px]">
                                  {g.surfaces.length === 1
                                    ? surfaceLabel(g.surfaces[0] === UNSET_SURFACE ? null : g.surfaces[0])
                                    : `${g.surfaces.length} surfaces`}
                                </Badge>
                                <Badge variant="outline">{g.sessions.length} sessions</Badge>
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {g.sessions[g.sessions.length - 1].session_date} → {g.sessions[0].session_date}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="all" className="mt-3">
                    <div className="relative mb-2">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Filter by title…"
                        className="pl-8 h-9"
                      />
                    </div>
                    <div className="max-h-[340px] overflow-y-auto brand-scrollbar border rounded-md">
                      <div className="divide-y">
                        {filteredSessions
                          .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
                          .map((s) => (
                            <label
                              key={s.id}
                              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/30 cursor-pointer"
                            >
                              <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleSession(s.id)} />
                              <span className="flex-1 min-w-0">
                                <span className="block truncate">{s.title}</span>
                                <span className="block text-xs text-muted-foreground truncate">
                                  {workoutLabel(workBySession.get(s.id) ?? [], recoveryBySession.get(s.id) ?? [])}
                                </span>
                              </span>
                              <Badge variant="secondary" className="text-[10px] shrink-0 hidden sm:inline-flex">
                                {surfaceLabel(s.terrain)}
                              </Badge>
                              <span className="text-xs text-muted-foreground shrink-0">{s.session_date}</span>
                              <span className="text-xs text-muted-foreground shrink-0 tabular-nums w-16 text-right">
                                {paceFmt(s.work_avg_pace_sec_per_km)}
                              </span>
                            </label>
                          ))}
                      </div>
                      {filteredSessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase())).length ===
                        0 && (
                        <p className="text-sm text-muted-foreground px-3 py-6 text-center">
                          No sessions match that surface filter and search.
                        </p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {rows.length < 2 ? (
              <p className="text-sm text-muted-foreground">Select at least two sessions above to see a comparison.</p>
            ) : (
              <>
                {/* ---------- Verdict ---------- */}
                {pair && verdict && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <CardTitle className="text-base flex items-center gap-2">
                          {verdict.headline.tone === "positive" ? (
                            <TrendingUp className="h-4 w-4 text-emerald-600" />
                          ) : verdict.headline.tone === "caution" ? (
                            <TrendingDown className="h-4 w-4 text-amber-600" />
                          ) : (
                            <Minus className="h-4 w-4 text-muted-foreground" />
                          )}
                          {verdict.headline.label}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {pair.a.session.session_date} → {pair.b.session.session_date}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>{verdict.headline.text}</p>
                      {verdict.lines.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {verdict.lines.map((l) => (
                            <div key={l.label} className="flex items-start gap-2">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 ${toneDot(l.tone)}`} />
                              <p className="text-[13px] leading-snug">
                                <span className={`font-medium ${toneClass(l.tone)}`}>{l.label}:</span>{" "}
                                <span className="text-muted-foreground">{l.text}</span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {surfacesDiffer && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="pt-4 text-sm flex items-start gap-2">
                      <Layers className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium">These sessions weren't all run on the same surface</p>
                        <p className="text-muted-foreground mt-0.5">
                          {selectionSurfaces
                            .map((k) => surfaceLabel(k === UNSET_SURFACE ? null : k))
                            .join(" · ")}
                          . Surface alone is worth a lot on identical effort — grass and trail typically cost several
                          seconds per kilometre against a track, and a treadmill can read faster or slower than the
                          road depending on calibration. Treat the pace difference below as indicative rather than a
                          like-for-like read, or use the Surface filter above to compare within one surface.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {surfacesUnknown && (
                  <Card className="border-muted-foreground/25 bg-muted/30">
                    <CardContent className="pt-4 text-sm flex items-start gap-2">
                      <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium">Surface isn't recorded on these sessions</p>
                        <p className="text-muted-foreground mt-0.5">
                          They may or may not have been run on the same surface — there's no way to tell from the data.
                          Setting the surface on each session makes this comparison meaningfully more trustworthy.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {shapesDiffer && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="pt-4 text-sm flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">These sessions aren't all the same shape</p>
                        <p className="text-muted-foreground mt-0.5">
                          {shapeExamples.join(" · ")} — longer reps are typically run slightly slower than shorter ones
                          at equivalent effort, so part of any pace difference below reflects rep length rather than a
                          fitness change.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ---------- Side-by-side diff ---------- */}
                {pair && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Side by side</CardTitle>
                      <CardDescription>
                        Every metric both sessions have in common. Green means the change is in the direction a coach
                        would want; amber means it isn't. Metrics with no inherent "better" direction (cadence,
                        conditions) are left neutral.
                      </CardDescription>
                      {rows.length > 2 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[11px] text-muted-foreground">Session A</Label>
                            <Select
                              value={pair.a.session.id}
                              onValueChange={(v) => setPinnedAId(v)}
                            >
                              <SelectTrigger className="h-8 w-[210px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {rows.map((r) => (
                                  <SelectItem key={r.session.id} value={r.session.id}>
                                    {r.session.session_date} — {r.session.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[11px] text-muted-foreground">Session B</Label>
                            <Select
                              value={pair.b.session.id}
                              onValueChange={(v) => setPinnedBId(v)}
                            >
                              <SelectTrigger className="h-8 w-[210px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {rows.map((r) => (
                                  <SelectItem key={r.session.id} value={r.session.id}>
                                    {r.session.session_date} — {r.session.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                        <div>Metric</div>
                        <div className="text-right truncate">A · {pair.a.session.session_date}</div>
                        <div className="text-right truncate">B · {pair.b.session.session_date}</div>
                        <div className="text-right">Change</div>
                      </div>

                      <div className="px-3 py-2 text-xs text-muted-foreground border-b grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2">
                        <div>Workout</div>
                        <div className="text-right truncate">{pair.a.shape}</div>
                        <div className="text-right truncate">{pair.b.shape}</div>
                        <div />
                      </div>

                      <div className="divide-y">
                        <DiffRow
                          label="Work pace"
                          hint="Average pace across the work portion only"
                          a={pair.a.pace}
                          b={pair.b.pace}
                          format={(v) => paceFmt(v)}
                          deltaFormat={(v) => `${v.toFixed(0)}s/km`}
                          betterIsLower
                          flatThreshold={1}
                        />
                        {referencePace && (
                          <DiffRow
                            label={`% of ${targetLabel} race pace`}
                            hint="Higher = closer to the athlete's real race pace at this event"
                            a={pair.a.relPct}
                            b={pair.b.relPct}
                            format={(v) => `${v.toFixed(1)}%`}
                            deltaFormat={(v) => `${v.toFixed(1)} pts`}
                            betterIsLower={false}
                            flatThreshold={0.3}
                          />
                        )}
                        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 px-3 py-2 text-sm">
                          <div className="font-medium">Surface</div>
                          <div className="text-right">{surfaceLabel(pair.a.session.terrain)}</div>
                          <div className="text-right font-medium">{surfaceLabel(pair.b.session.terrain)}</div>
                          <div
                            className={`text-right text-xs ${
                              surfaceKey(pair.a.session.terrain) === surfaceKey(pair.b.session.terrain)
                                ? "text-muted-foreground"
                                : "text-amber-600 font-medium"
                            }`}
                          >
                            {surfaceKey(pair.a.session.terrain) === surfaceKey(pair.b.session.terrain)
                              ? "same"
                              : "different"}
                          </div>
                        </div>
                        <DiffRow
                          label="Work distance"
                          a={pair.a.distanceM}
                          b={pair.b.distanceM}
                          format={(v) => `${(v / 1000).toFixed(2)} km`}
                          deltaFormat={(v) => `${(v / 1000).toFixed(2)} km`}
                          betterIsLower={null}
                          flatThreshold={50}
                        />
                        <DiffRow
                          label="Work time"
                          a={pair.a.timeS}
                          b={pair.b.timeS}
                          format={(v) => secToClock(v)}
                          betterIsLower={null}
                          flatThreshold={5}
                        />
                        <DiffRow
                          label="Average heart rate"
                          hint="Lower for the same pace means the work cost less"
                          a={pair.a.avgHr}
                          b={pair.b.avgHr}
                          format={(v) => `${v.toFixed(0)} bpm`}
                          betterIsLower
                          flatThreshold={2}
                        />
                        <DiffRow
                          label="Metres per heartbeat"
                          hint="Distance covered per beat — a simple aerobic-efficiency readout"
                          a={pair.a.mpb}
                          b={pair.b.mpb}
                          format={(v) => `${v.toFixed(2)} m`}
                          betterIsLower={false}
                          flatThreshold={0.02}
                        />
                        <DiffRow
                          label="Fade across the set"
                          hint="Second half vs first half — lower is better held together"
                          a={pair.a.reps?.fadePct ?? null}
                          b={pair.b.reps?.fadePct ?? null}
                          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
                          deltaFormat={(v) => `${v.toFixed(1)} pts`}
                          betterIsLower
                          flatThreshold={0.5}
                        />
                        <DiffRow
                          label="Fastest to slowest rep"
                          hint="How tightly the set held together"
                          a={pair.a.reps?.spreadPct ?? null}
                          b={pair.b.reps?.spreadPct ?? null}
                          format={(v) => `${v.toFixed(1)}%`}
                          deltaFormat={(v) => `${v.toFixed(1)} pts`}
                          betterIsLower
                          flatThreshold={0.5}
                        />
                        <DiffRow
                          label="Best rep"
                          a={pair.a.reps?.bestPace ?? null}
                          b={pair.b.reps?.bestPace ?? null}
                          format={(v) => paceFmt(v)}
                          deltaFormat={(v) => `${v.toFixed(0)}s/km`}
                          betterIsLower
                          flatThreshold={1}
                        />
                        <DiffRow
                          label="Recovery heart-rate drop"
                          hint="Average bpm fall between end of rep and end of recovery"
                          a={pair.a.reps?.avgHrDrop ?? null}
                          b={pair.b.reps?.avgHrDrop ?? null}
                          format={(v) => `${v.toFixed(0)} bpm`}
                          betterIsLower={false}
                          flatThreshold={2}
                        />
                        <DiffRow
                          label="Cadence"
                          a={pair.a.cadence}
                          b={pair.b.cadence}
                          format={(v) => `${v.toFixed(0)} spm`}
                          betterIsLower={null}
                          flatThreshold={1}
                        />
                        <DiffRow
                          label="Efficiency score"
                          hint="Strider's in-session efficiency rating, 0–100"
                          a={pair.a.efficiency}
                          b={pair.b.efficiency}
                          format={(v) => `${v.toFixed(0)}/100`}
                          deltaFormat={(v) => `${v.toFixed(0)} pts`}
                          betterIsLower={false}
                          flatThreshold={1}
                        />
                        <DiffRow
                          label="Perceived effort (RPE)"
                          a={pair.a.rpe}
                          b={pair.b.rpe}
                          format={(v) => `${v.toFixed(0)}/10`}
                          betterIsLower
                          flatThreshold={0}
                        />
                        <DiffRow
                          label="Fitness"
                          hint="Strider's rolling long-term training load on the day of the session"
                          a={pair.a.fitness}
                          b={pair.b.fitness}
                          format={(v) => v.toFixed(0)}
                          betterIsLower={false}
                          flatThreshold={1}
                        />
                        <DiffRow
                          label="Form"
                          hint="Freshness going into the session — higher means more rested"
                          a={pair.a.form}
                          b={pair.b.form}
                          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}`}
                          deltaFormat={(v) => v.toFixed(0)}
                          betterIsLower={null}
                          flatThreshold={2}
                        />
                        <DiffRow
                          label="Temperature"
                          hint="Heat above roughly 15°C costs about 1–2s/km"
                          a={num(pair.a.session.average_temp_c)}
                          b={num(pair.b.session.average_temp_c)}
                          format={(v) => `${v.toFixed(0)}°C`}
                          betterIsLower={null}
                          flatThreshold={1}
                        />
                        <DiffRow
                          label="Wind"
                          a={num(pair.a.session.wind_kph)}
                          b={num(pair.b.session.wind_kph)}
                          format={(v) => `${v.toFixed(0)} kph`}
                          betterIsLower={null}
                          flatThreshold={2}
                        />
                      </div>

                      {(pair.a.session.weather || pair.b.session.weather) && (
                        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-xs text-muted-foreground border-t">
                          <div>Conditions</div>
                          <div className="text-right truncate">{pair.a.session.weather || "—"}</div>
                          <div className="text-right truncate">{pair.b.session.weather || "—"}</div>
                          <div />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ---------- Rep by rep ---------- */}
                {repChartData.length > 0 && pair && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Rep by rep</CardTitle>
                      <CardDescription>
                        Actual pace of each rep in both sessions, in the order they were run. A flatter line held
                        together better; a line that rises towards the right faded.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[240px] w-full">
                        <ResponsiveContainer>
                          <LineChart data={repChartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="rep" tick={{ fontSize: 11 }} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              tickFormatter={(v) => paceFmt(v)}
                              width={54}
                              reversed
                              domain={["dataMin - 5", "dataMax + 5"]}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--background))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 12,
                              }}
                              formatter={(v: any, name: any) => [paceFmt(Number(v)), name]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line
                              type="monotone"
                              dataKey="a"
                              name={`A · ${pair.a.session.session_date}`}
                              stroke="#94a3b8"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              connectNulls
                            />
                            <Line
                              type="monotone"
                              dataKey="b"
                              name={`B · ${pair.b.session.session_date}`}
                              stroke="#10b981"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                        The pace axis is inverted — higher on the chart is faster. Reps are matched by position, so if
                        the two sessions had different rep counts the later reps only appear on one line.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ---------- Trends across the whole selection ---------- */}
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Work pace</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[140px] w-full">
                        <ResponsiveContainer>
                          <LineChart data={trendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => paceFmt(v)} width={44} reversed />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--background))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 11,
                              }}
                              formatter={(v: any) => [paceFmt(Number(v)), "Pace"]}
                            />
                            <Line
                              type="monotone"
                              dataKey="pace"
                              stroke="#10b981"
                              strokeWidth={2}
                              dot={{ r: 2 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Average heart rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[140px] w-full">
                        <ResponsiveContainer>
                          <LineChart data={trendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                            <YAxis tick={{ fontSize: 9 }} width={30} domain={["dataMin - 5", "dataMax + 5"]} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--background))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 11,
                              }}
                              formatter={(v: any) => [`${Math.round(Number(v))} bpm`, "HR"]}
                            />
                            <Line
                              type="monotone"
                              dataKey="hr"
                              stroke="#ef4444"
                              strokeWidth={2}
                              dot={{ r: 2 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Metres per heartbeat</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[140px] w-full">
                        <ResponsiveContainer>
                          <LineChart data={trendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                            <YAxis
                              tick={{ fontSize: 9 }}
                              width={34}
                              domain={["dataMin - 0.1", "dataMax + 0.1"]}
                              tickFormatter={(v) => Number(v).toFixed(2)}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--background))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 11,
                              }}
                              formatter={(v: any) => [`${Number(v).toFixed(2)} m/beat`, "Efficiency"]}
                            />
                            <Line
                              type="monotone"
                              dataKey="mpb"
                              stroke="#8b5cf6"
                              strokeWidth={2}
                              dot={{ r: 2 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">% of {targetLabel} race pace</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {referencePace == null ? (
                        <p className="text-xs text-muted-foreground h-[140px] grid place-items-center text-center px-2">
                          No real race result to anchor {targetLabel} against, so nothing is shown here rather than an
                          estimate.
                        </p>
                      ) : (
                        <div className="h-[140px] w-full">
                          <ResponsiveContainer>
                            <LineChart data={trendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                              <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                              <YAxis
                                tick={{ fontSize: 9 }}
                                width={38}
                                domain={["dataMin - 1", "dataMax + 1"]}
                                tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: "hsl(var(--background))",
                                  border: "1px solid hsl(var(--border))",
                                  fontSize: 11,
                                }}
                                formatter={(v: any) => [`${Number(v).toFixed(1)}%`, `of ${targetLabel} race pace`]}
                              />
                              <Line
                                type="monotone"
                                dataKey="relPct"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* ---------- All selected sessions ---------- */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">All selected sessions</CardTitle>
                    <CardDescription>Oldest first. {rows.length} sessions selected.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {rows.map((r) => (
                        <div
                          key={r.session.id}
                          className="flex items-center justify-between px-4 py-2.5 text-sm gap-2 flex-wrap"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{r.session.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.session.session_date} · {r.shape} · {surfaceLabel(r.session.terrain)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground flex-wrap justify-end">
                            {r.distanceM != null && <span>{(r.distanceM / 1000).toFixed(2)} km</span>}
                            {r.timeS != null && <span>{secToClock(r.timeS)}</span>}
                            <span>{paceFmt(r.pace)}</span>
                            {r.avgHr != null && <span>{r.avgHr.toFixed(0)} bpm</span>}
                            {r.relPct != null && <Badge variant="outline">{r.relPct.toFixed(1)}% race pace</Badge>}
                            {r.efficiency != null && <Badge variant="outline">Eff {r.efficiency}</Badge>}
                            <Badge variant="outline">Fitness {r.fitness ?? "—"}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
