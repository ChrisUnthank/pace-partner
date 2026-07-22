/**
 * Multi-Mode Workout Targets — Phase 1 foundation
 *
 * Defines the supported prescription modes, zone identifiers, shared types,
 * and a pure helper that infers the effective target mode for a step-like
 * object from either an explicit `target_mode` value or legacy field presence.
 *
 * No side effects. Safe to import anywhere (client, server, tests).
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const WORKOUT_TARGET_MODES = [
  "pace",
  "threshold_pace_pct",
  "threshold_hr_pct",
  "zone",
  "rpe",
  "open",
] as const;

export type WorkoutTargetMode = (typeof WORKOUT_TARGET_MODES)[number];

export const WORKOUT_TARGET_ZONES = ["z1", "z2", "z3", "z4", "z5"] as const;

export type WorkoutTargetZone = (typeof WORKOUT_TARGET_ZONES)[number];

// ── Step-like interface ───────────────────────────────────────────────────────

/**
 * Minimal shape accepted by `inferWorkoutTargetMode`.
 * Covers both legacy rows (only `target_pace_sec_per_km`) and new rows
 * (any combination of the Phase 1 columns).
 */
export interface WorkoutTargetStepLike {
  target_mode?: string | null;
  target_pace_sec_per_km?: number | null;
  target_threshold_pace_pct?: number | null;
  target_threshold_hr_pct?: number | null;
  target_zone?: string | null;
  target_rpe?: number | null;
}

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Infer the effective workout target mode for a step using the following
 * precedence:
 *
 * 1. Explicit valid `target_mode` field
 * 2. Legacy `target_pace_sec_per_km` present → `"pace"`
 * 3. `target_threshold_pace_pct` present → `"threshold_pace_pct"`
 * 4. `target_threshold_hr_pct` present → `"threshold_hr_pct"`
 * 5. `target_zone` present → `"zone"`
 * 6. `target_rpe` present → `"rpe"`
 * 7. Fallback → `"open"`
 *
 * This function is pure and has no side effects.
 */
export function inferWorkoutTargetMode(
  step: WorkoutTargetStepLike,
): WorkoutTargetMode {
  if (
    step.target_mode != null &&
    (WORKOUT_TARGET_MODES as readonly string[]).includes(step.target_mode)
  ) {
    return step.target_mode as WorkoutTargetMode;
  }
  if (step.target_pace_sec_per_km != null) return "pace";
  if (step.target_threshold_pace_pct != null) return "threshold_pace_pct";
  if (step.target_threshold_hr_pct != null) return "threshold_hr_pct";
  if (step.target_zone != null) return "zone";
  if (step.target_rpe != null) return "rpe";
  return "open";
}
