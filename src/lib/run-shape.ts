/**
 * The SHAPE of a continuous run — did the pace rise, fall, or hold?
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not decide whether a rising pace was intended. It cannot: a
 * deliberate negative split, going out too conservatively, and a tempo that
 * got away from someone all produce the same trace. Nothing in the data
 * distinguishes them, and a module that claimed to would be inventing intent.
 *
 * So this measures and reports, and the question of intent is answered by a
 * person — either through what was prescribed (a step carrying both a start
 * and an end pace asked for a build) or by someone saying so afterwards.
 *
 * `looksProgressive` means "pronounced enough to be worth asking about", not
 * "this was a progression run". The distinction matters because the flag's
 * only job is deciding whether to put the question to a human.
 */

export interface ShapeSegment {
  index: number;
  distanceM: number;
  seconds: number;
  paceSecPerKm: number;
}

export interface RunShape {
  segments: ShapeSegment[];
  firstHalfPaceSecPerKm: number | null;
  secondHalfPaceSecPerKm: number | null;
  /**
   * How much faster the second half was, as a percentage. Positive means the
   * run got quicker. Null when there is not enough to compare.
   */
  negativeSplitPct: number | null;
  /** Segment-to-segment transitions that got faster, out of segments-1. */
  fasterTransitions: number;
  totalTransitions: number;
  /**
   * Pronounced enough that classification would otherwise read it as a
   * workout, and therefore worth asking a person about. NOT a claim that the
   * run was progressive by design.
   */
  looksProgressive: boolean;
  basis: "measured" | "insufficient";
}

/** A point far enough along to place in a segment. */
export interface ShapePoint {
  /** Cumulative metres from the start of the run. */
  distanceM: number;
  /** Cumulative seconds from the start of the run. */
  elapsedS: number;
}

const EMPTY: RunShape = {
  segments: [],
  firstHalfPaceSecPerKm: null,
  secondHalfPaceSecPerKm: null,
  negativeSplitPct: null,
  fasterTransitions: 0,
  totalTransitions: 0,
  looksProgressive: false,
  basis: "insufficient",
};

/**
 * Below this a run is too short for its shape to mean anything — the first
 * kilometre of any run is slower while someone settles in, and on a 3km jog
 * that alone would read as a progression.
 */
const MIN_DISTANCE_M = 5000;

/**
 * How much faster the second half must be before the question is worth
 * asking. Ordinary easy runs commonly drift 1-3% quicker as someone warms up;
 * a deliberate build is a different order of magnitude.
 */
const PROGRESSIVE_SPLIT_PCT = 5;

/**
 * Splits a run into equal-DISTANCE segments and measures the pace of each.
 *
 * Distance rather than time on purpose. A progression run covers more ground
 * in its later minutes, so equal-time segments would put more of the fast
 * running into fewer segments and understate the build.
 */
export function measureRunShape(points: ShapePoint[], segmentCount = 4): RunShape {
  if (!points || points.length < 2 || segmentCount < 2) return { ...EMPTY };

  const clean = points
    .filter((p) => p && Number.isFinite(p.distanceM) && Number.isFinite(p.elapsedS))
    .sort((a, b) => a.distanceM - b.distanceM);
  if (clean.length < 2) return { ...EMPTY };

  const startD = clean[0].distanceM;
  const startT = clean[0].elapsedS;
  const totalD = clean[clean.length - 1].distanceM - startD;
  const totalT = clean[clean.length - 1].elapsedS - startT;
  if (!(totalD >= MIN_DISTANCE_M) || !(totalT > 0)) return { ...EMPTY };

  const segLength = totalD / segmentCount;
  const segments: ShapeSegment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const from = startD + segLength * i;
    const to = startD + segLength * (i + 1);
    const tFrom = interpolateElapsed(clean, from);
    const tTo = interpolateElapsed(clean, to);
    if (tFrom == null || tTo == null) return { ...EMPTY };
    const seconds = tTo - tFrom;
    if (!(seconds > 0)) return { ...EMPTY };
    segments.push({
      index: i,
      distanceM: segLength,
      seconds,
      paceSecPerKm: (seconds / segLength) * 1000,
    });
  }

  const half = Math.floor(segmentCount / 2);
  const firstHalf = segments.slice(0, half);
  const secondHalf = segments.slice(segmentCount - half);
  const paceOf = (segs: ShapeSegment[]) => {
    const d = segs.reduce((a, s) => a + s.distanceM, 0);
    const t = segs.reduce((a, s) => a + s.seconds, 0);
    return d > 0 ? (t / d) * 1000 : null;
  };
  const firstHalfPace = paceOf(firstHalf);
  const secondHalfPace = paceOf(secondHalf);

  // A LOWER pace figure is faster, so the sign is flipped deliberately: a
  // positive negativeSplitPct means the run sped up.
  const negativeSplitPct =
    firstHalfPace != null && secondHalfPace != null && firstHalfPace > 0
      ? ((firstHalfPace - secondHalfPace) / firstHalfPace) * 100
      : null;

  let fasterTransitions = 0;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].paceSecPerKm < segments[i - 1].paceSecPerKm) fasterTransitions++;
  }
  const totalTransitions = segments.length - 1;

  // Both conditions, because either alone misreads a common case. A big
  // negative split with one flat-out final segment is a kick, not a build.
  // A tidy monotonic sequence of 1% steps is someone warming up.
  const looksProgressive =
    negativeSplitPct != null &&
    negativeSplitPct >= PROGRESSIVE_SPLIT_PCT &&
    fasterTransitions >= Math.ceil(totalTransitions / 2);

  return {
    segments,
    firstHalfPaceSecPerKm: firstHalfPace,
    secondHalfPaceSecPerKm: secondHalfPace,
    negativeSplitPct,
    fasterTransitions,
    totalTransitions,
    looksProgressive,
    basis: "measured",
  };
}

/** Elapsed seconds at a given cumulative distance, linearly interpolated. */
function interpolateElapsed(sorted: ShapePoint[], distanceM: number): number | null {
  if (sorted.length === 0) return null;
  if (distanceM <= sorted[0].distanceM) return sorted[0].elapsedS;
  const last = sorted[sorted.length - 1];
  if (distanceM >= last.distanceM) return last.elapsedS;

  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].distanceM <= distanceM) lo = mid;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  const span = b.distanceM - a.distanceM;
  if (!(span > 0)) return a.elapsedS;
  const frac = (distanceM - a.distanceM) / span;
  return a.elapsedS + (b.elapsedS - a.elapsedS) * frac;
}

/**
 * A prescribed build: a step carrying both a start and an end pace.
 *
 * This is the OTHER source of intent, and the more reliable one — it was
 * written down before the run happened rather than recalled afterwards.
 */
export function stepPrescribesProgression(step: any): boolean {
  const start = Number(step?.target_pace_sec_per_km);
  const end = Number(step?.target_pace_end_sec_per_km);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start <= 0 || end <= 0) return false;
  // End must be genuinely faster. Equal values mean steady, and an end pace
  // SLOWER than the start is a fade — which some coaches do prescribe, but it
  // is not what suppresses the workout split, so it is not claimed here.
  return end < start;
}

export type ProgressionIntent = "intended" | "not_intended" | null;

/**
 * Whether to put the question to a person.
 *
 * Deliberately silent in three cases: when a prescription already answers it,
 * when someone has answered before (including "no" — asking again would make
 * the answer worthless), and when the shape is not pronounced enough for the
 * answer to change anything.
 */
export function shouldAskAboutProgression(
  shape: RunShape,
  recordedIntent: ProgressionIntent,
  prescribed: boolean,
): boolean {
  if (prescribed) return false;
  if (recordedIntent != null) return false;
  return shape.looksProgressive;
}
