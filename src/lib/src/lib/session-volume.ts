/**
 * How far and how long a planned session actually is.
 *
 * ONE implementation, because there were four and they disagreed.
 *
 *   calendar-copy.ts    estimateStepsDistanceM — work/strides steps only,
 *                       ignores set_count, ignores recovery
 *   plan-progression.ts estimateTemplateSessionDistanceM — same, separate copy
 *   app.plans.tsx       a third local copy of the same function; a bug fixed
 *                       here (recovery steps inflating the total) was never
 *                       carried back to the other two
 *   yearly-load-strip   counts ALL steps and DOES apply set_count, but never
 *                       converts a time target to distance
 *
 * They cannot all be right, and for the campaign fill it matters which:
 * campaign baselines are stated as total weekly kilometres, and
 * get_campaign_actuals measures SUM(sessions.total_distance_m) — everything
 * the athlete actually ran. A work-only estimate compared against either is
 * comparing two different quantities.
 *
 * The size of that gap is not small. A threshold session of 5 x 1km reads as
 * 5 km on a work-only estimate and is nearer 11 km on the road once warmup,
 * recovery jogs and cooldown are counted. A plan built to "match" a 60 km
 * campaign week on work-only numbers would put the athlete well over it.
 *
 *
 * WHAT COUNTS
 *
 * Every step whose counts_toward_distance is not explicitly false, times
 * reps x set_count, plus the recovery between reps and between sets. The
 * steps table already carries counts_toward_distance for exactly this
 * decision, so it is read rather than a step kind being guessed at.
 *
 * This is deliberately NOT the same rule as the Biomechanics scoring, which
 * excludes recovery jogs. That exclusion is right for measuring how an
 * athlete moves and wrong for measuring how far they went — a recovery jog
 * is distance on the legs whether or not it is worth scoring.
 *
 *
 * WHAT IS ESTIMATED
 *
 * A time-based target has no distance until someone assumes a pace. The
 * assumed paces below are coarse and shared across athletes on purpose: this
 * is for sizing a week, not predicting a performance. Every return value
 * reports how many metres came from a pace assumption so the UI can say so
 * rather than presenting a guess as a measurement.
 */

// ---------------------------------------------------------------------------
// Assumed paces, seconds per km.
//
// Carried over unchanged from the three existing copies so this does not
// silently move any number that is already on screen. Recovery is assumed at
// easy pace regardless of the work it sits between — a jog between reps is a
// jog, not a slower version of the interval.
// ---------------------------------------------------------------------------
export const ASSUMED_PACE_SEC_PER_KM: Record<string, number> = {
  easy: 330,
  long: 330,
  aerobic: 330,
  recovery: 360,
  tempo: 255,
  threshold: 240,
  vo2: 225,
  anaerobic: 210,
  speed: 200,
  strides: 200,
  race: 300,
  cross_train: 0,
  cross_training: 0,
  rest: 0,
};

const RECOVERY_PACE_SEC_PER_KM = 360;
const FALLBACK_PACE_SEC_PER_KM = 300;

export function assumedPaceSecPerKm(key: string | null | undefined): number {
  if (!key) return FALLBACK_PACE_SEC_PER_KM;
  const v = ASSUMED_PACE_SEC_PER_KM[key];
  return v === undefined ? FALLBACK_PACE_SEC_PER_KM : v;
}

export interface SessionVolume {
  /** Distance from steps that are the point of the session. */
  workM: number;
  /** Warmup, cooldown and recovery — real distance, not the point of it. */
  supportM: number;
  totalM: number;
  totalSeconds: number;
  /**
   * How much of totalM came from converting a time target at an assumed pace.
   * Zero means every metre was explicitly prescribed.
   */
  estimatedFromTimeM: number;
  /** True when nothing in this session carried a usable target at all. */
  isEmpty: boolean;
}

const EMPTY: SessionVolume = {
  workM: 0,
  supportM: 0,
  totalM: 0,
  totalSeconds: 0,
  estimatedFromTimeM: 0,
  isEmpty: true,
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Multiplier of one step: how many times its target is actually performed. */
function repetitions(step: any): number {
  const reps = Math.max(1, Math.floor(num(step?.reps, 1) || 1));
  const sets = Math.max(1, Math.floor(num(step?.set_count, 1) || 1));
  return reps * sets;
}

/**
 * Distance and time contributed by the recovery attached to a step.
 *
 * Between reps: happens reps-1 times per set — an athlete does not jog after
 * the last rep of a set, they move to the between-sets recovery or finish.
 * Between sets: happens sets-1 times.
 *
 * Two representations exist in the steps table and both are read: the
 * explicit recovery_target_kind/_distance_m/_seconds pair, and the older
 * recovery_between_reps_seconds / recovery_between_sets_seconds. The explicit
 * one wins where present.
 */
function recoveryVolume(step: any): { m: number; seconds: number; estimatedM: number } {
  const reps = Math.max(1, Math.floor(num(step?.reps, 1) || 1));
  const sets = Math.max(1, Math.floor(num(step?.set_count, 1) || 1));
  const betweenRepsCount = Math.max(0, reps - 1) * sets;
  const betweenSetsCount = Math.max(0, sets - 1);

  let m = 0;
  let seconds = 0;
  let estimatedM = 0;

  // Between reps.
  const recKind = step?.recovery_target_kind;
  const recDist = num(step?.recovery_target_distance_m);
  const recSecs = num(step?.recovery_target_seconds);
  const legacyRepSecs = num(step?.recovery_between_reps_seconds);

  if (recKind === "distance" && recDist > 0) {
    m += recDist * betweenRepsCount;
    seconds += (recDist / 1000) * RECOVERY_PACE_SEC_PER_KM * betweenRepsCount;
  } else if (recSecs > 0 || legacyRepSecs > 0) {
    const s = (recSecs > 0 ? recSecs : legacyRepSecs) * betweenRepsCount;
    const dist = (s / RECOVERY_PACE_SEC_PER_KM) * 1000;
    m += dist;
    estimatedM += dist;
    seconds += s;
  }

  // Between sets.
  const setSecs = num(step?.recovery_between_sets_seconds);
  if (setSecs > 0 && betweenSetsCount > 0) {
    const s = setSecs * betweenSetsCount;
    const dist = (s / RECOVERY_PACE_SEC_PER_KM) * 1000;
    m += dist;
    estimatedM += dist;
    seconds += s;
  }

  return { m, seconds, estimatedM };
}

/**
 * The volume of one session's steps.
 *
 * `paceKey` picks the assumed pace for time-based work targets — pass the
 * session's bucket, intent, or a template day's effort_type; they share a
 * vocabulary closely enough that one map serves all three, and an unknown key
 * falls back rather than throwing.
 */
export function estimateStepsVolume(steps: any[] | null | undefined, paceKey?: string | null): SessionVolume {
  if (!steps || steps.length === 0) return { ...EMPTY };

  const workPace = assumedPaceSecPerKm(paceKey);
  let workM = 0;
  let supportM = 0;
  let totalSeconds = 0;
  let estimatedFromTimeM = 0;
  let sawAnything = false;

  for (const step of steps) {
    if (!step) continue;
    // The database's own answer to "does this count", not a guess from kind.
    if (step.counts_toward_distance === false) continue;

    const mult = repetitions(step);
    const isWork = step.kind === "work" || step.kind === "strides";
    // Warmup and cooldown are usually easy running whatever the session is.
    const pace = isWork ? workPace : assumedPaceSecPerKm("easy");

    const dist = num(step.target_distance_m);
    const secs = num(step.target_time_seconds);

    let stepM = 0;
    if (dist > 0) {
      stepM = dist * mult;
      totalSeconds += pace > 0 ? (dist / 1000) * pace * mult : 0;
      sawAnything = true;
    } else if (secs > 0) {
      totalSeconds += secs * mult;
      sawAnything = true;
      if (pace > 0) {
        stepM = (secs / pace) * 1000 * mult;
        estimatedFromTimeM += stepM;
      }
    }

    if (isWork) workM += stepM;
    else supportM += stepM;

    const rec = recoveryVolume(step);
    if (rec.m > 0 || rec.seconds > 0) {
      supportM += rec.m;
      totalSeconds += rec.seconds;
      estimatedFromTimeM += rec.estimatedM;
      sawAnything = true;
    }
  }

  const totalM = workM + supportM;
  return {
    workM,
    supportM,
    totalM,
    totalSeconds,
    estimatedFromTimeM,
    isEmpty: !sawAnything,
  };
}

/** Sums several sessions' volumes into one. */
export function sumVolumes(volumes: SessionVolume[]): SessionVolume {
  if (!volumes || volumes.length === 0) return { ...EMPTY };
  const out = volumes.reduce<SessionVolume>(
    (acc, v) => ({
      workM: acc.workM + (v?.workM ?? 0),
      supportM: acc.supportM + (v?.supportM ?? 0),
      totalM: acc.totalM + (v?.totalM ?? 0),
      totalSeconds: acc.totalSeconds + (v?.totalSeconds ?? 0),
      estimatedFromTimeM: acc.estimatedFromTimeM + (v?.estimatedFromTimeM ?? 0),
      isEmpty: acc.isEmpty && (v?.isEmpty ?? true),
    }),
    { ...EMPTY },
  );
  return out;
}

/**
 * Prefers a session's own recorded totals over an estimate from its steps.
 *
 * A session that has been completed, or had its totals set explicitly, knows
 * its real distance — estimating it from the plan would replace a measurement
 * with a guess. Same precedence yearly-load-strip.tsx already uses.
 */
export function estimateSessionVolume(
  session: { total_distance_m?: number | null; total_time_seconds?: number | null } | null | undefined,
  steps: any[] | null | undefined,
  paceKey?: string | null,
): SessionVolume {
  const recordedM = num(session?.total_distance_m);
  const recordedS = num(session?.total_time_seconds);
  if (recordedM > 0 || recordedS > 0) {
    return {
      workM: recordedM,
      supportM: 0,
      totalM: recordedM,
      totalSeconds: recordedS,
      estimatedFromTimeM: 0,
      isEmpty: recordedM <= 0 && recordedS <= 0,
    };
  }
  return estimateStepsVolume(steps, paceKey);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatKm(metres: number, digits = 1): string {
  const km = num(metres) / 1000;
  return `${km.toFixed(digits)} km`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(num(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/**
 * How far off a target a volume is, as a percentage, or null when there is no
 * target to compare against. Positive is over.
 */
export function volumeDeltaPct(actualM: number, targetM: number): number | null {
  const t = num(targetM);
  if (t <= 0) return null;
  return (num(actualM) / t - 1) * 100;
}
