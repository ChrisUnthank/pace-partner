/**
 * What RPE and feel are saying over time.
 *
 * THE PROBLEM WITH RAW RPE
 *
 * Averaging RPE across a week is close to meaningless. An easy run at 3 and a
 * VO2 session at 8 average to 5.5, and that number moves with the SHAPE of
 * the week rather than with how the athlete is coping — a week with two hard
 * sessions instead of one "rises" without anything having changed.
 *
 * So the unit here is the DELTA: what the session was rated, minus what a
 * session of that type would normally be rated. An easy run at 3 scores 0. The
 * same easy run at 6 scores +3, and that is worth a coach's attention however
 * many hard days sat around it.
 *
 * The expected values are the same ones session_training_load already falls
 * back to when no RPE is logged. Reused rather than restated, so the estimate
 * a session gets without RPE and the baseline it is judged against afterwards
 * cannot drift apart.
 *
 *
 * WHY HEALTH EVENTS ARE MARKED RATHER THAN DROPPED
 *
 * Effort rises and feel falls when someone is ill. That is real data and
 * deleting it would be dishonest — but reading it as accumulated training
 * fatigue would be worse, because the response to those two is opposite: back
 * off the training, or wait for the illness to pass.
 *
 * Affected days are therefore kept, marked, and excluded from the BASELINE
 * the trend is measured against. The trend can then say "effort is up, and
 * these were the days he was unwell" instead of quietly blaming the training.
 */

/** What a session of each type is normally rated. Mirrors session_training_load. */
export const EXPECTED_RPE_BY_INTENT: Record<string, number> = {
  easy: 3,
  aerobic: 5,
  tempo: 6,
  threshold: 7,
  vo2: 8,
  anaerobic: 8,
  speed: 8,
};

export const EXPECTED_RPE_BY_DAY_TYPE: Record<string, number> = {
  race: 9,
  recovery: 2,
  cross_training: 4,
  rest: 0,
};

const FALLBACK_EXPECTED_RPE = 4;

export function expectedRpe(intent?: string | null, dayType?: string | null): number {
  if (dayType && dayType !== "training" && EXPECTED_RPE_BY_DAY_TYPE[dayType] !== undefined) {
    return EXPECTED_RPE_BY_DAY_TYPE[dayType];
  }
  if (intent && EXPECTED_RPE_BY_INTENT[intent] !== undefined) return EXPECTED_RPE_BY_INTENT[intent];
  return FALLBACK_EXPECTED_RPE;
}

export interface RpeSession {
  session_date: string;
  rpe?: number | null;
  feel?: number | null;
  intent?: string | null;
  day_type?: string | null;
  /** Marked by the caller from the athlete's injury/illness records. */
  health_affected?: boolean;
}

export interface RpeWeek {
  /** Monday of the week, ISO. */
  weekStart: string;
  sessions: number;
  rated: number;
  /** Mean of (actual - expected). Positive means harder than the type suggests. */
  meanDelta: number | null;
  meanRpe: number | null;
  meanFeel: number | null;
  /** How many of the rated sessions fell on a day with an active health record. */
  healthAffected: number;
  /** True when health-affected days are enough of the week to distort it. */
  healthDominated: boolean;
}

export interface RpeTrend {
  weeks: RpeWeek[];
  /**
   * Change in mean delta from the baseline weeks to the most recent one.
   * Null when there is not enough clean data to compare.
   */
  deltaChange: number | null;
  baselineWeeks: number;
  /** Weeks excluded from the baseline because illness or injury distorted them. */
  excludedWeeks: number;
  direction: "rising" | "falling" | "steady" | "unknown";
  /** Plain statement of what can and cannot be concluded. */
  note: string;
}

/** Monday of the week containing an ISO date. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = ((d.getUTCDay() + 6) % 7); // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * A week is "health dominated" once this share of its rated sessions fall on
 * days with an active record. Half, because at that point the week's average
 * says more about the illness than the training and using it as a baseline
 * would drag the comparison toward whatever being unwell felt like.
 */
const HEALTH_DOMINATED_SHARE = 0.5;

/** Below this, a week has too few rated sessions to mean anything. */
const MIN_RATED_PER_WEEK = 2;

/** How much mean delta must move before it is called a change rather than noise. */
const MEANINGFUL_DELTA = 0.5;

export function buildRpeWeeks(sessions: RpeSession[]): RpeWeek[] {
  const byWeek = new Map<string, RpeSession[]>();
  for (const s of sessions ?? []) {
    if (!s?.session_date) continue;
    const wk = weekStartOf(s.session_date);
    const list = byWeek.get(wk) ?? [];
    list.push(s);
    byWeek.set(wk, list);
  }

  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, rows]) => {
      const rated = rows.filter((r) => r.rpe != null);
      const deltas = rated.map((r) => Number(r.rpe) - expectedRpe(r.intent, r.day_type));
      const feels = rows.map((r) => r.feel).filter((f): f is number => f != null);
      const affected = rated.filter((r) => r.health_affected).length;

      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

      return {
        weekStart,
        sessions: rows.length,
        rated: rated.length,
        meanDelta: deltas.length ? Number(mean(deltas)!.toFixed(2)) : null,
        meanRpe: rated.length ? Number(mean(rated.map((r) => Number(r.rpe)))!.toFixed(2)) : null,
        meanFeel: feels.length ? Number(mean(feels)!.toFixed(2)) : null,
        healthAffected: affected,
        healthDominated: rated.length > 0 && affected / rated.length >= HEALTH_DOMINATED_SHARE,
      };
    });
}

/**
 * Compares the most recent usable week against the weeks before it.
 *
 * Deliberately conservative. It reports "unknown" freely, because a coach
 * acting on a spurious "effort is rising" is worse off than one told there is
 * not enough to say — and with a few weeks of data that is usually the truth.
 */
export function analyseRpeTrend(sessions: RpeSession[]): RpeTrend {
  const weeks = buildRpeWeeks(sessions);

  const usable = weeks.filter((w) => w.rated >= MIN_RATED_PER_WEEK && w.meanDelta != null);
  const clean = usable.filter((w) => !w.healthDominated);
  const excludedWeeks = usable.length - clean.length;

  if (clean.length < 2) {
    return {
      weeks,
      deltaChange: null,
      baselineWeeks: 0,
      excludedWeeks,
      direction: "unknown",
      note:
        excludedWeeks > 0
          ? `Not enough weeks unaffected by illness or injury to compare — ${excludedWeeks} of ${usable.length} were.`
          : "Needs at least two weeks with two or more rated sessions each.",
    };
  }

  const latest = clean[clean.length - 1];
  const baseline = clean.slice(0, -1);
  const baselineMean =
    baseline.reduce((a, w) => a + (w.meanDelta ?? 0), 0) / baseline.length;

  const change = Number(((latest.meanDelta ?? 0) - baselineMean).toFixed(2));

  const direction =
    Math.abs(change) < MEANINGFUL_DELTA ? "steady" : change > 0 ? "rising" : "falling";

  // Stated as an observation, not a diagnosis. Rising effort at similar
  // training is ONE explanation among several — heat, sleep, exams, a hard
  // week at work — and the data cannot separate them.
  const note =
    direction === "rising"
      ? `Sessions are being rated ${change.toFixed(1)} higher than usual for their type, against the previous ${baseline.length} week${baseline.length === 1 ? "" : "s"}.`
      : direction === "falling"
        ? `Sessions are being rated ${Math.abs(change).toFixed(1)} lower than usual for their type — the same work feeling easier.`
        : "Effort is tracking about where it usually does for these session types.";

  return {
    weeks,
    deltaChange: change,
    baselineWeeks: baseline.length,
    excludedWeeks,
    direction,
    note:
      excludedWeeks > 0
        ? `${note} ${excludedWeeks} week${excludedWeeks === 1 ? "" : "s"} excluded — illness or injury.`
        : note,
  };
}
