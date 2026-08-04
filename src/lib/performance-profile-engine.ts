// Performance Profile Engine — pure functions, no React/Supabase, same
// convention as the rest of this app's calculator engines.
//
// This replaces "predict from one recent race, sanity-check against
// PBs" with the architecture actually requested: analyse the whole
// body of evidence first, derive the athlete's shape from it, THEN
// predict from that shape. Five stages, in order:
//
//  1. Weight every PB by recency and reliability.
//  2. Fit a curve through them (VDOT vs log-distance) and derive
//     Speed/Aerobic scores, decay rates, and an overall profile shape
//     (Sprint/Speed/Balanced/Aerobic/Endurance bias) directly from
//     that curve's slope — not a manually-declared category.
//  3. Re-weight by internal consistency: a PB far from what the rest
//     of the evidence implies gets LESS influence on the final curve,
//     not deleted — implemented as one round of robust (residual-
//     based) reweighting, a standard technique for exactly this.
//  4. Confidence from data volume, recency, consistency, and distance
//     from the target — in that priority order — not just "how far is
//     this from the declared primary event."
//  5. Predict from the final, re-weighted curve.
//
// WHY VDOT AS THE COMMON CURRENCY: comparing raw times or paces across
// 800m and a marathon tells you nothing directly — they're different
// units of effort. VDOT (Daniels & Gilbert's published formulas, the
// same ones zone-calculator.ts already uses) normalizes any race
// result to one fitness-equivalent number, which is what makes "does
// this PB agree with the others" a meaningful, computable question
// instead of a vague one. A perfectly distance-neutral athlete would
// show the same VDOT at every distance; the SLOPE of VDOT against
// log-distance across their real results is literally their profile
// shape — negative slope (better at short) is a speed bias, positive
// (better at long) is an endurance bias, by construction.
//
// NOT attempted here: folding this into the Running DNA framework, or
// wiring it into training zones / event recommendations / goal setting
// / AI coaching. That's the clear, well-reasoned next step once this
// engine's actual output has been reviewed against real athletes — a
// separate integration effort touching several other features, not a
// natural extension of this file.

import { secToClock } from "@/lib/format";

export type PbRecord = {
  distanceKm: number;
  timeSec: number;
  // ISO date string (performance_date) — null is treated as "unknown
  // recency," given a conservative mid-range weight rather than
  // assumed either recent or stale.
  dateISO: string | null;
  // Whether this was raced (context === 'race') vs. a time trial,
  // estimate, or other context — the "Reliability" factor. A coarse
  // proxy given what's actually in the performances table today; a
  // real timing-chip/verification flag would be a better signal if
  // one exists later.
  isRace: boolean;
};

// ---------------------------------------------------------------------
// VDOT — forward (estimate from a result) and inverse (solve time from
// VDOT + distance) using Daniels & Gilbert's published equations.
// ---------------------------------------------------------------------

function vo2AtVelocity(vMetersPerMin: number): number {
  return -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;
}

function pctVo2MaxAtTime(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

export function estimateVdot(distanceKm: number, timeSec: number): number | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(timeSec) || timeSec <= 0) return null;
  const tMin = timeSec / 60;
  const v = (distanceKm * 1000) / tMin;
  const vdot = vo2AtVelocity(v) / pctVo2MaxAtTime(tMin);
  return Number.isFinite(vdot) && vdot > 0 ? vdot : null;
}

// VDOT is strictly monotonically decreasing in time for a fixed
// distance (verified numerically before building this) — safe to
// binary-search for the time that produces a target VDOT.
export function raceTimeFromVdot(distanceKm: number, vdot: number): number | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(vdot) || vdot <= 0) return null;
  let lo = 0.5; // minutes — far faster than any real distance/VDOT combo needs
  let hi = 600; // minutes — far slower than any real distance/VDOT combo needs
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = (distanceKm * 1000) / mid;
    const midVdot = vo2AtVelocity(v) / pctVo2MaxAtTime(mid);
    if (midVdot > vdot) lo = mid; // too fast a guess (higher VDOT than target) -> need more time
    else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

// ---------------------------------------------------------------------
// Stage 1 — recency + reliability weighting
// ---------------------------------------------------------------------

function recencyWeight(dateISO: string | null, now: Date): number {
  if (!dateISO) return 0.6; // unknown date — assume moderately current, not stale
  const then = new Date(dateISO).getTime();
  if (!Number.isFinite(then)) return 0.6;
  const monthsAgo = Math.max(0, (now.getTime() - then) / (1000 * 60 * 60 * 24 * 30.44));
  if (monthsAgo <= 1) return 1.0;
  // 8-month half-life after a 1-month grace period, floored at 0.15 —
  // even an old PB still carries some information about the athlete's
  // ceiling, it just shouldn't dominate current-fitness predictions.
  return Math.max(0.15, Math.exp((-(monthsAgo - 1) * Math.LN2) / 8));
}

function reliabilityWeight(isRace: boolean): number {
  return isRace ? 1.0 : 0.7;
}

export type WeightedPb = PbRecord & {
  vdot: number;
  recencyWeight: number;
  reliabilityWeight: number;
  // Filled in by Stage 3 — starts at 1.0 before the curve exists to
  // measure consistency against.
  consistencyWeight: number;
  // How strong this specific performance is relative to the athlete's
  // own best (by VDOT) — the "World Athletics points or an equivalent
  // standard" factor. VDOT itself already is that equivalent standard:
  // it's a physiologically-grounded, cross-distance-comparable fitness
  // score (the same formulas WA-style scoring tables are built from
  // conceptually), so an exceptional PB naturally scores a high VDOT
  // and this just turns that into more influence on predictions,
  // rather than a mediocre PB counting equally.
  qualityWeight: number;
  // recency x reliability x consistency (NOT including quality or the
  // per-target distance kernel — both of those are applied fresh at
  // prediction time in predictFromProfile, since quality matters
  // globally but the kernel is target-specific).
  weight: number;
  // Actual VDOT minus what the global curve implies at this distance —
  // negative means this PB sits below the rest of the profile,
  // positive means it sits above. Null until the global curve exists
  // (needs 2+ PBs). Used by the performance-gap insight below.
  residual: number | null;
};

// Distance-decay kernel for locally weighted prediction — a target's
// prediction is built primarily from nearby PBs, with influence fading
// as distance grows, rather than one global curve applying equally
// everywhere. Bandwidth tuned (and checked numerically before shipping)
// so a 1000m target gets ~95% influence from an 800m PB and ~85% from
// 1500m but under 1% from a 10K; a Half Marathon target gets ~57% from
// a 10K and ~61% from a marathon but under 1% from 1500m — matching
// "predict primarily from nearby events, distant ones contribute
// little or none."
const DISTANCE_KERNEL_BANDWIDTH = 0.7;

function distanceKernel(lnDistanceKm: number, lnTargetKm: number): number {
  const gap = lnDistanceKm - lnTargetKm;
  return Math.exp(-(gap * gap) / (2 * DISTANCE_KERNEL_BANDWIDTH * DISTANCE_KERNEL_BANDWIDTH));
}

// ---------------------------------------------------------------------
// Weighted linear regression: y = intercept + slope * x, plus weighted
// R^2 — used both for the main VDOT-vs-log-distance curve and the two
// sub-range decay rates (Speed Endurance, Aerobic Durability).
// ---------------------------------------------------------------------

export type LinearFit = { intercept: number; slope: number; rSquared: number };

function weightedLinearFit(points: { x: number; y: number; w: number }[]): LinearFit | null {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.w > 0);
  if (usable.length < 2) return null;
  const sumW = usable.reduce((s, p) => s + p.w, 0);
  if (sumW <= 0) return null;
  const xBar = usable.reduce((s, p) => s + p.w * p.x, 0) / sumW;
  const yBar = usable.reduce((s, p) => s + p.w * p.y, 0) / sumW;
  const sXX = usable.reduce((s, p) => s + p.w * (p.x - xBar) ** 2, 0);
  const sXY = usable.reduce((s, p) => s + p.w * (p.x - xBar) * (p.y - yBar), 0);
  if (sXX <= 1e-9) return { intercept: yBar, slope: 0, rSquared: 0 }; // all points at ~same distance — no slope info
  const slope = sXY / sXX;
  const intercept = yBar - slope * xBar;
  const ssRes = usable.reduce((s, p) => s + p.w * (p.y - (intercept + slope * p.x)) ** 2, 0);
  const ssTot = usable.reduce((s, p) => s + p.w * (p.y - yBar) ** 2, 0);
  const rSquared = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  return { intercept, slope, rSquared };
}

// ---------------------------------------------------------------------
// Stage 2/3 combined — the athlete profile: weighted PBs, and the
// derived shape/index metrics. NOTE: the single "global" curve fitted
// here is used only for the descriptive Profile Shape / Speed Endurance
// / Aerobic Durability display — actual predictions (predictFromProfile,
// below) no longer read from it. A single curve flattens exactly the
// case this refactor exists to fix: an athlete's strongest, most
// physiologically-relevant nearby PBs getting diluted by distant ones
// that happen to share the same fit. Predictions instead get their own
// fresh, locally-weighted fit per target distance.
// ---------------------------------------------------------------------

export type ProfileShape = {
  // -1 (strong speed bias) .. +1 (strong endurance bias), 0 = balanced.
  biasScore: number;
  label: "Speed-Oriented" | "Speed-Endurance" | "Balanced" | "Aerobic" | "Endurance";
  // Five-band relative-strength bars for display, index-matched to
  // ["Speed-Oriented","Speed-Endurance","Balanced","Aerobic","Endurance"],
  // each 0-10.
  bars: number[];
};

// VDOT (Daniels & Gilbert) is an AEROBIC model — it's built on the
// relationship between race duration and %VO2max, which simply doesn't
// describe a sub-400m effort at all (that's alactic/phosphagen-system
// dominated, a completely different energy system). Running a 60m or
// 100m PB through this model isn't just "a distance far from the rest
// of the evidence," it's a category error — comparing two things the
// underlying formula was never built to relate. Below this, a PB is
// excluded from the engine entirely (not deleted from the athlete's
// record, just not fed into this particular model).
const EXCLUDE_BELOW_KM = 0.4;
// 400m-600m sits in between: still not well-described by VDOT, but a
// genuinely useful, classic indicator of raw top-end speed on its own
// terms. Kept OUT of the VDOT profile/curve/shape/gap-detection, and
// instead compared against what the athlete's aerobic-side profile
// alone would imply at that distance — see topEndSpeedFromProfile.
const TOP_END_SPEED_MAX_KM = 0.6;

export type TopEndSpeedRating = "Strong" | "Good" | "Needs developing";

export type TopEndSpeed = {
  rating: TopEndSpeedRating;
  // The actual PB(s) this was assessed from, and the aerobic-profile
  // baseline it was compared against — shown so the rating is never a
  // bare label with no visible reasoning behind it.
  distanceLabel: string;
  actualTimeSec: number;
  aerobicBaselineTimeSec: number | null;
};

export type ProfileInsights = {
  // Which distance range this athlete performs relatively best in, and
  // which real PBs support that — e.g. "Excellent 800m-1500m
  // performances." Null if there isn't a clearly strongest range (e.g.
  // only one bucket has any data at all).
  strength: string | null;
  // Whether recent performances in the 5K-Half range are trending
  // better or worse than older ones in that same range — null unless
  // there are at least 2 dated PBs in range to compare, since a trend
  // needs at least two points in time to support it.
  aerobicProgression: string | null;
  // The single PB that sits furthest from what the rest of the
  // evidence implies (if any genuinely does, i.e. was downweighted by
  // Stage 3) — phrased as a gap to investigate, not a verdict, and
  // named in whichever direction it actually went (below OR above the
  // rest of the profile).
  performanceGap: string | null;
  // A plain-language read of overallConsistency — always present.
  predictionConfidence: string;
  // Only set when Top End Speed genuinely contradicts the Profile
  // Shape label — e.g. shape reads Speed-Oriented purely from an
  // 800m-vs-1500m/3000m comparison, but a real 400m PB shows that
  // speed isn't backed by raw top-end pace. Flags the discrepancy
  // rather than silently letting the (potentially misleading) shape
  // label stand unqualified.
  speedShapeMismatch: string | null;
};

export type AthleteProfile = {
  weighted: WeightedPb[];
  // Descriptive only now — see the note above. Predictions build their
  // own local fit per target instead of reading this.
  globalCurve: LinearFit | null;
  shape: ProfileShape;
  speedScore: number | null; // weighted-average VDOT, 800m-1500m PBs
  aerobicScore: number | null; // weighted-average VDOT, 5K-Half PBs
  speedEnduranceDecay: number | null; // dVDOT/d(ln km), 800m-3000m
  aerobicDurabilityDecay: number | null; // dVDOT/d(ln km), 5K-Half
  overallConsistency: number; // 0-1, the global curve's weighted R^2 (0 if no curve) — descriptive; per-target fit quality is used for prediction confidence instead
  insights: ProfileInsights;
  // Null when there's no 400m-600m PB on file to assess it from — never
  // guessed. See topEndSpeedFromProfile for the comparison this is
  // built from.
  topEndSpeed: TopEndSpeed | null;
  conversionMetrics: ConversionMetrics;
};

const SHAPE_BAND_POSITIONS = [-1, -0.5, 0, 0.5, 1];
const SHAPE_LABELS: ProfileShape["label"][] = ["Speed-Oriented", "Speed-Endurance", "Balanced", "Aerobic", "Endurance"];

function shapeFromSlope(slope: number): ProfileShape {
  // Compresses the raw slope (VDOT change per unit of ln-km) into a
  // -1..1 bias score — tanh saturates gracefully rather than needing a
  // hard cutoff for extreme slopes.
  const biasScore = Math.tanh(slope / 2.2);
  const bars = SHAPE_BAND_POSITIONS.map((pos) => Math.round(10 * Math.exp(-((biasScore - pos) ** 2) / (2 * 0.35 ** 2))));
  let labelIdx = 2;
  if (biasScore < -0.6) labelIdx = 0;
  else if (biasScore < -0.2) labelIdx = 1;
  else if (biasScore < 0.2) labelIdx = 2;
  else if (biasScore < 0.6) labelIdx = 3;
  else labelIdx = 4;
  return { biasScore, label: SHAPE_LABELS[labelIdx], bars };
}

function weightedAverage(points: { y: number; w: number }[]): number | null {
  const usable = points.filter((p) => p.w > 0);
  const sumW = usable.reduce((s, p) => s + p.w, 0);
  if (sumW <= 0) return null;
  return usable.reduce((s, p) => s + p.w * p.y, 0) / sumW;
}

function formatDistanceLabel(km: number): string {
  if (Math.abs(km - 1.60934) < 0.01) return "Mile";
  if (Math.abs(km - 21.0975) < 0.05) return "Half Marathon";
  if (Math.abs(km - 42.195) < 0.05) return "Marathon";
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (Math.abs(km - Math.round(km)) < 0.02) return `${Math.round(km)}K`;
  return `${Math.round(km * 1000)}m`;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Deliberately stays at what the data actually supports — a bucket
// this athlete is relatively strongest in, a recent trend where there
// are at least two dated points to show one, a specific PB that
// genuinely got downweighted for disagreeing with the rest of the
// evidence — rather than inferring a trait ("fades quickly") from a
// slope that a coach would rightly want more context (training
// history, testing) before accepting.
const STRENGTH_BUCKETS = [
  { label: "Speed", lo: 0.7, hi: 1.7 },
  { label: "Speed-Endurance", lo: 1.7, hi: 3.5 },
  { label: "Aerobic", lo: 4.5, hi: 11 },
  { label: "Endurance", lo: 15, hi: 45 },
];

function deriveProfileInsights(weighted: WeightedPb[]): ProfileInsights {
  // Strength
  const overallAvgVdot = weightedAverage(weighted.map((p) => ({ y: p.vdot, w: p.weight * p.qualityWeight })));
  const bucketScores = STRENGTH_BUCKETS.map((b) => {
    const pbsInBucket = weighted.filter((p) => p.distanceKm >= b.lo && p.distanceKm <= b.hi);
    if (pbsInBucket.length === 0 || overallAvgVdot == null) return null;
    const avg = weightedAverage(pbsInBucket.map((p) => ({ y: p.vdot, w: p.weight * p.qualityWeight })));
    if (avg == null) return null;
    return { bucket: b, pbs: pbsInBucket, relativeScore: avg - overallAvgVdot };
  }).filter((b): b is NonNullable<typeof b> => b != null);

  let strength: string | null = null;
  if (bucketScores.length >= 2) {
    const best = bucketScores.reduce((a, b) => (b.relativeScore > a.relativeScore ? b : a));
    const labels = best.pbs.map((p) => formatDistanceLabel(p.distanceKm));
    strength = `Excellent ${joinLabels(labels)} performance${labels.length > 1 ? "s" : ""}.`;
  }

  // Current aerobic progression — needs at least 2 dated PBs in the
  // 5K-Half range to compare old vs new; otherwise there's genuinely
  // no trend to report yet.
  const aerobicDated = weighted
    .filter((p) => p.distanceKm >= 4.5 && p.distanceKm <= 22 && p.dateISO)
    .sort((a, b) => new Date(a.dateISO!).getTime() - new Date(b.dateISO!).getTime());
  let aerobicProgression: string | null = null;
  if (aerobicDated.length >= 2) {
    const mid = Math.ceil(aerobicDated.length / 2);
    const older = aerobicDated.slice(0, mid);
    const newer = aerobicDated.slice(mid);
    const olderAvg = weightedAverage(older.map((p) => ({ y: p.vdot, w: 1 })));
    const newerAvg = weightedAverage((newer.length ? newer : [aerobicDated[aerobicDated.length - 1]]).map((p) => ({ y: p.vdot, w: 1 })));
    if (olderAvg != null && newerAvg != null) {
      const pctChange = (newerAvg - olderAvg) / olderAvg;
      if (pctChange > 0.02) aerobicProgression = "Strong recent improvement over 5K-10K performances.";
      else if (pctChange < -0.02) aerobicProgression = "5K-10K performances have trended slower recently — worth checking training load or recovery.";
      else aerobicProgression = "5K-10K performance has been stable recently.";
    }
  }

  // Performance gap — only reports something that was ACTUALLY
  // downweighted by Stage 3 (genuinely disagrees with the rest of the
  // evidence), never manufactures a gap when nothing stands out.
  let performanceGap: string | null = null;
  const flagged = weighted.filter((p) => p.consistencyWeight < 1 && p.residual != null);
  if (flagged.length > 0) {
    const worst = flagged.reduce((a, b) => (Math.abs(b.residual!) > Math.abs(a.residual!) ? b : a));
    const label = formatDistanceLabel(worst.distanceKm);
    performanceGap =
      worst.residual! < 0
        ? `${label} PB appears below the current performance profile and is likely outdated or underdeveloped.`
        : `${label} PB appears above the current performance profile — could reflect a specific strength or a standout day.`;
  }

  // Prediction confidence — data volume matters as much as fit quality:
  // 2 points always fit a line perfectly, which isn't real evidence of
  // consistency on its own.
  const overallConsistency = weightedLinearFit(weighted.map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight * p.qualityWeight })))?.rSquared ?? 0;
  let predictionConfidence: string;
  if (weighted.length < 2) predictionConfidence = "Limited — only one PB on file, not enough to assess consistency yet.";
  else if (weighted.length < 3) predictionConfidence = "Moderate — only two PBs to compare, so consistency can't be fully assessed yet.";
  else if (overallConsistency >= 0.75) predictionConfidence = "High, based on strong consistency across recent performances.";
  else if (overallConsistency >= 0.5) predictionConfidence = "Moderate — performances broadly agree, but with some spread.";
  else if (overallConsistency >= 0.25) predictionConfidence = "Developing — still building a consistent picture from the performances on file.";
  else predictionConfidence = "Limited — performances vary enough from each other that the profile isn't fully settled yet.";

  return { strength, aerobicProgression, performanceGap, predictionConfidence, speedShapeMismatch: null };
}

// Compares a real 400-600m PB against what the athlete's AEROBIC
// profile alone (the VDOT curve built from 600m+ results) would imply
// at that same distance if extrapolated down — not a real prediction
// (VDOT doesn't properly describe this range either, per the comment
// on EXCLUDE_BELOW_KM), just a deliberately rough baseline for "is this
// athlete's speed here better, the same, or worse than their aerobic
// fitness alone would suggest." That comparison is the actual answer
// to "is their 800m fast because they're fast, or because they're
// aerobically strong" — which a flat VDOT-based Speed Score can't tell
// apart on its own.
export type SpeedPoint = {
  km: number;
  timeSec: number;
  vdot: number;
  // false means this is an aerobic-profile extrapolation, not a real
  // logged result — every place that uses a SpeedPoint says so
  // explicitly rather than presenting an estimate as measured fact.
  measured: boolean;
  sourceLabel: string;
};

// Same 5-band scale Development Potential (Athlete DNA) already uses
// for its category scores — reused here rather than inventing a
// different scale, so "Good" or "Excellent" means the same thing
// wherever it shows up in the app.
function bucketFromScore(score: number): "Low" | "Developing" | "Good" | "Excellent" | "Elite" {
  if (score < 20) return "Low";
  if (score < 40) return "Developing";
  if (score < 65) return "Good";
  if (score < 85) return "Excellent";
  return "Elite";
}

export type ConversionScore = {
  score: number; // 0-100
  bucket: "Low" | "Developing" | "Good" | "Excellent" | "Elite";
  measured: boolean; // whether it's built from real PBs or leans on an estimate somewhere in the chain
  detail: string;
};

export type ConversionMetrics = {
  // Raw ability at 400-600m — the ceiling. Null only when there's
  // truly nothing on file to even estimate it from (no PBs at all).
  rawSpeedCeiling: ConversionScore | null;
  // How much of that raw speed carries into 800m — the 400->800
  // dVDOT/d(ln km) compared against the athlete's OWN aerobic-range
  // decay rate (Speed Endurance, 800m-3000m). Null when there's no
  // aerobic-range reference to compare against at all.
  speedConversion: ConversionScore | null;
  // How well 1500m-level fitness carries into 5K-Half — reads
  // aerobicDurabilityDecay as a score rather than a bare slope number.
  aerobicConversion: ConversionScore | null;
};

// The single aerobic-extrapolation calculation — "what would this
// distance look like if this athlete's aerobic profile alone (no
// special speed reserve, no deficiency) were extended down/out to it."
// Shared by topEndSpeedFromProfile's baseline and estimateSpeedPoint's
// fallback so there's exactly one implementation of this idea, not two
// that could quietly drift apart.
function aerobicExtrapolatedPoint(
  targetKm: number,
  globalCurve: LinearFit | null,
  fallbackSingle: WeightedPb | null,
): { timeSec: number; vdot: number } | null {
  if (globalCurve) {
    const vdot = globalCurve.intercept + globalCurve.slope * Math.log(targetKm);
    const timeSec = raceTimeFromVdot(targetKm, vdot);
    if (timeSec != null) return { timeSec, vdot };
  }
  if (fallbackSingle) {
    const timeSec = raceTimeFromVdot(targetKm, fallbackSingle.vdot);
    if (timeSec != null) return { timeSec, vdot: fallbackSingle.vdot };
  }
  return null;
}

// General-purpose "give me a time at this distance" for the conversion
// metrics below — prefers a real nearby PB (generous ~15%-of-log-
// distance tolerance, since this is "close enough to treat as this
// athlete's known ability here," not the tight exact-match check used
// elsewhere), falls back to the aerobic extrapolation above. Returns
// null only when there's genuinely nothing on file to work from —
// never invents a number from zero data, which is the actual answer
// to "estimate a 400m/800m PB if the athlete doesn't have one": use
// whatever real evidence exists, extrapolated honestly, clearly
// labelled as an estimate rather than presented as a real time.
function estimateSpeedPoint(
  targetKm: number,
  speedIndicatorPbs: PbRecord[],
  vdotWeighted: WeightedPb[],
  globalCurve: LinearFit | null,
): SpeedPoint | null {
  const candidates = [
    ...speedIndicatorPbs.map((p) => ({ distanceKm: p.distanceKm, timeSec: p.timeSec, vdot: estimateVdot(p.distanceKm, p.timeSec) })),
    ...vdotWeighted.map((p) => ({ distanceKm: p.distanceKm, timeSec: p.timeSec, vdot: p.vdot as number | null })),
  ].filter((c): c is { distanceKm: number; timeSec: number; vdot: number } => c.vdot != null);

  let nearest: { distanceKm: number; timeSec: number; vdot: number } | null = null;
  let nearestGap = Infinity;
  for (const c of candidates) {
    const gap = Math.abs(Math.log(c.distanceKm / targetKm));
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = c;
    }
  }
  if (nearest && nearestGap <= 0.15) {
    return {
      km: targetKm,
      timeSec: nearest.timeSec,
      vdot: nearest.vdot,
      measured: true,
      sourceLabel: `measured (${formatDistanceLabel(nearest.distanceKm)})`,
    };
  }

  const extrapolated = aerobicExtrapolatedPoint(targetKm, globalCurve, vdotWeighted[0] ?? null);
  if (extrapolated) {
    return { km: targetKm, ...extrapolated, measured: false, sourceLabel: "estimated from aerobic profile" };
  }
  return null;
}

const TOP_END_SPEED_THRESHOLD = 0.04; // 4% either side of the aerobic baseline

function topEndSpeedFromProfile(
  speedIndicatorPbs: PbRecord[],
  vdotWeighted: WeightedPb[],
  globalCurve: LinearFit | null,
): TopEndSpeed | null {
  if (speedIndicatorPbs.length === 0) return null;
  // Prefers a real 400m PB specifically (the classic reference
  // distance) if one exists; otherwise whichever 400-600m result is on
  // file.
  const best = [...speedIndicatorPbs].sort((a, b) => Math.abs(a.distanceKm - 0.4) - Math.abs(b.distanceKm - 0.4))[0];

  let aerobicBaselineTimeSec: number | null = null;
  const baseline = aerobicExtrapolatedPoint(best.distanceKm, globalCurve, vdotWeighted[0] ?? null);
  if (baseline) aerobicBaselineTimeSec = baseline.timeSec;

  let rating: TopEndSpeedRating = "Good";
  if (aerobicBaselineTimeSec != null) {
    const diff = (aerobicBaselineTimeSec - best.timeSec) / aerobicBaselineTimeSec; // positive = actual is faster than baseline
    if (diff > TOP_END_SPEED_THRESHOLD) rating = "Strong";
    else if (diff < -TOP_END_SPEED_THRESHOLD) rating = "Needs developing";
  }

  return {
    rating,
    distanceLabel: formatDistanceLabel(best.distanceKm),
    actualTimeSec: best.timeSec,
    aerobicBaselineTimeSec,
  };
}

// Raw VDOT ranges roughly 30 (recreational) to 85 (world-class) — a
// simple linear scale across that range, not a validated population-
// normed score. Documented as a heuristic on purpose: this is a
// starting calibration, worth revisiting once tested against real
// athletes rather than a claim of precision it doesn't have.
function vdotToScore(vdot: number): number {
  return Math.max(0, Math.min(100, ((vdot - 30) / (85 - 30)) * 100));
}

function deriveConversionMetrics(
  speedIndicatorPbs: PbRecord[],
  vdotWeighted: WeightedPb[],
  globalCurve: LinearFit | null,
  speedEnduranceDecay: number | null,
  aerobicDurabilityDecay: number | null,
): ConversionMetrics {
  const point400 = estimateSpeedPoint(0.4, speedIndicatorPbs, vdotWeighted, globalCurve);
  const point800 = estimateSpeedPoint(0.8, speedIndicatorPbs, vdotWeighted, globalCurve);

  const rawSpeedCeiling: ConversionScore | null = point400
    ? {
        score: vdotToScore(point400.vdot),
        bucket: bucketFromScore(vdotToScore(point400.vdot)),
        measured: point400.measured,
        detail: `400m ${point400.measured ? "PB" : "estimate"}: ${secToClock(point400.timeSec)} (${point400.sourceLabel})`,
      }
    : null;

  // Compares the ACTUAL 400->800 drop-off against this athlete's own
  // aerobic-range decay rate (Speed Endurance, 800m-3000m) — both in
  // the same dVDOT/d(ln km) units, so this is "does this athlete hold
  // their speed into 800m better or worse than their own broader
  // pattern would predict," not a comparison against a generic
  // population norm. Centered at 60 ("matches their own pattern");
  // reads a genuinely richer signal than a raw exponent number would.
  let speedConversion: ConversionScore | null = null;
  const referenceSlope = speedEnduranceDecay ?? globalCurve?.slope ?? null;
  if (point400 && point800 && referenceSlope != null) {
    const impliedSlope = (point800.vdot - point400.vdot) / (Math.log(0.8) - Math.log(0.4));
    const diff = impliedSlope - referenceSlope; // positive = holds speed into 800m BETTER than their own aerobic pattern implies
    const score = Math.max(0, Math.min(100, 60 + diff * 15));
    speedConversion = {
      score,
      bucket: bucketFromScore(score),
      measured: point400.measured && point800.measured,
      detail:
        diff > 0.3
          ? "Holds speed into 800m better than this athlete's own aerobic pattern alone would suggest."
          : diff < -0.3
            ? "Speed drops off into 800m faster than this athlete's own aerobic pattern alone would suggest — raw speed may be under-utilised here."
            : "800m performance is in line with what this athlete's own aerobic pattern implies.",
    };
  }

  // Reads aerobicDurabilityDecay (1500m-Half) as a score — slope near 0
  // (VDOT barely drops across that whole range) is excellent aerobic
  // carry-through; a steep negative slope means fitness measured at
  // 1500m doesn't hold up well as distance extends. Centered at 70 for
  // a flat (0) slope rather than 100 — some decay across that huge a
  // range is normal even for strong aerobic athletes; near-zero or
  // positive is the genuinely exceptional case.
  const aerobicConversion: ConversionScore | null =
    aerobicDurabilityDecay != null
      ? (() => {
          const score = Math.max(0, Math.min(100, 70 + aerobicDurabilityDecay * 25));
          return {
            score,
            bucket: bucketFromScore(score),
            measured: true,
            detail:
              aerobicDurabilityDecay > -0.3
                ? "1500m-level fitness carries into 5K-Half with very little drop-off."
                : aerobicDurabilityDecay < -1.0
                  ? "Meaningful drop-off from 1500m-level fitness out to 5K-Half — aerobic development is the higher-leverage lever here."
                  : "Typical drop-off from 1500m-level fitness out to 5K-Half.",
          };
        })()
      : null;

  return { rawSpeedCeiling, speedConversion, aerobicConversion };
}

export function buildAthleteProfile(pbs: PbRecord[], now: Date = new Date()): AthleteProfile | null {
  const clean = pbs.filter((p) => Number.isFinite(p.distanceKm) && p.distanceKm > 0 && Number.isFinite(p.timeSec) && p.timeSec > 0);

  // Distance-band partition — see EXCLUDE_BELOW_KM / TOP_END_SPEED_MAX_KM
  // above for why. Sub-400m never enters this function's model at all;
  // 400-600m is set aside for topEndSpeedFromProfile below rather than
  // treated as a normal VDOT data point.
  const speedIndicatorPbs = clean.filter((p) => p.distanceKm >= EXCLUDE_BELOW_KM && p.distanceKm < TOP_END_SPEED_MAX_KM);
  const vdotEligible = clean.filter((p) => p.distanceKm >= TOP_END_SPEED_MAX_KM);

  const withVdot = vdotEligible
    .map((p) => ({ ...p, vdot: estimateVdot(p.distanceKm, p.timeSec) }))
    .filter((p): p is PbRecord & { vdot: number } => p.vdot != null);
  if (withVdot.length === 0) return null;

  // Quality weight — the athlete's own best (by VDOT) sets the ceiling
  // (weight 1.0); everything else scales down from there. Squared
  // rather than linear so the effect is real but not so aggressive
  // that a merely-solid PB gets nearly zeroed out next to an
  // exceptional one.
  const maxVdot = Math.max(...withVdot.map((p) => p.vdot));

  // Stage 1
  let weighted: WeightedPb[] = withVdot.map((p) => {
    const rec = recencyWeight(p.dateISO, now);
    const rel = reliabilityWeight(p.isRace);
    const quality = maxVdot > 0 ? (p.vdot / maxVdot) ** 2 : 1;
    return { ...p, recencyWeight: rec, reliabilityWeight: rel, consistencyWeight: 1, qualityWeight: quality, weight: rec * rel, residual: null };
  });

  // Stage 2 (first pass) + Stage 3 (residual-based reweight, then
  // refit) — this fit is GLOBAL (no distance kernel), used only to
  // derive consistencyWeight and the descriptive shape/index metrics,
  // never for predictions themselves (see predictFromProfile).
  const fitPoints = (list: WeightedPb[]) => list.map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight * p.qualityWeight }));
  let globalCurve = weightedLinearFit(fitPoints(weighted));

  if (globalCurve && weighted.length >= 3) {
    const residuals = weighted.map((p) => p.vdot - (globalCurve!.intercept + globalCurve!.slope * Math.log(p.distanceKm)));
    const sumW = weighted.reduce((s, p) => s + p.weight, 0);
    const weightedVar = weighted.reduce((s, p, i) => s + p.weight * residuals[i] ** 2, 0) / (sumW || 1);
    const sigma = Math.sqrt(weightedVar) || 1;
    weighted = weighted.map((p, i) => {
      const z = Math.abs(residuals[i]) / sigma;
      // "Reduce its influence" (never delete) — a PB more than ~2
      // weighted-standard-deviations from what the rest of the
      // evidence implies still counts, just much less.
      const consistencyWeight = z <= 1 ? 1 : z <= 2 ? 0.6 : 0.25;
      return { ...p, consistencyWeight, weight: p.recencyWeight * p.reliabilityWeight * consistencyWeight };
    });
    globalCurve = weightedLinearFit(fitPoints(weighted)); // final, reweighted global curve
  }

  // Final residuals — recomputed against whichever curve actually ended
  // up being used (post-reweight, if a reweight happened), so the
  // performance-gap insight below reads the same number the fit itself
  // settled on rather than a stale first-pass figure.
  if (globalCurve) {
    weighted = weighted.map((p) => ({ ...p, residual: p.vdot - (globalCurve!.intercept + globalCurve!.slope * Math.log(p.distanceKm)) }));
  }

  const shape = globalCurve ? shapeFromSlope(globalCurve.slope) : { biasScore: 0, label: "Balanced" as const, bars: [2, 4, 10, 4, 2] };

  const speedScore = weightedAverage(weighted.filter((p) => p.distanceKm >= 0.7 && p.distanceKm <= 1.7).map((p) => ({ y: p.vdot, w: p.weight })));
  const aerobicScore = weightedAverage(weighted.filter((p) => p.distanceKm >= 4.5 && p.distanceKm <= 22).map((p) => ({ y: p.vdot, w: p.weight })));

  const speedEnduranceFit = weightedLinearFit(
    weighted.filter((p) => p.distanceKm >= 0.7 && p.distanceKm <= 3.3).map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight })),
  );
  const aerobicDurabilityFit = weightedLinearFit(
    weighted.filter((p) => p.distanceKm >= 4.5 && p.distanceKm <= 22).map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight })),
  );

  const topEndSpeed = topEndSpeedFromProfile(speedIndicatorPbs, weighted, globalCurve);
  const conversionMetrics = deriveConversionMetrics(
    speedIndicatorPbs,
    weighted,
    globalCurve,
    speedEnduranceFit?.slope ?? null,
    aerobicDurabilityFit?.slope ?? null,
  );
  const insights = deriveProfileInsights(weighted);
  // This is the actual fix for "an athlete reads as Speed-Oriented off
  // an 800m that's really being carried by aerobic fitness, not raw
  // speed" — a real 400m result contradicting the shape label is
  // surfaced explicitly rather than left for a coach to notice (or not)
  // on their own.
  if (topEndSpeed?.rating === "Needs developing" && (shape.label === "Speed-Oriented" || shape.label === "Speed-Endurance")) {
    insights.speedShapeMismatch = `Profile shape reads as ${shape.label} from distance comparisons alone, but the ${topEndSpeed.distanceLabel} PB suggests limited raw top-end speed — this athlete's shorter-distance strength may be more aerobic-driven than pure speed. Worth confirming with sprint-specific testing before treating "${shape.label}" as settled.`;
  }

  return {
    weighted,
    globalCurve,
    shape,
    speedScore,
    aerobicScore,
    speedEnduranceDecay: speedEnduranceFit?.slope ?? null,
    aerobicDurabilityDecay: aerobicDurabilityFit?.slope ?? null,
    overallConsistency: globalCurve?.rSquared ?? 0,
    insights,
    topEndSpeed,
    conversionMetrics,
  };
}

// ---------------------------------------------------------------------
// Stage 4/5 — confidence + prediction from the built profile.
// ---------------------------------------------------------------------

export type ConfidenceTier = 1 | 2 | 3 | 4 | 5;
export const TIER_META: Record<ConfidenceTier, { label: string; rangePct: number }> = {
  5: { label: "Very High", rangePct: 1.5 },
  4: { label: "High", rangePct: 3 },
  3: { label: "Moderate", rangePct: 5 },
  2: { label: "Low", rangePct: 8 },
  1: { label: "Very Low", rangePct: 12 },
};

function tierFromPct(pct: number): ConfidenceTier {
  if (pct >= 85) return 5;
  if (pct >= 68) return 4;
  if (pct >= 48) return 3;
  if (pct >= 28) return 2;
  return 1;
}

export type ProfilePrediction = {
  label: string;
  km: number;
  timeSec: number;
  lowSec: number;
  highSec: number;
  paceSecPerKm: number;
  tier: ConfidenceTier;
  confidencePct: number;
  isPb: boolean;
  // Only set on isPb rows — what the rest of the athlete's evidence
  // (every OTHER PB, kernel-weighted the same way as any other target)
  // implies is achievable here, independent of the PB itself. Lets a
  // coach see whether a PB is right in line with the rest of the
  // profile, or whether there's more in the tank (potential faster
  // than the PB) or the PB was a standout day (potential slower).
  potentialTimeSec?: number;
  potentialLowSec?: number;
  potentialHighSec?: number;
  potentialTier?: ConfidenceTier;
};

const PB_EXACT_MATCH_TOLERANCE = 0.03;

// Shared by both the main (non-PB) prediction path and the "potential"
// figure computed alongside a PB — a locally-weighted VDOT estimate at
// lnTarget from whichever weighted PBs are passed in, with the same
// single-point/no-data fallback either caller would otherwise have to
// duplicate.
function localVdotEstimate(
  points: WeightedPb[],
  lnTarget: number,
  globalSlope: number | null,
): { vdot: number; rSquared: number | null } | null {
  const weighted = points.map((p) => ({
    x: Math.log(p.distanceKm),
    y: p.vdot,
    w: p.weight * p.qualityWeight * distanceKernel(Math.log(p.distanceKm), lnTarget),
  }));
  const localFit = weightedLinearFit(weighted);
  if (localFit) return { vdot: localFit.intercept + localFit.slope * lnTarget, rSquared: localFit.rSquared };

  const usable = weighted.filter((p) => p.w > 1e-4);
  if (usable.length === 0) return null;
  const nearest = usable.reduce((a, b) => (b.w > a.w ? b : a));
  const slope = globalSlope ?? 0;
  return { vdot: nearest.y + slope * (lnTarget - nearest.x), rSquared: null };
}

// Shared by both prediction paths — Stage 4's 40/30/20/10 confidence
// formula, given whichever weighted PB set and local fit quality apply
// (the full set for a normal prediction, or "every PB except this one"
// for a PB row's potential).
function confidenceForTarget(weightedPbs: WeightedPb[], lnTarget: number, localRSquared: number | null, overallConsistency: number): number {
  const nearby = weightedPbs.filter((p) => distanceKernel(Math.log(p.distanceKm), lnTarget) > 0.05);
  const nearbyWeight = nearby.reduce((s, p) => s + p.weight * p.qualityWeight * distanceKernel(Math.log(p.distanceKm), lnTarget), 0);
  const dataVolumeScore = Math.min(100, (nearbyWeight / 2.5) * 100);

  const recencyBasis = nearby.length > 0 ? nearby : weightedPbs;
  const recencyScore = 100 * (weightedAverage(recencyBasis.map((p) => ({ y: p.recencyWeight, w: p.weight }))) ?? 0.5);

  const consistencyScore = 100 * (localRSquared ?? overallConsistency);

  const nearestGap = weightedPbs.length > 0 ? Math.min(...weightedPbs.map((p) => Math.abs(Math.log(p.distanceKm) - lnTarget))) : 1.5;
  const distanceScore = Math.max(0, 100 * (1 - nearestGap / 1.5));

  return 0.4 * dataVolumeScore + 0.3 * recencyScore + 0.2 * consistencyScore + 0.1 * distanceScore;
}

// The nearest real PB shorter than the target, and the nearest longer
// than it — used by clampToBrackets below to bound predictions against
// real, proven results on either side.
function bracketingPbs(pbs: WeightedPb[], targetKm: number): { shorter: WeightedPb | null; longer: WeightedPb | null } {
  let shorter: WeightedPb | null = null;
  let longer: WeightedPb | null = null;
  for (const pb of pbs) {
    if (pb.distanceKm < targetKm && (!shorter || pb.distanceKm > shorter.distanceKm)) shorter = pb;
    if (pb.distanceKm > targetKm && (!longer || pb.distanceKm < longer.distanceKm)) longer = pb;
  }
  return { shorter, longer };
}

// Bounds ANY time value (a point estimate, or a range's low/high
// endpoint individually) against the nearest real PBs bracketing the
// target — pace can't sensibly be faster than a real shorter-distance
// result, nor slower than a real longer-distance one. Same principle
// the old recent-race system used (clampAgainstPbs in
// performance-predictor.ts); this engine never had an equivalent,
// which is exactly how a "potential" range could claim a 5K slower
// than the athlete's actual 10K pace, or an 800m slower than what
// their 1500m/3000m results already prove they can hold. A 3% buffer
// leaves genuine room for day-to-day and distance-specific variation
// without allowing a physiologically backwards number through.
function clampToBrackets(targetKm: number, timeSec: number, others: WeightedPb[]): number {
  let pace = timeSec / targetKm;
  const { shorter, longer } = bracketingPbs(others, targetKm);
  if (shorter) pace = Math.max(pace, (shorter.timeSec / shorter.distanceKm) * 0.97);
  if (longer) pace = Math.min(pace, (longer.timeSec / longer.distanceKm) * 1.03);
  return pace * targetKm;
}

// A flat percentage range doesn't mean the same thing at every
// distance — 5% of an 800m time is ~5-6 seconds (a genuinely different
// tactical race), while 5% of a marathon is several minutes (normal
// day-to-day variability). Scales whatever the confidence tier already
// decided by distance, referenced around 15km (roughly where a
// percentage range starts feeling proportionate), floored so very
// short distances still get a real range and capped so very long ones
// don't balloon further than the tier system already allows.
function distanceRangeScale(targetKm: number): number {
  return Math.max(0.4, Math.min(1.3, Math.sqrt(targetKm / 15)));
}

// The athlete's single best recent, reliable VDOT — a genuinely
// different question from "is this result consistent with the rest of
// the profile" (which is what the local fit / potential answers). This
// is "what does this athlete's BEST current fitness, wherever it was
// demonstrated, look like applied here" — the answer to "what's the
// upside," not "what's the average." At an athlete's own strongest
// event this will land at (or essentially at) their actual PB there —
// correctly, since there's no faster fitness on file to draw on — but
// at any OTHER distance it can show real, data-grounded room above
// what local consistency alone implies. Recency-filtered so an old,
// no-longer-representative peak doesn't get used as today's ceiling.
function bestRecentVdot(weighted: WeightedPb[]): number | null {
  const candidates = weighted.filter((p) => p.recencyWeight >= 0.4);
  const pool = candidates.length > 0 ? candidates : weighted;
  if (pool.length === 0) return null;
  return Math.max(...pool.map((p) => p.vdot));
}

export function predictFromProfile(profile: AthleteProfile, targetLabel: string, targetKm: number): ProfilePrediction | null {
  if (!Number.isFinite(targetKm) || targetKm <= 0) return null;
  const lnTarget = Math.log(targetKm);
  const peakVdot = bestRecentVdot(profile.weighted);

  // A real result at (or essentially at) this distance beats any
  // projection. Still given a small range (not zero-width) — even a
  // proven result has some real day-to-day variance, and a flat single
  // number reads as falsely precise next to every other row's range.
  let exactPb: WeightedPb | null = null;
  let bestGap = Infinity;
  for (const p of profile.weighted) {
    const gap = Math.abs(Math.log(p.distanceKm / targetKm));
    if (gap < bestGap) {
      bestGap = gap;
      exactPb = p;
    }
  }
  if (exactPb && bestGap <= PB_EXACT_MATCH_TOLERANCE) {
    const pbRangePct = TIER_META[5].rangePct * distanceRangeScale(targetKm);
    const result: ProfilePrediction = {
      label: targetLabel,
      km: targetKm,
      timeSec: exactPb.timeSec,
      lowSec: exactPb.timeSec * (1 - pbRangePct / 100),
      highSec: exactPb.timeSec * (1 + pbRangePct / 100),
      paceSecPerKm: exactPb.timeSec / exactPb.distanceKm,
      tier: 5,
      confidencePct: 100,
      isPb: true,
    };

    // "Potential" — what every OTHER PB implies is achievable here,
    // deliberately excluding this one (and anything else within the
    // same match tolerance) so it's an independent read, not an echo
    // of the PB itself back at ~full weight.
    const others = profile.weighted.filter((p) => Math.abs(Math.log(p.distanceKm / targetKm)) > PB_EXACT_MATCH_TOLERANCE);
    if (others.length > 0) {
      const est = localVdotEstimate(others, lnTarget, profile.globalCurve?.slope ?? null);
      const rawPotential = est ? raceTimeFromVdot(targetKm, est.vdot) : null;
      if (rawPotential != null) {
        const potentialTimeSec = clampToBrackets(targetKm, rawPotential, others);
        const potentialConfidencePct = confidenceForTarget(others, lnTarget, est!.rSquared, profile.overallConsistency);
        const potentialTier = tierFromPct(potentialConfidencePct);
        // Capped tighter than the normal tier width — "potential" is
        // still built from directly-adjacent real PBs even after
        // excluding this one, which is materially stronger evidence
        // than the low/very-low tiers (designed for genuinely distant,
        // thin-evidence targets like a Marathon prediction from a
        // miler) were calibrated for. Without this cap, excluding a
        // well-supported PB from its own neighborhood was producing
        // ranges wide enough to look like guesses rather than a
        // grounded read of nearby evidence.
        const potentialRangePct = Math.min(TIER_META[potentialTier].rangePct, 5) * distanceRangeScale(targetKm);
        result.potentialTimeSec = potentialTimeSec;
        // The fast/low end blends two different questions: what does
        // LOCAL consistency alone suggest (potentialTimeSec's own
        // range), and what does this athlete's single BEST demonstrated
        // fitness elsewhere imply if applied here (peakVdot) — takes
        // whichever is more optimistic. At the athlete's own strongest
        // event these two already agree (nothing to be more optimistic
        // than), so it correctly shows no manufactured upside there;
        // at a secondary event it's what actually answers "how much
        // more is in the tank," not just "is this result consistent."
        const consistencyLow = potentialTimeSec * (1 - potentialRangePct / 100);
        const peakLow = peakVdot != null ? raceTimeFromVdot(targetKm, peakVdot) : null;
        const optimisticLow = peakLow != null ? Math.min(consistencyLow, peakLow) : consistencyLow;
        result.potentialLowSec = clampToBrackets(targetKm, optimisticLow, others);
        // Range endpoints clamped individually too — a wide tier
        // shouldn't be able to push the slow end past what a real
        // longer-distance PB already proves, even when the center
        // estimate itself is fine.
        result.potentialHighSec = clampToBrackets(targetKm, potentialTimeSec * (1 + potentialRangePct / 100), others);
        result.potentialTier = potentialTier;
      }
    }

    return result;
  }

  // Locally weighted fit — this target's own fresh regression, built
  // primarily from nearby PBs (the distance kernel) weighted by
  // recency, reliability, consistency, and performance quality, NOT a
  // read from one global curve. This is what stops a 1000m prediction
  // from being dragged toward a marathon PB just because they're both
  // on the same overall line — distant PBs contribute almost nothing
  // to the weight sum here, so they can barely move the local fit.
  const est = localVdotEstimate(profile.weighted, lnTarget, profile.globalCurve?.slope ?? null);
  if (!est) return null;
  const rawTimeSec = raceTimeFromVdot(targetKm, est.vdot);
  if (rawTimeSec == null) return null;
  const timeSec = clampToBrackets(targetKm, rawTimeSec, profile.weighted);

  // Stage 4 — confidence: data volume (40%) + recency (30%) +
  // consistency (20%) + distance from target (10%), in that priority
  // order, as specified. "Nearby" uses the same distance kernel the
  // prediction itself was built from, so confidence and the prediction
  // are answering the same question about the same evidence.
  const confidencePct = confidenceForTarget(profile.weighted, lnTarget, est.rSquared, profile.overallConsistency);
  const tier = tierFromPct(confidencePct);
  const rangePct = TIER_META[tier].rangePct * distanceRangeScale(targetKm);

  // Same peak-fitness blend as the PB branch above — the fast end
  // reflects the more optimistic of "local consistency" and "this
  // athlete's best demonstrated fitness elsewhere, applied here."
  const consistencyLow = timeSec * (1 - rangePct / 100);
  const peakLow = peakVdot != null ? raceTimeFromVdot(targetKm, peakVdot) : null;
  const optimisticLow = peakLow != null ? Math.min(consistencyLow, peakLow) : consistencyLow;

  return {
    label: targetLabel,
    km: targetKm,
    timeSec,
    lowSec: clampToBrackets(targetKm, optimisticLow, profile.weighted),
    highSec: clampToBrackets(targetKm, timeSec * (1 + rangePct / 100), profile.weighted),
    paceSecPerKm: timeSec / targetKm,
    tier,
    confidencePct: Math.round(confidencePct),
    isPb: false,
  };
}
