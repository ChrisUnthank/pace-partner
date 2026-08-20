import { describe, it, expect } from "vitest";
import {
  measureRunShape,
  stepPrescribesProgression,
  shouldAskAboutProgression,
  type ShapePoint,
} from "../run-shape";

/**
 * Builds a run from per-kilometre paces. Points every 100m so the segment
 * boundaries land on real data rather than always on a kilometre mark.
 */
function runFromKmPaces(paces: number[]): ShapePoint[] {
  const pts: ShapePoint[] = [{ distanceM: 0, elapsedS: 0 }];
  let d = 0;
  let t = 0;
  for (const pace of paces) {
    for (let i = 0; i < 10; i++) {
      d += 100;
      t += pace / 10;
      pts.push({ distanceM: d, elapsedS: t });
    }
  }
  return pts;
}

describe("measureRunShape", () => {
  it("a steady run has no split and no progression", () => {
    const shape = measureRunShape(runFromKmPaces(Array(12).fill(270)));
    expect(shape.basis).toBe("measured");
    expect(shape.negativeSplitPct).toBeCloseTo(0, 1);
    expect(shape.looksProgressive).toBe(false);
  });

  it("a deliberate build reads as progressive", () => {
    // 12km building 4:30 -> 3:40.
    const paces = [270, 268, 264, 258, 252, 246, 240, 234, 228, 224, 220, 218];
    const shape = measureRunShape(runFromKmPaces(paces));
    expect(shape.negativeSplitPct).toBeGreaterThan(10);
    expect(shape.fasterTransitions).toBe(shape.totalTransitions);
    expect(shape.looksProgressive).toBe(true);
  });

  it("an easy run drifting slightly quicker does NOT trigger the question", () => {
    // The common case. Monotonic, but only ~2% — someone warming into it.
    const paces = [312, 310, 308, 306, 305, 304, 303, 302, 301, 300];
    const shape = measureRunShape(runFromKmPaces(paces));
    expect(shape.fasterTransitions).toBe(shape.totalTransitions);
    expect(shape.negativeSplitPct!).toBeLessThan(5);
    expect(shape.looksProgressive).toBe(false);
  });

  it("a single hard finish is a kick, not a build", () => {
    // Flat then one flat-out kilometre. The split percentage alone would
    // pass; requiring most transitions to speed up is what rejects it.
    const paces = [270, 270, 270, 270, 270, 270, 270, 272, 271, 180];
    const shape = measureRunShape(runFromKmPaces(paces));
    expect(shape.fasterTransitions).toBeLessThan(Math.ceil(shape.totalTransitions / 2));
    expect(shape.looksProgressive).toBe(false);
  });

  it("a positive split reads as negative percentage, never as progressive", () => {
    const paces = [220, 224, 230, 238, 246, 256, 264, 272, 280, 290];
    const shape = measureRunShape(runFromKmPaces(paces));
    expect(shape.negativeSplitPct!).toBeLessThan(0);
    expect(shape.looksProgressive).toBe(false);
  });

  it("segments are equal DISTANCE, so a build is not understated", () => {
    const shape = measureRunShape(runFromKmPaces([270, 260, 250, 240, 230, 220, 210, 200]));
    const d = shape.segments.map((s) => Math.round(s.distanceM));
    expect(new Set(d).size).toBe(1);
    // Each quarter faster than the last.
    for (let i = 1; i < shape.segments.length; i++) {
      expect(shape.segments[i].paceSecPerKm).toBeLessThan(shape.segments[i - 1].paceSecPerKm);
    }
  });

  it("a short run has no meaningful shape", () => {
    // 3km — the first kilometre of anything is slower while settling in, and
    // on a jog that alone would read as a build.
    expect(measureRunShape(runFromKmPaces([300, 280, 250])).basis).toBe("insufficient");
  });

  it("degenerate input", () => {
    expect(measureRunShape([]).basis).toBe("insufficient");
    expect(measureRunShape([{ distanceM: 0, elapsedS: 0 }]).basis).toBe("insufficient");
    expect(() => measureRunShape(null as any)).not.toThrow();
    expect(
      measureRunShape([
        { distanceM: NaN, elapsedS: 0 },
        { distanceM: 10000, elapsedS: NaN },
      ] as any).basis,
    ).toBe("insufficient");
    // Zero elapsed across the run is unusable, not a run at infinite speed.
    expect(
      measureRunShape([
        { distanceM: 0, elapsedS: 5 },
        { distanceM: 10000, elapsedS: 5 },
      ]).basis,
    ).toBe("insufficient");
  });

  it("unsorted points are handled", () => {
    const pts = runFromKmPaces([300, 290, 280, 270, 260, 250]);
    const shuffled = [...pts].sort(() => Math.random() - 0.5);
    expect(measureRunShape(shuffled).negativeSplitPct).toBeCloseTo(
      measureRunShape(pts).negativeSplitPct!,
      6,
    );
  });
});

describe("stepPrescribesProgression", () => {
  it("both paces present and the end faster", () => {
    expect(stepPrescribesProgression({ target_pace_sec_per_km: 270, target_pace_end_sec_per_km: 230 })).toBe(true);
  });

  it("steady, fading, or incomplete is not a prescribed build", () => {
    expect(stepPrescribesProgression({ target_pace_sec_per_km: 270, target_pace_end_sec_per_km: 270 })).toBe(false);
    // A fade is a real thing to prescribe, but it is not what suppresses the
    // workout split, so it is not claimed here.
    expect(stepPrescribesProgression({ target_pace_sec_per_km: 230, target_pace_end_sec_per_km: 270 })).toBe(false);
    expect(stepPrescribesProgression({ target_pace_sec_per_km: 270 })).toBe(false);
    expect(stepPrescribesProgression({})).toBe(false);
    expect(stepPrescribesProgression(null)).toBe(false);
  });
});

describe("shouldAskAboutProgression", () => {
  const progressive = measureRunShape(runFromKmPaces([270, 262, 254, 246, 238, 230, 224, 218]));
  const steady = measureRunShape(runFromKmPaces(Array(8).fill(270)));

  it("asks when the shape is pronounced and nothing else answers it", () => {
    expect(shouldAskAboutProgression(progressive, null, false)).toBe(true);
  });

  it("stays silent when a prescription already answers it", () => {
    expect(shouldAskAboutProgression(progressive, null, true)).toBe(false);
  });

  it("never asks twice — including after a no", () => {
    // The important one. Re-asking would make the answer worthless, and a
    // recompute would otherwise re-raise it every time.
    expect(shouldAskAboutProgression(progressive, "not_intended", false)).toBe(false);
    expect(shouldAskAboutProgression(progressive, "intended", false)).toBe(false);
  });

  it("stays silent on an ordinary run", () => {
    expect(shouldAskAboutProgression(steady, null, false)).toBe(false);
  });
});
