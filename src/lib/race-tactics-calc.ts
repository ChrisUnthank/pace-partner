// Race Tactics Planner — split calculation engine (Phase 7).
// Pure functions, no React/Supabase — the same split math is needed by
// the create form (initial even splits) and the editor (recalculate after
// an edit), so it lives here once rather than being duplicated.

export type SplitRow = {
  distance_m: number; // this segment's own distance
  cumulative_distance_m: number; // running total distance at the end of this segment
  segment_time_seconds: number; // this segment's own time
  cumulative_time_seconds: number; // running total time at the end of this segment
  is_edited: boolean; // true once a coach/athlete has manually set this segment's time
};

// Split-increment options the spec names explicitly — track events pick
// from the shorter list, road/XC ("longer events") from the other.
export const TRACK_SPLIT_INCREMENTS_M = [100, 200, 400, 800, 1000, 1500, 3000];
export const LONGER_SPLIT_INCREMENTS_M = [400, 500, 1000, 5000];

export function splitIncrementOptions(raceType: string): number[] {
  return raceType === "track" ? TRACK_SPLIT_INCREMENTS_M : LONGER_SPLIT_INCREMENTS_M;
}

// Distance checkpoints from the increment up to (and including) the full
// race distance — e.g. 800m race, 300m increment -> [300, 600, 800] (the
// last segment is a shorter 200m closer rather than overshooting).
function buildBoundaries(raceDistanceM: number, incrementM: number): number[] {
  const boundaries: number[] = [];
  let d = incrementM;
  while (d < raceDistanceM) {
    boundaries.push(d);
    d += incrementM;
  }
  boundaries.push(raceDistanceM);
  return boundaries;
}

// Builds a fresh, perfectly even-paced split set for a goal time — the
// starting point before any manual edits.
export function generateEvenSplits(raceDistanceM: number, incrementM: number, goalTimeSeconds: number): SplitRow[] {
  const boundaries = buildBoundaries(raceDistanceM, incrementM);
  const paceSecPerM = goalTimeSeconds / raceDistanceM;
  let prevBoundary = 0;
  let cumulativeTime = 0;
  return boundaries.map((b) => {
    const segDist = b - prevBoundary;
    const segTime = segDist * paceSecPerM;
    cumulativeTime += segTime;
    prevBoundary = b;
    return {
      distance_m: segDist,
      cumulative_distance_m: b,
      segment_time_seconds: segTime,
      cumulative_time_seconds: cumulativeTime,
      is_edited: false,
    };
  });
}

// Core "edit one split, recalculate the rest" behavior. Every split
// already marked is_edited (including the one just changed) keeps its own
// time exactly as set; the goal time minus all edited splits' time is
// redistributed proportionally by distance across the remaining
// not-yet-edited splits, so the overall goal time is always preserved
// exactly.
export function recalcAfterEdit(splits: SplitRow[], editedIndex: number, newSegmentTimeSeconds: number, goalTimeSeconds: number): SplitRow[] {
  const marked = splits.map((s, i) => (i === editedIndex ? { ...s, segment_time_seconds: newSegmentTimeSeconds, is_edited: true } : s));
  return recalcFromEditedFlags(marked, goalTimeSeconds);
}

// Re-derives segment/cumulative times from whichever splits are currently
// flagged is_edited, without changing any flags — used after recalcAfterEdit
// and also directly if a caller toggles a split back to "auto" (is_edited
// = false) and wants the rest to absorb that segment's share again.
export function recalcFromEditedFlags(splits: SplitRow[], goalTimeSeconds: number): SplitRow[] {
  const editedTime = splits.filter((s) => s.is_edited).reduce((a, s) => a + s.segment_time_seconds, 0);
  const editedDistance = splits.filter((s) => s.is_edited).reduce((a, s) => a + s.distance_m, 0);
  const totalDistance = splits.reduce((a, s) => a + s.distance_m, 0);
  const remainingDistance = totalDistance - editedDistance;
  const remainingTime = goalTimeSeconds - editedTime;
  // Floors at 0 rather than going negative — if the edited splits alone
  // already exceed the goal time, the remaining splits can't sensibly have
  // negative time. The caller surfaces a warning in this case (see
  // isOverGoalTime below) rather than silently showing impossible numbers.
  const paceForRemaining = remainingDistance > 0 ? Math.max(0, remainingTime) / remainingDistance : 0;

  let cumulative = 0;
  return splits.map((s) => {
    const segTime = s.is_edited ? s.segment_time_seconds : s.distance_m * paceForRemaining;
    cumulative += segTime;
    return { ...s, segment_time_seconds: segTime, cumulative_time_seconds: cumulative };
  });
}

export function isOverGoalTime(splits: SplitRow[], goalTimeSeconds: number): boolean {
  const editedTime = splits.filter((s) => s.is_edited).reduce((a, s) => a + s.segment_time_seconds, 0);
  return editedTime > goalTimeSeconds;
}

export function averagePaceSecPerKm(raceDistanceM: number, goalTimeSeconds: number): number {
  return goalTimeSeconds / (raceDistanceM / 1000);
}

export function averageSpeedKmh(raceDistanceM: number, goalTimeSeconds: number): number {
  return raceDistanceM / 1000 / (goalTimeSeconds / 3600);
}

// ============================================================
// Phase 8 — Strategy Builder
// ============================================================
// Each strategy is a pace-multiplier CURVE over the race (relative to
// average pace, 1.0 = exactly average), not a fixed set of numbers — the
// raw times from that curve get scaled so the total always lands exactly
// on the goal time, regardless of how many splits are being generated.
// That scaling step is what keeps the shape honest at any split increment
// without hand-tuning percentages per distance.

export type Strategy = "even_pace" | "negative_split" | "positive_split" | "fast_start" | "controlled_start" | "custom";

export const STRATEGY_OPTIONS: { value: Strategy; label: string; description: string }[] = [
  { value: "even_pace", label: "Even Pace", description: "Same pace start to finish." },
  { value: "negative_split", label: "Negative Split", description: "Second half faster than the first." },
  { value: "positive_split", label: "Positive Split", description: "First half faster, fading toward the end." },
  { value: "fast_start", label: "Fast Start", description: "Quick opening, then settle for the rest." },
  { value: "controlled_start", label: "Controlled Start", description: "Deliberately conservative opening, then even through the rest." },
  { value: "custom", label: "Custom", description: "Start even, then edit any split by hand." },
];

// fraction = midpoint of the segment as a proportion of total race
// distance (0 at the start, 1 at the finish). Returned value is a
// relative-pace multiplier — above 1 is slower than average, below 1 is
// faster.
function strategyMultiplier(strategy: Strategy, fraction: number): number {
  switch (strategy) {
    case "negative_split":
      // Slower at the start (+3%), faster at the finish (-3%), linear.
      return 1.03 - 0.06 * fraction;
    case "positive_split":
      // Faster at the start (-3%), slower at the finish (+3%), linear.
      return 0.97 + 0.06 * fraction;
    case "fast_start":
      // Quick first 15%, then a slightly-slower steady pace for the rest.
      return fraction < 0.15 ? 0.9 : 1.02;
    case "controlled_start":
      // Deliberately conservative first 20%, then even through the rest.
      return fraction < 0.2 ? 1.05 : 0.99;
    case "even_pace":
    case "custom":
    default:
      return 1;
  }
}

// Generates a fresh split set shaped by the given strategy, always
// summing to exactly goalTimeSeconds. This is what both the create form
// and "change strategy" on an existing plan call — always a full
// regeneration (clears any is_edited flags), never a partial adjustment.
export function generateStrategySplits(raceDistanceM: number, incrementM: number, goalTimeSeconds: number, strategy: Strategy): SplitRow[] {
  const boundaries = buildBoundaries(raceDistanceM, incrementM);
  const basePaceSecPerM = goalTimeSeconds / raceDistanceM;

  let prevBoundary = 0;
  const raw = boundaries.map((b) => {
    const segDist = b - prevBoundary;
    const midpointFraction = (prevBoundary + b) / 2 / raceDistanceM;
    const rawTime = segDist * basePaceSecPerM * strategyMultiplier(strategy, midpointFraction);
    prevBoundary = b;
    return { distance_m: segDist, cumulative_distance_m: b, rawTime };
  });

  const rawTotal = raw.reduce((a, r) => a + r.rawTime, 0);
  const scale = rawTotal > 0 ? goalTimeSeconds / rawTotal : 1;

  let cumulativeTime = 0;
  return raw.map((r) => {
    const segTime = r.rawTime * scale;
    cumulativeTime += segTime;
    return {
      distance_m: r.distance_m,
      cumulative_distance_m: r.cumulative_distance_m,
      segment_time_seconds: segTime,
      cumulative_time_seconds: cumulativeTime,
      is_edited: false,
    };
  });
}
