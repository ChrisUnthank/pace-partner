import { describe, it, expect } from "vitest";
import {
  stepPaceSecPerKm,
  estimateStepsVolume,
  estimateSessionVolume,
  sumVolumes,
  assumedPaceSecPerKm,
  volumeDeltaPct,
  formatKm,
  formatDuration,
} from "../session-volume";

const work = (o: any = {}) => ({ kind: "work", reps: 1, set_count: 1, target_kind: "distance", ...o });

describe("estimateStepsVolume — what counts", () => {
  it("counts warmup and cooldown, not just work", () => {
    const v = estimateStepsVolume(
      [
        { kind: "warmup", target_kind: "distance", target_distance_m: 3000 },
        work({ target_distance_m: 5000 }),
        { kind: "cooldown", target_kind: "distance", target_distance_m: 2000 },
      ],
      "threshold",
    );
    expect(v.workM).toBe(5000);
    expect(v.supportM).toBe(5000);
    expect(v.totalM).toBe(10000);
  });

  it("the 5x1km case — work-only estimates understate the road by more than half", () => {
    const steps = [
      { kind: "warmup", target_kind: "distance", target_distance_m: 3000 },
      work({
        reps: 5,
        target_distance_m: 1000,
        recovery_target_kind: "distance",
        recovery_target_distance_m: 400,
      }),
      { kind: "cooldown", target_kind: "distance", target_distance_m: 2000 },
    ];
    const v = estimateStepsVolume(steps, "threshold");
    expect(v.workM).toBe(5000);
    // 3000 warmup + 2000 cooldown + 4 recoveries x 400m
    expect(v.supportM).toBe(6600);
    expect(v.totalM).toBe(11600);
  });

  it("respects counts_toward_distance = false", () => {
    const v = estimateStepsVolume(
      [work({ target_distance_m: 5000 }), work({ target_distance_m: 9999, counts_toward_distance: false })],
      "easy",
    );
    expect(v.totalM).toBe(5000);
  });

  it("multiplies by reps AND set_count", () => {
    const v = estimateStepsVolume([work({ reps: 4, set_count: 3, target_distance_m: 400 })], "vo2");
    expect(v.workM).toBe(4800);
  });
});

describe("estimateStepsVolume — recovery", () => {
  it("applies between-rep recovery reps-1 times per set", () => {
    const v = estimateStepsVolume(
      [work({ reps: 4, set_count: 2, target_distance_m: 400, recovery_target_kind: "distance", recovery_target_distance_m: 200 })],
      "vo2",
    );
    // (4-1) recoveries x 2 sets x 200m
    expect(v.supportM).toBe(1200);
  });

  it("applies between-set recovery sets-1 times", () => {
    const v = estimateStepsVolume(
      [work({ reps: 1, set_count: 3, target_distance_m: 1000, recovery_between_sets_seconds: 180 })],
      "threshold",
    );
    // 2 set breaks x 180s at recovery pace
    expect(v.totalSeconds).toBeGreaterThan(0);
    expect(v.supportM).toBeGreaterThan(0);
    expect(v.estimatedFromTimeM).toBe(v.supportM);
  });

  it("falls back to the legacy between-reps seconds field", () => {
    const v = estimateStepsVolume([work({ reps: 3, target_distance_m: 1000, recovery_between_reps_seconds: 120 })], "threshold");
    expect(v.supportM).toBeGreaterThan(0);
  });

  it("no recovery on a single rep with no sets", () => {
    const v = estimateStepsVolume(
      [work({ reps: 1, target_distance_m: 5000, recovery_target_kind: "distance", recovery_target_distance_m: 400 })],
      "tempo",
    );
    expect(v.supportM).toBe(0);
  });
});

describe("estimateStepsVolume — time targets", () => {
  it("converts time to distance at the bucket's assumed pace and flags it", () => {
    const v = estimateStepsVolume([work({ target_kind: "time", target_time_seconds: 1800 })], "easy");
    expect(v.workM).toBeCloseTo((1800 / 330) * 1000, 0);
    expect(v.estimatedFromTimeM).toBeCloseTo(v.workM, 0);
  });

  it("a distance target contributes no estimated metres", () => {
    const v = estimateStepsVolume([work({ target_distance_m: 10000 })], "easy");
    expect(v.estimatedFromTimeM).toBe(0);
    expect(v.totalSeconds).toBeCloseTo(10 * 330, 0);
  });

  it("cross-training has no assumed pace, so time yields no distance but does yield time", () => {
    const v = estimateStepsVolume([work({ target_kind: "time", target_time_seconds: 2400 })], "cross_train");
    expect(v.workM).toBe(0);
    expect(v.totalSeconds).toBe(2400);
  });
});

describe("estimateStepsVolume — degenerate", () => {
  it("empty and null inputs", () => {
    expect(estimateStepsVolume(null).isEmpty).toBe(true);
    expect(estimateStepsVolume([]).isEmpty).toBe(true);
    expect(estimateStepsVolume([null, undefined] as any).isEmpty).toBe(true);
  });

  it("steps with no targets set are empty, not zero-with-confidence", () => {
    expect(estimateStepsVolume([work({ target_distance_m: null, target_time_seconds: null })], "easy").isEmpty).toBe(true);
  });

  it("survives junk", () => {
    const junk: any[] = [
      [{ kind: "work", reps: NaN, target_distance_m: "abc" }],
      [{ kind: "work", reps: -5, set_count: -2, target_distance_m: 1000 }],
      [{ kind: "work", reps: Infinity, target_distance_m: 1000 }],
      [{}],
    ];
    for (const steps of junk) {
      expect(() => estimateStepsVolume(steps, "easy")).not.toThrow();
      const v = estimateStepsVolume(steps, "easy");
      expect(Number.isFinite(v.totalM)).toBe(true);
      expect(Number.isFinite(v.totalSeconds)).toBe(true);
    }
  });

  it("an unknown pace key falls back rather than throwing", () => {
    expect(assumedPaceSecPerKm("nonsense")).toBe(300);
    expect(assumedPaceSecPerKm(null)).toBe(300);
  });
});

describe("estimateSessionVolume", () => {
  it("prefers a recorded total over an estimate", () => {
    const v = estimateSessionVolume({ total_distance_m: 12345, total_time_seconds: 3600 }, [work({ target_distance_m: 5000 })], "easy");
    expect(v.totalM).toBe(12345);
    expect(v.totalSeconds).toBe(3600);
  });

  it("estimates when nothing was recorded", () => {
    const v = estimateSessionVolume({ total_distance_m: 0 }, [work({ target_distance_m: 5000 })], "easy");
    expect(v.totalM).toBe(5000);
  });

  it("handles a missing session", () => {
    expect(estimateSessionVolume(null, [work({ target_distance_m: 5000 })], "easy").totalM).toBe(5000);
  });
});

describe("sumVolumes / helpers", () => {
  it("sums and stays empty only when everything was", () => {
    const a = estimateStepsVolume([work({ target_distance_m: 5000 })], "easy");
    const b = estimateStepsVolume([work({ target_distance_m: 3000 })], "easy");
    expect(sumVolumes([a, b]).totalM).toBe(8000);
    expect(sumVolumes([a, b]).isEmpty).toBe(false);
    expect(sumVolumes([]).isEmpty).toBe(true);
  });

  it("delta and formatting", () => {
    expect(volumeDeltaPct(60000, 50000)).toBeCloseTo(20);
    expect(volumeDeltaPct(5000, 0)).toBeNull();
    expect(formatKm(12345)).toBe("12.3 km");
    expect(formatDuration(3900)).toBe("1h 05m");
    expect(formatDuration(1800)).toBe("30m");
  });
});


describe("prescribed pace beats the assumed table", () => {
  // The bug this locks down: a planned 10 km easy run was estimated at
  // 5:30/km — the population figure — while the calendar pill beside it read
  // "Z2 · 4:05–4:43/km" from the athlete's own zone profile. Every easy run
  // came out about eleven minutes long, and a week of them put the weekly
  // total out by nearly an hour.
  const JOSH_Z2: [number, number] = [245, 283]; // 4:05–4:43/km
  const resolve = () => JOSH_Z2;

  it("uses the middle of a prescribed band, not the generic table", () => {
    expect(stepPaceSecPerKm({ kind: "work" }, "easy", resolve)).toBe(264);
    // Without a resolver it falls back, which is the old behaviour.
    expect(stepPaceSecPerKm({ kind: "work" }, "easy")).toBe(330);
  });

  it("an explicit pace on the step beats even the zone profile", () => {
    expect(stepPaceSecPerKm({ kind: "work", target_pace_sec_per_km: 250 }, "easy", resolve)).toBe(250);
  });

  it("falls back when the profile cannot resolve the target", () => {
    expect(stepPaceSecPerKm({ kind: "work" }, "easy", () => null)).toBe(330);
    // A band with an unusable bound is not a band.
    expect(stepPaceSecPerKm({ kind: "work" }, "easy", () => [NaN, 280] as any)).toBe(330);
    expect(stepPaceSecPerKm({ kind: "work" }, "easy", () => [0, 0])).toBe(330);
  });

  it("the 10 km easy run comes back at the athlete's pace, not the table's", () => {
    const steps = [{ kind: "work", reps: 1, target_kind: "distance", target_distance_m: 10000 }];

    const generic = estimateStepsVolume(steps, "easy");
    expect(Math.round(generic.totalSeconds / 60)).toBe(55); // what was on screen

    const real = estimateStepsVolume(steps, "easy", resolve);
    expect(Math.round(real.totalSeconds / 60)).toBe(44); // 10 km at 4:24/km
    // Distance is unaffected — only the time was ever wrong.
    expect(real.totalM).toBe(generic.totalM);
  });

  it("a session's own distance never changes, whichever pace is used", () => {
    const steps = [
      { kind: "warmup", target_kind: "distance", target_distance_m: 3000 },
      { kind: "work", reps: 5, target_kind: "distance", target_distance_m: 1000 },
      { kind: "cooldown", target_kind: "distance", target_distance_m: 2000 },
    ];
    expect(estimateStepsVolume(steps, "threshold").totalM).toBe(
      estimateStepsVolume(steps, "threshold", resolve).totalM,
    );
  });

  it("a time-based target converts to MORE distance at a faster pace", () => {
    const steps = [{ kind: "work", target_kind: "time", target_time_seconds: 1800 }];
    const generic = estimateStepsVolume(steps, "easy");
    const real = estimateStepsVolume(steps, "easy", resolve);
    expect(real.totalM).toBeGreaterThan(generic.totalM);
    // Time is what was prescribed, so it is identical either way.
    expect(real.totalSeconds).toBe(generic.totalSeconds);
  });
});
