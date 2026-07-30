import { describe, it, expect } from "vitest";
import {
  hrZoneFor,
  computeTaiByZone,
  findHighIntensityRuns,
  computeOnsetSlope,
  computeBaselinePace,
  isPaceSurge,
  classifyRun,
  computeRefinedContinuousZoneTime,
  computeWorkRestSparsity,
  type IntensityPoint,
  type HrZoneBoundaries,
} from "../intensity-segments";

// Athlete zone profile used throughout: easy <=140, steady <=155,
// threshold <=168, vo2 <=178, rep >178.
const ZONES: HrZoneBoundaries = { z1Max: 140, z2Max: 155, z3Max: 168, z4Max: 178 };

// Builds a point series at 5-second resolution from a list of segments —
// a compact way to describe a whole session shape without hand-writing
// hundreds of individual points. Each segment can optionally ramp HR from
// `hr` to `hrEnd` linearly across its duration (real HR changes are never
// instant step-functions — using a flat value for a "drift" segment would
// look like a sharp onset to the slope detector, which is exactly the
// signal a genuine effort launch produces; ramping is what makes the
// synthetic drift patterns below physiologically realistic instead of
// accidentally looking like real efforts).
function buildPoints(segments: { durationS: number; hr: number; hrEnd?: number; paceSecPerKm: number }[]): IntensityPoint[] {
  const points: IntensityPoint[] = [];
  let t = 0;
  let lastHr = segments[0]?.hr ?? 0;
  let lastPace = segments[0]?.paceSecPerKm ?? 0;

  for (const seg of segments) {
    const steps = Math.max(1, Math.round(seg.durationS / 5));
    const hrEnd = seg.hrEnd ?? seg.hr;
    for (let i = 0; i < steps; i++) {
      const frac = steps > 1 ? i / (steps - 1) : 0;
      const hr = seg.hr + (hrEnd - seg.hr) * frac;
      points.push({ elapsedS: t, hr, paceSecPerKm: seg.paceSecPerKm });
      t += 5;
      lastHr = hr;
      lastPace = seg.paceSecPerKm;
    }
  }
  // Closing point so the last segment's final interval is included in any
  // sum-of-dt calculation (computeTaiByZone etc. sum time BETWEEN
  // consecutive points, so the series needs an endpoint after the final
  // sample, not just the sample itself).
  points.push({ elapsedS: t, hr: lastHr, paceSecPerKm: lastPace });
  return points;
}

describe("hrZoneFor", () => {
  it("buckets ascending HR into the right zone", () => {
    expect(hrZoneFor(120, ZONES)).toBe("easy");
    expect(hrZoneFor(150, ZONES)).toBe("steady");
    expect(hrZoneFor(165, ZONES)).toBe("threshold");
    expect(hrZoneFor(175, ZONES)).toBe("vo2");
    expect(hrZoneFor(190, ZONES)).toBe("rep");
  });
});

describe("computeTaiByZone", () => {
  it("sums seconds per zone from a plain point series", () => {
    const points = buildPoints([{ durationS: 60, hr: 130, paceSecPerKm: 330 }]);
    const tai = computeTaiByZone(points, ZONES);
    expect(tai.easy).toBe(60);
    expect(tai.threshold).toBe(0);
  });
});

describe("Pattern 1 — Continuous race, cardiac drift only (no real kick)", () => {
  // 35-minute continuous 10km-style effort: gentle ramp-in, settles into
  // steady/threshold pace, then GRADUALLY drifts up into vo2-zone HR over
  // the final ~8 minutes purely from cardiac drift — pace stays
  // essentially the SAME throughout the drift (no real surge). The ramp
  // is deliberately gradual (not a step change) to match how real HR
  // actually moves — a sudden jump between two constant values would
  // itself look like a genuine effort launch to the slope detector.
  const points = buildPoints([
    { durationS: 120, hr: 130, hrEnd: 145, paceSecPerKm: 260 }, // settle-in
    { durationS: 900, hr: 145, hrEnd: 165, paceSecPerKm: 240 }, // steady race effort
    { durationS: 480, hr: 165, hrEnd: 177, paceSecPerKm: 241 }, // gradual drift, pace UNCHANGED
  ]);

  it("classifies the drifted stretch as drift, not a genuine effort", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    const driftRuns = result.detectedRuns.filter((r) => r.classification === "drift");
    expect(driftRuns.length).toBeGreaterThan(0);
  });

  it("folds the drifted time into threshold instead of vo2", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    expect(result.seconds.vo2).toBe(0);
    expect(result.seconds.threshold).toBeGreaterThan(0);
  });

  it("the naive (unrefined) TAI would have wrongly shown real vo2 time", () => {
    const naive = computeTaiByZone(points, ZONES);
    expect(naive.vo2).toBeGreaterThan(0); // confirms the bug this module fixes is real
  });
});

describe("Pattern 2 — Continuous race WITH a genuine final sprint", () => {
  // Same shape as Pattern 1, but the last 45 seconds is a real kick: sharp
  // HR rise (not gradual drift) AND a clear pace surge, appended directly
  // onto the drifted stretch with no dip back to a lower zone first —
  // the exact "drift transitions straight into a kick" case that needs
  // the within-run split (findKickSplitWithinRun) to handle correctly.
  const points = buildPoints([
    { durationS: 120, hr: 130, hrEnd: 145, paceSecPerKm: 260 },
    { durationS: 900, hr: 145, hrEnd: 165, paceSecPerKm: 240 },
    { durationS: 480, hr: 165, hrEnd: 177, paceSecPerKm: 241 }, // drift, same as pattern 1
    { durationS: 45, hr: 188, paceSecPerKm: 195 }, // genuine sprint: sharp HR + real pace surge
  ]);

  it("still flags the long drifted stretch as drift", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    expect(result.detectedRuns.some((r) => r.classification === "drift")).toBe(true);
  });

  it("classifies the genuine finishing kick as anaerobic, not drift", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    const kick = result.detectedRuns.find((r) => r.durationS <= 60 && r.startS > 1400);
    expect(kick).toBeDefined();
    expect(kick!.classification).toBe("anaerobic");
  });

  it("the genuine kick's time still counts toward rep zone", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    expect(result.seconds.rep).toBeGreaterThan(0);
  });
});

describe("Pattern 3 — Short continuous effort under the cap (no correction needed)", () => {
  // A hard 1500m time trial run as ONE continuous block, ~4.5 minutes —
  // genuinely anaerobic/vo2-dominant. Must NOT be capped just for being a
  // single continuous rep.
  const points = buildPoints([{ durationS: 270, hr: 185, paceSecPerKm: 200 }]);

  it("returns raw TAI with no drift correction applied", () => {
    const result = computeRefinedContinuousZoneTime(points, ZONES, 12);
    expect(result.detectedRuns).toEqual([]);
    expect(result.seconds.rep).toBeGreaterThan(0);
  });
});

describe("computeOnsetSlope", () => {
  it("reads a steep slope for an explosive launch", () => {
    const points: IntensityPoint[] = [
      { elapsedS: 0, hr: 140, paceSecPerKm: 300 },
      { elapsedS: 10, hr: 175, paceSecPerKm: 180 },
    ];
    const slope = computeOnsetSlope(points, 1, 45);
    expect(slope).not.toBeNull();
    expect(slope!).toBeGreaterThan(1); // >1 bpm/sec is a sharp launch
  });

  it("reads a gentle slope for a gradual settle-in", () => {
    const points: IntensityPoint[] = [];
    for (let s = 0; s <= 300; s += 10) {
      points.push({ elapsedS: s, hr: 120 + s * 0.1, paceSecPerKm: 260 });
    }
    const lastIdx = points.length - 1;
    const slope = computeOnsetSlope(points, lastIdx, 45);
    expect(slope).not.toBeNull();
    expect(Math.abs(slope!)).toBeLessThan(0.15);
  });
});

describe("isPaceSurge", () => {
  it("confirms a real surge when pace is meaningfully faster than baseline", () => {
    const run = { startIdx: 0, endIdx: 1, startS: 0, endS: 10, durationS: 10, avgHr: 185, avgPaceSecPerKm: 195 };
    expect(isPaceSurge(run, 240)).toBe(true);
  });

  it("rejects a surge when pace barely changed (the drift signature)", () => {
    const run = { startIdx: 0, endIdx: 1, startS: 0, endS: 10, durationS: 10, avgHr: 176, avgPaceSecPerKm: 241 };
    expect(isPaceSurge(run, 240)).toBe(false);
  });
});

describe("classifyRun", () => {
  const run = { startIdx: 0, endIdx: 1, startS: 0, endS: 45, durationS: 45, avgHr: 188, avgPaceSecPerKm: 195 };

  it("classifies as drift when neither slope nor pace surge confirm it", () => {
    expect(classifyRun(run, 0.02, false)).toBe("drift");
  });

  it("classifies a confirmed short run as anaerobic", () => {
    expect(classifyRun(run, 0.2, true)).toBe("anaerobic");
  });

  it("classifies a confirmed longer run as vo2", () => {
    const longer = { ...run, durationS: 240 };
    expect(classifyRun(longer, 0.2, true)).toBe("vo2");
  });
});

describe("Pattern 4 — Work:rest sparsity distinguishes anaerobic reps from VO2 intervals", () => {
  it("reads short bursts with deep full recovery as anaerobic reps", () => {
    const reps = Array.from({ length: 6 }).map(() => ({
      workDurationS: 25,
      workAvgHr: 178,
      restDurationS: 90,
      restMinHr: 130,
    }));
    const result = computeWorkRestSparsity(reps);
    expect(result.character).toBe("anaerobic_reps");
  });

  it("reads longer bursts with incomplete recovery as vo2 intervals", () => {
    const reps = Array.from({ length: 5 }).map(() => ({
      workDurationS: 180,
      workAvgHr: 175,
      restDurationS: 150,
      restMinHr: 160,
    }));
    const result = computeWorkRestSparsity(reps);
    expect(result.character).toBe("vo2_intervals");
  });

  it("returns unknown for an empty rep list rather than guessing", () => {
    const result = computeWorkRestSparsity([]);
    expect(result.character).toBe("unknown");
  });
});

describe("findHighIntensityRuns", () => {
  it("drops sub-noise-threshold blips", () => {
    const points = buildPoints([
      { durationS: 60, hr: 140, paceSecPerKm: 260 },
      { durationS: 5, hr: 185, paceSecPerKm: 200 }, // 5s blip — should be dropped
      { durationS: 60, hr: 140, paceSecPerKm: 260 },
    ]);
    const runs = findHighIntensityRuns(points, ZONES, 15);
    expect(runs.length).toBe(0);
  });

  it("keeps a run at or above the minimum duration", () => {
    const points = buildPoints([
      { durationS: 60, hr: 140, paceSecPerKm: 260 },
      { durationS: 30, hr: 185, paceSecPerKm: 200 },
      { durationS: 60, hr: 140, paceSecPerKm: 260 },
    ]);
    const runs = findHighIntensityRuns(points, ZONES, 15);
    expect(runs.length).toBe(1);
  });
});

describe("computeBaselinePace", () => {
  it("excludes flagged runs from the baseline average", () => {
    const points = buildPoints([
      { durationS: 60, hr: 150, paceSecPerKm: 250 },
      { durationS: 30, hr: 185, paceSecPerKm: 180 },
    ]);
    const runs = findHighIntensityRuns(points, ZONES, 15);
    const baseline = computeBaselinePace(points, runs);
    expect(baseline).toBeCloseTo(250, 0);
  });
});
