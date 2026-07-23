/**
 * Multi-Mode Workout Targets — Phase 3: resolution
 *
 * Pure functions that combine a step's target prescription with an
 * athlete's threshold/zone profile to produce concrete, displayable
 * pace/HR ranges. No side effects; safe to import anywhere.
 *
 * Semantics (agreed with Chris, July 2026):
 * - "% of threshold pace" is a percentage of threshold SPEED (the
 *   TrainingPeaks/industry convention): 95% resolves SLOWER than
 *   threshold, 105% faster. pace = threshold_pace / (pct / 100).
 * - "% of threshold HR" is simply pct × hr_threshold.
 * - Percent targets display as a band (± the constants below), not a
 *   single number — a coach prescribes an effort region, not one second.
 * - Zone targets resolve against the athlete's stored zone boundaries,
 *   using their preferred basis (pace or HR) and falling back to the
 *   other basis if the preferred one has no boundaries yet.
 */

import { inferWorkoutTargetMode, type WorkoutTargetMode, type WorkoutTargetStepLike } from "./workout-target-modes";

// ── Tunable band widths ──────────────────────────────────────────────────────

/** ± percentage points applied around a threshold-pace % target. */
export const THRESHOLD_PACE_BAND_PCT = 2.5;
/** ± bpm applied around a threshold-HR % target. */
export const THRESHOLD_HR_BAND_BPM = 3;

// ── Profile shape ────────────────────────────────────────────────────────────

/** Minimal slice of athlete_zone_profiles the resolver reads. */
export interface ZoneProfileLike {
  pace_threshold_sec_per_km?: number | null;
  hr_threshold?: number | null;
  preferred_zone_basis?: string | null;
  hr_z1_max?: number | null;
  hr_z2_max?: number | null;
  hr_z3_max?: number | null;
  hr_z4_max?: number | null;
  hr_z5_max?: number | null;
  pace_z1_max_sec_per_km?: number | null;
  pace_z2_max_sec_per_km?: number | null;
  pace_z3_max_sec_per_km?: number | null;
  pace_z4_max_sec_per_km?: number | null;
  pace_z5_max_sec_per_km?: number | null;
}

// ── Result shape ─────────────────────────────────────────────────────────────

export interface ResolvedTarget {
  mode: WorkoutTargetMode;
  /** Compact label for cards and step headers, e.g. "95% thr · 4:07–4:20/km". */
  label: string;
  /** Longer explanation for detail views, or null when the label says it all. */
  detail: string | null;
  /** [fast, slow] in sec/km when the target resolves to a pace band. */
  paceRangeSecPerKm: [number, number] | null;
  /** [low, high] bpm when the target resolves to an HR band. */
  hrRangeBpm: [number, number] | null;
  /** True when the mode needs profile data the athlete doesn't have yet. */
  needsProfile: boolean;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

/** 247.3 → "4:07". Local, tiny, so this lib stays dependency-free. */
export function paceClock(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function paceRangeLabel(fast: number, slow: number): string {
  return `${paceClock(fast)}–${paceClock(slow)}/km`;
}

function hrRangeLabel(lo: number, hi: number): string {
  return `${Math.round(lo)}–${Math.round(hi)} bpm`;
}

/** Ensure [fast, slow] ordering (fast = fewer sec/km). */
function orderedPace(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

// ── The resolver ─────────────────────────────────────────────────────────────

export function resolveStepTarget(
  step: WorkoutTargetStepLike,
  profile: ZoneProfileLike | null | undefined,
): ResolvedTarget {
  const mode = inferWorkoutTargetMode(step);

  const base: ResolvedTarget = {
    mode,
    label: "Open",
    detail: null,
    paceRangeSecPerKm: null,
    hrRangeBpm: null,
    needsProfile: false,
  };

  switch (mode) {
    case "open":
      return base;

    case "pace": {
      const p = step.target_pace_sec_per_km;
      if (p == null || !(p > 0)) return base;
      return { ...base, label: `@ ${paceClock(p)}/km`, paceRangeSecPerKm: [p, p] };
    }

    case "rpe": {
      const r = step.target_rpe;
      if (r == null) return base;
      return { ...base, label: `RPE ${r}/10`, detail: "Effort-based — run to feel, not a number." };
    }

    case "threshold_pace_pct": {
      const pct = step.target_threshold_pace_pct;
      if (pct == null || !(pct > 0)) return base;
      const thr = profile?.pace_threshold_sec_per_km;
      if (thr == null || !(thr > 0)) {
        return {
          ...base,
          label: `${pct}% threshold pace`,
          detail: "No threshold pace set for this athlete yet — set one on the Zones page to see a concrete pace.",
          needsProfile: true,
        };
      }
      // % of threshold SPEED: higher % = faster pace (fewer sec/km).
      const hiPct = pct + THRESHOLD_PACE_BAND_PCT;
      const loPct = Math.max(1, pct - THRESHOLD_PACE_BAND_PCT);
      const [fast, slow] = orderedPace(thr / (hiPct / 100), thr / (loPct / 100));
      return {
        ...base,
        label: `${pct}% thr · ${paceRangeLabel(fast, slow)}`,
        detail: `${pct}% of threshold pace (threshold ${paceClock(thr)}/km)`,
        paceRangeSecPerKm: [fast, slow],
      };
    }

    case "threshold_hr_pct": {
      const pct = step.target_threshold_hr_pct;
      if (pct == null || !(pct > 0)) return base;
      const thr = profile?.hr_threshold;
      if (thr == null || !(thr > 0)) {
        return {
          ...base,
          label: `${pct}% threshold HR`,
          detail: "No threshold HR set for this athlete yet — set one on the Zones page to see a concrete range.",
          needsProfile: true,
        };
      }
      const center = (thr * pct) / 100;
      const lo = Math.round(center - THRESHOLD_HR_BAND_BPM);
      const hi = Math.round(center + THRESHOLD_HR_BAND_BPM);
      return {
        ...base,
        label: `${pct}% thr HR · ${hrRangeLabel(lo, hi)}`,
        detail: `${pct}% of threshold HR (threshold ${Math.round(thr)} bpm)`,
        hrRangeBpm: [lo, hi],
      };
    }

    case "zone": {
      const z = step.target_zone;
      const n = z ? Number(String(z).replace(/^z/i, "")) : NaN;
      if (!Number.isFinite(n) || n < 1 || n > 5) return base;
      const zLabel = `Z${n}`;

      const preferHr = profile?.preferred_zone_basis === "hr";
      const paceBand = zonePaceBand(n, profile);
      const hrBand = zoneHrBand(n, profile);

      // Preferred basis first, other basis as fallback.
      const chosen: { kind: "pace" | "hr"; band: [number | null, number | null] } | null = preferHr
        ? hrBand
          ? { kind: "hr", band: hrBand }
          : paceBand
            ? { kind: "pace", band: paceBand }
            : null
        : paceBand
          ? { kind: "pace", band: paceBand }
          : hrBand
            ? { kind: "hr", band: hrBand }
            : null;

      if (!chosen) {
        return {
          ...base,
          label: `Zone ${n}`,
          detail: "No zone boundaries set for this athlete yet — set them on the Zones page to see a concrete range.",
          needsProfile: true,
        };
      }

      if (chosen.kind === "pace") {
        const [fast, slow] = chosen.band;
        if (fast != null && slow != null) {
          const [f, s] = orderedPace(fast, slow);
          return {
            ...base,
            label: `${zLabel} · ${paceRangeLabel(f, s)}`,
            detail: `Zone ${n} pace for this athlete`,
            paceRangeSecPerKm: [f, s],
          };
        }
        // Z1's slow end is open — only a fastest bound exists.
        if (fast != null) {
          return {
            ...base,
            label: `${zLabel} · ${paceClock(fast)}/km or slower`,
            detail: `Zone ${n} pace for this athlete`,
            paceRangeSecPerKm: [fast, fast],
          };
        }
      } else {
        const [lo, hi] = chosen.band;
        if (hi != null) {
          const loV = lo ?? 0;
          return {
            ...base,
            label: lo != null ? `${zLabel} · ${hrRangeLabel(loV, hi)}` : `${zLabel} · ≤${Math.round(hi)} bpm`,
            detail: `Zone ${n} heart rate for this athlete`,
            hrRangeBpm: [loV, hi],
          };
        }
      }

      return { ...base, label: `Zone ${n}`, needsProfile: true };
    }
  }

  return base;
}

/**
 * Compact target string for tight surfaces (calendar cards, list rows) —
 * null when there's nothing worth showing ("Open" stays silent there).
 */
export function resolvedTargetShortLabel(
  step: WorkoutTargetStepLike,
  profile: ZoneProfileLike | null | undefined,
): string | null {
  const r = resolveStepTarget(step, profile);
  if (r.mode === "open") return null;
  return r.label;
}

// ── Zone band lookups ────────────────────────────────────────────────────────
// Both boundary sets follow the same convention as the Zones page: the
// "_zN_max" column is the boundary between zone N and zone N+1. For HR
// that's the top bpm of zone N; for pace (where faster = smaller sec/km
// and higher zones are faster) it's the FAST end of zone N. Zone N's other
// bound comes from zone N-1's boundary; Z1's slow/low end is open.
// orderedPace() in the caller makes display robust even if a stored
// profile has these inverted.

function zonePaceBand(n: number, profile: ZoneProfileLike | null | undefined): [number | null, number | null] | null {
  if (!profile) return null;
  const bound = (i: number): number | null =>
    ((profile as any)[`pace_z${i}_max_sec_per_km`] as number | null | undefined) ?? null;
  const fast = bound(n);
  if (fast == null) return null;
  const slow = n > 1 ? bound(n - 1) : null;
  return [fast, slow];
}

function zoneHrBand(n: number, profile: ZoneProfileLike | null | undefined): [number | null, number | null] | null {
  if (!profile) return null;
  const bound = (i: number): number | null => ((profile as any)[`hr_z${i}_max`] as number | null | undefined) ?? null;
  const hi = bound(n);
  if (hi == null) return null;
  const lo = n > 1 ? (bound(n - 1) != null ? (bound(n - 1) as number) + 1 : null) : null;
  return [lo, hi];
}
