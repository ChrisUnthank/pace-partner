/**
 * Copy Week/Month Forward — bucket resolution + progression scaling.
 *
 * Pure functions, no side effects, so the review step in the dialog can
 * build and re-build drafts instantly without a server round trip. The
 * server only ever sees the final, possibly coach-edited, draft array at
 * commit time (src/lib/calendar-copy.functions.ts).
 *
 * Bucket taxonomy note: real sessions (logged or planned) don't carry a
 * "strides" classification at the session level the way plan templates
 * do — strides are a step *within* a session, not a session-level type —
 * so this uses six buckets (no strides), resolved from existing columns
 * (`intent`, `is_long_run`, `day_type`), not a new field.
 */

export type CopyBucket = "easy" | "long" | "tempo" | "threshold" | "vo2" | "race";

export const COPY_BUCKETS: CopyBucket[] = ["easy", "long", "tempo", "threshold", "vo2", "race"];

export const COPY_BUCKET_LABELS: Record<CopyBucket, string> = {
  easy: "Easy",
  long: "Long run",
  tempo: "Tempo",
  threshold: "Threshold",
  vo2: "VO2 / speed",
  race: "Race",
};

export type ProgressionRule = { volumePct: number; intensityPct: number };
export type ProgressionRules = Partial<Record<CopyBucket, ProgressionRule>>;

export function emptyProgressionRules(): ProgressionRules {
  const rules: ProgressionRules = {};
  for (const b of COPY_BUCKETS) rules[b] = { volumePct: 0, intensityPct: 0 };
  return rules;
}

/**
 * cross_training and rest have nothing meaningful to scale — they're
 * excluded (return null) rather than lumped into "easy", and always
 * copy across untouched.
 */
export function bucketForSession(session: {
  day_type: string;
  intent: string | null;
  is_long_run?: boolean | null;
}): CopyBucket | null {
  if (session.day_type === "race") return "race";
  if (session.day_type === "cross_training") return null;
  if (session.is_long_run) return "long";
  switch (session.intent) {
    case "easy":
    case "aerobic":
      return "easy";
    case "tempo":
      return "tempo";
    case "threshold":
      return "threshold";
    case "vo2":
      return "vo2";
    default:
      return null;
  }
}

export type DraftStep = {
  kind: string;
  reps: number;
  set_count: number;
  target_kind: string | null;
  target_distance_m: number | null;
  target_time_seconds: number | null;
  target_mode: string | null;
  target_pace_sec_per_km: number | null;
  target_threshold_pace_pct: number | null;
  target_threshold_hr_pct: number | null;
  target_zone: string | null;
  target_rpe: number | null;
  is_ladder: boolean;
  counts_toward_distance: boolean;
  recovery_between_reps_seconds: number | null;
  recovery_between_reps_mode: string | null;
  recovery_between_reps_target_kind: string | null;
  recovery_between_sets_seconds: number | null;
  recovery_between_sets_mode: string | null;
  recovery_mode: string | null;
  recovery_target_kind: string | null;
  recovery_target_seconds: number | null;
  recovery_target_distance_m: number | null;
  notes: string | null;
};

function baseDraftStep(step: any): DraftStep {
  return {
    kind: step.kind,
    reps: step.reps ?? 1,
    set_count: step.set_count ?? 1,
    target_kind: step.target_kind ?? null,
    target_distance_m: step.target_distance_m ?? null,
    target_time_seconds: step.target_time_seconds ?? null,
    target_mode: step.target_mode ?? null,
    target_pace_sec_per_km: step.target_pace_sec_per_km ?? null,
    target_threshold_pace_pct: step.target_threshold_pace_pct ?? null,
    target_threshold_hr_pct: step.target_threshold_hr_pct ?? null,
    target_zone: step.target_zone ?? null,
    target_rpe: step.target_rpe ?? null,
    is_ladder: step.is_ladder ?? false,
    counts_toward_distance: step.counts_toward_distance ?? true,
    recovery_between_reps_seconds: step.recovery_between_reps_seconds ?? null,
    recovery_between_reps_mode: step.recovery_between_reps_mode ?? null,
    recovery_between_reps_target_kind: step.recovery_between_reps_target_kind ?? null,
    recovery_between_sets_seconds: step.recovery_between_sets_seconds ?? null,
    recovery_between_sets_mode: step.recovery_between_sets_mode ?? null,
    recovery_mode: step.recovery_mode ?? null,
    recovery_target_kind: step.recovery_target_kind ?? null,
    recovery_target_seconds: step.recovery_target_seconds ?? null,
    recovery_target_distance_m: step.recovery_target_distance_m ?? null,
    notes: step.notes ?? null,
  };
}

// Rounds a scaled (or even unscaled) distance to a number a coach would
// actually write in a plan, not an arithmetic artifact of a percentage
// multiplier (5437m instead of 5400m). Finer-grained for interval-length
// distances, coarser for continuous/long-run distances — a judgment call
// on granularity, not a confirmed product spec; easy to change the two
// thresholds below if a different rounding feels more natural.
function roundDistanceM(m: number): number {
  const step = m < 3000 ? 50 : 100;
  return Math.round(m / step) * step;
}

// Same reasoning, for time-based work steps — rounds to the nearest
// minute rather than leaving an odd number of seconds after scaling.
function roundTimeSeconds(s: number): number {
  return Math.round(s / 60) * 60;
}

/**
 * Applies one bucket's progression rule to one step. Only work/strides
 * steps scale — warmup, cooldown, and recovery blocks copy across
 * untouched, since a harder week shouldn't quietly grow the warmup too.
 * Returns `flagged: true` when an intensity change was requested but the
 * step's target mode isn't numerically scalable (zone/RPE) — those need
 * a coach's judgment call, not a guessed number.
 *
 * Note on what this never touches: `step` here is always the SOURCE
 * step's own prescription (target_kind/target_distance_m/etc) — the
 * `steps` table only ever holds the planned target in the first place,
 * never actual recorded results (those live in `interval_results`,
 * a separate table this never reads). A copy is a copy of the plan, not
 * of what was actually run, whether or not the source session was
 * itself completed.
 */
export function scaleStep(step: any, rule: ProgressionRule | undefined): { step: DraftStep; flagged: boolean } {
  const base = baseDraftStep(step);
  const isWorkLike = step.kind === "work" || step.kind === "strides";

  if (!isWorkLike) {
    return { step: base, flagged: false };
  }

  let flagged = false;

  if (rule?.volumePct) {
    const mult = 1 + rule.volumePct / 100;
    if (base.target_kind === "distance" && base.target_distance_m != null) {
      base.target_distance_m = base.target_distance_m * mult;
    } else if (base.target_kind === "time" && base.target_time_seconds != null) {
      base.target_time_seconds = base.target_time_seconds * mult;
    }
  }

  if (rule?.intensityPct) {
    if (base.target_mode === "pace" && base.target_pace_sec_per_km != null) {
      // Positive intensity % = faster = fewer seconds per km.
      base.target_pace_sec_per_km = Math.round(base.target_pace_sec_per_km * (1 - rule.intensityPct / 100));
    } else if (base.target_mode === "threshold_pace_pct" && base.target_threshold_pace_pct != null) {
      base.target_threshold_pace_pct = Math.round((base.target_threshold_pace_pct + rule.intensityPct) * 10) / 10;
    } else if (base.target_mode === "threshold_hr_pct" && base.target_threshold_hr_pct != null) {
      base.target_threshold_hr_pct = Math.round((base.target_threshold_hr_pct + rule.intensityPct) * 10) / 10;
    } else if (base.target_mode === "zone" || base.target_mode === "rpe") {
      flagged = true;
    }
  }

  // Always rounds to a plan-friendly number — applies even with no
  // progression at all (an exact copy), not just a side effect of
  // scaling, since prescribed distances should read like a plan either way.
  if (base.target_kind === "distance" && base.target_distance_m != null) {
    base.target_distance_m = roundDistanceM(base.target_distance_m);
  } else if (base.target_kind === "time" && base.target_time_seconds != null) {
    base.target_time_seconds = roundTimeSeconds(base.target_time_seconds);
  }

  return { step: base, flagged };
}

export type DraftSession = {
  tempId: string;
  sourceSessionId: string;
  athlete_id: string;
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  structure: string | null;
  is_long_run: boolean;
  bucket: CopyBucket | null;
  needsReview: boolean;
  steps: DraftStep[];
};

let tempIdCounter = 0;
function nextTempId(): string {
  tempIdCounter += 1;
  return `draft-${Date.now()}-${tempIdCounter}`;
}

/** Whole-days offset between a source range start and the chosen target start. */
export function offsetDaysBetween(sourceStart: string, targetStart: string): number {
  const a = new Date(sourceStart + "T00:00:00");
  const b = new Date(targetStart + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const INTENT_LABELS: Record<string, string> = {
  easy: "Easy",
  aerobic: "Aerobic",
  tempo: "Tempo",
  threshold: "Threshold",
  vo2: "VO2",
  anaerobic: "Anaerobic",
  speed: "Speed",
  recovery: "Recovery",
};

/**
 * Classification-based title for a copied/planned session — "Easy Run",
 * "Threshold Session", "Long Run" — instead of carrying forward whatever
 * the source session happened to be titled. Real session titles are often
 * auto-generated from an actual FIT upload's timestamp ("Morning Easy
 * Run"), which reads as misleading prescriptive guidance on a brand-new
 * planned session that has no actual time attached to it at all — there's
 * currently no field anywhere for a coach to specify AM/PM on an
 * individual session, only the separate squad Training Schedule has that.
 *
 * "Run" for anything continuous (easy/tempo/long/fartlek-style — no
 * discrete reps); "Session" for anything built from reps (intervals,
 * VO2/speed work, threshold reps) — a coach's own working vocabulary,
 * not a database enum, so this is derived rather than stored.
 */
export function classifiedTitle(session: any, steps: any[]): string {
  if (session.day_type === "race") return "Race";
  if (session.day_type === "cross_training") return "Cross Training";
  if (session.day_type === "rest") return "Rest";
  if (session.is_long_run) return "Long Run";

  const hasReps = (steps ?? []).some((s: any) => (s.kind === "work" || s.kind === "strides") && Number(s.reps ?? 1) > 1);
  const suffix = hasReps ? "Session" : "Run";
  const intentLabel = session.intent ? INTENT_LABELS[session.intent] : undefined;
  return intentLabel ? `${intentLabel} ${suffix}` : suffix;
}

/**
 * Builds one editable draft from a source session + its steps. Only the
 * prescription (structure/targets) copies across — actual-performance
 * fields (distance/HR/pace actually recorded, completed_at, etc.) never
 * do. A copy always lands as a fresh planned session, never a completed
 * one, regardless of whether the source session was completed.
 */
export function buildCopyDraft(session: any, steps: any[], offsetDays: number, rules: ProgressionRules): DraftSession {
  const bucket = bucketForSession(session);
  const rule = bucket ? rules[bucket] : undefined;

  const srcDate = new Date(session.session_date + "T00:00:00");
  srcDate.setDate(srcDate.getDate() + offsetDays);
  const y = srcDate.getFullYear();
  const m = String(srcDate.getMonth() + 1).padStart(2, "0");
  const d = String(srcDate.getDate()).padStart(2, "0");
  const newDate = `${y}-${m}-${d}`;

  let needsReview = false;
  const draftSteps = [...steps]
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map((s) => {
      const { step, flagged } = scaleStep(s, rule);
      if (flagged) needsReview = true;
      return step;
    });

  return {
    tempId: nextTempId(),
    sourceSessionId: session.id,
    athlete_id: session.athlete_id,
    session_date: newDate,
    title: classifiedTitle(session, steps),
    day_type: session.day_type,
    intent: session.intent ?? null,
    structure: session.structure ?? null,
    is_long_run: !!session.is_long_run,
    bucket,
    needsReview,
    steps: draftSteps,
  };
}

// ── Volume estimation, for the "current total -> target total" quick-set ──

// Same approximation pattern already used elsewhere in the app (the Plan
// Builder's browsing-only weekly-volume estimate) — a representative pace
// per bucket, used only to convert time-based work steps into a distance
// figure for comparison. Deliberately not the resolved-target pace (which
// would need each athlete's zone profile); this is a rough total for
// sizing a volume change, not a precise number.
const ASSUMED_PACE_SEC_PER_KM: Record<CopyBucket, number> = {
  easy: 330,
  long: 330,
  tempo: 255,
  threshold: 240,
  vo2: 225,
  race: 300,
};

function estimateStepsDistanceM(steps: any[], bucket: CopyBucket | null): number {
  const paceSecPerKm = bucket ? ASSUMED_PACE_SEC_PER_KM[bucket] : 0;

  return steps.reduce((sum, s) => {
    if (s.kind !== "work" && s.kind !== "strides") return sum;
    const reps = Number(s.reps ?? 1);
    if (s.target_kind === "distance" && s.target_distance_m != null) {
      return sum + Number(s.target_distance_m) * reps;
    }
    if (s.target_kind === "time" && s.target_time_seconds != null && paceSecPerKm > 0) {
      return sum + (Number(s.target_time_seconds) * reps / paceSecPerKm) * 1000;
    }
    return sum;
  }, 0);
}

/** Estimated distance (m) for one already-fetched session + its steps. */
export function estimateSessionDistanceM(session: any, steps: any[]): number {
  return estimateStepsDistanceM(steps, bucketForSession(session));
}

/** Estimated total distance (m) across a whole set of source sessions. */
export function estimateTotalDistanceM(sessions: any[], stepsBySession: Map<string, any[]>): number {
  return sessions.reduce((sum, s) => sum + estimateSessionDistanceM(s, stepsBySession.get(s.id) ?? []), 0);
}

/** Estimated distance (m) for a draft session — same math, reading its already-resolved bucket. */
export function estimateDraftDistanceM(draft: DraftSession): number {
  return estimateStepsDistanceM(draft.steps, draft.bucket);
}

function formatDraftPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function targetSuffix(s: DraftStep): string {
  if (s.target_mode === "pace" && s.target_pace_sec_per_km != null) return ` @ ${formatDraftPace(s.target_pace_sec_per_km)}`;
  if (s.target_mode === "threshold_pace_pct" && s.target_threshold_pace_pct != null)
    return ` @ ${s.target_threshold_pace_pct}% thr pace`;
  if (s.target_mode === "threshold_hr_pct" && s.target_threshold_hr_pct != null)
    return ` @ ${s.target_threshold_hr_pct}% thr HR`;
  if (s.target_mode === "zone" && s.target_zone) return ` @ ${s.target_zone.toUpperCase()}`;
  if (s.target_mode === "rpe" && s.target_rpe != null) return ` @ RPE ${s.target_rpe}`;
  return "";
}

/**
 * Compact one-line structure summary for a draft's work/strides steps —
 * "6 × 800m @ 3:45/km + 45min easy" — used in the review list so a coach
 * can actually see what's being copied (and see an edit take effect)
 * instead of just a bare title.
 */
export function summarizeDraftSteps(steps: DraftStep[]): string {
  const workSteps = steps.filter((s) => s.kind === "work" || s.kind === "strides");
  if (workSteps.length === 0) return "No work steps";

  return workSteps
    .map((s) => {
      const repsPrefix = s.reps > 1 ? `${s.reps} × ` : "";
      let amount = "";
      if (s.target_kind === "distance" && s.target_distance_m != null) {
        amount =
          s.target_distance_m >= 1000
            ? `${(s.target_distance_m / 1000).toFixed(s.target_distance_m % 1000 === 0 ? 0 : 1)}km`
            : `${s.target_distance_m}m`;
      } else if (s.target_kind === "time" && s.target_time_seconds != null) {
        amount = `${Math.round(s.target_time_seconds / 60)}min`;
      }
      return `${repsPrefix}${amount}${targetSuffix(s)}`;
    })
    .join(" + ");
}
