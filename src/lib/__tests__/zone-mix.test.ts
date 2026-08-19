import { describe, it, expect } from "vitest";
import {
  plannedZoneMix,
  measuredZoneMix,
  zoneForStep,
  zonePercentages,
  hardSharePct,
  dominantZone,
  sumZoneSeconds,
  totalZoneSeconds,
  emptyZoneSeconds,
  ZONE_KEYS,
  ZONE_COLORS,
  ZONE_LABELS,
} from "../zone-mix";

describe("vocabulary", () => {
  it("every zone in the enum has a colour and a label", () => {
    for (const k of ZONE_KEYS) {
      expect(ZONE_COLORS[k]).toBeTruthy();
      expect(ZONE_LABELS[k]).toBeTruthy();
    }
    // z6 was previously unlabelled everywhere, so sprint time rendered as a gap.
    expect(ZONE_KEYS).toContain("z6");
  });
});

describe("zoneForStep", () => {
  it("an explicit target zone always wins", () => {
    expect(zoneForStep({ kind: "warmup", target_mode: "zone", target_zone: "z4" }, "easy")).toBe("z4");
  });

  it("warmup and cooldown are easy whatever the session is", () => {
    expect(zoneForStep({ kind: "warmup" }, "vo2")).toBe("z1");
    expect(zoneForStep({ kind: "cooldown" }, "threshold")).toBe("z1");
    expect(zoneForStep({ kind: "recovery" }, "vo2")).toBe("z1");
  });

  it("work takes the session's intent", () => {
    expect(zoneForStep({ kind: "work" }, "easy")).toBe("z1");
    expect(zoneForStep({ kind: "work" }, "aerobic")).toBe("z2");
    expect(zoneForStep({ kind: "work" }, "tempo")).toBe("z3");
    expect(zoneForStep({ kind: "work" }, "threshold")).toBe("z3");
    expect(zoneForStep({ kind: "work" }, "vo2")).toBe("z4");
    expect(zoneForStep({ kind: "work" }, "speed")).toBe("z5");
  });

  it("day type beats intent, and unknowns fall back rather than throwing", () => {
    expect(zoneForStep({ kind: "work" }, "easy", "race")).toBe("z4");
    expect(zoneForStep({ kind: "work" }, "nonsense")).toBe("z1");
    expect(zoneForStep(null as any, null, null)).toBe("z1");
  });
});

describe("plannedZoneMix", () => {
  it("does not count a threshold session's warmup as threshold time", () => {
    const mix = plannedZoneMix({ intent: "threshold" }, [
      { kind: "warmup", target_kind: "time", target_time_seconds: 900 },
      { kind: "work", reps: 5, target_kind: "time", target_time_seconds: 240, recovery_target_seconds: 90 },
      { kind: "cooldown", target_kind: "time", target_time_seconds: 600 },
    ]);
    expect(mix.seconds.z3).toBe(1200); // 5 x 240 only
    // 900 warmup + 600 cooldown + 4 x 90 recovery
    expect(mix.seconds.z1).toBe(1860);
    expect(mix.basis).toBe("planned");
  });

  it("counts sets as well as reps", () => {
    const mix = plannedZoneMix({ intent: "vo2" }, [
      { kind: "work", reps: 4, set_count: 3, target_kind: "time", target_time_seconds: 60 },
    ]);
    expect(mix.seconds.z4).toBe(720);
  });

  it("converts a distance target to time at the assumed pace", () => {
    const mix = plannedZoneMix({ intent: "easy" }, [
      { kind: "work", target_kind: "distance", target_distance_m: 10000 },
    ]);
    expect(mix.seconds.z1).toBeCloseTo(10 * 330, 0);
  });

  it("recovery lands in z1 even between hard reps", () => {
    const mix = plannedZoneMix({ intent: "vo2" }, [
      {
        kind: "work",
        reps: 6,
        target_kind: "distance",
        target_distance_m: 400,
        recovery_target_kind: "distance",
        recovery_target_distance_m: 200,
      },
    ]);
    expect(mix.seconds.z1).toBeGreaterThan(0);
    expect(mix.seconds.z4).toBeGreaterThan(0);
  });

  it("empty and junk input", () => {
    expect(plannedZoneMix(null, null).basis).toBe("empty");
    expect(plannedZoneMix({ intent: "easy" }, []).basis).toBe("empty");
    expect(plannedZoneMix({ intent: "easy" }, [{ kind: "work" }]).basis).toBe("empty");
    expect(() => plannedZoneMix({ intent: "easy" }, [null, { reps: NaN }] as any)).not.toThrow();
  });
});

describe("measuredZoneMix", () => {
  it("prefers pace rows and does not double-count HR", () => {
    const mix = measuredZoneMix([
      { zone: "z1", seconds: 1800, source: "pace" },
      { zone: "z3", seconds: 600, source: "pace" },
      { zone: "z1", seconds: 1700, source: "hr" },
      { zone: "z3", seconds: 700, source: "hr" },
    ]);
    expect(mix.seconds.z1).toBe(1800);
    expect(mix.seconds.z3).toBe(600);
    expect(mix.totalSeconds).toBe(2400);
  });

  it("falls back to HR when there is no pace data", () => {
    const mix = measuredZoneMix([{ zone: "z2", seconds: 1200, source: "hr" }]);
    expect(mix.seconds.z2).toBe(1200);
    expect(mix.basis).toBe("measured");
  });

  it("ignores unknown zone values rather than throwing", () => {
    const mix = measuredZoneMix([
      { zone: "z9", seconds: 999, source: "pace" },
      { zone: "z2", seconds: 60, source: "pace" },
    ] as any);
    expect(mix.totalSeconds).toBe(60);
  });

  it("empty input", () => {
    expect(measuredZoneMix([]).basis).toBe("empty");
    expect(measuredZoneMix(null as any).basis).toBe("empty");
  });
});

describe("reading the mix", () => {
  const z = { ...emptyZoneSeconds(), z1: 8000, z2: 1000, z3: 600, z4: 400 };

  it("percentages sum to 100", () => {
    const p = zonePercentages(z);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("hard share counts z3 and above", () => {
    expect(hardSharePct(z)).toBeCloseTo((1000 / 10000) * 100);
  });

  it("null-safe on empty", () => {
    expect(hardSharePct(emptyZoneSeconds())).toBeNull();
    expect(dominantZone(emptyZoneSeconds())).toBeNull();
    expect(zonePercentages(null).z1).toBe(0);
  });

  it("dominant zone and summing", () => {
    expect(dominantZone(z)).toBe("z1");
    const s = sumZoneSeconds([z, z]);
    expect(totalZoneSeconds(s)).toBe(20000);
  });
});
