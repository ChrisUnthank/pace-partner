/**
 * Multi-Mode Workout Targets — shared save-time normalization.
 *
 * Extracted from the New Session builder (Phase 2) so the same logic backs
 * both the builder and the standalone WorkTargetEditor (Phase 3.5) used to
 * set/fix targets on a session that already exists — a template apply, a
 * plan assignment, or an earlier builder save that skipped it. Two callers,
 * one source of truth; no behavior change from the original builder-only
 * version.
 */

import { inferWorkoutTargetMode, type WorkoutTargetMode } from "./workout-target-modes";

export type TargetMode = WorkoutTargetMode;

/** Minimal shape both callers need — a superset of StepDraft/steps row fields. */
export interface WorkTargetDraft {
  target_mode?: TargetMode | null;
  target_pace_sec_per_km?: number | null;
  target_threshold_pace_pct?: number | null;
  target_threshold_hr_pct?: number | null;
  target_zone?: string | null;
  target_rpe?: number | null;
}

/** UI mode-switch: clears every other mode's fields, never invents a value. */
export function setModePayload<T extends WorkTargetDraft>(mode: TargetMode, s: T): T {
  return {
    ...s,
    target_mode: mode,
    target_pace_sec_per_km: mode === "pace" ? (s.target_pace_sec_per_km ?? null) : null,
    target_threshold_pace_pct: mode === "threshold_pace_pct" ? (s.target_threshold_pace_pct ?? null) : null,
    target_threshold_hr_pct: mode === "threshold_hr_pct" ? (s.target_threshold_hr_pct ?? null) : null,
    target_zone: mode === "zone" ? (s.target_zone ?? null) : null,
    target_rpe: mode === "rpe" ? (s.target_rpe ?? null) : null,
  };
}

/**
 * Save-time normalization. Guarantees:
 *   1. Exactly one payload field (or none) is set — satisfies the DB's
 *      payload-exclusivity CHECK constraint.
 *   2. If the chosen mode's own value was never filled in, saves as "open"
 *      rather than inventing a default — blank means blank.
 */
export function normalizeWorkTargetForSave<T extends WorkTargetDraft>(s: T): T {
  const chosen = (s.target_mode ?? inferWorkoutTargetMode(s as any)) as TargetMode;

  const payloadByMode: Record<TargetMode, number | string | null | undefined> = {
    pace: s.target_pace_sec_per_km,
    threshold_pace_pct: s.target_threshold_pace_pct,
    threshold_hr_pct: s.target_threshold_hr_pct,
    zone: s.target_zone,
    rpe: s.target_rpe,
    open: null,
  };

  const v = payloadByMode[chosen];
  const hasValue = chosen !== "open" && v != null && !(typeof v === "number" && !Number.isFinite(v));
  const effective: TargetMode = hasValue ? chosen : "open";

  return {
    ...s,
    target_mode: effective,
    target_pace_sec_per_km: effective === "pace" ? (s.target_pace_sec_per_km ?? null) : null,
    target_threshold_pace_pct: effective === "threshold_pace_pct" ? (s.target_threshold_pace_pct ?? null) : null,
    target_threshold_hr_pct: effective === "threshold_hr_pct" ? (s.target_threshold_hr_pct ?? null) : null,
    target_zone: effective === "zone" ? (s.target_zone ?? null) : null,
    target_rpe: effective === "rpe" ? (s.target_rpe ?? null) : null,
  };
}

/** Range checks matching the DB's CHECK constraints — validate before writing. */
export function validateWorkTarget(s: WorkTargetDraft): string | null {
  const mode = (s.target_mode ?? inferWorkoutTargetMode(s as any)) as TargetMode;
  if (
    mode === "threshold_pace_pct" &&
    s.target_threshold_pace_pct != null &&
    (s.target_threshold_pace_pct <= 0 || s.target_threshold_pace_pct > 200)
  ) {
    return "Threshold pace percent must be between 1 and 200";
  }
  if (
    mode === "threshold_hr_pct" &&
    s.target_threshold_hr_pct != null &&
    (s.target_threshold_hr_pct <= 0 || s.target_threshold_hr_pct > 200)
  ) {
    return "Threshold HR percent must be between 1 and 200";
  }
  if (mode === "rpe" && s.target_rpe != null && (s.target_rpe < 1 || s.target_rpe > 10)) {
    return "RPE must be between 1 and 10";
  }
  return null;
}
