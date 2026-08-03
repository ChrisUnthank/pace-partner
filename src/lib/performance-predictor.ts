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
};

export type DistancePrediction = {
  label: string;
  km: number;
  timeSec: number;
  lowSec: number;
  highSec: number;
  paceSecPerKm: number;
  tier: ConfidenceTier;
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

export function predictAtDistance(input: PredictionInput, targetLabel: string, targetKm: number): DistancePrediction | null {
  const { recentDistanceKm, recentTimeSec, primaryEventKm, profile, weeklyVolumeKm, trainingAgeYears } = input;
  if (!Number.isFinite(recentDistanceKm) || recentDistanceKm <= 0 || !Number.isFinite(recentTimeSec) || recentTimeSec <= 0) return null;

  const meta = PROFILE_META[profile];
  const exponent = meta.exponent + volumeExponentDelta(targetKm, weeklyVolumeKm);
  const timeSec = recentTimeSec * Math.pow(targetKm / recentDistanceKm, exponent);

  const coreLo = primaryEventKm * Math.exp(-meta.coreHalfWidthLn);
  const coreHi = primaryEventKm * Math.exp(meta.coreHalfWidthLn);
  let excessGap = 0;
  if (targetKm > coreHi) excessGap = Math.log(targetKm / coreHi);
  else if (targetKm < coreLo) excessGap = Math.log(coreLo / targetKm);
  excessGap = Math.max(0, excessGap + trainingAgeGapAdjustment(trainingAgeYears));

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
  };
}

// ---------------------------------------------------------------------
// Future integration — NOT wired up yet, documented here so the next
// pass has a clear target rather than needing to re-derive it:
//
// - Running DNA -> could set/refine `profile` automatically instead of
//   a manual pick, from the athlete's actual event-distribution history.
// - Threshold pace (athlete_zone_profiles) -> could replace or sanity-
//   check the "recent race" input with a live, always-current anchor
//   instead of a one-off manually-entered result.
// - Weekly training volume / long run distance / training consistency /
//   recent training load -> `weeklyVolumeKm` above is the one already
//   wired; long run distance and consistency would refine the Half/
//   Marathon-specific adjustment the same volumeExponentDelta already
//   makes room for, recent load would feed a short-term form adjustment
//   this version doesn't attempt.
// - Biomechanical efficiency (Biomechanics page scores) -> a plausible
//   confidence modifier (an athlete with efficient, low-drift mechanics
//   at race pace is a more reliable extrapolation subject) — no attempt
//   made here to guess the right weighting without real data to check
//   it against.
//
// The intent is that all of these become additional optional fields on
// PredictionInput, each nudging either the exponent (real ability) or
// the confidence gap (how much to trust the extrapolation) — the same
// two knobs this version already uses for profile/volume/training age,
// not a parallel scoring system.
// ---------------------------------------------------------------------
