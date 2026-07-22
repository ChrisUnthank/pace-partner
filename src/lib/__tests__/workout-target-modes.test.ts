import { describe, it, expect } from "vitest";
import {
  inferWorkoutTargetMode,
  WORKOUT_TARGET_MODES,
  WORKOUT_TARGET_ZONES,
  type WorkoutTargetMode,
  type WorkoutTargetZone,
} from "../workout-target-modes";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("WORKOUT_TARGET_MODES", () => {
  it("contains exactly the six expected modes", () => {
    expect(WORKOUT_TARGET_MODES).toEqual([
      "pace",
      "threshold_pace_pct",
      "threshold_hr_pct",
      "zone",
      "rpe",
      "open",
    ]);
  });
});

describe("WORKOUT_TARGET_ZONES", () => {
  it("contains exactly z1–z5", () => {
    expect(WORKOUT_TARGET_ZONES).toEqual(["z1", "z2", "z3", "z4", "z5"]);
  });
});

// ── inferWorkoutTargetMode ────────────────────────────────────────────────────

describe("inferWorkoutTargetMode", () => {
  // ── 1. Explicit valid target_mode ──────────────────────────────────────────

  it("returns the explicit target_mode when it is a known mode", () => {
    const modes: WorkoutTargetMode[] = [
      "pace",
      "threshold_pace_pct",
      "threshold_hr_pct",
      "zone",
      "rpe",
      "open",
    ];
    for (const mode of modes) {
      expect(inferWorkoutTargetMode({ target_mode: mode })).toBe(mode);
    }
  });

  it("explicit target_mode=open overrides any populated legacy field", () => {
    expect(
      inferWorkoutTargetMode({
        target_mode: "open",
        target_pace_sec_per_km: 240,
      }),
    ).toBe("open");
  });

  it("explicit target_mode=threshold_pace_pct overrides target_pace_sec_per_km", () => {
    expect(
      inferWorkoutTargetMode({
        target_mode: "threshold_pace_pct",
        target_pace_sec_per_km: 240,
      }),
    ).toBe("threshold_pace_pct");
  });

  it("ignores unknown/invalid target_mode strings and falls through", () => {
    // An unknown mode string should not short-circuit; fall back by field.
    expect(
      inferWorkoutTargetMode({
        target_mode: "heartrate", // not in the allowed set
        target_pace_sec_per_km: 240,
      }),
    ).toBe("pace");
  });

  it("treats null target_mode the same as absent", () => {
    expect(
      inferWorkoutTargetMode({
        target_mode: null,
        target_pace_sec_per_km: 240,
      }),
    ).toBe("pace");
  });

  // ── 2. Legacy pace fallback ────────────────────────────────────────────────

  it("infers pace from target_pace_sec_per_km (legacy row)", () => {
    expect(
      inferWorkoutTargetMode({ target_pace_sec_per_km: 210 }),
    ).toBe("pace");
  });

  it("infers pace when only target_pace_sec_per_km is set (no target_mode)", () => {
    expect(
      inferWorkoutTargetMode({
        target_mode: null,
        target_pace_sec_per_km: 300,
      }),
    ).toBe("pace");
  });

  // ── 3. threshold_pace_pct ─────────────────────────────────────────────────

  it("infers threshold_pace_pct from target_threshold_pace_pct", () => {
    expect(
      inferWorkoutTargetMode({ target_threshold_pace_pct: 95 }),
    ).toBe("threshold_pace_pct");
  });

  it("threshold_pace_pct takes lower precedence than pace", () => {
    // pace field is present → should win over threshold_pace_pct
    expect(
      inferWorkoutTargetMode({
        target_pace_sec_per_km: 240,
        target_threshold_pace_pct: 95,
      }),
    ).toBe("pace");
  });

  // ── 4. threshold_hr_pct ───────────────────────────────────────────────────

  it("infers threshold_hr_pct from target_threshold_hr_pct", () => {
    expect(
      inferWorkoutTargetMode({ target_threshold_hr_pct: 90 }),
    ).toBe("threshold_hr_pct");
  });

  it("threshold_hr_pct loses to threshold_pace_pct", () => {
    expect(
      inferWorkoutTargetMode({
        target_threshold_pace_pct: 95,
        target_threshold_hr_pct: 90,
      }),
    ).toBe("threshold_pace_pct");
  });

  // ── 5. zone ───────────────────────────────────────────────────────────────

  it("infers zone from target_zone", () => {
    const zones: WorkoutTargetZone[] = ["z1", "z2", "z3", "z4", "z5"];
    for (const zone of zones) {
      expect(inferWorkoutTargetMode({ target_zone: zone })).toBe("zone");
    }
  });

  it("zone loses to threshold_hr_pct", () => {
    expect(
      inferWorkoutTargetMode({
        target_threshold_hr_pct: 90,
        target_zone: "z3",
      }),
    ).toBe("threshold_hr_pct");
  });

  // ── 6. rpe ────────────────────────────────────────────────────────────────

  it("infers rpe from target_rpe", () => {
    expect(inferWorkoutTargetMode({ target_rpe: 7 })).toBe("rpe");
  });

  it("rpe loses to zone", () => {
    expect(
      inferWorkoutTargetMode({ target_zone: "z2", target_rpe: 6 }),
    ).toBe("zone");
  });

  // ── 7. open fallback ──────────────────────────────────────────────────────

  it("returns open when no fields are set", () => {
    expect(inferWorkoutTargetMode({})).toBe("open");
  });

  it("returns open for a completely empty step", () => {
    expect(
      inferWorkoutTargetMode({
        target_mode: null,
        target_pace_sec_per_km: null,
        target_threshold_pace_pct: null,
        target_threshold_hr_pct: null,
        target_zone: null,
        target_rpe: null,
      }),
    ).toBe("open");
  });

  // ── Representative legacy cases ───────────────────────────────────────────

  it('legacy step — "6 x 1km @ 3:30/km" → pace', () => {
    // 3:30/km = 210 sec/km
    expect(
      inferWorkoutTargetMode({ target_pace_sec_per_km: 210 }),
    ).toBe("pace");
  });

  it('new step — "6 x 3 min @ 95% Threshold Pace" → threshold_pace_pct', () => {
    expect(
      inferWorkoutTargetMode({ target_threshold_pace_pct: 95 }),
    ).toBe("threshold_pace_pct");
  });

  it('new step — "20 min @ Zone 3" → zone', () => {
    expect(
      inferWorkoutTargetMode({ target_zone: "z3" }),
    ).toBe("zone");
  });

  it('new step — "10 min @ RPE 7" → rpe', () => {
    expect(inferWorkoutTargetMode({ target_rpe: 7 })).toBe("rpe");
  });

  it('new step — "Easy run (notes only)" → open', () => {
    expect(inferWorkoutTargetMode({})).toBe("open");
  });

  // ── Full precedence chain ─────────────────────────────────────────────────

  it("honours full precedence order when multiple fields are present", () => {
    // explicit mode wins over everything
    expect(
      inferWorkoutTargetMode({
        target_mode: "zone",
        target_pace_sec_per_km: 240,
        target_threshold_pace_pct: 95,
        target_threshold_hr_pct: 90,
        target_zone: "z3",
        target_rpe: 7,
      }),
    ).toBe("zone");

    // no explicit mode; pace wins
    expect(
      inferWorkoutTargetMode({
        target_mode: null,
        target_pace_sec_per_km: 240,
        target_threshold_pace_pct: 95,
        target_zone: "z3",
        target_rpe: 7,
      }),
    ).toBe("pace");

    // no pace; threshold_pace_pct wins
    expect(
      inferWorkoutTargetMode({
        target_threshold_pace_pct: 95,
        target_threshold_hr_pct: 90,
        target_zone: "z3",
        target_rpe: 7,
      }),
    ).toBe("threshold_pace_pct");

    // no threshold_pace_pct; threshold_hr_pct wins
    expect(
      inferWorkoutTargetMode({
        target_threshold_hr_pct: 90,
        target_zone: "z3",
        target_rpe: 7,
      }),
    ).toBe("threshold_hr_pct");

    // no threshold_hr_pct; zone wins
    expect(
      inferWorkoutTargetMode({ target_zone: "z3", target_rpe: 7 }),
    ).toBe("zone");

    // only rpe
    expect(inferWorkoutTargetMode({ target_rpe: 7 })).toBe("rpe");
  });
});
