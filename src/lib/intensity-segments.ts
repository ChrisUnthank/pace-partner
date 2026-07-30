// Intensity-segment classification for continuous efforts (races, tempo
// runs, long runs — a single block with no rest breaks, as opposed to a
// genuine interval/rep session with real recovery between reps).
//
// WHY THIS EXISTS
// A plain HR-threshold lookup (what recompute_session_zones does in the DB,
// and what this module's caller falls back to when no raw point trace
// exists) cannot tell these three things apart, because they can produce an
// identical average HR over a long window:
//   1. A continuous race that drifted into Z4/Z5 purely from cardiac drift
//      (heat, dehydration, duration) — the energy system used the whole way
//      stayed aerobic; the elevated HR is a lagging, plateauing artifact,
//      not evidence of anaerobic contribution.
//   2. A genuine mid-race surge (a hard final kilometre, surging to pass
//      someone) — a real, shorter-duration harder effort embedded inside an
//      otherwise-aerobic continuous block.
//   3. A genuine short finishing sprint (last 100-400m) — real anaerobic
//      contribution, but brief.
//
// HR alone can't distinguish these because it's a LAGGING indicator (takes
// 30-90s to catch up to a real effort change) and PLATEAUS at high
// intensity (a steady hard race and a sprint can show the same flat-line
// high HR). This module cross-checks HR against two other signals raw GPS
// data actually provides:
//   - Time at Intensity (TAI) — how long, continuously, HR has actually
//     been elevated. Genuine anaerobic/VO2 efforts are physiologically
//     capped in duration; a long unbroken high-HR block that ISN'T embedded
//     surges is drift, not effort.
//   - Onset slope (dHR/dt) — a genuine hard effort launches with a sharp,
//     immediate HR rise. Cardiac drift creeps up gradually over minutes.
//   - Pace surge — a genuine harder effort should show a correspondingly
//     faster pace than the block's own baseline. Drift shows elevated HR
//     at essentially UNCHANGED pace — the giveaway that effort didn't
//     actually increase, only the cardiovascular cost of sustaining it did.
//
// A genuine effort needs at least one of onset-slope or pace-surge to
// confirm it — elevated HR by itself is deliberately not enough evidence,
// per the whole point of this module.
//
// NONE of this applies to genuine interval/rep sessions (real recovery
// between reps) — each rep's own average HR against threshold already
// classifies it correctly on its own merits; this module is specifically
// for the "one long continuous block" case where plain averaging fails.

export type HrZoneKey = "easy" | "steady" | "threshold" | "vo2" | "rep";

const ZONE_KEYS: HrZoneKey[] = ["easy", "steady", "threshold", "vo2", "rep"];

export interface IntensityPoint {
  elapsedS: number;
  hr: number | null;
  paceSecPerKm: number | null;
}

export interface HrZoneBoundaries {
  z1Max: number | null; // easy ceiling
  z2Max: number | null; // steady ceiling
  z3Max: number | null; // threshold ceiling
  z4Max: number | null; // vo2 ceiling — above this is "rep"
}

export function hrZoneFor(hr: number, zones: HrZoneBoundaries): HrZoneKey {
  if (zones.z1Max != null && hr <= zones.z1Max) return "easy";
  if (zones.z2Max != null && hr <= zones.z2Max) return "steady";
  if (zones.z3Max != null && hr <= zones.z3Max) return "threshold";
  if (zones.z4Max != null && hr <= zones.z4Max) return "vo2";
  return "rep";
}

function emptyZoneSeconds(): Record<HrZoneKey, number> {
  return { easy: 0, steady: 0, threshold: 0, vo2: 0, rep: 0 };
}

// Raw Time-at-Intensity per zone — no drift correction, just the plain
// per-point-threshold sum. This is what a short continuous effort (under
// the cap, see computeRefinedContinuousZoneTime) uses as-is, and what the
// refined calculation starts from before correcting the long-block case.
export function computeTaiByZone(points: IntensityPoint[], zones: HrZoneBoundaries): Record<HrZoneKey, number> {
  const totals = emptyZoneSeconds();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = cur.elapsedS - prev.elapsedS;
    if (dt <= 0 || cur.hr == null) continue;
    totals[hrZoneFor(cur.hr, zones)] += dt;
  }
  return totals;
}

export interface IntensityRun {
  startIdx: number;
  endIdx: number;
  startS: number;
  endS: number;
  durationS: number;
  avgHr: number;
  avgPaceSecPerKm: number | null;
}

// Contiguous stretches where HR sits at/above the vo2 boundary. Runs
// shorter than minDurationS are dropped as sensor noise (a single spurious
// high HR sample isn't a real effort). Not exported as the "answer" on its
// own — each run still needs onset-slope and pace-surge evaluation before
// it's trusted as genuine (see classifyRun).
export function findHighIntensityRuns(points: IntensityPoint[], zones: HrZoneBoundaries, minDurationS = 15): IntensityRun[] {
  const runs: IntensityRun[] = [];
  let runStart: number | null = null;

  const closeRun = (startIdx: number, endIdx: number) => {
    const startS = points[startIdx].elapsedS;
    const endS = points[endIdx].elapsedS;
    const durationS = endS - startS;
    if (durationS < minDurationS) return;

    const slice = points.slice(startIdx, endIdx + 1);
    const hrs = slice.map((p) => p.hr).filter((h): h is number => h != null);
    const paces = slice.map((p) => p.paceSecPerKm).filter((p): p is number => p != null);
    if (hrs.length === 0) return;

    runs.push({
      startIdx,
      endIdx,
      startS,
      endS,
      durationS,
      avgHr: hrs.reduce((a, b) => a + b, 0) / hrs.length,
      avgPaceSecPerKm: paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null,
    });
  };

  for (let i = 0; i < points.length; i++) {
    const hr = points[i].hr;
    const isHigh = hr != null && (hrZoneFor(hr, zones) === "vo2" || hrZoneFor(hr, zones) === "rep");
    if (isHigh && runStart == null) {
      runStart = i;
    } else if (!isHigh && runStart != null) {
      closeRun(runStart, i - 1);
      runStart = null;
    }
  }
  if (runStart != null) closeRun(runStart, points.length - 1);

  return runs;
}

// A run found above is one CONTIGUOUS stretch of vo2/rep-zone points — but
// a real race commonly drifts gradually into a high HR zone and THEN
// kicks, with no dip back down to a lower zone in between the drift and
// the kick. That whole stretch shows up as a single run. Classifying it as
// one atomic unit would wrongly tar the genuine kick with the drift's
// "not confirmed" verdict (or, just as wrong, let the kick's real pace
// surge drag the drifted portion's average enough to look like a false
// positive for the whole thing). This scans for the single best split
// point within a run's back half where the tail (candidate kick) is
// genuinely faster than the head (candidate drift) by at least
// minSurgePct — if found, the run gets evaluated as two pieces instead of
// one. Returns null when no such internal acceleration exists, meaning
// the run really is uniform and a single evaluation applies as-is.
export function findKickSplitWithinRun(
  points: IntensityPoint[],
  run: IntensityRun,
  minSurgePct = 0.08,
  minKickDurationS = 15,
  maxKickDurationS = 8 * 60,
): number | null {
  const runLength = run.endIdx - run.startIdx + 1;
  if (runLength < 4) return null;

  let bestSplit: number | null = null;
  let bestImprovement = minSurgePct;

  // Only search the back half of the run — a kick is by definition near
  // the end of a hard effort, not scattered arbitrarily through it.
  const searchStart = run.startIdx + Math.floor(runLength * 0.5);

  for (let split = searchStart; split <= run.endIdx; split++) {
    const tailDurationS = points[run.endIdx].elapsedS - points[split].elapsedS;
    if (tailDurationS < minKickDurationS || tailDurationS > maxKickDurationS) continue;

    const headPaces = points
      .slice(run.startIdx, split)
      .map((p) => p.paceSecPerKm)
      .filter((p): p is number => p != null);
    const tailPaces = points
      .slice(split, run.endIdx + 1)
      .map((p) => p.paceSecPerKm)
      .filter((p): p is number => p != null);
    if (!headPaces.length || !tailPaces.length) continue;

    const headAvg = headPaces.reduce((a, b) => a + b, 0) / headPaces.length;
    const tailAvg = tailPaces.reduce((a, b) => a + b, 0) / tailPaces.length;
    if (headAvg <= 0) continue;

    const improvement = (headAvg - tailAvg) / headAvg;
    if (improvement >= bestImprovement) {
      bestImprovement = improvement;
      bestSplit = split;
    }
  }

  return bestSplit;
}

function sliceRun(points: IntensityPoint[], startIdx: number, endIdx: number): IntensityRun {
  const startS = points[startIdx].elapsedS;
  const endS = points[endIdx].elapsedS;
  const slice = points.slice(startIdx, endIdx + 1);
  const hrs = slice.map((p) => p.hr).filter((h): h is number => h != null);
  const paces = slice.map((p) => p.paceSecPerKm).filter((p): p is number => p != null);
  return {
    startIdx,
    endIdx,
    startS,
    endS,
    durationS: endS - startS,
    avgHr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0,
    avgPaceSecPerKm: paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null,
  };
}

// Splits a run into [head, kick] sub-runs if findKickSplitWithinRun finds a
// genuine internal acceleration, otherwise returns the run unchanged as a
// single-element array — callers always get back one or more runs to
// classify independently, never needing to know which case applied.
export function splitRunIfKickPresent(points: IntensityPoint[], run: IntensityRun): IntensityRun[] {
  const split = findKickSplitWithinRun(points, run);
  if (split == null) return [run];
  return [sliceRun(points, run.startIdx, split - 1), sliceRun(points, split, run.endIdx)];
}

// dHR/dt (bpm per second) over the window immediately before a run starts —
// a genuine hard-effort launch shows a sharp, immediate rise; a race
// settling into pace over the first 1-2km shows a gentle one. Returns null
// when there's no usable baseline point (e.g. the run starts at the very
// beginning of the recording).
export function computeOnsetSlope(points: IntensityPoint[], runStartIdx: number, lookbackS = 45): number | null {
  const runStart = points[runStartIdx];
  if (runStart?.hr == null) return null;

  let baselineIdx = runStartIdx;
  for (let i = runStartIdx; i >= 0; i--) {
    if (runStart.elapsedS - points[i].elapsedS > lookbackS) break;
    baselineIdx = i;
  }

  const baseline = points[baselineIdx];
  if (baseline.hr == null || baseline.elapsedS === runStart.elapsedS) return null;

  return (runStart.hr - baseline.hr) / (runStart.elapsedS - baseline.elapsedS);
}

// The block's own baseline pace, computed excluding whatever high-intensity
// runs were found — this is "what pace was this effort actually holding
// outside the flagged stretches," the reference point a run gets compared
// against to see if it's really a surge or just elevated HR at the same pace.
export function computeBaselinePace(points: IntensityPoint[], excludeRuns: IntensityRun[]): number | null {
  const excluded = new Set<number>();
  for (const run of excludeRuns) {
    for (let i = run.startIdx; i <= run.endIdx; i++) excluded.add(i);
  }
  const paces = points
    .filter((_, i) => !excluded.has(i))
    .map((p) => p.paceSecPerKm)
    .filter((p): p is number => p != null);

  if (!paces.length) return null;
  return paces.reduce((a, b) => a + b, 0) / paces.length;
}

// True if a run's pace is meaningfully faster than the block's baseline —
// pace is measured in sec/km, so faster = lower. minSurgePct is the
// fractional improvement required (0.08 = at least 8% faster) before it
// counts as a real surge rather than ordinary pace noise.
export function isPaceSurge(run: IntensityRun, baselinePaceSecPerKm: number | null, minSurgePct = 0.08): boolean {
  if (run.avgPaceSecPerKm == null || baselinePaceSecPerKm == null || baselinePaceSecPerKm <= 0) return false;
  return (baselinePaceSecPerKm - run.avgPaceSecPerKm) / baselinePaceSecPerKm >= minSurgePct;
}

export type RunClassification = "anaerobic" | "vo2" | "drift";

// A run only counts as genuine effort (not drift) if it's confirmed by
// EITHER a steep onset slope OR a real pace surge — elevated HR by itself
// is deliberately insufficient evidence, since that's exactly the signal
// cardiac drift also produces. Among confirmed runs, duration decides
// anaerobic (short, explosive — a finishing kick) vs vo2 (sustained
// harder effort, e.g. a hard final kilometre) — matching the "short vs
// medium work burst" distinction real interval sessions show structurally,
// applied here to a single embedded surge instead.
export function classifyRun(
  run: IntensityRun,
  onsetSlopeBpmPerSec: number | null,
  paceSurgeConfirmed: boolean,
  steepSlopeThreshold = 0.15,
): RunClassification {
  const steepOnset = onsetSlopeBpmPerSec != null && onsetSlopeBpmPerSec >= steepSlopeThreshold;

  if (!paceSurgeConfirmed && !steepOnset) return "drift";
  if (run.durationS <= 60) return "anaerobic";
  return "vo2";
}

export interface DetectedRun {
  startS: number;
  endS: number;
  durationS: number;
  classification: RunClassification;
}

export interface ZoneTimeResult {
  seconds: Record<HrZoneKey, number>;
  detectedRuns: DetectedRun[];
}

// Main entry point for a continuous block (steps.reps <= 1, not a recovery
// step). Blocks at or under continuousCapMinutes are returned as plain TAI
// with no correction — a continuous effort short enough to genuinely BE
// anaerobic/VO2-dominant (a hard 1500-3000m time trial run as one block)
// shouldn't have that flattened out just for being logged as a single rep.
// Above that length, every vo2/rep-zone stretch gets evaluated: confirmed
// genuine efforts (anaerobic or vo2) keep their real zone time, everything
// else — the drift — gets folded down into "threshold" rather than
// inflating vo2/rep with sustained cardiac drift.
export function computeRefinedContinuousZoneTime(
  points: IntensityPoint[],
  zones: HrZoneBoundaries,
  continuousCapMinutes = 12,
): ZoneTimeResult {
  if (points.length < 2) return { seconds: emptyZoneSeconds(), detectedRuns: [] };

  const totalDurationS = points[points.length - 1].elapsedS - points[0].elapsedS;

  if (totalDurationS <= continuousCapMinutes * 60) {
    return { seconds: computeTaiByZone(points, zones), detectedRuns: [] };
  }

  const runs = findHighIntensityRuns(points, zones);
  const baselinePace = computeBaselinePace(points, runs);

  const detectedRuns: DetectedRun[] = [];
  const genuineIndices = new Set<number>();

  for (const rawRun of runs) {
    // Split first — a run that drifts straight into a kick with no zone
    // dip in between must not be classified as one atomic block (see
    // findKickSplitWithinRun for why).
    for (const run of splitRunIfKickPresent(points, rawRun)) {
      const slope = computeOnsetSlope(points, run.startIdx);
      const surge = isPaceSurge(run, baselinePace);
      const classification = classifyRun(run, slope, surge);

      detectedRuns.push({ startS: run.startS, endS: run.endS, durationS: run.durationS, classification });

      if (classification !== "drift") {
        for (let i = run.startIdx; i <= run.endIdx; i++) genuineIndices.add(i);
      }
    }
  }

  const seconds = emptyZoneSeconds();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = cur.elapsedS - prev.elapsedS;
    if (dt <= 0 || cur.hr == null) continue;

    let zone = hrZoneFor(cur.hr, zones);
    if ((zone === "vo2" || zone === "rep") && !genuineIndices.has(i)) {
      zone = "threshold";
    }
    seconds[zone] += dt;
  }

  return { seconds, detectedRuns };
}

// ── Work:rest sparsity (genuine interval/rep sessions) ──────────────────────
//
// A secondary, confirmatory signal for real interval sessions (NOT
// continuous blocks — those are handled entirely above). Distinguishes
// anaerobic-rep-style structure (short bursts, long full-recovery gaps)
// from VO2-interval-style structure (longer bursts, incomplete recovery —
// HR never fully drops between reps) per the classic work:rest convention.
// Each rep's own average HR already classifies it reasonably against
// threshold on its own (the bug this module exists for is specific to
// continuous single blocks) — this is exposed as an additional descriptive
// signal for anything that wants to label a session's overall interval
// character, not a correction to per-rep zone time.
export interface WorkRestSparsity {
  avgWorkDurationS: number;
  avgRestDurationS: number | null;
  workToRestRatio: number | null;
  recoveryDepthBpm: number | null; // how far HR actually drops during rest, on average
  character: "anaerobic_reps" | "vo2_intervals" | "unknown";
}

export interface RepBlock {
  workDurationS: number;
  workAvgHr: number | null;
  restDurationS: number | null;
  restMinHr: number | null;
}

export function computeWorkRestSparsity(reps: RepBlock[]): WorkRestSparsity {
  if (reps.length === 0) {
    return { avgWorkDurationS: 0, avgRestDurationS: null, workToRestRatio: null, recoveryDepthBpm: null, character: "unknown" };
  }

  const workDurations = reps.map((r) => r.workDurationS);
  const avgWorkDurationS = workDurations.reduce((a, b) => a + b, 0) / workDurations.length;

  const restDurations = reps.map((r) => r.restDurationS).filter((d): d is number => d != null);
  const avgRestDurationS = restDurations.length ? restDurations.reduce((a, b) => a + b, 0) / restDurations.length : null;

  const workToRestRatio = avgRestDurationS && avgRestDurationS > 0 ? avgWorkDurationS / avgRestDurationS : null;

  const depths = reps
    .filter((r) => r.workAvgHr != null && r.restMinHr != null)
    .map((r) => r.workAvgHr! - r.restMinHr!);
  const recoveryDepthBpm = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : null;

  // Short bursts (<60s) with deep, near-complete recovery (HR drops a lot,
  // ratio well under 1:1) reads as classic anaerobic reps. Longer bursts
  // (2-5min) with recovery that never lets HR fully settle (shallow drop,
  // ratio closer to or above 1:1) reads as VO2 intervals. Anything that
  // doesn't clearly fit either pattern is left unknown rather than forced.
  let character: WorkRestSparsity["character"] = "unknown";
  if (avgWorkDurationS <= 60 && recoveryDepthBpm != null && recoveryDepthBpm >= 25 && (workToRestRatio == null || workToRestRatio <= 0.6)) {
    character = "anaerobic_reps";
  } else if (
    avgWorkDurationS >= 120 &&
    avgWorkDurationS <= 300 &&
    (recoveryDepthBpm == null || recoveryDepthBpm < 20) &&
    (workToRestRatio == null || workToRestRatio >= 0.8)
  ) {
    character = "vo2_intervals";
  }

  return { avgWorkDurationS, avgRestDurationS, workToRestRatio, recoveryDepthBpm, character };
}

export { ZONE_KEYS };
