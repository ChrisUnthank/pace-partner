// Rep-level 100m split analysis — the calculation engine behind the "View
// splits" popup on Session Analysis. Deliberately kept dependency-free from
// React/JSX (same convention as session-metrics.ts) so every function here
// can be unit-tested directly with `node -e` against real recorded numbers,
// per the project's numerical-model-verification convention.
//
// WHY A SEPARATE COPY OF THE SLICE/BUCKET LOGIC
// app.sessions.$sessionId.analysis.tsx already has sliceRawPointsByRep() and
// splitRepPointsIntoBuckets() doing very similar distance-bucketing for the
// "By km"/"By lap" rep-chart toggle. This module deliberately keeps its own
// copies (sliceRepPoints / build100mSplits) rather than importing from that
// 4000+ line route file: the existing functions only return
// {durationS, distanceM, avgPace, isPartial} — not the avgHr/avgCadence/
// avgVo/avgGct/strideLength this feature needs — and reaching into a route
// file's internals from a shared lib is fragile. The bucketing algorithm and
// constants (dead-time speed threshold, rep-slice gap threshold) are kept
// IDENTICAL to the existing, already-validated logic so results agree with
// what the "By lap"/"By km" chart already shows for the same rep.

import { normalizeVO, computeStrideLengthM } from "@/lib/session-metrics";
import { computeBearingDeg } from "@/lib/wind";

export type RepPointLike = {
  elapsed_s?: number | null;
  distance_m?: number | null;
  hr?: number | null;
  pace_sec_per_km?: number | null;
  cadence?: number | null;
  elevation_m?: number | null;
  vertical_oscillation_cm?: number | null;
  ground_contact_time_ms?: number | null;
  segment_type?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type RepRowLike = {
  type: string;
  distanceM: number;
};

// A stationary/near-stationary stretch (standing drills, a dead GPS patch)
// shouldn't inflate a split's pace — same 0.3 m/s convention (≈56 min/km,
// well below even a very easy walk) already used for the session's own
// distance-based splits.
const DEAD_TIME_SPEED_THRESHOLD_MPS = 0.3;

// A gap this large between two consecutive recorded WORK points means
// something was excised in between (recovery, a pause) rather than genuine
// continuous recording — same 20s convention as the existing rep-slicing
// logic on the analysis page.
const REP_SLICE_GAP_THRESHOLD_S = 20;

function deadSecondsInSlice(slice: RepPointLike[]): number {
  if (!Array.isArray(slice) || slice.length < 2) return 0;
  let dead = 0;
  for (let i = 1; i < slice.length; i++) {
    const dt = Number(slice[i].elapsed_s ?? 0) - Number(slice[i - 1].elapsed_s ?? 0);
    if (dt <= 0) continue;
    const dd = Math.max(0, Number(slice[i].distance_m ?? 0) - Number(slice[i - 1].distance_m ?? 0));
    const speed = dd / dt;
    if (speed < DEAD_TIME_SPEED_THRESHOLD_MPS) dead += dt;
  }
  return dead;
}

type SliceMetrics = {
  durationS: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  avgCadence: number | null;
  avgVerticalOscillationCm: number | null;
  avgGroundContactTimeMs: number | null;
};

function metricsFromSlice(slice: RepPointLike[]): SliceMetrics {
  if (!Array.isArray(slice) || slice.length === 0) {
    return {
      durationS: 0,
      distanceM: 0,
      avgPaceSecPerKm: null,
      avgHr: null,
      avgCadence: null,
      avgVerticalOscillationCm: null,
      avgGroundContactTimeMs: null,
    };
  }

  const first = slice[0];
  const last = slice[slice.length - 1];

  const durationS = Math.max(0, Number(last.elapsed_s ?? 0) - Number(first.elapsed_s ?? 0));
  const distanceM = Math.max(0, Number(last.distance_m ?? 0) - Number(first.distance_m ?? 0));

  const hrs = slice.map((p) => p.hr).filter((x): x is number => typeof x === "number" && x > 0);
  const paces = slice
    .map((p) => p.pace_sec_per_km)
    .filter((x): x is number => typeof x === "number" && x > 0 && x <= 1800);
  const cads = slice.map((p) => p.cadence).filter((x): x is number => typeof x === "number" && x > 0);
  const vos = slice
    .map((p) => normalizeVO(p.vertical_oscillation_cm))
    .filter((x): x is number => typeof x === "number" && x > 0);
  const gcts = slice
    .map((p) => p.ground_contact_time_ms)
    .filter((x): x is number => typeof x === "number" && x > 0);

  const avgPaceSecPerKm =
    distanceM > 0 && durationS > 0
      ? (durationS / distanceM) * 1000
      : paces.length
        ? paces.reduce((a, b) => a + b, 0) / paces.length
        : null;

  return {
    durationS,
    distanceM,
    avgPaceSecPerKm,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    avgCadence: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    avgVerticalOscillationCm: vos.length
      ? Number((vos.reduce((a, b) => a + b, 0) / vos.length).toFixed(1))
      : null,
    avgGroundContactTimeMs: gcts.length ? Math.round(gcts.reduce((a, b) => a + b, 0) / gcts.length) : null,
  };
}

// Carves the full work/strides trace into one point-slice per rep, in
// chronological order, using each rep's own recorded distance (repRows) as
// the cut point rather than raw segment_type continuity — two back-to-back
// "work" reps with no detected recovery lap between them would otherwise
// get silently fused into one blob. Mirrors sliceRawPointsByRep on the
// analysis page exactly (same gap threshold, same cursor approach).
export function sliceRepPoints(points: RepPointLike[], repRows: RepRowLike[]): RepPointLike[][] {
  const workPoints = (points ?? [])
    .filter((p) => p && (p.segment_type === "work" || p.segment_type === "strides"))
    .sort((a, b) => Number(a.elapsed_s ?? 0) - Number(b.elapsed_s ?? 0));

  const slices: RepPointLike[][] = [];
  let cursor = 0;

  for (const rep of repRows) {
    const targetDist = Number(rep.distanceM ?? 0);
    if (targetDist <= 0 || cursor >= workPoints.length) {
      slices.push([]);
      continue;
    }

    const startIdx = cursor;
    const startDist = Number(workPoints[startIdx]?.distance_m ?? 0);
    let endIdx = startIdx;

    while (endIdx < workPoints.length - 1) {
      const distSoFar = Number(workPoints[endIdx].distance_m ?? 0) - startDist;
      if (distSoFar >= targetDist) break;

      const gap = Number(workPoints[endIdx + 1].elapsed_s ?? 0) - Number(workPoints[endIdx].elapsed_s ?? 0);
      if (gap >= REP_SLICE_GAP_THRESHOLD_S) break;

      endIdx++;
    }

    slices.push(workPoints.slice(startIdx, endIdx + 1));
    cursor = endIdx + 1;
  }

  return slices;
}

// GPS distance measurement on a track is a well-known weak point — tight
// bends cause satellite multipath/tangent-cutting errors that make a
// watch's own cumulative distance drift from the true distance, often by
// enough to shift a 1200m rep's own 100m split count by a full split (13
// splits' worth of GPS-measured distance for a real 1200m rep is a
// classic symptom). Elapsed TIME through a bend has no equivalent failure
// mode — the watch's clock doesn't care about satellite geometry — so
// time is trustworthy where distance isn't.
//
// This rescales every point's distance_m so the rep's own total lines up
// with `targetDistanceM` — the SAME authoritative, already-corrected
// total already shown everywhere else in the app for this rep (see the
// "* adjusted" distance in the Session segments table, computed in
// app.sessions.$sessionId.analysis.tsx). elapsed_s is left completely
// untouched; only distance moves, and it moves by a single proportional
// scale factor applied uniformly across the whole rep — appropriate for
// this specific failure mode, where GPS overshoot on a track accumulates
// roughly evenly across repeated bends rather than concentrating at one
// point in the rep. (The app's own rep-level correction elsewhere instead
// TRIMS the trace to the target distance when it overruns by more than
// 5% — appropriate there, since it's protecting a single rep-level
// distance/pace figure and doesn't need to preserve every point for
// further sub-splitting. Trimming would be the wrong tool here: it
// discards whichever points fall past the target, which is exactly the
// data this feature needs to keep in order to show 100m splits for the
// rep's full recorded length.)
export function calibrateDistanceToTarget(points: RepPointLike[], targetDistanceM: number | null | undefined): RepPointLike[] {
  if (!Array.isArray(points) || points.length < 2) return points;
  if (targetDistanceM == null || !(targetDistanceM > 0)) return points;

  const sorted = [...points].sort((a, b) => Number(a.elapsed_s ?? 0) - Number(b.elapsed_s ?? 0));
  const startDist = Number(sorted[0].distance_m ?? 0);
  const endDist = Number(sorted[sorted.length - 1].distance_m ?? 0);
  const recordedSpan = endDist - startDist;

  // Nothing usable to scale from, or the recorded span is already close
  // enough to the target that rescaling would just be adding floating-
  // point noise for no visible benefit.
  if (recordedSpan <= 0) return points;
  const deviationFrac = Math.abs(recordedSpan - targetDistanceM) / targetDistanceM;
  if (deviationFrac < 0.005) return points;

  const scale = targetDistanceM / recordedSpan;

  // Return in the SAME order as the input (not necessarily time-sorted —
  // callers may depend on original ordering), scaling each point's
  // distance relative to the rep's own start distance so the first point
  // stays anchored at its original value and only the SPAN is corrected.
  return points.map((p) => {
    const d = p.distance_m;
    if (typeof d !== "number") return p;
    return { ...p, distance_m: startDist + (d - startDist) * scale };
  });
}

export type Split = {
  index: number;
  distanceM: number;
  cumulativeDistanceM: number;
  durationS: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
  avgCadence: number | null;
  avgVerticalOscillationCm: number | null;
  avgGroundContactTimeMs: number | null;
  strideLengthM: number | null;
  isPartial: boolean;
  // Compass bearing (0-360, toward which the athlete was heading) across
  // this split's own first-to-last GPS fix — null when either end of the
  // split is missing a lat/lng (e.g. a GPS dropout, or an indoor/treadmill
  // session with no GPS trace at all). Used to classify this split's
  // relative wind (headwind/tailwind/crosswind) against a session's wind
  // reading — see src/lib/wind.ts.
  bearingDeg: number | null;
  // Every point in this split that had a real GPS fix, in order — used to
  // draw the split's own stretch of the route-shape map (a colour-coded
  // polyline per split, not just its two endpoints), so a curved bend
  // still reads as curved rather than getting straight-lined into a
  // chord. Empty when the split has no GPS points at all. distanceM is
  // this point's own cumulative rep distance (not just this split's) —
  // used by the route-shape map to work out how far into its OWN lap each
  // point is, for aligning repeated laps onto a shared shape (see
  // rep-split-analysis-dialog.tsx).
  path: Array<{ lat: number; lng: number; distanceM: number }>;
};

// Splits should be cut at the EXACT 100m mark — but the raw GPS trace
// only has samples every few seconds, so the true 100m point almost never
// lands exactly on a recorded point. Without this, build100mSplits used
// to snap the boundary to whichever raw point was the FIRST to reach or
// pass each mark, which produces two compounding problems whenever GPS
// sampling is sparse or a single point's recorded distance jumps
// unusually far (a real, common GPS artifact — e.g. brief signal
// degradation going around a bend):
//   1. That split runs long, however far the point overshot by.
//   2. The next mark hasn't moved (it only ever advances by one 100m
//      increment per detected boundary), so the very next point — even
//      if only a metre or two further along — immediately re-triggers a
//      boundary, producing a short split right after the long one.
// This function pre-processes the point trace and inserts a SYNTHETIC
// point, linearly interpolated between the two real points that bracket
// each exact 100m mark, for distance/time/lat/lng only. Per-point sensor
// readings (hr/cadence/pace/vo/gct) are deliberately left unset on these
// synthetic points — they exist purely to pin the precise moment and
// location of the mark; every split's own averages still come only from
// genuinely recorded points, via the existing metricsFromSlice filtering
// (which already ignores fields that aren't present).
function injectDistanceBoundaryPoints(sorted: RepPointLike[], splitDistanceM: number): RepPointLike[] {
  if (sorted.length < 2) return sorted;
  const startDist = Number(sorted[0].distance_m ?? 0);

  const out: RepPointLike[] = [sorted[0]];
  let nextMark = splitDistanceM;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dPrev = Number(prev.distance_m ?? 0) - startDist;
    const dCurr = Number(curr.distance_m ?? 0) - startDist;

    // A `while`, not `if` — a single real gap can span more than one 100m
    // mark (e.g. dPrev=95, dCurr=310 jumps past 100, 200, AND 300 in one
    // recorded step); each mark in that range gets its own interpolated
    // point rather than only the first.
    while (nextMark <= dCurr && nextMark > dPrev) {
      const frac = dCurr > dPrev ? (nextMark - dPrev) / (dCurr - dPrev) : 0;
      const elapsedPrev = Number(prev.elapsed_s ?? 0);
      const elapsedCurr = Number(curr.elapsed_s ?? 0);
      const lat =
        typeof prev.lat === "number" && typeof curr.lat === "number" ? prev.lat + frac * (curr.lat - prev.lat) : curr.lat;
      const lng =
        typeof prev.lng === "number" && typeof curr.lng === "number" ? prev.lng + frac * (curr.lng - prev.lng) : curr.lng;

      out.push({
        elapsed_s: elapsedPrev + frac * (elapsedCurr - elapsedPrev),
        distance_m: startDist + nextMark,
        lat,
        lng,
        segment_type: curr.segment_type,
      });

      nextMark += splitDistanceM;
    }

    out.push(curr);
  }

  return out;
}

// Buckets one rep's own point slice into fixed-distance splits (100m by
// default). Always aligns from the start of the rep — a genuine interval
// rep starts right at 0, so any leftover distance trails as a final
// (labelled) partial split rather than being redistributed to the front.
export function build100mSplits(repPoints: RepPointLike[], splitDistanceM = 100): Split[] {
  if (!Array.isArray(repPoints) || repPoints.length < 2 || splitDistanceM <= 0) return [];

  const sortedRaw = [...repPoints].sort((a, b) => Number(a.elapsed_s ?? 0) - Number(b.elapsed_s ?? 0));
  const sorted = injectDistanceBoundaryPoints(sortedRaw, splitDistanceM);
  const startDist = Number(sorted[0]?.distance_m ?? 0);
  const endDist = Number(sorted[sorted.length - 1]?.distance_m ?? 0);
  const totalDist = Math.max(0, endDist - startDist);
  if (totalDist <= 0) return [];

  const out: Split[] = [];
  let nextMark = splitDistanceM;
  let sliceStart = 0;
  let index = 1;
  let cumulativeDistanceM = 0;

  for (let i = 0; i < sorted.length; i++) {
    const d = Number(sorted[i].distance_m ?? 0) - startDist;
    if (d >= nextMark || i === sorted.length - 1) {
      const slice = sorted.slice(sliceStart, i + 1);
      const m = metricsFromSlice(slice);

      if (m.distanceM > 0) {
        const deadS = deadSecondsInSlice(slice);
        const movingDurationS = Math.max(0, m.durationS - deadS);
        const paceSecPerKm =
          movingDurationS > 0 && m.distanceM > 0 ? (movingDurationS / m.distanceM) * 1000 : m.avgPaceSecPerKm;

        cumulativeDistanceM += m.distanceM;

        const first = slice[0];
        const last = slice[slice.length - 1];
        const bearingDeg =
          typeof first.lat === "number" &&
          typeof first.lng === "number" &&
          typeof last.lat === "number" &&
          typeof last.lng === "number"
            ? computeBearingDeg(first.lat, first.lng, last.lat, last.lng)
            : null;

        const path = slice
          .filter((p): p is RepPointLike & { lat: number; lng: number } => typeof p.lat === "number" && typeof p.lng === "number")
          .map((p) => ({ lat: p.lat, lng: p.lng, distanceM: Number(p.distance_m ?? 0) }));

        out.push({
          index: index++,
          distanceM: Number(m.distanceM.toFixed(1)),
          cumulativeDistanceM: Number(cumulativeDistanceM.toFixed(1)),
          durationS: Number(movingDurationS.toFixed(1)),
          paceSecPerKm: paceSecPerKm != null ? Number(paceSecPerKm.toFixed(2)) : null,
          avgHr: m.avgHr,
          avgCadence: m.avgCadence,
          avgVerticalOscillationCm: m.avgVerticalOscillationCm,
          avgGroundContactTimeMs: m.avgGroundContactTimeMs,
          strideLengthM: computeStrideLengthM(m.distanceM, movingDurationS, m.avgCadence),
          isPartial: m.distanceM < splitDistanceM * 0.9,
          bearingDeg,
          path,
        });
      }

      sliceStart = i;
      nextMark += splitDistanceM;
    }
  }

  return out;
}

// ---------------------------------------------------------------------
// Summary stats (Average / Fastest / Slowest / Pacing range / Std dev /
// Coefficient of variation / Consistency score)
// ---------------------------------------------------------------------

export type SplitSummaryStats = {
  avgPaceSecPerKm: number | null;
  fastestSecPerKm: number | null;
  slowestSecPerKm: number | null;
  pacingRangeSec: number | null; // slowest − fastest, i.e. Chris's "Variation"
  stdDevSecPerKm: number | null;
  coefficientOfVariationPct: number | null;
  consistencyScore: number | null; // 0-100
};

// Consistency score is an original heuristic built for this feature, NOT
// the app's calibrated Biomechanics score elsewhere — it's a simple, tuned
// transform of coefficient of variation (100 - CV% × 3, clamped to
// 0-100). Tight, evenly-held splits (CV under ~1%) land in the mid-to-high
// 90s; splits with real pace swings (CV over ~15%) bottom out at 0. The
// multiplier (3) is a deliberately gentle curve chosen so a well-paced
// threshold session (CV ≈ 1-2%) still reads in the "excellent" band rather
// than being penalised for ordinary GPS/pace noise — easy to retune if it
// doesn't feel right against real sessions.
const CONSISTENCY_CV_MULTIPLIER = 3;

export function computeSplitSummary(splits: Split[]): SplitSummaryStats {
  const paces = splits.map((s) => s.paceSecPerKm).filter((x): x is number => typeof x === "number");

  if (paces.length === 0) {
    return {
      avgPaceSecPerKm: null,
      fastestSecPerKm: null,
      slowestSecPerKm: null,
      pacingRangeSec: null,
      stdDevSecPerKm: null,
      coefficientOfVariationPct: null,
      consistencyScore: null,
    };
  }

  const avg = paces.reduce((a, b) => a + b, 0) / paces.length;
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const variance = paces.reduce((a, b) => a + (b - avg) ** 2, 0) / paces.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? (stdDev / avg) * 100 : null;
  const consistency = cv != null ? Math.max(0, Math.min(100, Math.round(100 - cv * CONSISTENCY_CV_MULTIPLIER))) : null;

  return {
    avgPaceSecPerKm: Number(avg.toFixed(2)),
    fastestSecPerKm: Number(fastest.toFixed(2)),
    slowestSecPerKm: Number(slowest.toFixed(2)),
    pacingRangeSec: Number((slowest - fastest).toFixed(2)),
    stdDevSecPerKm: Number(stdDev.toFixed(2)),
    coefficientOfVariationPct: cv != null ? Number(cv.toFixed(2)) : null,
    consistencyScore: consistency,
  };
}

// ---------------------------------------------------------------------
// Colour coding
// ---------------------------------------------------------------------

export type SplitColor = "green" | "yellow" | "red" | "none";

// Thresholds are a % deviation from the REP'S OWN average pace (not a plan
// target — always available, even for unstructured reps). 100m splits are
// short enough that GPS/watch pace noise is real, so these are deliberately
// tight: ±0.5% green, ±0.5-2% yellow, beyond that red. Easy to widen if a
// particular device's noise floor turns out higher than this in practice.
export const SPLIT_COLOR_GREEN_PCT = 0.5;
export const SPLIT_COLOR_YELLOW_PCT = 2;

export function colorForSplit(paceSecPerKm: number | null, avgPaceSecPerKm: number | null): SplitColor {
  if (paceSecPerKm == null || avgPaceSecPerKm == null || avgPaceSecPerKm <= 0) return "none";
  const deviationPct = (Math.abs(paceSecPerKm - avgPaceSecPerKm) / avgPaceSecPerKm) * 100;
  if (deviationPct <= SPLIT_COLOR_GREEN_PCT) return "green";
  if (deviationPct <= SPLIT_COLOR_YELLOW_PCT) return "yellow";
  return "red";
}

// ---------------------------------------------------------------------
// Running dynamics drift through the rep (cadence / stride / GCT / VO)
// ---------------------------------------------------------------------

export type DriftEntry = {
  label: string;
  unit: string;
  startValue: number | null;
  endValue: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
};

// Compares the average of the first two valid splits against the average
// of the last two valid splits, rather than a single first/last split —
// one noisy 100m bucket at either end shouldn't swing the whole drift
// reading. Falls back to a single split at each end for a short rep with
// too few splits for a 2-split window.
function edgeAverage(values: (number | null)[], fromStart: boolean): number | null {
  const valid = values.filter((v): v is number => typeof v === "number");
  if (valid.length === 0) return null;
  const windowSize = Math.min(2, valid.length);
  const window = fromStart ? valid.slice(0, windowSize) : valid.slice(valid.length - windowSize);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

function buildDrift(label: string, unit: string, values: (number | null)[], higherIsFatigue: boolean): DriftEntry {
  const start = edgeAverage(values, true);
  const end = edgeAverage(values, false);
  if (start == null || end == null) {
    return { label, unit, startValue: null, endValue: null, deltaAbs: null, deltaPct: null };
  }
  const deltaAbs = end - start;
  const deltaPct = start !== 0 ? (deltaAbs / Math.abs(start)) * 100 : null;
  return {
    label,
    unit,
    startValue: Number(start.toFixed(1)),
    endValue: Number(end.toFixed(1)),
    deltaAbs: Number(deltaAbs.toFixed(1)),
    deltaPct: deltaPct != null ? Number(deltaPct.toFixed(1)) : null,
    // higherIsFatigue is reserved for the caller's own labelling (e.g. GCT
    // rising = fatigue, cadence falling = fatigue) — not encoded in this
    // value itself, kept as a documented parameter so callers don't have to
    // re-derive which direction is "bad" per metric.
    ...(higherIsFatigue ? {} : {}),
  };
}

export function computeDynamicsDrift(splits: Split[]): {
  cadence: DriftEntry;
  strideLength: DriftEntry;
  groundContactTime: DriftEntry;
  verticalOscillation: DriftEntry;
} {
  return {
    cadence: buildDrift("Cadence", "spm", splits.map((s) => s.avgCadence), false),
    strideLength: buildDrift("Stride length", "m", splits.map((s) => s.strideLengthM), false),
    groundContactTime: buildDrift("Ground contact time", "ms", splits.map((s) => s.avgGroundContactTimeMs), true),
    verticalOscillation: buildDrift("Vertical oscillation", "cm", splits.map((s) => s.avgVerticalOscillationCm), true),
  };
}

// ---------------------------------------------------------------------
// HR drift (beginning vs end of the rep)
// ---------------------------------------------------------------------

export type HrDrift = { beginningHr: number | null; endHr: number | null; deltaBpm: number | null };

export function computeHrDrift(splits: Split[]): HrDrift | null {
  const hrs = splits.map((s) => s.avgHr);
  const start = edgeAverage(hrs, true);
  const end = edgeAverage(hrs, false);
  if (start == null || end == null) return null;
  return {
    beginningHr: Math.round(start),
    endHr: Math.round(end),
    deltaBpm: Math.round(end - start),
  };
}

// ---------------------------------------------------------------------
// Fatigue score — first 200m vs last 200m
// ---------------------------------------------------------------------

export type FatigueLevel = "low" | "medium" | "high";

export type FatigueResult = {
  level: FatigueLevel;
  first200: { cadence: number | null; groundContactTimeMs: number | null; strideLengthM: number | null };
  last200: { cadence: number | null; groundContactTimeMs: number | null; strideLengthM: number | null };
  cadenceDeltaPct: number | null;
  gctDeltaPct: number | null;
  strideDeltaPct: number | null;
};

// Needs at least ~400m of rep so the first-200m and last-200m windows don't
// overlap — shorter reps (e.g. 200m reps) don't have a meaningful "start vs
// finish" fatigue read at this granularity.
const FATIGUE_MIN_REP_DISTANCE_M = 400;
const FATIGUE_WINDOW_M = 200;

function windowAverage(splits: Split[], key: keyof Split, fromStart: boolean): number | null {
  if (!splits.length) return null;
  const totalDist = splits[splits.length - 1].cumulativeDistanceM;
  const inWindow = splits.filter((s) =>
    fromStart ? s.cumulativeDistanceM <= FATIGUE_WINDOW_M : s.cumulativeDistanceM > totalDist - FATIGUE_WINDOW_M,
  );
  const values = inWindow.map((s) => s[key]).filter((v): v is number => typeof v === "number");
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Fatigue level is another original, documented heuristic (not a published
// clinical/coaching formula): averages the signed % change across cadence
// (falling = fatigue), GCT (rising = fatigue) and stride length (shortening
// = fatigue) into one composite, then bands it. Deliberately conservative
// thresholds — real form changes from fatigue are usually in the low
// single-digit percentages per component.
const FATIGUE_LOW_MAX_PCT = 3;
const FATIGUE_MEDIUM_MAX_PCT = 7;

export function computeFatigueScore(splits: Split[]): FatigueResult | null {
  if (!splits.length) return null;
  const totalDist = splits[splits.length - 1].cumulativeDistanceM;
  if (totalDist < FATIGUE_MIN_REP_DISTANCE_M) return null;

  const first200 = {
    cadence: windowAverage(splits, "avgCadence", true),
    groundContactTimeMs: windowAverage(splits, "avgGroundContactTimeMs", true),
    strideLengthM: windowAverage(splits, "strideLengthM", true),
  };
  const last200 = {
    cadence: windowAverage(splits, "avgCadence", false),
    groundContactTimeMs: windowAverage(splits, "avgGroundContactTimeMs", false),
    strideLengthM: windowAverage(splits, "strideLengthM", false),
  };

  const cadenceDeltaPct =
    first200.cadence != null && last200.cadence != null && first200.cadence !== 0
      ? ((first200.cadence - last200.cadence) / first200.cadence) * 100 // positive = cadence dropped = fatigue signal
      : null;
  const gctDeltaPct =
    first200.groundContactTimeMs != null && last200.groundContactTimeMs != null && first200.groundContactTimeMs !== 0
      ? ((last200.groundContactTimeMs - first200.groundContactTimeMs) / first200.groundContactTimeMs) * 100 // positive = GCT rose = fatigue signal
      : null;
  const strideDeltaPct =
    first200.strideLengthM != null && last200.strideLengthM != null && first200.strideLengthM !== 0
      ? ((first200.strideLengthM - last200.strideLengthM) / first200.strideLengthM) * 100 // positive = stride shortened = fatigue signal
      : null;

  const signals = [cadenceDeltaPct, gctDeltaPct, strideDeltaPct].filter((v): v is number => typeof v === "number");
  const composite = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : null;

  let level: FatigueLevel = "low";
  if (composite != null) {
    if (composite > FATIGUE_MEDIUM_MAX_PCT) level = "high";
    else if (composite > FATIGUE_LOW_MAX_PCT) level = "medium";
  }

  return {
    level,
    first200: {
      cadence: first200.cadence != null ? Math.round(first200.cadence) : null,
      groundContactTimeMs: first200.groundContactTimeMs != null ? Math.round(first200.groundContactTimeMs) : null,
      strideLengthM: first200.strideLengthM != null ? Number(first200.strideLengthM.toFixed(2)) : null,
    },
    last200: {
      cadence: last200.cadence != null ? Math.round(last200.cadence) : null,
      groundContactTimeMs: last200.groundContactTimeMs != null ? Math.round(last200.groundContactTimeMs) : null,
      strideLengthM: last200.strideLengthM != null ? Number(last200.strideLengthM.toFixed(2)) : null,
    },
    cadenceDeltaPct: cadenceDeltaPct != null ? Number(cadenceDeltaPct.toFixed(1)) : null,
    gctDeltaPct: gctDeltaPct != null ? Number(gctDeltaPct.toFixed(1)) : null,
    strideDeltaPct: strideDeltaPct != null ? Number(strideDeltaPct.toFixed(1)) : null,
  };
}

// ---------------------------------------------------------------------
// Best section (sliding window, default 400m)
// ---------------------------------------------------------------------

export type BestSection = {
  startDistanceM: number;
  endDistanceM: number;
  paceSecPerKm: number;
  timeS: number;
  // An original per-window "form" heuristic for THIS feature only — not
  // the app's calibrated, competitive-tier Biomechanics score used
  // elsewhere (biomechanics-scores-card.tsx / biomechanics-trend-card.tsx).
  // Deliberately labelled "Form score" everywhere in the UI so it's never
  // confused with that system. Built from how tight GCT and VO stayed in
  // this window relative to the rep's OWN average (lower variance from the
  // rep's baseline = higher score), clamped 0-100. Null when the rep has no
  // GCT/VO data to score against (e.g. no Running Dynamics accessory worn).
  formScore: number | null;
};

export function computeBestSection(splits: Split[], windowM = 400): BestSection | null {
  if (!splits.length) return null;
  const totalDist = splits[splits.length - 1].cumulativeDistanceM;
  if (totalDist < windowM) return null;

  const repGct = splits.map((s) => s.avgGroundContactTimeMs).filter((x): x is number => typeof x === "number");
  const repVo = splits.map((s) => s.avgVerticalOscillationCm).filter((x): x is number => typeof x === "number");
  const repAvgGct = repGct.length ? repGct.reduce((a, b) => a + b, 0) / repGct.length : null;
  const repAvgVo = repVo.length ? repVo.reduce((a, b) => a + b, 0) / repVo.length : null;

  let best: BestSection | null = null;

  for (let i = 0; i < splits.length; i++) {
    const windowStart = splits[i].cumulativeDistanceM - splits[i].distanceM;
    let windowDist = 0;
    let windowTime = 0;
    const windowSplits: Split[] = [];

    for (let j = i; j < splits.length; j++) {
      windowDist += splits[j].distanceM;
      windowTime += splits[j].durationS;
      windowSplits.push(splits[j]);
      if (windowDist >= windowM) break;
    }

    if (windowDist < windowM * 0.95) continue; // don't score a short trailing partial window

    const paceSecPerKm = windowTime > 0 ? (windowTime / windowDist) * 1000 : null;
    if (paceSecPerKm == null) continue;

    if (!best || paceSecPerKm < best.paceSecPerKm) {
      const wGct = windowSplits
        .map((s) => s.avgGroundContactTimeMs)
        .filter((x): x is number => typeof x === "number");
      const wVo = windowSplits
        .map((s) => s.avgVerticalOscillationCm)
        .filter((x): x is number => typeof x === "number");

      let formScore: number | null = null;
      if (repAvgGct != null && wGct.length) {
        const wAvgGct = wGct.reduce((a, b) => a + b, 0) / wGct.length;
        const gctScore = Math.max(0, 100 - (Math.abs(wAvgGct - repAvgGct) / repAvgGct) * 100 * 5);
        let voScore = 100;
        if (repAvgVo != null && wVo.length) {
          const wAvgVo = wVo.reduce((a, b) => a + b, 0) / wVo.length;
          voScore = Math.max(0, 100 - (Math.abs(wAvgVo - repAvgVo) / repAvgVo) * 100 * 5);
        }
        formScore = Math.round((gctScore + voScore) / 2);
      }

      best = {
        startDistanceM: Math.round(windowStart),
        endDistanceM: Math.round(windowStart + windowDist),
        paceSecPerKm: Number(paceSecPerKm.toFixed(2)),
        timeS: Number(windowTime.toFixed(1)),
        formScore,
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------
// Pace distribution — % of moving time spent in each pace band
// ---------------------------------------------------------------------

export type PaceBand = { label: string; pctOfTime: number; loSecPerKm: number; hiSecPerKm: number };

export function computePaceDistribution(splits: Split[], bandWidthSec = 5): PaceBand[] {
  const valid = splits.filter((s) => s.paceSecPerKm != null && s.durationS > 0);
  if (!valid.length) return [];

  const totalTimeS = valid.reduce((a, s) => a + s.durationS, 0);
  if (totalTimeS <= 0) return [];

  const buckets = new Map<number, number>(); // band floor (sec/km) -> total seconds

  for (const s of valid) {
    const pace = s.paceSecPerKm as number;
    const bandFloor = Math.floor(pace / bandWidthSec) * bandWidthSec;
    buckets.set(bandFloor, (buckets.get(bandFloor) ?? 0) + s.durationS);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([floor, seconds]) => ({
      label: `${floor}-${floor + bandWidthSec}s/km`,
      pctOfTime: Number(((seconds / totalTimeS) * 100).toFixed(1)),
      loSecPerKm: floor,
      hiSecPerKm: floor + bandWidthSec,
    }));
}
