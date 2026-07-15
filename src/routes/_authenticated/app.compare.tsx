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
import { GitCompare, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Search, AlertTriangle } from "lucide-react";
import { secToClock, paceFmt } from "@/lib/format";
import { predictTime, predictTimeWithExponent, personalizedExponent, REFERENCE_DISTANCES } from "@/lib/race-predict";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

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

// Human-readable workout shape, e.g. "8 x 1km w/ 60s recovery" — the exact
// detail requested instead of just showing "Threshold · intervals".
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
  const athleteId = isCoach ? selectedAthleteId : (myAthlete?.id ?? "");

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
        .select(
          "id, session_id, kind, step_order, reps, set_count, target_kind, target_distance_m, target_time_seconds",
        )
        .in("session_id", sessionIds)
        .in("kind", ["work", "recovery"]);
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

  // Efficiency score — same field already shown on the session Analysis
  // page's "Overall run fatigue" card, averaged per session here (a session
  // can have several fatigue rows, e.g. one per rep for intervals).
  const { data: fatigueRows = [] } = useQuery({
    queryKey: ["compare-fatigue", sessionIds.join(",")],
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
    for (const r of fatigueRows) {
      const arr = m.get(r.session_id) ?? [];
      arr.push(Number(r.efficiency_score));
      m.set(r.session_id, arr);
    }
    const out = new Map<string, number>();
    for (const [id, vals] of m) out.set(id, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
    return out;
  }, [fatigueRows]);

  // Per-rep results for the work steps — used to check two things a raw
  // average pace can't tell you: whether the athlete faded across reps
  // (last rep meaningfully slower than the first), and whether recovery
  // between reps looked genuinely good (a real HR drop, not just a pause).
  const workStepIds = useMemo(() => workSteps.filter((s) => s.kind === "work").map((s) => s.id), [workSteps]);
  const { data: repResults = [] } = useQuery({
    queryKey: ["compare-reps", workStepIds.join(",")],
    enabled: workStepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results")
        .select("step_id, set_number, rep_number, actual_pace_sec_per_km, hr_end, hr_end_recovery")
        .in("step_id", workStepIds)
        .order("set_number", { ascending: true })
        .order("rep_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const repsBySession = useMemo(() => {
    const stepToSession = new Map(workSteps.filter((s) => s.kind === "work").map((s) => [s.id, s.session_id]));
    const m = new Map<string, typeof repResults>();
    for (const r of repResults) {
      const sid = stepToSession.get(r.step_id);
      if (!sid) continue;
      const arr = m.get(sid) ?? [];
      arr.push(r);
      m.set(sid, arr);
    }
    return m;
  }, [repResults, workSteps]);

  // Reads as: has this session's reps held together (no fade), and did
  // recovery between them look genuinely good?
  function repQualitySignals(sessionId: string): { noFade: boolean; goodRecovery: boolean } {
    const reps = (repsBySession.get(sessionId) ?? [])
      .filter((r) => r.actual_pace_sec_per_km != null)
      .slice()
      .sort((a, b) => a.set_number - b.set_number || a.rep_number - b.rep_number);

    let noFade = false;
    if (reps.length >= 2) {
      const firstPace = Number(reps[0].actual_pace_sec_per_km);
      const lastPace = Number(reps[reps.length - 1].actual_pace_sec_per_km);
      const fadePct = ((lastPace - firstPace) / firstPace) * 100;
      noFade = fadePct <= 2; // flat or negative split counts as "held together"
    }

    const drops = reps
      .filter((r) => r.hr_end != null && r.hr_end_recovery != null)
      .map((r) => Number(r.hr_end) - Number(r.hr_end_recovery));
    const goodRecovery = drops.length > 0 && drops.reduce((a, b) => a + b, 0) / drops.length >= 15;

    return { noFade, goodRecovery };
  }

  // Real race results — ground truth to cross-check the workout-based
  // projection against. Pulled from `performances`, not session-level GPS
  // fields: `performances.distance_m`/`time_seconds` is the "Official
  // Distance" a coach can hand-correct when the raw GPS/reconstructed
  // distance disagrees with the actual measured course (e.g. GPS reads
  // 7.2km on a course that's really 7.4km) — the same authoritative values
  // that already feed the PB list, so this stays consistent with what's
  // shown there rather than trusting GPS-derived session totals a second,
  // possibly-disagreeing way.
  const { data: raceSessions = [] } = useQuery({
    queryKey: ["compare-races", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, event_name, performance_date, distance_m, time_seconds, session_id")
        .eq("athlete_id", athleteId)
        .not("distance_m", "is", null)
        .not("time_seconds", "is", null)
        .order("performance_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
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

  const { sameGroups, similarGroups } = useMemo(() => {
    const same = new Map<string, CompSession[]>();
    const similar = new Map<string, CompSession[]>();
    for (const s of sessions) {
      const fp = workFingerprint(workBySession.get(s.id) ?? []);
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
  }, [sessions, workBySession]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [targetKm, setTargetKm] = useState(5); // default 5000m — middle-distance-friendly default

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

  const targetLabel = REFERENCE_DISTANCES.find((r) => Math.abs(r.km - targetKm) < 0.001)?.label ?? `${targetKm}km`;

  const comparison = useMemo(() => {
    if (selectedSessions.length < 2) return null;
    // Find the best available real race to calibrate against, before
    // computing any projections — a real result anchors the whole curve to
    // this athlete's actual demonstrated speed/endurance balance, rather
    // than assuming everyone fits the same generic exponent.
    const provisionalDates = selectedSessions.map((s) => s.session_date);
    const windowEndProvisional = provisionalDates[provisionalDates.length - 1];
    const nearbyRace =
      raceSessions.find(
        (r) => r.performance_date >= provisionalDates[0] && r.performance_date <= windowEndProvisional,
      ) ??
      raceSessions.slice().sort((a, b) => {
        const da = Math.abs(new Date(a.performance_date).getTime() - new Date(windowEndProvisional).getTime());
        const db = Math.abs(new Date(b.performance_date).getTime() - new Date(windowEndProvisional).getTime());
        return da - db;
      })[0];

    let exponent = 1.06; // only used if calibrated flips true below
    let calibrated = false;
    if (nearbyRace) {
      const raceKm = Number(nearbyRace.distance_m) / 1000;
      const raceTime = Number(nearbyRace.time_seconds);
      const closestSession = selectedSessions.reduce((best, s) => {
        const d = Math.abs(new Date(s.session_date).getTime() - new Date(nearbyRace.performance_date).getTime());
        const bd = Math.abs(new Date(best.session_date).getTime() - new Date(nearbyRace.performance_date).getTime());
        return d < bd ? s : best;
      }, selectedSessions[0]);
      const closestKm = Number(closestSession.work_distance_m) / 1000;
      if (closestKm > 0 && raceKm > 0 && closestKm !== raceKm) {
        const k = personalizedExponent(Number(closestSession.work_time_s), closestKm, raceTime, raceKm);
        if (k != null) {
          exponent = k;
          calibrated = true;
        }
      }
    }

    // Bug fix: a personalized exponent is only ever fitted from ONE (session,
    // race) pair, then was being applied blindly to every row's projection —
    // including a session whose own distance is nowhere near the calibration
    // pair's range (e.g. a 400m-rep session projected with an exponent
    // calibrated from a 7.4km race). Extrapolating a validly-bounded exponent
    // far outside the range it was fitted on can still produce an impossible
    // result (a "4-minute 5K"), even though the exponent itself passed its
    // own sanity bounds. This checks the *resulting pace*, per call, and
    // silently falls back to the generic formula for that specific
    // projection when the calibrated result isn't physically plausible,
    // rather than trusting the exponent everywhere it's used.
    const MIN_PLAUSIBLE_PACE_S_PER_KM = 120; // 2:00/km — faster than this is not realistic for 5K+
    const MAX_PLAUSIBLE_PACE_S_PER_KM = 900; // 15:00/km — slower than this isn't a meaningful projection

    // Second, separate guard: the check above only protects against a BAD
    // EXPONENT — it does nothing if the session's own recorded work pace
    // (t1/d1, before any exponent is even applied) is itself implausible,
    // e.g. from corrupted/duplicated work_distance_m or work_time_s data.
    // Garbage in still means garbage out even with a perfectly reasonable
    // exponent, so this checks the RAW input pace and refuses to project
    // from it at all if it's not physically plausible.
    const isPlausibleInput = (t1: number, d1: number) => {
      if (d1 <= 0) return false;
      const rawPace = t1 / d1;
      return rawPace >= MIN_PLAUSIBLE_PACE_S_PER_KM && rawPace <= MAX_PLAUSIBLE_PACE_S_PER_KM;
    };

    const project = (t1: number, d1: number, d2: number) => {
      if (!isPlausibleInput(t1, d1)) return null;
      if (calibrated) {
        const calibratedResult = predictTimeWithExponent(t1, d1, d2, exponent);
        const impliedPace = calibratedResult / d2;
        if (impliedPace >= MIN_PLAUSIBLE_PACE_S_PER_KM && impliedPace <= MAX_PLAUSIBLE_PACE_S_PER_KM) {
          return calibratedResult;
        }
      }
      return predictTime(t1, d1, d2);
    };

    const rows = selectedSessions.map((s) => {
      const km = Number(s.work_distance_m) / 1000;
      const predicted = km > 0 ? project(Number(s.work_time_s), km, targetKm) : null;
      return {
        ...s,
        km,
        predicted,
        ctl: ctlNear(s.session_date),
        efficiency: efficiencyBySession.get(s.id) ?? null,
      };
    });
    const first = rows[0];
    const last = rows[rows.length - 1];
    const chartData = rows.map((r) => ({
      date: r.session_date,
      predicted: r.predicted != null ? Math.round(r.predicted) : null,
      pace: r.work_avg_pace_sec_per_km,
      hr: r.work_avg_hr,
      efficiency: r.efficiency,
    }));

    // Rep-length variance caveat: if the selected sessions don't all share
    // the same work-step shape, part of any pace difference between them
    // may reflect rep length rather than fitness — e.g. longer threshold
    // reps are typically run slightly slower than shorter ones even at
    // equivalent effort. Only relevant for "Similar" or manual selections;
    // Direct matches are exact-shape repeats by definition, so this never
    // fires for those.
    const shapes = new Set(selectedSessions.map((s) => workFingerprint(workBySession.get(s.id) ?? [])));
    const repLengthVaries = shapes.size > 1;
    const shapeExamples = selectedSessions
      .map((s) => workoutLabel(workBySession.get(s.id) ?? [], recoveryBySession.get(s.id) ?? []))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    let raceCheck: {
      title: string;
      date: string;
      actualTime: number;
      km: number;
      projectedAtSameDistance: number;
    } | null = null;
    if (nearbyRace) {
      const raceKm = Number(nearbyRace.distance_m) / 1000;
      const raceTime = Number(nearbyRace.time_seconds);
      const closest = rows.reduce((best, r) => {
        const d = Math.abs(new Date(r.session_date).getTime() - new Date(nearbyRace.performance_date).getTime());
        const bd = Math.abs(new Date(best.session_date).getTime() - new Date(nearbyRace.performance_date).getTime());
        return d < bd ? r : best;
      }, rows[0]);
      if (closest.km > 0) {
        // Deliberately uses the generic formula here, not the personalized
        // one calibrated *from* this same race — otherwise the cross-check
        // would just trivially agree with itself.
        const projectedAtSameDistance = predictTime(Number(closest.work_time_s), closest.km, raceKm);
        raceCheck = {
          title: nearbyRace.event_name ?? "Race",
          date: nearbyRace.performance_date,
          actualTime: raceTime,
          km: raceKm,
          projectedAtSameDistance,
        };
      }
    }

    return { rows, first, last, chartData, repLengthVaries, shapeExamples, raceCheck, calibrated };
  }, [selectedSessions, loadHistory, targetKm, efficiencyBySession, raceSessions, workBySession, recoveryBySession]);

  // Upper/Middle/Lower range for the most recent compared session — Low is
  // the raw rep-based projection (already computed above, no adjustment).
  // Upper applies a small, capped bonus only for signals that are actually
  // true for that session/window: no fade across reps, good recovery
  // between reps (a real HR drop, not just a pause), fitness (CTL) rising
  // over the window, and a real race outperforming its own projection.
  // Each signal is worth a modest 1.5%, capped at 4 signals (6% max) —
  // deliberately conservative rather than wildly optimistic. Middle is a
  // plain average of the two, not a separately-modeled estimate.
  const predictionRange = useMemo(() => {
    if (!comparison || comparison.last.predicted == null) return null;
    const low = comparison.last.predicted;
    const { noFade, goodRecovery } = repQualitySignals(comparison.last.id);
    const ctlDelta =
      comparison.last.ctl != null && comparison.first.ctl != null ? comparison.last.ctl - comparison.first.ctl : null;
    const fitnessRising = ctlDelta != null && ctlDelta > 0;
    const raceOutperformed = comparison.raceCheck
      ? comparison.raceCheck.actualTime < comparison.raceCheck.projectedAtSameDistance
      : false;

    const signals = [
      { label: "No fade across reps", met: noFade },
      { label: "Good recovery between reps", met: goodRecovery },
      { label: "Fitness (CTL) rising", met: fitnessRising },
      { label: "Recent race outperformed projection", met: raceOutperformed },
    ];
    const metCount = signals.filter((s) => s.met).length;
    const bonusPct = metCount * 1.5;
    const upper = low * (1 - bonusPct / 100);
    const middle = (low + upper) / 2;

    return { low, middle, upper, signals, metCount };
  }, [comparison]);

  const narrative = useMemo(() => {
    if (!comparison) return null;
    const { first, last } = comparison;
    if (first.predicted == null || last.predicted == null) return null;

    const deltaSec = first.predicted - last.predicted; // positive = faster/improved
    const pct = (deltaSec / first.predicted) * 100;
    const ctlDelta = last.ctl != null && first.ctl != null ? last.ctl - first.ctl : null;

    const direction = deltaSec > 5 ? "improved" : deltaSec < -5 ? "declined" : "held steady";
    const paceLine = `Predicted ${targetLabel} equivalent for this session type ${direction} from ${secToClock(first.predicted)} to ${secToClock(last.predicted)} between ${first.session_date} and ${last.session_date}${
      Math.abs(deltaSec) > 5
        ? ` (${deltaSec > 0 ? "-" : "+"}${secToClock(Math.abs(deltaSec))}, ${Math.abs(pct).toFixed(1)}% ${deltaSec > 0 ? "faster" : "slower"})`
        : ""
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
  }, [comparison, targetLabel]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Compare Sessions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See how a repeated or similar session type has changed over time — and what that actually means for fitness
            and likely race performance, not just a pace number.
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
            {predictionRange && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">Predicted {targetLabel} — range, most recent session</CardTitle>
                    <Badge variant={comparison?.calibrated ? "default" : "outline"} className="text-[10px]">
                      {comparison?.calibrated ? "Calibrated to a real race" : "Generic formula"}
                    </Badge>
                  </div>
                  <CardDescription>
                    Low is the raw rep-based projection, no adjustment. Upper adds a small, capped bonus only for
                    signals that actually held true below. Middle is a plain average of the two.
                    {comparison?.calibrated && (
                      <>
                        {" "}
                        The exponent behind these numbers is solved from an actual logged race, not the generic
                        population-average formula — more accurate for an athlete whose speed/endurance balance differs
                        from average.
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="border rounded-md py-2">
                      <p className="text-xs text-muted-foreground">Conservative</p>
                      <p className="text-lg font-bold tabular-nums">{secToClock(predictionRange.low)}</p>
                    </div>
                    <div className="border rounded-md py-2 bg-accent/40">
                      <p className="text-xs text-muted-foreground">Likely</p>
                      <p className="text-lg font-bold tabular-nums">{secToClock(predictionRange.middle)}</p>
                    </div>
                    <div className="border rounded-md py-2">
                      <p className="text-xs text-muted-foreground">Best case</p>
                      <p className="text-lg font-bold tabular-nums">{secToClock(predictionRange.upper)}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {predictionRange.signals.map((s) => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.met ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                        />
                        <span className={s.met ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {predictionRange.metCount} of 4 signals met — Best case is{" "}
                    {(predictionRange.metCount * 1.5).toFixed(1)}% faster than Conservative.
                  </p>
                </CardContent>
              </Card>
            )}

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

            {comparison?.repLengthVaries && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="pt-4 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">These sessions aren't all the same rep length</p>
                    <p className="text-muted-foreground mt-0.5">
                      {comparison.shapeExamples.join(" · ")} — longer reps are typically run slightly slower than
                      shorter ones even at equivalent effort, so part of any pace difference above may reflect rep
                      length rather than a fitness change. Worth keeping in mind, especially for Threshold/Tempo work
                      where rep duration varies a lot by design.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {comparison?.raceCheck && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Cross-check against a real race result</CardTitle>
                  <CardDescription>
                    An actual race result outranks any workout-based projection — shown here for comparison, not as a
                    replacement for the chart above.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {comparison.raceCheck.title} ({comparison.raceCheck.date}), {comparison.raceCheck.km.toFixed(2)}{" "}
                      km
                    </span>
                    <span className="font-medium tabular-nums">
                      Actual: {secToClock(comparison.raceCheck.actualTime)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Projected from nearest compared session, same distance
                    </span>
                    <span className="font-medium tabular-nums">
                      {secToClock(comparison.raceCheck.projectedAtSameDistance)}
                    </span>
                  </div>
                  <p className="text-muted-foreground pt-1">
                    {Math.abs(comparison.raceCheck.actualTime - comparison.raceCheck.projectedAtSameDistance) <= 15
                      ? "Actual result and projection line up closely — good sign the workout-based prediction is tracking real fitness."
                      : comparison.raceCheck.actualTime < comparison.raceCheck.projectedAtSameDistance
                        ? "The athlete actually raced faster than the workout-based projection expected — race-day execution, taper, or competition effect likely outweighs what training paces alone predict."
                        : "The athlete actually raced slower than the workout-based projection expected — worth considering race-day conditions, pacing, or whether training paces overstate current race fitness."}
                  </p>
                </CardContent>
              </Card>
            )}

            {comparison && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base">Predicted {targetLabel} equivalent, over time</CardTitle>
                      <CardDescription>
                        Each selected session's work pace/distance projected onto the chosen distance via Riegel's
                        formula — the same engine behind the Pace/Race Predictor calculator.
                      </CardDescription>
                    </div>
                    <div className="w-[140px] shrink-0">
                      <Label className="text-xs">Project onto</Label>
                      <Select value={String(targetKm)} onValueChange={(v) => setTargetKm(Number(v))}>
                        <SelectTrigger className="mt-1 h-8 text-xs">
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
                          formatter={(v: any) => [secToClock(Number(v)), `Predicted ${targetLabel}`]}
                        />
                        <Line type="monotone" dataKey="predicted" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {comparison && (
              <div className="grid sm:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Work pace</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[140px] w-full">
                      <ResponsiveContainer>
                        <LineChart data={comparison.chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                          <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => paceFmt(v)} width={40} />
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
                    <CardTitle className="text-sm">Avg HR</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[140px] w-full">
                      <ResponsiveContainer>
                        <LineChart data={comparison.chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                          <YAxis tick={{ fontSize: 9 }} width={30} />
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
                    <CardTitle className="text-sm">Efficiency</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[140px] w-full">
                      <ResponsiveContainer>
                        <LineChart data={comparison.chartData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                          <YAxis tick={{ fontSize: 9 }} width={30} domain={[0, 100]} />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--background))",
                              border: "1px solid hsl(var(--border))",
                              fontSize: 11,
                            }}
                            formatter={(v: any) => [`${Math.round(Number(v))}/100`, "Efficiency"]}
                          />
                          <Line
                            type="monotone"
                            dataKey="efficiency"
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
              </div>
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
                          <div className="text-xs text-muted-foreground">
                            {r.session_date} ·{" "}
                            {workoutLabel(workBySession.get(r.id) ?? [], recoveryBySession.get(r.id) ?? [])}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                          <span>{r.km.toFixed(2)} km</span>
                          <span>{secToClock(Number(r.work_time_s))}</span>
                          <span>{paceFmt(r.work_avg_pace_sec_per_km)}</span>
                          {r.work_avg_hr != null && <span>{Math.round(r.work_avg_hr)} bpm</span>}
                          {r.efficiency != null && <Badge variant="outline">Eff {r.efficiency}</Badge>}
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
                  <CardDescription>
                    Same intent, structure, and work-step shape — the closest apples-to-apples comparisons.
                  </CardDescription>
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
                            {intentLabel(g.sessions[0].intent)} ·{" "}
                            {workoutLabel(
                              workBySession.get(g.sessions[0].id) ?? [],
                              recoveryBySession.get(g.sessions[0].id) ?? [],
                            )}
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
                  <CardDescription>
                    Same intent and structure type, but not an exact repeat — normalized via predicted equivalent, not
                    raw pace.
                  </CardDescription>
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
                            {intentLabel(g.sessions[0].intent)} · e.g.{" "}
                            {workoutLabel(
                              workBySession.get(g.sessions[0].id) ?? [],
                              recoveryBySession.get(g.sessions[0].id) ?? [],
                            )}
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
