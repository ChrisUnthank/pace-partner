import { describe, it, expect } from "vitest";
import { reconstructTrack, type RawTrackPoint } from "../gps-reconstruction";

/**
 * The case these lock down is a real one: a 10.08 km race run in 30:42, whose
 * analysis page reported
 *
 *   GPS 12.87 km · Reconstructed 28.37 km · Official 10.08 km
 *   52:13–1:27:00 · dropout 0m → 8729m (+8729m)
 *   General GPS-vs-course smoothing: -18289m distributed across the whole race
 *
 * 2087 silent seconds — the watch off between two files — were read as a GPS
 * dropout and filled at 3:59/km, and the resulting 18 km surplus was then
 * spread across every split to make the total come out right.
 */

/** One point per second at a steady pace. */
function steady(fromS: number, toS: number, startM: number, mps: number): RawTrackPoint[] {
  const out: RawTrackPoint[] = [];
  for (let t = fromS; t <= toS; t++) {
    out.push({ elapsed_s: t, distance_m: startM + (t - fromS) * mps });
  }
  return out;
}

describe("recording gaps are not dropouts", () => {
  it("does not invent distance across a 35-minute silence", () => {
    // Ten minutes of running, the watch off for 35 minutes, ten more minutes.
    const first = steady(0, 600, 0, 5.5);
    const last = steady(2687, 3287, 3300, 5.5);
    const res = reconstructTrack([...first, ...last], null);

    const gap = res.anomalies.find((a) => a.type === "gap");
    expect(gap).toBeDefined();
    // Nothing was recorded, so nothing is added.
    expect(gap!.adjustmentM).toBe(0);

    // Without the fix this reconstructed ~11.5km of running that never
    // happened; the real total is the two recorded blocks.
    expect(res.reconstructedTotalDistanceM).toBeLessThan(7000);
  });

  it("still corrects a genuine short dropout", () => {
    // A real GPS dropout is MISSING POINTS, not points that barely move —
    // the watch stops fixing position and the next sample lands 40s later
    // having logged almost no distance. That shape is one long interval, and
    // it is what the detector is built to find.
    const pts = [...steady(0, 300, 0, 5.5)];
    const at = pts[pts.length - 1].distance_m as number;
    pts.push({ elapsed_s: 340, distance_m: at + 8 });
    pts.push(...steady(341, 640, at + 8, 5.5));

    const res = reconstructTrack(pts, null);
    const dropout = res.anomalies.find((a) => a.type === "dropout");
    expect(dropout).toBeDefined();
    // 40s at ~5.5 m/s is a little over 200m of running to restore.
    expect(dropout!.adjustmentM).toBeGreaterThan(150);
    // And it is not a gap — 40s of lost signal is ordinary, and well under
    // the two-minute threshold that marks the watch as simply not recording.
    expect(res.anomalies.some((a) => a.type === "gap")).toBe(false);
  });

  it("a long stretch of REAL but very slow movement is left alone", () => {
    // Points still arriving every second at walking pace. Whatever this is —
    // a stop at lights, a stitch, a chat — it was recorded, and the athlete
    // was really there. Nothing should be added to it.
    const pts = [...steady(0, 300, 0, 5.5)];
    const at = pts[pts.length - 1].distance_m as number;
    for (let t = 301; t <= 340; t++) pts.push({ elapsed_s: t, distance_m: at + (t - 300) * 0.2 });
    pts.push(...steady(341, 640, at + 8, 5.5));

    const res = reconstructTrack(pts, null);
    const added = res.anomalies.reduce((sum, a) => sum + Math.max(0, a.adjustmentM), 0);
    expect(added).toBeLessThan(50);
  });

  it("the gap threshold is what separates them", () => {
    const build = (silenceS: number) => {
      const a = steady(0, 300, 0, 5.5);
      const b = steady(300 + silenceS, 600 + silenceS, 1650, 5.5);
      return reconstructTrack([...a, ...b], null);
    };
    expect(build(60).anomalies.some((x) => x.type === "gap")).toBe(false);
    expect(build(600).anomalies.some((x) => x.type === "gap")).toBe(true);
  });
});

describe("no single correction may dominate the race", () => {
  it("caps one anomaly well below the official distance", () => {
    const pts = [...steady(0, 300, 0, 5.5)];
    const at = pts[pts.length - 1].distance_m as number;
    // 110s of near-zero movement: long enough to be a big correction, short
    // enough to still count as a dropout rather than a gap.
    for (let t = 301; t <= 410; t++) pts.push({ elapsed_s: t, distance_m: at });
    pts.push(...steady(411, 900, at, 5.5));

    const res = reconstructTrack(pts, 10080);
    const added = res.anomalies.reduce((sum, a) => sum + Math.max(0, a.adjustmentM), 0);
    // 15% of 10.08km. The old cap was ref * dt * 3, which grew with the gap
    // and so constrained nothing.
    expect(added).toBeLessThanOrEqual(10080 * 0.15 + 1);
  });
});

describe("an absurd reconstruction is abandoned, not distributed", () => {
  it("falls back to scaled raw GPS rather than spreading the error", () => {
    // Reconstruct far above the official distance, the shape of the real bug.
    const pts = [...steady(0, 600, 0, 5.5)];
    const at = pts[pts.length - 1].distance_m as number;
    for (let t = 601; t <= 700; t++) pts.push({ elapsed_s: t, distance_m: at });
    pts.push(...steady(701, 1842, at, 5.5));

    const official = 1000; // deliberately far below what the GPS recorded
    const res = reconstructTrack(pts, official);

    expect(res.reconstructionAbandoned).toBe(true);
    // The total still lands on the official distance...
    expect(res.finalTotalDistanceM).toBeCloseTo(official, 0);
    // ...but by scaling the RAW series, so the splits reflect what the watch
    // actually recorded rather than an invented reconstruction.
    expect(res.points[res.points.length - 1].final_distance_m).toBeCloseTo(official, 0);
  });

  it("a normal race is left alone", () => {
    const pts = steady(0, 1800, 0, 5.6); // ~10.08km in 30:00
    const res = reconstructTrack(pts, 10080);
    expect(res.reconstructionAbandoned).toBeFalsy();
    expect(res.finalTotalDistanceM).toBeCloseTo(10080, 0);
  });
});

describe("degenerate input", () => {
  it("survives empty, single-point and unusable series", () => {
    expect(() => reconstructTrack([], 10000)).not.toThrow();
    expect(() => reconstructTrack([{ elapsed_s: 0, distance_m: 0 }], 10000)).not.toThrow();
    expect(() =>
      reconstructTrack(
        [
          { elapsed_s: 0, distance_m: null },
          { elapsed_s: 10, distance_m: null },
        ],
        10000,
      ),
    ).not.toThrow();
  });

  it("no official distance means nothing is forced", () => {
    const pts = steady(0, 600, 0, 5.5);
    const res = reconstructTrack(pts, null);
    expect(res.officialDistanceM).toBeNull();
    expect(res.finalTotalDistanceM).toBeGreaterThan(0);
  });
});
