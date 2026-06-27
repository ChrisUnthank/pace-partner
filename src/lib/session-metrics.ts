// Shared helpers for derived session metrics, status mapping, and insight text.
// Used by the analysis screen and session-details summary so VO normalization,
// stride-length computation, and coach-friendly status labels stay consistent.

export type SegmentType = "warmup" | "work" | "recovery" | "cooldown" | "strides";

/**
 * Normalize a vertical-oscillation reading to centimeters.
 * Some devices (and FIT files) store VO in tenths of a centimeter — a raw
 * value of 102 actually represents 10.2 cm. We treat anything > 30 as
 * tenths-of-cm and divide by 10. Garmin "extreme runners" rarely exceed
 * ~16 cm, so 30 is a safe ceiling.
 */
export function normalizeVO(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 30 ? n / 10 : n;
}

export function formatVO(raw: number | null | undefined): string {
  const v = normalizeVO(raw);
  if (v == null) return "—";
  return `${v.toFixed(1)} cm`;
}

/**
 * Stride length in meters from distance, duration and average cadence (spm).
 * stride (m) = speed (m/s) / (cadence / 60)
 *            = (distance / duration) * (60 / cadence)
 */
export function computeStrideLengthM(
  distanceM: number | null | undefined,
  durationS: number | null | undefined,
  avgCadSpm: number | null | undefined,
): number | null {
  const d = Number(distanceM);
  const t = Number(durationS);
  const c = Number(avgCadSpm);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(c) || c <= 0) return null;
  const stride = (d / t) * (60 / c);
  if (!Number.isFinite(stride) || stride <= 0 || stride > 5) return null;
  return Number(stride.toFixed(2));
}

export function formatStride(m: number | null | undefined): string {
  if (m == null) return "—";
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(2)} m`;
}

export type StatusKey = "best" | "on_pace" | "slight_fade" | "fade" | "none";
export type StatusInfo = {
  key: StatusKey;
  label: string;
  tone: "good" | "ok" | "warn" | "bad" | "none";
};

/**
 * Map a scored row to a single coach-friendly status. Best beats fade.
 * Non-work/strides rows always get "none".
 */
export function rowStatus(row: {
  type?: string | null;
  isBest?: boolean;
  fadeFlag?: "none" | "mild" | "strong";
  score?: number | null;
}): StatusInfo {
  if (row.type !== "work" && row.type !== "strides") {
    return { key: "none", label: "—", tone: "none" };
  }
  if (row.isBest) return { key: "best", label: "🔥 Best", tone: "good" };
  if (row.fadeFlag === "strong") return { key: "fade", label: "🔻 Fade", tone: "bad" };
  if (row.fadeFlag === "mild") return { key: "slight_fade", label: "⚠ Slight fade", tone: "warn" };
  if (typeof row.score === "number" && row.score >= 80) {
    return { key: "on_pace", label: "✅ On pace", tone: "ok" };
  }
  return { key: "none", label: "—", tone: "none" };
}

export type SessionInsight = {
  tone: "good" | "warn" | "bad";
  text: string;
};

/**
 * One- or two-sentence interpretation derived from the work/strides rows.
 * Returns null when there isn't enough rep data (< 2 reps).
 */
export function buildSessionInsight(rows: Array<{
  type?: string | null;
  avgPace?: number | null;
  fadeFlag?: "none" | "mild" | "strong";
  isBest?: boolean;
}>): SessionInsight | null {
  const work = rows.filter(
    (r) => (r.type === "work" || r.type === "strides") && typeof r.avgPace === "number" && (r.avgPace as number) > 0,
  );
  if (work.length < 2) return null;

  const paces = work.map((r) => r.avgPace as number);
  const first = paces[0];
  const last = paces[paces.length - 1];
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation

  const firstHalf = paces.slice(0, Math.floor(paces.length / 2));
  const secondHalf = paces.slice(Math.ceil(paces.length / 2));
  const fhMean = firstHalf.reduce((a, b) => a + b, 0) / Math.max(1, firstHalf.length);
  const shMean = secondHalf.reduce((a, b) => a + b, 0) / Math.max(1, secondHalf.length);
  const driftPct = fhMean > 0 ? ((shMean - fhMean) / fhMean) * 100 : 0;

  const startFastPct = mean > 0 ? ((first - mean) / mean) * 100 : 0; // negative => started faster
  const strongFades = work.filter((r) => r.fadeFlag === "strong").length;
  const mildFades = work.filter((r) => r.fadeFlag === "mild").length;

  if (strongFades >= 2 || driftPct > 6) {
    return { tone: "bad", text: `Late fade — pace drifted ${driftPct.toFixed(1)}% slower over the work reps. Consider easing the opening effort.` };
  }
  if (startFastPct <= -4 && driftPct > 2) {
    return { tone: "warn", text: `Started ~${Math.abs(startFastPct).toFixed(1)}% faster than average and faded ${driftPct.toFixed(1)}% later. Aim for a steadier opening.` };
  }
  if (mildFades >= 2 || (driftPct > 2 && cv > 0.04)) {
    return { tone: "warn", text: `Mixed execution — some reps drifted off pace (drift ${driftPct.toFixed(1)}%, variability ${(cv * 100).toFixed(1)}%).` };
  }
  if (cv <= 0.025) {
    return { tone: "good", text: `Even pacing across ${work.length} reps (variability ${(cv * 100).toFixed(1)}%). Strong execution.` };
  }
  return { tone: "good", text: `Solid work — ${work.length} reps with ${(cv * 100).toFixed(1)}% pace variability and minimal fade.` };
}