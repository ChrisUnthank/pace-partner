import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Activity, EyeOff, Eye, Plus, Trash2, Radar as RadarIcon } from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

// Phase 3 — Training Response Profile. Every observation here is computed
// client-side from data that already exists (sessions, daily_vitals,
// athlete_load_daily) — nothing is stored except a coach's dismiss/note
// override and freeform manual notes (see
// 20260718000002_training_response_phase3.sql).
//
// Deliberately conservative: every observation has a minimum sample size
// gate below which it shows "not enough data yet" instead of a claim, and
// every observation states its own method in small print so a coach can
// judge it rather than trust it blindly. Per spec: "these should initially
// be displayed as observed patterns, not definitive conclusions."

const WINDOW_DAYS = 84; // 12 weeks, matching the spec's own example phrasing

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function weekStartMonday(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const HARD_INTENTS = new Set(["vo2", "anaerobic", "threshold", "speed", "time_trial"]);

// Response by Training Stimulus — the doc's spec asks for 9 categories
// (Threshold/VO2/Tempo/Long Run/Strength/Hills/Speed/Sprint/Recovery).
// Scoped down to the 7 with a real data source, same call as dropping
// Strength/Climbing Ability from the DNA ratings earlier: Hills has no
// terrain-specific tracking anywhere in the schema (sessions.terrain
// covers track/road/trail, not hill-specific), and Speed/Sprint aren't
// distinguished from each other at the schema level (both fall under the
// single `speed` session_intent), so they're shown as one combined
// category rather than inventing a split the data can't actually support.
type StimulusKey = "threshold" | "vo2" | "tempo" | "long_run" | "speed" | "recovery" | "strength";

const STIMULUS_META: Record<StimulusKey, { label: string }> = {
  threshold: { label: "Threshold" },
  vo2: { label: "VO2" },
  tempo: { label: "Tempo" },
  long_run: { label: "Long Run" },
  speed: { label: "Speed / Sprint" },
  recovery: { label: "Recovery" },
  strength: { label: "Strength" },
};

function matchesStimulus(s: any, key: StimulusKey): boolean {
  switch (key) {
    case "threshold":
      return s.intent === "threshold";
    case "vo2":
      return s.intent === "vo2";
    case "tempo":
      return s.intent === "tempo";
    case "long_run":
      return !!s.is_long_run;
    case "speed":
      return s.intent === "speed" || s.intent === "anaerobic";
    case "recovery":
      return s.day_type === "recovery" || s.intent === "easy";
    case "strength":
      return s.activity_type === "gym";
  }
}

type Observation = {
  key: string;
  title: string;
  sentence: string | null; // null = not enough data
  method: string;
  insufficientReason?: string;
};

export function TrainingResponseCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const since = daysAgo(WINDOW_DAYS);

  const { data: sessions } = useQuery({
    queryKey: ["training-response-sessions", athleteId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("session_date, intent, rpe, completed_at, is_long_run, day_type, activity_type")
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .not("completed_at", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: vitals } = useQuery({
    queryKey: ["training-response-vitals", athleteId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_vitals")
        .select("vitals_date, resting_hr")
        .eq("athlete_id", athleteId)
        .gte("vitals_date", since)
        .not("resting_hr", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: loadDaily } = useQuery({
    queryKey: ["training-response-load", athleteId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_load_daily")
        .select("load_date, training_load, readiness_status, readiness_score, checkin_score")
        .eq("athlete_id", athleteId)
        .gte("load_date", since)
        .order("load_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: overrides } = useQuery({
    queryKey: ["training-response-overrides", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_training_response_overrides" as any)
        .select("*")
        .eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: manualNotes } = useQuery({
    queryKey: ["training-response-notes", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_training_response_notes" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // ---- Observation 1: resting-HR recovery after high-intensity sessions ----
  const hrRecovery = useMemo((): Observation => {
    const key = "hr_recovery";
    const title = "Resting HR after high-intensity sessions";
    const method =
      "Method: for each session flagged VO2/anaerobic/threshold/speed/time-trial (or RPE 8+), checks the first day in the following 3 with a logged resting HR back within 2 bpm of this athlete's own 12-week median.";

    const vitalsByDate = new Map<string, number>();
    for (const v of vitals ?? []) {
      if (v.resting_hr != null) vitalsByDate.set(v.vitals_date, v.resting_hr);
    }
    const allRhr = (vitals ?? []).map((v) => v.resting_hr).filter((n): n is number => n != null);
    const baseline = median(allRhr);
    if (baseline == null || allRhr.length < 7) {
      return { key, title, sentence: null, method, insufficientReason: "Needs more days of logged resting HR (at least a week's worth) to establish a baseline." };
    }

    const hardSessionDates = (sessions ?? [])
      .filter((s) => (s.intent && HARD_INTENTS.has(s.intent)) || (s.rpe != null && s.rpe >= 8))
      .map((s) => s.session_date);

    const recoveryDaysList: number[] = [];
    let checked = 0;
    for (const d of hardSessionDates) {
      const day1 = vitalsByDate.get(addDays(d, 1));
      const day2 = vitalsByDate.get(addDays(d, 2));
      const day3 = vitalsByDate.get(addDays(d, 3));
      if (day1 == null && day2 == null && day3 == null) continue; // no follow-up data for this instance
      checked++;
      if (day1 != null && day1 <= baseline + 2) recoveryDaysList.push(1);
      else if (day2 != null && day2 <= baseline + 2) recoveryDaysList.push(2);
      else if (day3 != null && day3 <= baseline + 2) recoveryDaysList.push(3);
      // else: still elevated at day 3 — excluded from the "typical days"
      // figure since it's censored, but still counts toward `checked`.
    }

    if (checked < 3) {
      return {
        key,
        title,
        sentence: null,
        method,
        insufficientReason: `Only ${checked} high-intensity session${checked === 1 ? "" : "s"} in the last 12 weeks had resting HR logged in the following days — needs at least 3.`,
      };
    }

    const returned = recoveryDaysList.length;
    if (returned === 0) {
      return {
        key,
        title,
        sentence: `Based on ${checked} high-intensity sessions in the last 12 weeks, resting HR had not returned to this athlete's baseline within 3 days in any instance with follow-up data.`,
        method,
      };
    }

    const typical = median(recoveryDaysList);
    return {
      key,
      title,
      sentence: `Based on ${checked} high-intensity sessions in the last 12 weeks with follow-up data, resting HR typically returned to baseline within ${typical} day${typical === 1 ? "" : "s"} (${returned} of ${checked} instances returned within the 3-day window checked).`,
      method,
    };
  }, [sessions, vitals]);

  // ---- Observation 2: readiness after 2+ consecutive higher-load days ----
  const loadStreakReadiness = useMemo((): Observation => {
    const key = "consecutive_load_readiness";
    const title = "Readiness after consecutive higher-load days";
    const method =
      "Method: flags any day preceded by 2 consecutive days with training load above this athlete's own 12-week median (training days only), then compares the Amber/Red readiness rate on those flagged days against the athlete's overall Amber/Red rate. Only days with a completed check-in are counted — readiness without one is derived from training load, so including those days would compare load against itself.";

    // Only days with a CHECK-IN behind them.
    //
    // Without one, readiness is load_balance, which is computed from the
    // ATL/CTL ratio — so asking "is readiness worse after consecutive
    // high-load days" answers itself. Consecutive high load raises ATL (7-day
    // constant) faster than CTL (42-day), the ratio rises, the fatigue
    // component falls, readiness falls. Yes, by construction, for every
    // athlete, always.
    //
    // That is a property of the formula, not a finding about the athlete, and
    // presenting it as an observation is worse than showing nothing — it
    // reads as evidence and would survive any amount of scrutiny of the
    // arithmetic while being about nothing.
    //
    // A check-in makes readiness carry information the load side does not,
    // and only then is the comparison real.
    const rows = (loadDaily ?? []).filter(
      (r) => r.readiness_status != null && (r as any).checkin_score != null,
    );
    if (rows.length < 14) {
      return {
        key,
        title,
        sentence: null,
        method,
        insufficientReason:
          "Needs at least 2 weeks of days with a completed check-in. Without one, readiness is derived from training load, so comparing it against training load would just restate the formula.",
      };
    }

    const trainingLoads = rows.map((r) => Number(r.training_load ?? 0)).filter((n) => n > 0);
    const med = median(trainingLoads);
    if (med == null) {
      return { key, title, sentence: null, method, insufficientReason: "Not enough logged training load yet." };
    }

    const byDate = new Map(rows.map((r) => [r.load_date, r]));
    let flaggedCount = 0;
    let flaggedAmberRed = 0;
    for (const r of rows) {
      const prev1 = byDate.get(addDays(r.load_date, -1));
      const prev2 = byDate.get(addDays(r.load_date, -2));
      if (!prev1 || !prev2) continue;
      if (Number(prev1.training_load ?? 0) > med && Number(prev2.training_load ?? 0) > med) {
        flaggedCount++;
        if (r.readiness_status === "amber" || r.readiness_status === "red") flaggedAmberRed++;
      }
    }

    if (flaggedCount < 5) {
      return {
        key,
        title,
        sentence: null,
        method,
        insufficientReason: `Only ${flaggedCount} instance${flaggedCount === 1 ? "" : "s"} of 2+ consecutive higher-load days in the last 12 weeks — needs at least 5.`,
      };
    }

    const overallAmberRed = rows.filter((r) => r.readiness_status === "amber" || r.readiness_status === "red").length;
    const overallPct = Math.round((overallAmberRed / rows.length) * 100);
    const flaggedPct = Math.round((flaggedAmberRed / flaggedCount) * 100);

    const comparison =
      flaggedPct > overallPct + 10
        ? "notably higher than"
        : flaggedPct < overallPct - 10
          ? "no higher than (in fact lower than)"
          : "similar to";

    return {
      key,
      title,
      sentence: `In ${flaggedCount} instances of 2+ consecutive higher-load days in the last 12 weeks, readiness was Amber or Red ${flaggedPct}% of the time — ${comparison} the athlete's overall Amber/Red rate of ${overallPct}%.`,
      method,
    };
  }, [loadDaily]);

  // ---- Observation 3: higher-volume weeks vs lower-volume weeks ----
  const volumeTolerance = useMemo((): Observation => {
    const key = "volume_tolerance";
    const title = "Readiness in higher-volume vs lower-volume weeks";
    const method =
      "Method: groups the last 12 weeks by this athlete's own weekly training load, splits into higher-load and lower-load weeks by the athlete's own median week, and compares average readiness score between the two groups. Only days with a completed check-in contribute a readiness score, since readiness without one is calculated from load.";

    const weekMap = new Map<string, { load: number; readinessScores: number[] }>();
    for (const r of loadDaily ?? []) {
      const wk = weekStartMonday(r.load_date);
      if (!weekMap.has(wk)) weekMap.set(wk, { load: 0, readinessScores: [] });
      const entry = weekMap.get(wk)!;
      entry.load += Number(r.training_load ?? 0);
      // Same restriction as Observation 2, and for the same reason: a
      // readiness score with no check-in behind it is a function of load, so
      // grouping it BY load measures the formula.
      if (r.readiness_score != null && (r as any).checkin_score != null) {
        entry.readinessScores.push(Number(r.readiness_score));
      }
    }
    const weeks = Array.from(weekMap.entries()).map(([wk, v]) => ({
      week: wk,
      load: v.load,
      avgReadiness: v.readinessScores.length ? v.readinessScores.reduce((a, b) => a + b, 0) / v.readinessScores.length : null,
    }));

    if (weeks.length < 6) {
      return { key, title, sentence: null, method, insufficientReason: "Needs at least 6 weeks of training load history." };
    }

    // Weeks with no check-in contribute no readiness score above, so a
    // history full of load but empty of check-ins reaches here with nothing
    // to compare. Says which is missing rather than "not enough data", which
    // would send a coach looking for more training rather than more check-ins.
    if (weeks.filter((w) => w.avgReadiness != null).length < 6) {
      return {
        key,
        title,
        sentence: null,
        method,
        insufficientReason:
          "Needs at least 6 weeks containing a completed check-in. Readiness without one is calculated from training load, so comparing it across load levels would only restate the formula.",
      };
    }

    const loadMedian = median(weeks.map((w) => w.load));
    if (loadMedian == null) {
      return { key, title, sentence: null, method, insufficientReason: "Not enough logged training load yet." };
    }

    const higher = weeks.filter((w) => w.load >= loadMedian && w.avgReadiness != null);
    const lower = weeks.filter((w) => w.load < loadMedian && w.avgReadiness != null);

    if (higher.length < 3 || lower.length < 3) {
      return {
        key,
        title,
        sentence: null,
        method,
        insufficientReason: "Needs at least 3 higher-volume weeks and 3 lower-volume weeks with readiness data.",
      };
    }

    const higherAvg = higher.reduce((a, w) => a + (w.avgReadiness ?? 0), 0) / higher.length;
    const lowerAvg = lower.reduce((a, w) => a + (w.avgReadiness ?? 0), 0) / lower.length;
    const diff = higherAvg - lowerAvg;

    const interpretation =
      Math.abs(diff) < 5
        ? "little difference between the two — an early sign this athlete tolerates higher-volume weeks reasonably well"
        : diff < 0
          ? "readiness running lower during higher-volume weeks — may be worth extra recovery support in volume blocks"
          : "readiness actually running higher during higher-volume weeks — worth reviewing what else differs about those weeks";

    return {
      key,
      title,
      sentence: `Comparing this athlete's own ${higher.length} higher-volume weeks to ${lower.length} lower-volume weeks over the last 12 weeks, average readiness was ${higherAvg.toFixed(0)} vs ${lowerAvg.toFixed(0)} — ${interpretation}.`,
      method,
    };
  }, [loadDaily]);

  // ---- Response by Training Stimulus ----
  // Same evidence-gated approach as the observations above, just bucketed
  // per stimulus type instead of one blended "hard sessions" category:
  // for each completed session matching a stimulus, checks readiness
  // status 1-2 days later against this athlete's own logged data. High
  // Response = mostly green within that window, Moderate = mixed, Low =
  // mostly amber/red. Needs at least 3 instances with follow-up readiness
  // data per stimulus, same minimum-sample-size gate as every other
  // observation on this card — shows "not enough data" rather than a
  // guess below that.
  const stimulusResponses = useMemo(() => {
    const loadByDate = new Map((loadDaily ?? []).map((d) => [d.load_date, d]));
    const keys: StimulusKey[] = ["threshold", "vo2", "tempo", "long_run", "speed", "recovery", "strength"];
    return keys.map((key) => {
      const matched = (sessions ?? []).filter((s) => matchesStimulus(s, key));
      let checked = 0;
      let good = 0;
      for (const s of matched) {
        const d1 = loadByDate.get(addDays(s.session_date, 1));
        const d2 = loadByDate.get(addDays(s.session_date, 2));
        const status = d1?.readiness_status ?? d2?.readiness_status;
        if (!status) continue;
        checked++;
        if (status === "green") good++;
      }
      if (checked < 3) {
        return { key, label: STIMULUS_META[key].label, level: null as "High" | "Moderate" | "Low" | null, pct: null as number | null, n: checked };
      }
      const pct = Math.round((good / checked) * 100);
      const level: "High" | "Moderate" | "Low" = pct >= 70 ? "High" : pct >= 40 ? "Moderate" : "Low";
      return { key, label: STIMULUS_META[key].label, level, pct, n: checked };
    });
  }, [sessions, loadDaily]);

  const observations = [hrRecovery, loadStreakReadiness, volumeTolerance];

  const overrideByKey = new Map((overrides ?? []).map((o) => [o.observation_key, o]));

  async function toggleDismiss(key: string, dismissed: boolean) {
    const { error } = await supabase.from("athlete_training_response_overrides" as any).upsert(
      { athlete_id: athleteId, observation_key: key, dismissed } as any,
      { onConflict: "athlete_id,observation_key" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["training-response-overrides", athleteId] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RadarIcon className="h-4 w-4 text-[var(--accent-red)]" />
            Response by Training Stimulus
          </CardTitle>
          <CardDescription>
            How this athlete's readiness typically holds up 1-2 days after each type of session, over the last 12
            weeks. Needs at least 3 instances with follow-up readiness data per stimulus — shown as "Not enough
            data" below that, never a guess.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stimulusResponses.some((r) => r.level != null) && (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={stimulusResponses.map((r) => ({ stimulus: r.label, pct: r.pct ?? 0 }))} outerRadius="75%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="stimulus" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar name="Response" dataKey="pct" stroke="var(--accent-red)" fill="var(--accent-red)" fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {stimulusResponses.map((r) => (
              <div key={r.key} className="border rounded-lg p-2.5 text-center">
                <div className="text-xs text-muted-foreground">{r.label}</div>
                {r.level != null ? (
                  <>
                    <div className="text-lg font-bold tabular-nums mt-0.5">{r.level}</div>
                    <div className="text-[10px] text-muted-foreground">{r.pct}% · {r.n} instances</div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-bold text-muted-foreground mt-0.5">—</div>
                    <div className="text-[10px] text-muted-foreground">Not enough data{r.n > 0 ? ` (${r.n})` : ""}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-[var(--accent-red)]" />
            Training response — observed patterns
          </CardTitle>
          <CardDescription>
            Computed from the last 12 weeks. These are observations, not conclusions — review and dismiss any that
            don't hold up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {observations.map((obs) => {
            const override = overrideByKey.get(obs.key);
            const dismissed = override?.dismissed ?? false;
            return (
              <div key={obs.key} className={`rounded-md border p-3 ${dismissed ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{obs.title}</div>
                  {isCoach && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs shrink-0"
                      onClick={() => toggleDismiss(obs.key, !dismissed)}
                    >
                      {dismissed ? (
                        <>
                          <Eye className="h-3.5 w-3.5 mr-1" /> Restore
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5 mr-1" /> Dismiss
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {dismissed ? (
                  <p className="text-xs text-muted-foreground mt-1">Dismissed by coach — hidden from summary views.</p>
                ) : obs.sentence ? (
                  <p className="text-sm mt-1.5 leading-relaxed">{obs.sentence}</p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1.5">{obs.insufficientReason ?? "Not enough data yet."}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">{obs.method}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <CoachNotesCard athleteId={athleteId} isCoach={isCoach} notes={manualNotes ?? []} />
    </div>
  );
}

function CoachNotesCard({
  athleteId,
  isCoach,
  notes,
}: {
  athleteId: string;
  isCoach: boolean;
  notes: any[];
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["training-response-notes", athleteId] });
  }

  async function addNote() {
    if (!text.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("athlete_training_response_notes" as any).insert({
      athlete_id: athleteId,
      note: text.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    setShowForm(false);
    invalidate();
  }

  async function removeNote(id: string) {
    const { error } = await supabase.from("athlete_training_response_notes" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidate();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Coach observations</CardTitle>
          <CardDescription>Your own notes on how this athlete responds to training — not auto-computed.</CardDescription>
        </div>
        {isCoach && !showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add note
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Responds well to threshold work but needs an extra easy day after back-to-back track sessions."
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={addNote} disabled={saving}>
                {saving ? "Saving…" : "Save note"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coach notes yet.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
                <div>
                  <p className="text-sm leading-relaxed">{n.note}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{n.created_at?.slice(0, 10)}</p>
                </div>
                {isCoach && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 shrink-0" onClick={() => removeNote(n.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
