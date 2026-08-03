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
  weight: number; // recency x reliability x consistency
};

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
// Stage 2/3 combined — the athlete profile: weighted PBs, the final
// (consistency-reweighted) curve, and the derived shape/index metrics.
// ---------------------------------------------------------------------

export type ProfileShape = {
  // -1 (strong speed bias) .. +1 (strong endurance bias), 0 = balanced.
  biasScore: number;
  label: "Sprint Bias" | "Speed Bias" | "Balanced" | "Aerobic Bias" | "Endurance Bias";
  // Five-band relative-strength bars for display, index-matched to
  // ["Sprint Bias","Speed Bias","Balanced","Aerobic Bias","Endurance Bias"],
  // each 0-10.
  bars: number[];
};

export type AthleteProfile = {
  weighted: WeightedPb[];
  curve: LinearFit | null;
  shape: ProfileShape;
  speedScore: number | null; // weighted-average VDOT, 800m-1500m PBs
  aerobicScore: number | null; // weighted-average VDOT, 5K-Half PBs
  speedEnduranceDecay: number | null; // dVDOT/d(ln km), 800m-3000m
  aerobicDurabilityDecay: number | null; // dVDOT/d(ln km), 5K-Half
  overallConsistency: number; // 0-1, the final curve's weighted R^2 (0 if no curve)
};

const SHAPE_BAND_POSITIONS = [-1, -0.5, 0, 0.5, 1];
const SHAPE_LABELS: ProfileShape["label"][] = ["Sprint Bias", "Speed Bias", "Balanced", "Aerobic Bias", "Endurance Bias"];

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

export function buildAthleteProfile(pbs: PbRecord[], now: Date = new Date()): AthleteProfile | null {
  const clean = pbs.filter((p) => Number.isFinite(p.distanceKm) && p.distanceKm > 0 && Number.isFinite(p.timeSec) && p.timeSec > 0);
  const withVdot = clean
    .map((p) => ({ ...p, vdot: estimateVdot(p.distanceKm, p.timeSec) }))
    .filter((p): p is PbRecord & { vdot: number } => p.vdot != null);
  if (withVdot.length === 0) return null;

  // Stage 1
  let weighted: WeightedPb[] = withVdot.map((p) => {
    const rec = recencyWeight(p.dateISO, now);
    const rel = reliabilityWeight(p.isRace);
    return { ...p, recencyWeight: rec, reliabilityWeight: rel, consistencyWeight: 1, weight: rec * rel };
  });

  // Stage 2 (first pass) + Stage 3 (residual-based reweight, then refit)
  const fitPoints = (list: WeightedPb[]) => list.map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight }));
  let curve = weightedLinearFit(fitPoints(weighted));

  if (curve && weighted.length >= 3) {
    const residuals = weighted.map((p) => p.vdot - (curve!.intercept + curve!.slope * Math.log(p.distanceKm)));
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
    curve = weightedLinearFit(fitPoints(weighted)); // final, reweighted curve
  }

  const shape = curve ? shapeFromSlope(curve.slope) : { biasScore: 0, label: "Balanced" as const, bars: [2, 4, 10, 4, 2] };

  const speedScore = weightedAverage(weighted.filter((p) => p.distanceKm >= 0.7 && p.distanceKm <= 1.7).map((p) => ({ y: p.vdot, w: p.weight })));
  const aerobicScore = weightedAverage(weighted.filter((p) => p.distanceKm >= 4.5 && p.distanceKm <= 22).map((p) => ({ y: p.vdot, w: p.weight })));

  const speedEnduranceFit = weightedLinearFit(
    weighted.filter((p) => p.distanceKm >= 0.7 && p.distanceKm <= 3.3).map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight })),
  );
  const aerobicDurabilityFit = weightedLinearFit(
    weighted.filter((p) => p.distanceKm >= 4.5 && p.distanceKm <= 22).map((p) => ({ x: Math.log(p.distanceKm), y: p.vdot, w: p.weight })),
  );

  return {
    weighted,
    curve,
    shape,
    speedScore,
    aerobicScore,
    speedEnduranceDecay: speedEnduranceFit?.slope ?? null,
    aerobicDurabilityDecay: aerobicDurabilityFit?.slope ?? null,
    overallConsistency: curve?.rSquared ?? 0,
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
};

const PB_EXACT_MATCH_TOLERANCE = 0.03;

export function predictFromProfile(profile: AthleteProfile, targetLabel: string, targetKm: number): ProfilePrediction | null {
  if (!Number.isFinite(targetKm) || targetKm <= 0) return null;

  // A real result at (or essentially at) this distance beats any
  // projection from the curve — same principle as before, still holds
  // here.
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
    return {
      label: targetLabel,
      km: targetKm,
      timeSec: exactPb.timeSec,
      lowSec: exactPb.timeSec,
      highSec: exactPb.timeSec,
      paceSecPerKm: exactPb.timeSec / exactPb.distanceKm,
      tier: 5,
      confidencePct: 100,
      isPb: true,
    };
  }

  if (!profile.curve) return null; // not enough distinct-distance PBs to fit a curve at all

  const predictedVdot = profile.curve.intercept + profile.curve.slope * Math.log(targetKm);
  const timeSec = raceTimeFromVdot(targetKm, predictedVdot);
  if (timeSec == null) return null;

  // Stage 4 — confidence: data volume (40%) + recency (30%) +
  // consistency (20%) + distance from target (10%), in that priority
  // order, as specified.
  const lnTarget = Math.log(targetKm);
  const nearby = profile.weighted.filter((p) => Math.abs(Math.log(p.distanceKm) - lnTarget) <= 1.0);
  const nearbyWeight = nearby.reduce((s, p) => s + p.weight, 0);
  const dataVolumeScore = Math.min(100, (nearbyWeight / 2.5) * 100);

  const recencyBasis = nearby.length > 0 ? nearby : profile.weighted;
  const recencyScore = 100 * (weightedAverage(recencyBasis.map((p) => ({ y: p.recencyWeight, w: p.weight }))) ?? 0.5);

  const consistencyScore = 100 * profile.overallConsistency;

  const nearestGap = Math.min(...profile.weighted.map((p) => Math.abs(Math.log(p.distanceKm) - lnTarget)));
  const distanceScore = Math.max(0, 100 * (1 - nearestGap / 1.5));

  const confidencePct = 0.4 * dataVolumeScore + 0.3 * recencyScore + 0.2 * consistencyScore + 0.1 * distanceScore;
  const tier = tierFromPct(confidencePct);
  const rangePct = TIER_META[tier].rangePct;

  return {
    label: targetLabel,
    km: targetKm,
    timeSec,
    lowSec: timeSec * (1 - rangePct / 100),
    highSec: timeSec * (1 + rangePct / 100),
    paceSecPerKm: timeSec / targetKm,
    tier,
    confidencePct: Math.round(confidencePct),
    isPb: false,
  };
}
