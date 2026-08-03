// Zone Calculator — calculation engine (pure functions, no React/Supabase,
// same convention as race-tactics-calc.ts and race-predict.ts).
//
// Architecture: every method's only job is to produce ONE canonical anchor —
// thresholdPaceSecPerKm for pace-based methods, thresholdHrBpm for HR-based
// ones. A single shared band model then turns that anchor into the same six
// named zones (Recovery/Endurance/Tempo/Threshold/VO2 Max/Anaerobic) for
// every method, which is what makes "compare three methods side by side"
// mean something — they're all read off the same ruler, just anchored at a
// different point by each method's own math. This mirrors how
// ZoneBoundariesCard itself already works: many ways to arrive at a
// threshold value, one zone formula from threshold.
//
// IMPORTANT: this is a *preview* model — genuinely useful for comparing
// methods against each other, but the actual persisted Z1-Z6 boundaries
// (after "Save to Zone Boundaries") are computed by the app's existing
// set_pace_threshold_manual / set_hr_threshold_manual database functions,
// which this deliberately does not try to reverse-engineer or duplicate.
// Saving hands the computed threshold value off to those exact same
// functions a coach would otherwise call by typing a threshold in by hand
// on Zone Boundaries — so the real, persisted zones always come from the
// app's one actual source of truth, not a client-side approximation of it.

import { predictPaceAt } from "@/lib/race-predict";

export type ZoneMethod =
  | "daniels_vdot"
  | "recent_race"
  | "threshold_pace"
  | "critical_speed"
  | "mas"
  | "karvonen"
  | "threshold_hr"
  | "pct_max_hr";

export type ZoneBasis = "pace" | "hr";

export const METHOD_META: Record<
  ZoneMethod,
  { label: string; basis: ZoneBasis; blurb: string; bestFor: string }
> = {
  daniels_vdot: {
    label: "Daniels VDOT",
    basis: "pace",
    blurb: "Jack Daniels' VDOT model — one fitness number driving every training pace.",
    bestFor: "Best when you already know (or have just raced to establish) a current VDOT.",
  },
  recent_race: {
    label: "Recent Race Result",
    basis: "pace",
    blurb: "Predicts threshold pace from any recent race, using the same Riegel formula as the Pace Predictor.",
    bestFor: "Best straight after a race — the most direct, least assumption-laden pace method.",
  },
  threshold_pace: {
    label: "Threshold Pace",
    basis: "pace",
    blurb: "Enter a known threshold pace directly — from a lab test, a time trial, or a coach's judgement.",
    bestFor: "Best when threshold pace is already known with confidence and doesn't need deriving.",
  },
  critical_speed: {
    label: "Critical Speed",
    basis: "pace",
    blurb: "The classic two-time-trial Critical Speed test (CS = distance difference ÷ time difference).",
    bestFor: "Best for a physiologically grounded threshold estimate from two all-out efforts of different lengths.",
  },
  mas: {
    label: "Maximum Aerobic Speed (MAS)",
    basis: "pace",
    blurb: "Anchors everything off your maximum aerobic (≈vVO2max) speed rather than threshold directly.",
    bestFor: "Best for athletes who've done a MAS/VAM-Eval-style test and train off %MAS.",
  },
  karvonen: {
    label: "Karvonen (Heart Rate Reserve)",
    basis: "hr",
    blurb: "Uses resting + max HR to compute Heart Rate Reserve, the classic %HRR zone model.",
    bestFor: "Best when resting HR is known and tracked — more individualised than %HRmax alone.",
  },
  threshold_hr: {
    label: "Threshold Heart Rate (Joe Friel)",
    basis: "hr",
    blurb: "Enter a known lactate-threshold HR directly — Friel's published %LTHR zone bands.",
    bestFor: "Best when threshold HR is already known from a field test (e.g. a 30-minute time trial).",
  },
  pct_max_hr: {
    label: "% Maximum Heart Rate",
    basis: "hr",
    blurb: "The simplest HR model — zones as a percentage of max HR alone.",
    bestFor: "Best as a rough starting point when only max HR is known, nothing else.",
  },
};

export type ZoneRow = { key: string; name: string; low: number; high: number | null };

// ---------------------------------------------------------------------
// Shared band models — the "one ruler" every method's anchor gets read
// against. Pace bands are multipliers on threshold PACE (sec/km) — a
// smaller multiplier is a FASTER pace, so a band's "low" (fast) edge
// uses its lower multiplier and "high" (slow) edge uses its higher one.
// HR bands are % of threshold HR, ascending the normal way.
// ---------------------------------------------------------------------

const PACE_BANDS: { key: string; name: string; lowMult: number; highMult: number | null }[] = [
  { key: "recovery", name: "Recovery", lowMult: 1.5, highMult: null },
  { key: "endurance", name: "Endurance", lowMult: 1.3, highMult: 1.5 },
  { key: "tempo", name: "Tempo", lowMult: 1.04, highMult: 1.3 },
  { key: "threshold", name: "Threshold", lowMult: 0.97, highMult: 1.04 },
  { key: "vo2max", name: "VO₂ Max", lowMult: 0.9, highMult: 0.97 },
  { key: "anaerobic", name: "Anaerobic", lowMult: 0.8, highMult: 0.9 },
];

// Friel's published %LTHR (lactate-threshold heart rate) zone bands —
// the same well-known model cited directly by the Threshold HR method,
// reused here as the shared band for every HR-based method so they stay
// comparable to each other.
const HR_BANDS: { key: string; name: string; lowPct: number; highPct: number | null }[] = [
  { key: "recovery", name: "Recovery", lowPct: 0, highPct: 81 },
  { key: "endurance", name: "Endurance", lowPct: 81, highPct: 89 },
  { key: "tempo", name: "Tempo", lowPct: 90, highPct: 93 },
  { key: "threshold", name: "Threshold", lowPct: 94, highPct: 99 },
  { key: "vo2max", name: "VO₂ Max", lowPct: 100, highPct: 102 },
  { key: "anaerobic", name: "Anaerobic", lowPct: 103, highPct: null },
];

export function deriveZonesFromPaceThreshold(thresholdSecPerKm: number): ZoneRow[] {
  return PACE_BANDS.map((b) => ({
    key: b.key,
    name: b.name,
    low: thresholdSecPerKm * b.lowMult,
    high: b.highMult != null ? thresholdSecPerKm * b.highMult : null,
  }));
}

export function deriveZonesFromHrThreshold(thresholdBpm: number): ZoneRow[] {
  return HR_BANDS.map((b) => ({
    key: b.key,
    name: b.name,
    low: Math.round(thresholdBpm * (b.lowPct / 100)),
    high: b.highPct != null ? Math.round(thresholdBpm * (b.highPct / 100)) : null,
  }));
}

// ---------------------------------------------------------------------
// Method-specific anchor calculations
// ---------------------------------------------------------------------

// Daniels & Gilbert (1979) published VO2/velocity/%VO2max equations —
// the standard formulas VDOT calculators are built on, not a
// reproduction of Daniels' own proprietary lookup tables. Threshold
// ("T") pace is anchored at 86% VO2max, the midpoint of Daniels' cited
// 83-88% T-pace intensity range.
const T_PACE_PCT_VO2MAX = 0.86;

export function paceFromVdot(vdot: number): number | null {
  if (!Number.isFinite(vdot) || vdot <= 0) return null;
  const vo2Target = vdot * T_PACE_PCT_VO2MAX;
  // Solve 0.000104*v^2 + 0.182258*v - (4.60 + vo2Target) = 0 for v (m/min).
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + vo2Target);
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  if (!Number.isFinite(v) || v <= 0) return null;
  return (1000 / v) * 60; // sec/km
}

export function paceFromRecentRace(distanceKm: number, timeSec: number): number | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(timeSec) || timeSec <= 0) return null;
  // Same ~15-16K "threshold effort" anchor the Pace Predictor calculator
  // already uses for its own Threshold/Tempo training pace.
  return predictPaceAt(timeSec, distanceKm, 16);
}

export function paceFromCriticalSpeedTest(d1: number, t1: number, d2: number, t2: number): number | null {
  if (![d1, t1, d2, t2].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (d1 === d2 || t1 === t2) return null;
  // Orders the two trials by distance so the subtraction is always
  // (longer − shorter), regardless of which one was entered first.
  const [shortD, shortT, longD, longT] = d1 < d2 ? [d1, t1, d2, t2] : [d2, t2, d1, t1];
  const csMetersPerSec = ((longD - shortD) * 1000) / (longT - shortT);
  if (!Number.isFinite(csMetersPerSec) || csMetersPerSec <= 0) return null;
  // Critical Speed sits very close to, and is commonly used directly as,
  // a real-world proxy for sustainable lactate-threshold pace.
  return 1000 / csMetersPerSec;
}

export function paceFromMas(masKmh: number): number | null {
  if (!Number.isFinite(masKmh) || masKmh <= 0) return null;
  const masPaceSecPerKm = 3600 / masKmh;
  // MAS (≈vVO2max) is a harder/faster intensity than threshold —
  // threshold pace is slower, so divide by a sub-1.0 factor to lengthen
  // the per-km time.
  return masPaceSecPerKm / 0.86;
}

export function hrFromKarvonen(restingHr: number, maxHr: number): number | null {
  if (!Number.isFinite(restingHr) || !Number.isFinite(maxHr) || maxHr <= restingHr) return null;
  const hrr = maxHr - restingHr;
  // 85% HRR is a commonly-cited threshold-equivalent intensity in
  // Karvonen-based models — anchors Karvonen onto the same
  // threshold-based band system every other HR method uses, so it stays
  // comparable in the side-by-side table.
  return Math.round(restingHr + 0.85 * hrr);
}

export function hrFromPctMaxHr(maxHr: number): number | null {
  if (!Number.isFinite(maxHr) || maxHr <= 0) return null;
  // Commonly cited: lactate threshold sits ~85-90% of HRmax for trained
  // runners — 88% used as a single representative point.
  return Math.round(maxHr * 0.88);
}
