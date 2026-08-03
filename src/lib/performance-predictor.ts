// Performance Predictor — prediction engine (pure functions, no React/
// Supabase, same convention as race-tactics-calc.ts / race-predict.ts /
// zone-calculator.ts).
//
// THE CORE IDEA: standard Riegel (T2 = T1 x (D2/D1)^1.06) assumes every
// athlete's time scales with distance the same way — a fixed exponent
// for everyone. That's exactly why a 1500m specialist's 5K time can
// project to an implausibly fast marathon: the same math that correctly
// predicts a 3000m from their 1500m keeps extrapolating the same
// "generic" relationship all the way out to 42.2km, with nothing that
// knows a speed-biased athlete's relative pace actually fades faster
// than that as distance grows (and, in the other direction, that they
// likely have more raw speed in hand than a generic projection down to
// 800m would credit them for).
//
// The fix here is a single substitution: swap Riegel's fixed 1.06 for a
// profile-specific personal exponent, applied through the exact same
// formula. A higher exponent fades faster over distance (speed-biased);
// a lower one holds pace better over distance (endurance-biased) — and
// because it's the same formula in both directions, it automatically
// does the right thing whether projecting up (long from short) or down
// (short from long), not just one of them. Confidence is a separate
// concern layered on top: how far the target sits from the athlete's
// declared specialty, independent of which direction the number moved.

import { personalizedExponent } from "@/lib/race-predict";

export type PbPoint = { distanceKm: number; timeSec: number };

export type AthleteProfile = "speed_specialist" | "middle_distance" | "balanced" | "distance" | "road_marathon";

export const PROFILE_META: Record<AthleteProfile, { label: string; blurb: string; exponent: number; coreHalfWidthLn: number }> = {
  speed_specialist: {
    label: "Speed Specialist",
    blurb: "800m-1500m focus — fast-twitch bias, relative pace fades quickly as distance grows.",
    exponent: 1.12,
    coreHalfWidthLn: 0.55,
  },
  middle_distance: {
    label: "Middle Distance",
    blurb: "1500m-5000m focus — a real balance of speed and endurance, still speed-leaning.",
    exponent: 1.08,
    coreHalfWidthLn: 0.65,
  },
  balanced: {
    label: "Balanced",
    blurb: "No strong specialty either way — standard Riegel scaling (the same exponent this calculator always used).",
    exponent: 1.06,
    coreHalfWidthLn: 0.85,
  },
  distance: {
    label: "Distance",
    blurb: "5K-Half Marathon focus — aerobic bias, holds relative pace well as distance grows.",
    exponent: 1.04,
    coreHalfWidthLn: 0.85,
  },
  road_marathon: {
    label: "Road / Marathon",
    blurb: "Half Marathon-Marathon focus — strongly aerobic, best-supported predictions at the long end.",
    exponent: 1.02,
    coreHalfWidthLn: 0.75,
  },
};

export const PRIMARY_EVENTS = [
  { label: "800m", km: 0.8 },
  { label: "1500m", km: 1.5 },
  { label: "Mile", km: 1.60934 },
  { label: "3000m", km: 3 },
  { label: "5000m", km: 5 },
  { label: "10K", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
] as const;

export type ConfidenceTier = 5 | 4 | 3 | 2 | 1;

export const CONFIDENCE_META: Record<ConfidenceTier, { label: string; pct: number; rangePct: number }> = {
  5: { label: "Very High", pct: 95, rangePct: 1.5 },
  4: { label: "High", pct: 80, rangePct: 3 },
  3: { label: "Moderate", pct: 60, rangePct: 5 },
  2: { label: "Low", pct: 35, rangePct: 8 },
  1: { label: "Very Low", pct: 15, rangePct: 12 },
};

// How far outside the athlete's "core" specialty range (in natural-log
// km, so distance ratios rather than raw km differences) a target sits
// before confidence drops a tier. Kept as plain thresholds rather than a
// formula — these are a tuned heuristic, not a derived constant, and
// worth being able to eyeball/adjust directly.
function tierFromExcessGap(excessLnGap: number): ConfidenceTier {
  if (excessLnGap <= 0.05) return 5;
  if (excessLnGap <= 0.35) return 4;
  if (excessLnGap <= 0.65) return 3;
  if (excessLnGap <= 1.0) return 2;
  return 1;
}

export type PredictionInput = {
  recentDistanceKm: number;
  recentTimeSec: number;
  primaryEventKm: number;
  profile: AthleteProfile;
  // Both optional, both currently light-touch adjustments — see
  // predictAtDistance for exactly what each does. Reserved fields for
  // future real-data wiring (Running DNA, threshold pace, long run
  // distance, training consistency, recent load, biomechanical
  // efficiency) are documented at the bottom of this file rather than
  // added here as unused parameters — no point widening this type until
  // there's a real value to pass into it.
  weeklyVolumeKm?: number | null;
  trainingAgeYears?: number | null;
  // The athlete's real PBs across whatever distances they've actually
  // raced — grounds predictions in demonstrated ability instead of pure
  // extrapolation from a single recent race. See predictAtDistance for
  // exactly how each PB gets used (exact-match substitution,
  // bracketing-exponent grounding, or pace-monotonicity clamping).
  // Optional and additive — every existing call site without this still
  // behaves exactly as before.
  pbs?: PbPoint[] | null;
};

export type DistancePrediction = {
  label: string;
  km: number;
  timeSec: number;
  lowSec: number;
  highSec: number;
  paceSecPerKm: number;
  tier: ConfidenceTier;
  // True when this row IS an actual raced PB (within tolerance of the
  // target distance) rather than a projection — shown as a known result,
  // not a prediction, and never given a range since there's nothing to
  // estimate.
  isPb: boolean;
  // True when the exponent used came from two of the athlete's own real
  // PBs bracketing this target (via personalizedExponent), rather than
  // the profile's generic default — a materially better-grounded number,
  // reflected as a confidence boost.
  groundedByPbs: boolean;
  // Set when a raw prediction was adjusted to stay consistent with a
  // real PB at a shorter or longer distance (pace can't sensibly get
  // faster as distance increases past a point) — surfaced so the
  // adjustment is visible, not silent.
  clampNote: string | null;
};

// Long-distance-only volume adjustment — nudges the effective exponent
// slightly for targets at Half Marathon distance or beyond, where
// weekly mileage genuinely predicts aerobic durability in a way it
// doesn't for anything shorter. Deliberately small (±0.02 max on an
// exponent that's already 1.02-1.12) — volume informs the prediction,
// it doesn't override the athlete's declared profile.
function volumeExponentDelta(targetKm: number, weeklyVolumeKm: number | null | undefined): number {
  if (targetKm < 15 || weeklyVolumeKm == null || !Number.isFinite(weeklyVolumeKm) || weeklyVolumeKm <= 0) return 0;
  if (weeklyVolumeKm >= 100) return -0.02;
  if (weeklyVolumeKm >= 70) return -0.01;
  if (weeklyVolumeKm >= 40) return 0;
  if (weeklyVolumeKm >= 20) return 0.01;
  return 0.02;
}

// Training age nudges confidence very slightly — a longer training
// history means a given race result is more likely to actually reflect
// stable fitness rather than a one-off. Kept small and one-directional
// (a short training age never being used to boost confidence, only a
// long one to firm it up a little, and a very short one to soften it).
function trainingAgeGapAdjustment(trainingAgeYears: number | null | undefined): number {
  if (trainingAgeYears == null || !Number.isFinite(trainingAgeYears)) return 0;
  if (trainingAgeYears >= 3) return -0.1;
  if (trainingAgeYears < 1) return 0.15;
  return 0;
}

// A PB within this relative distance of the target counts as "this IS
// the target" rather than something to project towards — deliberately
// tight (about 3%): loose enough to unify genuinely-identical distances
// recorded under different labels (Half Marathon vs "13.1mi", 8K vs "5
// mile"), but tight enough that a real 3000m PB (7% shorter than 2
// Mile) never gets relabeled and shown AS a 2 Mile result it isn't.
const PB_EXACT_MATCH_TOLERANCE = 0.03;

function findExactPb(pbs: PbPoint[], targetKm: number): PbPoint | null {
  let best: PbPoint | null = null;
  let bestGap = Infinity;
  for (const pb of pbs) {
    const gap = Math.abs(Math.log(pb.distanceKm / targetKm));
    if (gap < bestGap) {
      bestGap = gap;
      best = pb;
    }
  }
  return best && bestGap <= PB_EXACT_MATCH_TOLERANCE ? best : null;
}

// The nearest real PB shorter than the target, and the nearest longer
// than it — the two points personalizedExponent needs to solve the
// athlete's own actual speed/endurance curve, when both exist.
function bracketingPbs(pbs: PbPoint[], targetKm: number): { shorter: PbPoint | null; longer: PbPoint | null } {
  let shorter: PbPoint | null = null;
  let longer: PbPoint | null = null;
  for (const pb of pbs) {
    if (pb.distanceKm < targetKm && (!shorter || pb.distanceKm > shorter.distanceKm)) shorter = pb;
    if (pb.distanceKm > targetKm && (!longer || pb.distanceKm < longer.distanceKm)) longer = pb;
  }
  return { shorter, longer };
}

// Pace should not sensibly get FASTER as distance increases past a real
// demonstrated result, nor SLOWER than a real result at a longer
// distance — this is what actually stops a prediction from landing
// "well above or below current ability" regardless of what the formula
// alone would say. A small buffer (2%) avoids clamping genuinely close
// calls at the boundary, only catching real violations.
//
// Deliberately checks only the NEAREST shorter/longer PB (the same pair
// bracketingPbs already finds), not every PB on file — a distant PB
// (or one with bad underlying data — see sanitizePbs) has no business
// overriding a much more locally-relevant one just because it happened
// to be the last one checked in an unweighted loop.
function clampAgainstPbs(targetKm: number, timeSec: number, pbs: PbPoint[]): { timeSec: number; note: string | null } {
  let pace = timeSec / targetKm;
  let note: string | null = null;
  const { shorter, longer } = bracketingPbs(pbs, targetKm);
  if (shorter) {
    const floorPace = (shorter.timeSec / shorter.distanceKm) * 0.98;
    if (pace < floorPace) {
      pace = floorPace;
      note = `Adjusted to stay consistent with your ${formatKmLabel(shorter.distanceKm)} PB`;
    }
  }
  if (longer) {
    const ceilPace = (longer.timeSec / longer.distanceKm) * 1.02;
    if (pace > ceilPace) {
      pace = ceilPace;
      note = `Adjusted to stay consistent with your ${formatKmLabel(longer.distanceKm)} PB`;
    }
  }
  return { timeSec: pace * targetKm, note };
}

function formatKmLabel(km: number): string {
  if (Math.abs(km - 1.60934) < 0.01) return "Mile";
  if (Math.abs(km - 21.0975) < 0.05) return "Half Marathon";
  if (Math.abs(km - 42.195) < 0.05) return "Marathon";
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km % 1 === 0 ? km : km.toFixed(1)}K`;
}

// Guards against a single bad PB (wrong units, mislabeled distance, a
// data-entry slip somewhere in the athlete's history) badly distorting
// predictions nowhere near it — a real single athlete's PBs rarely span
// more than about 3.5x in pace from fastest to slowest (sprint to
// marathon is roughly 2-2.5x for most runners); anything beyond that is
// far more likely corrupted data than a genuine result, so it's
// excluded before anything else in this file ever sees it. Applied
// once, at the top of predictAtDistance, so every downstream check
// (exact match, bracketing, clamping) already sees the cleaned list.
export function sanitizePbs(pbs: PbPoint[] | null | undefined): PbPoint[] {
  const valid = (pbs ?? []).filter(
    (p) => Number.isFinite(p.distanceKm) && p.distanceKm > 0 && Number.isFinite(p.timeSec) && p.timeSec > 0,
  );
  if (valid.length === 0) return [];
  const fastestPace = Math.min(...valid.map((p) => p.timeSec / p.distanceKm));
  return valid.filter((p) => p.timeSec / p.distanceKm <= fastestPace * 3.5);
}

export function predictAtDistance(input: PredictionInput, targetLabel: string, targetKm: number): DistancePrediction | null {
  const { recentDistanceKm, recentTimeSec, primaryEventKm, profile, weeklyVolumeKm, trainingAgeYears } = input;
  if (!Number.isFinite(recentDistanceKm) || recentDistanceKm <= 0 || !Number.isFinite(recentTimeSec) || recentTimeSec <= 0) return null;

  const pbs = sanitizePbs(input.pbs);

  // A real PB at (or essentially at) this exact distance beats any
  // projection — show what actually happened, not an estimate of it.
  const exact = findExactPb(pbs, targetKm);
  if (exact) {
    return {
      label: targetLabel,
      km: targetKm,
      timeSec: exact.timeSec,
      lowSec: exact.timeSec,
      highSec: exact.timeSec,
      paceSecPerKm: exact.timeSec / exact.distanceKm,
      tier: 5,
      isPb: true,
      groundedByPbs: true,
      clampNote: null,
    };
  }

  const meta = PROFILE_META[profile];
  let exponent = meta.exponent + volumeExponentDelta(targetKm, weeklyVolumeKm);
  let groundedByPbs = false;

  // Two real PBs bracketing the target solve the athlete's own actual
  // curve directly (personalizedExponent, already built for exactly
  // this) — a strictly better source for the exponent than the
  // profile's generic guess, so it takes over whenever both sides exist.
  const { shorter, longer } = bracketingPbs(pbs, targetKm);
  if (shorter && longer) {
    const personal = personalizedExponent(shorter.timeSec, shorter.distanceKm, longer.timeSec, longer.distanceKm);
    if (personal != null) {
      exponent = personal + volumeExponentDelta(targetKm, weeklyVolumeKm);
      groundedByPbs = true;
    }
  }

  // Project from whichever single point — the manually-entered recent
  // race, or the closest available PB — sits nearer the target, so a
  // long-buried recent-race entry doesn't out-rank a much closer, more
  // relevant PB when only one-sided PB data exists (no bracket to solve
  // a personalized exponent from, but still a better anchor to project
  // from than a distant recent race).
  let anchorKm = recentDistanceKm;
  let anchorTimeSec = recentTimeSec;
  const closestPb = [shorter, longer].filter((p): p is PbPoint => p != null).sort(
    (a, b) => Math.abs(Math.log(a.distanceKm / targetKm)) - Math.abs(Math.log(b.distanceKm / targetKm)),
  )[0];
  if (closestPb && Math.abs(Math.log(closestPb.distanceKm / targetKm)) < Math.abs(Math.log(recentDistanceKm / targetKm))) {
    anchorKm = closestPb.distanceKm;
    anchorTimeSec = closestPb.timeSec;
  }

  let timeSec = anchorTimeSec * Math.pow(targetKm / anchorKm, exponent);

  const clamped = clampAgainstPbs(targetKm, timeSec, pbs);
  timeSec = clamped.timeSec;

  const coreLo = primaryEventKm * Math.exp(-meta.coreHalfWidthLn);
  const coreHi = primaryEventKm * Math.exp(meta.coreHalfWidthLn);
  let excessGap = 0;
  if (targetKm > coreHi) excessGap = Math.log(targetKm / coreHi);
  else if (targetKm < coreLo) excessGap = Math.log(coreLo / targetKm);
  excessGap = Math.max(0, excessGap + trainingAgeGapAdjustment(trainingAgeYears) - (groundedByPbs ? 0.3 : 0));

  const tier = tierFromExcessGap(excessGap);
  const rangePct = CONFIDENCE_META[tier].rangePct;

  return {
    label: targetLabel,
    km: targetKm,
    timeSec,
    lowSec: timeSec * (1 - rangePct / 100),
    highSec: timeSec * (1 + rangePct / 100),
    paceSecPerKm: timeSec / targetKm,
    tier,
    isPb: false,
    groundedByPbs,
    clampNote: clamped.note,
  };
}

// ---------------------------------------------------------------------
// Future integration — PBs (all of them, across every distance the
// athlete's raced) are wired up now via `pbs` on PredictionInput; the
// rest below is still NOT wired up, documented here so the next pass
// has a clear target rather than needing to re-derive it:
//
// - Running DNA -> could set/refine `profile` automatically instead of
//   a manual pick, from the athlete's actual event-distribution history.
// - Threshold pace (athlete_zone_profiles) -> could replace or sanity-
//   check the "recent race" input with a live, always-current anchor
//   instead of a one-off manually-entered result.
// - Long run distance / training consistency / recent training load ->
//   `weeklyVolumeKm` is wired; long run distance and consistency would
//   refine the Half/Marathon-specific adjustment the same
//   volumeExponentDelta already makes room for, recent load would feed
//   a short-term form adjustment this version doesn't attempt.
// - Biomechanical efficiency (Biomechanics page scores) -> a plausible
//   confidence modifier (an athlete with efficient, low-drift mechanics
//   at race pace is a more reliable extrapolation subject) — no attempt
//   made here to guess the right weighting without real data to check
//   it against.
//
// The intent is that each of these still nudges one of the same two
// knobs this version already uses — the exponent (real ability) or the
// confidence gap (how much to trust the extrapolation) — not a parallel
// scoring system, the same pattern PBs themselves just followed.
// ---------------------------------------------------------------------
