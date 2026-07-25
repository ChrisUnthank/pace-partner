/**
 * Plan Builder — week-by-week progression patterns.
 *
 * Generates target weeks' worth of `plan_template_sessions` rows from one
 * already-built base week, scaling volume by a named pattern. Reuses
 * `scaleStep()` from calendar-copy.ts (the same engine Copy Period
 * Forward / Copy Athlete History use) rather than a second scaling
 * implementation — a template step's JSON shape (kind, target_kind,
 * target_distance_m, etc.) matches DraftStep's shape exactly, so no
 * conversion is needed either way.
 *
 * Deliberately volume-only, no intensity progression: a template is a
 * general-purpose starting point (see SystemTemplateNotice elsewhere in
 * app.plans.tsx), and pace/threshold-% intensity targets are something a
 * coach tunes per athlete at assign time, not something a template
 * pattern should be guessing at. Keeping this to volume keeps the picker
 * itself to one number per week, not two.
 */

import { scaleStep, type CopyBucket, type ProgressionRule } from "./calendar-copy";

// Template sessions carry `effort_type`, not the `day_type`/`intent`/
// `is_long_run` combination real sessions use — same six scalable
// buckets as Copy Period Forward, plus "strides" and "cross_train"/"rest"
// excluded from scaling (a strides session is normally a fixed short
// format regardless of block phase, same reasoning cross_train/rest are
// already excluded from Copy's own bucket resolution).
export function bucketForEffortType(effortType: string): CopyBucket | null {
  switch (effortType) {
    case "easy":
      return "easy";
    case "long":
      return "long";
    case "tempo":
      return "tempo";
    case "threshold":
      return "threshold";
    case "vo2":
      return "vo2";
    case "race":
      return "race";
    default:
      return null; // strides, cross_train, rest
  }
}

export type ProgressionPatternId = "flat" | "build_5" | "build_8" | "build_10" | "build_3_1" | "taper";

export const PROGRESSION_PATTERNS: { id: ProgressionPatternId; label: string; description: string }[] = [
  { id: "flat", label: "Flat repeat", description: "Same volume every week — just fills out the range from the base week, no progression." },
  { id: "build_5", label: "Build +5%/wk", description: "Steady volume increase, +5% of the base week per week (cumulative from base, not compounding week-over-week)." },
  { id: "build_8", label: "Build +8%/wk", description: "Same shape, +8%/week." },
  { id: "build_10", label: "Build +10%/wk", description: "Same shape, +10%/week." },
  {
    id: "build_3_1",
    label: "3:1 build with cutback",
    description:
      "Repeating 4-week cycle relative to base: +10%, +20%, +30%, then a −10% cutback week, then the cycle repeats. Intended for filling one training block, not a long continuous ramp — for that, chain blocks with a phase reset in between rather than expecting this to keep climbing indefinitely.",
  },
  {
    id: "taper",
    label: "Taper",
    description: "Anchored to the END of the target range: last week −50%, second-to-last −30%, third-to-last −15%, everything earlier in the range left flat.",
  },
];

/**
 * Returns one volume % (relative to the base week) per generated week, in
 * order. weekCount is how many weeks are being generated — taper is
 * tail-anchored so it needs to know the full count to place its steepest
 * cutback on the actual last week, not a fixed week number.
 */
export function computeProgressionPercents(patternId: ProgressionPatternId, weekCount: number): number[] {
  switch (patternId) {
    case "flat":
      return Array(weekCount).fill(0);
    case "build_5":
      return Array.from({ length: weekCount }, (_, i) => 5 * (i + 1));
    case "build_8":
      return Array.from({ length: weekCount }, (_, i) => 8 * (i + 1));
    case "build_10":
      return Array.from({ length: weekCount }, (_, i) => 10 * (i + 1));
    case "build_3_1": {
      const cycle = [10, 20, 30, -10];
      return Array.from({ length: weekCount }, (_, i) => cycle[i % 4]);
    }
    case "taper": {
      const tail = [-15, -30, -50]; // last up to 3 weeks of the range
      return Array.from({ length: weekCount }, (_, i) => {
        const posFromEnd = weekCount - i; // 1 = last week in the range
        const idx = tail.length - posFromEnd;
        return idx >= 0 ? tail[idx] : 0;
      });
    }
    default:
      return Array(weekCount).fill(0);
  }
}

export type TemplateSessionRow = {
  week_number: number;
  day_of_week: number;
  title: string;
  effort_type: string;
  steps: any[];
  notes: string | null;
};

/**
 * Builds one target week's session rows from the base week's sessions,
 * scaling each session's work/strides steps by volumePct (bucket-aware —
 * a bucket with nothing to scale, like cross_train or rest, copies
 * across untouched, same convention as Copy Period Forward).
 */
export function buildProgressedWeekSessions(
  baseWeekSessions: { day_of_week: number; title: string; effort_type: string; steps: any[]; notes: string | null }[],
  targetWeekNumber: number,
  volumePct: number,
): TemplateSessionRow[] {
  return baseWeekSessions.map((s) => {
    const bucket = bucketForEffortType(s.effort_type);
    const rule: ProgressionRule | undefined = bucket ? { volumePct, intensityPct: 0 } : undefined;
    const steps = (s.steps ?? []).map((step: any) => scaleStep(step, rule).step);
    return {
      week_number: targetWeekNumber,
      day_of_week: s.day_of_week,
      title: s.title,
      effort_type: s.effort_type,
      steps,
      notes: s.notes ?? null,
    };
  });
}

/** Rough estimated distance (m) for one template session — same
 * assumed-pace approximation already used in app.plans.tsx for browsing
 * template weekly volume, duplicated here (not imported) since that one
 * is a local, non-exported function scoped to the templates browse list. */
const ASSUMED_PACE_SEC_PER_KM: Record<string, number> = {
  easy: 330,
  long: 330,
  tempo: 255,
  threshold: 240,
  vo2: 225,
  strides: 200,
  race: 300,
  cross_train: 0,
  rest: 0,
};

export function estimateTemplateSessionDistanceM(effortType: string, steps: any[] | null): number {
  if (!steps || steps.length === 0) return 0;
  const paceSecPerKm = ASSUMED_PACE_SEC_PER_KM[effortType] ?? 300;

  return steps.reduce((sum, s) => {
    if (s.kind !== "work" && s.kind !== "strides") return sum;
    const reps = Number(s.reps ?? 1);
    if (s.target_kind === "distance") {
      return sum + Number(s.target_distance_m ?? 0) * reps;
    }
    if (s.target_kind === "time" && paceSecPerKm > 0) {
      const seconds = Number(s.target_time_seconds ?? 0) * reps;
      return sum + (seconds / paceSecPerKm) * 1000;
    }
    return sum;
  }, 0);
}
