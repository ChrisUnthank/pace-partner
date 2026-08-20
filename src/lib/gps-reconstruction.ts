/**
 * gps-reconstruction.ts
 *
 * Reconstructs a realistic distance series from noisy GPS watch data.
 *
 * The problem: GPS watches routinely under-record distance during signal
 * acquisition (race start), tunnels/bridges/tree cover (mid-race dropouts),
 * and can occasionally over-record via multipath spikes. Naive fixed
 * thresholds ("distance didn't move for 1s") either miss slow-onset
 * dropouts or misfire on genuinely slow but valid pacing.
 *
 * The approach here:
 *   1. Establish a robust *local* reference pace using a rolling median of
 *      point-to-point speed (medians are resistant to the very dropouts/
 *      spikes we're trying to detect).
 *   2. Classify each interval as normal / dropout / spike / jitter by
 *      comparing its implied speed against that local reference — not a
 *      single global fixed number.
 *   3. Only touch flagged intervals. Genuine pacing changes (fatigue, hills,
 *      surges) are gradual across many samples and won't trip the detector;
 *      dropouts/spikes are abrupt and isolated, so they will.
 *   4. When an official race distance is known, reconcile the reconstructed
 *      total against it — but do so intelligently:
 *        - If the shortfall/excess is small and there's no dominant
 *          anomaly location, treat it as generic GPS drift and smooth it
 *          proportionally across genuine (non-anomalous) intervals.
 *        - If a dominant anomaly cluster sits near the START, anchor the
 *          correction from the FINISH (the back end of the race is more
 *          trustworthy) and inject the needed distance as a one-time
 *          offset at the point of the dropout, leaving everything else
 *          untouched in relative terms.
 *        - If the dominant cluster sits near the FINISH, anchor from the
 *          START instead, and let the shortfall land in the tail / final
 *          partial split.
 *   5. Splits are rebuilt from the corrected per-point distance series
 *      (not the raw one), so split boundaries land in the right place,
 *      and any remaining distance is always kept as a final partial split
 *      (never silently discarded).
 */

export interface RawTrackPoint {
  elapsed_s: number;
  distance_m: number | null;
  hr?: number | null;
  [key: string]: any;
}

export type AnomalyType = "dropout" | "spike" | "jitter" | "gap";

export interface AnomalySegment {
  startIndex: number;
  endIndex: number;
  startElapsed: number;
  endElapsed: number;
  type: AnomalyType;
  rawDeltaM: number;
  correctedDeltaM: number;
  /** correctedDeltaM - rawDeltaM. Positive = distance was added back in. */
  adjustmentM: number;
}

export interface CorrectedPoint {
  elapsed_s: number;
  raw_distance_m: number | null;
  /** Cumulative corrected distance, before official-distance alignment. */
  corrected_distance_m: number;
  /** Cumulative corrected distance, after official-distance alignment. Use this for splits/UI. */
  final_distance_m: number;
  hr?: number | null;
  flag: AnomalyType | null;
}

export type AnchorMode = "start" | "finish" | "distributed";

export interface ReconstructionOptions {
  /** Multiple of local reference speed below which an interval is a dropout. Default 0.45 */
  dropoutSpeedRatio?: number;
  /** Multiple of local reference speed above which an interval is a spike. Default 2.4 */
  spikeSpeedRatio?: number;
  /** Absolute floor speed (m/s) a spike must also exceed, to avoid flagging genuine surges. Default 7.0 m/s (~2:23/km) */
  spikeAbsoluteFloorMps?: number;
  /** Rolling median window in samples used for the local reference pace. Default 21 */
  medianWindow?: number;
  /** If the reconciliation gap vs. official distance is below this fraction of total distance, treat as generic smoothing rather than localized anchoring. Default 0.03 (3%) — anomaly-specific correction already ran in classifyAndCorrect, so a remaining gap in this range is far more likely ordinary GPS-vs-course measurement drift than something that also belongs concentrated at the same dropout location a second time. */
  genericSmoothingThreshold?: number;
  /** Fraction of total race time used to decide if anomalies are "dominant" near start/finish. Default 0.15 (15%) */
  edgeWindowFraction?: number;
  /**
   * Seconds above which a silent interval is a RECORDING GAP, not a GPS
   * dropout. Default 120.
   *
   * A dropout is the watch still recording while the signal is degraded — it
   * produces points, just poor ones. An interval with no points across two
   * minutes is something else: the watch was paused, stopped, or between
   * files. Nothing was measured because nothing was recording, and filling it
   * at race pace invents distance that was never run.
   *
   * On a real race this fired at 52:13–1:27:00 — 2087 silent seconds with 0m
   * of GPS, reconstructed as 8729m at 3:59/km. That alone was 87% of a 10km
   * race, conjured out of a gap between two files.
   */
  recordingGapSeconds?: number;
  /**
   * Hard ceiling on what any single anomaly may add, as a fraction of the
   * official distance. Default 0.15 (15%).
   *
   * The existing cap is `ref * dt * 3`, which scales WITH the gap — so the
   * longer the silence, the more distance it is licensed to invent. That is
   * backwards: a longer unexplained gap deserves less trust, not more.
   */
  maxSingleCorrectionFraction?: number;
  /**
   * Above this fraction of official distance, reconstruction is judged to
   * have failed and is abandoned in favour of scaling the raw GPS. Default
   * 0.25 (25%).
   *
   * Distributing an 18km correction across a 10km race does not rescue the
   * numbers, it spreads the error into every split while presenting a total
   * that looks correct.
   */
  reconstructionSanityFraction?: number;
}

const DEFAULTS: Required<ReconstructionOptions> = {
  dropoutSpeedRatio: 0.45,
  spikeSpeedRatio: 2.4,
  spikeAbsoluteFloorMps: 7.0,
  medianWindow: 21,
  genericSmoothingThreshold: 0.03,
  edgeWindowFraction: 0.15,
  recordingGapSeconds: 120,
  maxSingleCorrectionFraction: 0.15,
  reconstructionSanityFraction: 0.25,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface Interval {
  index: number; // index of the "curr" point in the original points array
  dt: number;
  dd: number;
  v: number; // implied speed, dd/dt (only meaningful if dt > 0)
}

/** Build point-to-point intervals, skipping points with missing/non-monotonic time. */
function buildIntervals(points: RawTrackPoint[]): Interval[] {
  const intervals: Interval[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev?.distance_m == null || curr?.distance_m == null || prev?.elapsed_s == null || curr?.elapsed_s == null) {
      continue;
    }
    const dt = curr.elapsed_s - prev.elapsed_s;
    const dd = curr.distance_m - prev.distance_m;
    if (dt <= 0) continue; // out-of-order / duplicate timestamp, ignore
    intervals.push({ index: i, dt, dd, v: dd / dt });
  }
  return intervals;
}

/**
 * Rolling median speed centered on each interval, using only "plausible"
 * (non-negative) speeds. If an `excludeMask` is supplied, intervals already
 * flagged as anomalous are dropped from every window they'd otherwise
 * appear in — so one dropout's depressed speed can't pollute the reference
 * pace used to correct a *neighboring* dropout (a real issue when two
 * anomalies sit back-to-back, as they often do around a race start).
 */
function rollingMedianSpeed(intervals: Interval[], window: number, excludeMask?: boolean[]): number[] {
  const speeds = intervals.map((iv, i) => (excludeMask?.[i] ? null : Math.max(iv.v, 0)));
  const half = Math.floor(window / 2);
  const cleanAll = speeds.filter((v): v is number => v != null && v > 0);
  const globalMedian = median(cleanAll) || 0;

  return intervals.map((_, i) => {
    let lo = Math.max(0, i - half);
    let hi = Math.min(speeds.length - 1, i + half);
    let windowVals = speeds.slice(lo, hi + 1).filter((v): v is number => v != null && v > 0);

    // If exclusions hollowed out this window too much, widen it (up to the
    // full series) rather than fall back straight to a possibly-distant
    // global median — keeps the reference as *local* as the data allows.
    let expand = window;
    while (windowVals.length < 3 && (lo > 0 || hi < speeds.length - 1)) {
      expand += window;
      lo = Math.max(0, i - Math.floor(expand / 2));
      hi = Math.min(speeds.length - 1, i + Math.floor(expand / 2));
      windowVals = speeds.slice(lo, hi + 1).filter((v): v is number => v != null && v > 0);
    }

    return windowVals.length >= 3 ? median(windowVals) : globalMedian;
  });
}

/**
 * Classify every interval and produce a corrected delta for it.
 * Only dropout/spike/jitter intervals get their delta replaced; everything
 * else (including genuine slow patches / surges) passes through untouched.
 *
 * Two-pass: an initial rough classification identifies which intervals are
 * anomalous, then reference speeds are recomputed *excluding* those
 * intervals, and corrections are calculated from that refined reference.
 * This avoids one dropout depressing the correction estimate used for a
 * neighboring one.
 */
function classifyAndCorrect(
  intervals: Interval[],
  opts: Required<ReconstructionOptions>,
  officialDistanceM?: number | null,
): { correctedDeltas: number[]; flags: (AnomalyType | null)[] } {
  // Absolute ceiling on any one correction. Falls back to a generous fixed
  // figure when there is no official distance to size it against — still far
  // tighter than a cap that grows with the gap it is meant to constrain.
  const singleCap =
    officialDistanceM && officialDistanceM > 0
      ? officialDistanceM * opts.maxSingleCorrectionFraction
      : 2000;
  const roughClassify = (refSpeeds: number[]) =>
    intervals.map((iv, i) => {
      const ref = refSpeeds[i];
      // A recording gap is excluded from the reference calculation as well as
      // from correction — its zero speed would otherwise drag down the median
      // that every neighbouring correction is measured against.
      if (iv.dt > opts.recordingGapSeconds) return true;
      if (iv.dd < 0) return true;
      if (ref > 0 && iv.v < ref * opts.dropoutSpeedRatio) return true;
      if (ref > 0 && iv.v > ref * opts.spikeSpeedRatio && iv.v > opts.spikeAbsoluteFloorMps) return true;
      return false;
    });

  const passOneRef = rollingMedianSpeed(intervals, opts.medianWindow);
  const roughFlags = roughClassify(passOneRef);
  const refSpeeds = rollingMedianSpeed(intervals, opts.medianWindow, roughFlags);

  const correctedDeltas: number[] = [];
  const flags: (AnomalyType | null)[] = [];

  intervals.forEach((iv, i) => {
    const ref = refSpeeds[i];
    const expected = ref * iv.dt;

    // ── Recording gap: nothing was measured, so nothing is inferred ──────
    //
    // Kept exactly as recorded (normally ~0m) and flagged so the UI can name
    // it honestly rather than presenting invented metres as a correction.
    if (iv.dt > opts.recordingGapSeconds) {
      correctedDeltas.push(iv.dd > 0 ? iv.dd : 0);
      flags.push("gap");
      return;
    }
    // Sanity clamp: never attribute more than ~3x the plausible distance for
    // the elapsed gap, however low the implied speed looked — protects
    // against a single bad reference estimate producing a runaway split.
    // Both ceilings apply. The relative one alone let a long gap license a
    // proportionally larger invention; the absolute one is what actually
    // binds when the reference pace is fast and the gap is long.
    const cap = Math.min(ref > 0 ? ref * iv.dt * 3 : expected, singleCap);

    // Negative distance = GPS jitter (backward jump). Treat like a dropout:
    // trust the local reference pace instead of the raw (negative) delta.
    if (iv.dd < 0) {
      correctedDeltas.push(ref > 0 ? Math.min(expected, cap) : 0);
      flags.push("jitter");
      return;
    }

    // Dropout: implied speed is well below the local reference for this
    // stretch — GPS lost/degraded signal while the athlete kept moving.
    if (ref > 0 && iv.v < ref * opts.dropoutSpeedRatio) {
      correctedDeltas.push(Math.min(Math.max(iv.dd, expected), cap));
      flags.push("dropout");
      return;
    }

    // Spike: implied speed is both a large relative jump AND an absolute
    // speed unlikely for the athlete — multipath / satellite jump. Genuine
    // surges build gradually over several samples, so a single isolated
    // interval this far outside the local pace is far more likely noise.
    if (ref > 0 && iv.v > ref * opts.spikeSpeedRatio && iv.v > opts.spikeAbsoluteFloorMps) {
      correctedDeltas.push(Math.min(iv.dd, expected));
      flags.push("spike");
      return;
    }

    // Normal — preserve exactly as recorded, including genuine pacing shifts.
    correctedDeltas.push(iv.dd);
    flags.push(null);
  });

  return { correctedDeltas, flags };
}

/** Merge consecutive flagged intervals into anomaly segments for reporting/anchoring. */
function buildAnomalySegments(
  points: RawTrackPoint[],
  intervals: Interval[],
  correctedDeltas: number[],
  flags: (AnomalyType | null)[],
): AnomalySegment[] {
  const segments: AnomalySegment[] = [];
  let i = 0;
  while (i < intervals.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    const type = flags[i]!;
    const startIdx = i;
    let rawSum = 0;
    let corrSum = 0;
    while (i < intervals.length && flags[i] === type) {
      rawSum += intervals[i].dd;
      corrSum += correctedDeltas[i];
      i++;
    }
    const endIdx = i - 1;
    segments.push({
      startIndex: intervals[startIdx].index - 1,
      endIndex: intervals[endIdx].index,
      startElapsed: points[intervals[startIdx].index - 1].elapsed_s,
      endElapsed: points[intervals[endIdx].index].elapsed_s,
      type,
      rawDeltaM: rawSum,
      correctedDeltaM: corrSum,
      adjustmentM: corrSum - rawSum,
    });
  }
  return segments;
}

export interface ReconstructionResult {
  points: CorrectedPoint[];
  anomalies: AnomalySegment[];
  rawTotalDistanceM: number;
  reconstructedTotalDistanceM: number; // after anomaly correction, before official alignment
  finalTotalDistanceM: number; // after aligning to official distance, if provided
  officialDistanceM: number | null;
  anchor: AnchorMode;
  /** How much distance was added purely as generic end-to-end smoothing (not tied to a specific anomaly). */
  genericSmoothingM: number;
  /**
   * True when the reconstruction was judged wrong and discarded — the final
   * series is the raw GPS scaled onto the official distance instead.
   *
   * Surfaced rather than hidden: a page listing corrections that were then
   * thrown away would be describing work that had no effect on the numbers
   * underneath it.
   */
  reconstructionAbandoned?: boolean;
}

export function reconstructTrack(
  rawPoints: RawTrackPoint[],
  officialDistanceM: number | null | undefined,
  userOptions?: ReconstructionOptions,
): ReconstructionResult {
  const opts = { ...DEFAULTS, ...userOptions };
  const points = [...rawPoints].sort((a, b) => a.elapsed_s - b.elapsed_s);

  if (points.length < 2) {
    return {
      points: points.map((p) => ({
        elapsed_s: p.elapsed_s,
        raw_distance_m: p.distance_m,
        corrected_distance_m: p.distance_m ?? 0,
        final_distance_m: p.distance_m ?? 0,
        hr: p.hr,
        flag: null,
      })),
      anomalies: [],
      rawTotalDistanceM: points[0]?.distance_m ?? 0,
      reconstructedTotalDistanceM: points[0]?.distance_m ?? 0,
      finalTotalDistanceM: officialDistanceM ?? points[0]?.distance_m ?? 0,
      officialDistanceM: officialDistanceM ?? null,
      anchor: "distributed",
      genericSmoothingM: 0,
    };
  }

  const intervals = buildIntervals(points);
  const { correctedDeltas, flags } = classifyAndCorrect(intervals, opts, officialDistanceM);
  const anomalies = buildAnomalySegments(points, intervals, correctedDeltas, flags);

  // Build the reconstructed cumulative series (pre-official-alignment).
  const corrected: number[] = new Array(points.length).fill(0);
  corrected[0] = points[0].distance_m ?? 0;
  let cursor = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) continue;
    const iv = intervals.find((v) => v.index === i);
    if (iv) {
      const ivPos = intervals.indexOf(iv);
      corrected[i] = corrected[i - 1] + correctedDeltas[ivPos];
      cursor = i;
    } else {
      corrected[i] = corrected[cursor]; // carry forward across skipped/invalid points
    }
  }

  const rawTotalDistanceM = points[points.length - 1].distance_m ?? corrected[corrected.length - 1];
  const reconstructedTotalDistanceM = corrected[corrected.length - 1];

  // --- Reconcile against official distance, deciding an anchor strategy ---
  let anchor: AnchorMode = "distributed";
  let genericSmoothingM = 0;
  let reconstructionAbandoned = false;
  const final: number[] = [...corrected];

  if (officialDistanceM && reconstructedTotalDistanceM > 0) {
    let remainder = officialDistanceM - reconstructedTotalDistanceM;
    const totalTime = points[points.length - 1].elapsed_s - points[0].elapsed_s;
    let fractionOfTotal = Math.abs(remainder) / officialDistanceM;

    // ── Reconstruction sanity check ──────────────────────────────────────
    //
    // A remainder this large means the reconstruction is wrong, not that the
    // course was mismeasured. Distributing it does not rescue the numbers: it
    // spreads the error into every split while presenting a plausible-looking
    // total, which is worse than admitting the reconstruction failed.
    //
    // The case that prompted this: 28.37km reconstructed against a 10.08km
    // official distance, resolved by "distributing" -18289m across the race.
    // Every split on that page was derived from a series that had been scaled
    // by 0.36.
    //
    // Falls back to the RAW GPS scaled onto the official distance — ignoring
    // the reconstruction entirely. Raw GPS with its real dropouts is a
    // truthful record of a flawed measurement; a reconstruction that invented
    // 18km is not a record of anything.
    if (fractionOfTotal > opts.reconstructionSanityFraction) {
      reconstructionAbandoned = true;
      const rawScale = rawTotalDistanceM > 0 ? officialDistanceM / rawTotalDistanceM : 1;
      for (let i = 0; i < final.length; i++) {
        final[i] = (points[i].distance_m ?? (i > 0 ? points[i - 1].distance_m : 0) ?? 0) * rawScale;
      }
      return {
        points: points.map((p, i) => ({
          elapsed_s: p.elapsed_s,
          raw_distance_m: p.distance_m,
          corrected_distance_m: corrected[i],
          final_distance_m: final[i],
          hr: p.hr,
          flag: null,
        })),
        anomalies,
        rawTotalDistanceM,
        reconstructedTotalDistanceM,
        finalTotalDistanceM: final[final.length - 1],
        officialDistanceM,
        anchor: "distributed",
        genericSmoothingM: officialDistanceM - rawTotalDistanceM,
        reconstructionAbandoned: true,
      };
    }

    if (Math.abs(remainder) < 0.5) {
      // Negligible, nothing to do.
    } else if (fractionOfTotal < opts.genericSmoothingThreshold || anomalies.length === 0) {
      // Small gap with no strong localized cause (or no anomalies at all) —
      // this is ordinary GPS-vs-course-measurement drift. Smooth it
      // proportionally across every interval so relative pacing is preserved.
      anchor = "distributed";
      genericSmoothingM = remainder;
      const scale = reconstructedTotalDistanceM > 0 ? officialDistanceM / reconstructedTotalDistanceM : 1;
      for (let i = 0; i < final.length; i++) final[i] = corrected[i] * scale;
    } else {
      // A meaningful chunk of distance is unaccounted for AND we have
      // identifiable anomaly segments. Find which one dominates (by
      // magnitude of raw shortfall) and decide where in the race it sits.
      const dominant = [...anomalies].sort((a, b) => Math.abs(b.adjustmentM) - Math.abs(a.adjustmentM))[0];
      const dominantMidElapsed = (dominant.startElapsed + dominant.endElapsed) / 2;
      const fractionThroughRace = totalTime > 0 ? (dominantMidElapsed - points[0].elapsed_s) / totalTime : 0.5;

      // A plausible minimum duration for how long it should take to cover
      // `remainder` metres, using the race's overall average pace as the
      // reference. Without this, a real-world pause (elapsed time barely
      // advances, but GPS jumps a long way on resume) looks like a
      // dominant anomaly with a near-zero duration — ramping a large
      // distance across that tiny window creates an impossible
      // instantaneous jump (e.g. multiple "km" splits crossed in seconds).
      const raceAvgSpeed = totalTime > 0 ? officialDistanceM / totalTime : 0;
      const minRampDurationS = raceAvgSpeed > 0 ? Math.abs(remainder) / raceAvgSpeed : 0;

      if (fractionThroughRace <= opts.edgeWindowFraction) {
        // Error concentrated at the START -> anchor from the FINISH.
        // Spread the missing distance smoothly across the dropout's own
        // duration (time-weighted), not as a single abrupt step at its end —
        // the athlete covered that ground gradually during the dropout, so
        // split boundaries that fall inside/near it should reflect that
        // gradual ramp rather than jumping straight to the fully-corrected
        // value. Before the anomaly: untouched. After it: fully shifted.
        anchor = "finish";
        const rampStartElapsed = points[dominant.startIndex]?.elapsed_s ?? 0;
        const rawRampEndElapsed = points[dominant.endIndex]?.elapsed_s ?? rampStartElapsed;
        const rampEndElapsed = Math.max(rawRampEndElapsed, rampStartElapsed + minRampDurationS);

        for (let i = 0; i < final.length; i++) {
          const t =
            points[i].elapsed_s <= rampStartElapsed
              ? 0
              : (points[i].elapsed_s - rampStartElapsed) / (rampEndElapsed - rampStartElapsed);
          final[i] = corrected[i] + remainder * Math.max(0, Math.min(1, t));
        }
      } else if (fractionThroughRace >= 1 - opts.edgeWindowFraction) {
        // Error concentrated at the FINISH -> anchor from the START.
        // Same smooth-ramp treatment, mirrored, with the same physically-
        // plausible minimum duration.
        anchor = "start";
        const rampStartElapsed = points[dominant.startIndex]?.elapsed_s ?? 0;
        const rawRampEndElapsed = points[dominant.endIndex]?.elapsed_s ?? rampStartElapsed;
        const rampEndElapsed = Math.max(rawRampEndElapsed, rampStartElapsed + minRampDurationS);

        for (let i = 0; i < final.length; i++) {
          const t =
            points[i].elapsed_s <= rampStartElapsed
              ? 0
              : (points[i].elapsed_s - rampStartElapsed) / (rampEndElapsed - rampStartElapsed);
          final[i] = corrected[i] + remainder * Math.max(0, Math.min(1, t));
        }
      } else {
        // Error is somewhere in the middle, or spread across multiple
        // segments — no clean start/finish anchor applies. Distribute
        // proportionally, weighted toward the intervals that were already
        // flagged, so untouched genuine pacing is disturbed the least.
        anchor = "distributed";
        genericSmoothingM = remainder;
        const scale = reconstructedTotalDistanceM > 0 ? officialDistanceM / reconstructedTotalDistanceM : 1;
        for (let i = 0; i < final.length; i++) final[i] = corrected[i] * scale;
      }
    }
  }

  const finalTotalDistanceM = officialDistanceM ?? reconstructedTotalDistanceM;
  // Guarantee monotonic non-decreasing final series (defensive, in case of
  // floating point edge cases around injection points).
  for (let i = 1; i < final.length; i++) {
    if (final[i] < final[i - 1]) final[i] = final[i - 1];
  }

  const flagByPointIndex: (AnomalyType | null)[] = new Array(points.length).fill(null);
  anomalies.forEach((seg) => {
    for (let i = seg.startIndex; i <= seg.endIndex; i++) flagByPointIndex[i] = seg.type;
  });

  const resultPoints: CorrectedPoint[] = points.map((p, i) => ({
    elapsed_s: p.elapsed_s,
    raw_distance_m: p.distance_m,
    corrected_distance_m: corrected[i],
    final_distance_m: final[i],
    hr: p.hr,
    flag: flagByPointIndex[i],
  }));

  return {
    points: resultPoints,
    anomalies,
    rawTotalDistanceM,
    reconstructedTotalDistanceM,
    finalTotalDistanceM,
    officialDistanceM: officialDistanceM ?? null,
    anchor,
    genericSmoothingM,
  };
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

export interface Split {
  index: number; // 1-based
  startDistanceM: number;
  endDistanceM: number; // for a partial split, < startDistanceM + splitDistanceM
  time: number; // elapsed seconds at the end of this split
  durationS: number;
  /** What this split's duration would be from raw (uncorrected) GPS distance, for debugging/comparison. */
  rawDurationS: number;
  isPartial: boolean;
  hasAnomaly: boolean;
  avgHr: number | null;
  hrSeries: number[];
}

/**
 * Build splits from the *corrected* per-point distance series. Split
 * boundaries are interpolated in time the same way as before, but now they
 * land on real (corrected) distance marks instead of raw GPS marks. Any
 * leftover distance at the end is always kept as a final partial split.
 */
export function buildSplitsFromCorrectedPoints(points: CorrectedPoint[], splitDistanceM: number): Split[] {
  if (!points || points.length < 2 || splitDistanceM <= 0) return [];

  const splits: Split[] = [];
  let nextMark = splitDistanceM;
  let prevSplitEndTime = points[0].elapsed_s;
  let prevSplitEndDistance = points[0].final_distance_m;

  // Track the raw (uncorrected) timeline in parallel purely for the
  // rawDurationS debug field, using the raw_distance_m series and the same
  // split marks. Falls back gracefully if raw data has nulls.
  let rawCursorTime = points[0].elapsed_s;
  function interpolateRawTimeAtMark(mark: number): number | null {
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev.raw_distance_m == null || curr.raw_distance_m == null) continue;
      if (prev.raw_distance_m < mark && curr.raw_distance_m >= mark) {
        const dd = curr.raw_distance_m - prev.raw_distance_m;
        const dt = curr.elapsed_s - prev.elapsed_s;
        const ratio = dd > 0 ? (mark - prev.raw_distance_m) / dd : 0;
        return prev.elapsed_s + ratio * dt;
      }
    }
    return null;
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    while (prev.final_distance_m < nextMark && curr.final_distance_m >= nextMark) {
      const dd = curr.final_distance_m - prev.final_distance_m;
      const dt = curr.elapsed_s - prev.elapsed_s;
      const ratio = dd > 0 ? (nextMark - prev.final_distance_m) / dd : 0;
      const interpolatedTime = prev.elapsed_s + ratio * dt;

      const rawTimeAtMark = interpolateRawTimeAtMark(nextMark);
      const rawDurationS = rawTimeAtMark != null ? rawTimeAtMark - rawCursorTime : interpolatedTime - prevSplitEndTime;
      if (rawTimeAtMark != null) rawCursorTime = rawTimeAtMark;

      splits.push({
        index: splits.length + 1,
        startDistanceM: prevSplitEndDistance,
        endDistanceM: nextMark,
        time: interpolatedTime,
        durationS: interpolatedTime - prevSplitEndTime,
        rawDurationS,
        isPartial: false,
        hasAnomaly: false, // filled in below
        avgHr: null,
        hrSeries: [],
      });

      prevSplitEndTime = interpolatedTime;
      prevSplitEndDistance = nextMark;
      nextMark += splitDistanceM;
    }
  }

  // Final partial split — always included if any distance remains, however small.
  const lastPoint = points[points.length - 1];
  const remaining = lastPoint.final_distance_m - prevSplitEndDistance;
  if (remaining > 0.5) {
    splits.push({
      index: splits.length + 1,
      startDistanceM: prevSplitEndDistance,
      endDistanceM: lastPoint.final_distance_m,
      time: lastPoint.elapsed_s,
      durationS: lastPoint.elapsed_s - prevSplitEndTime,
      rawDurationS: lastPoint.elapsed_s - rawCursorTime,
      isPartial: true,
      hasAnomaly: false,
      avgHr: null,
      hrSeries: [],
    });
  }

  // Fill HR + anomaly-per-split using points that fall in each split's distance range.
  for (const split of splits) {
    const pts = points.filter(
      (p) => p.final_distance_m >= split.startDistanceM && p.final_distance_m < split.endDistanceM + 0.001,
    );
    const hrPts = pts.map((p) => p.hr).filter((hr): hr is number => hr != null);
    split.hrSeries = hrPts;
    split.avgHr = hrPts.length ? hrPts.reduce((a, b) => a + b, 0) / hrPts.length : null;
    split.hasAnomaly = pts.some((p) => p.flag != null);
  }

  return splits;
}

/** Simple centered moving average smoother, e.g. for HR series display. */
export function smoothSeries(series: number[], windowSize = 5): number[] {
  if (!series || series.length === 0) return series;
  const result: number[] = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < series.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < series.length) {
        sum += series[j];
        count++;
      }
    }
    result.push(sum / count);
  }
  return result;
}
