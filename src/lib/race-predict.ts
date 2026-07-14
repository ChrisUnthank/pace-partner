// Riegel's formula (Peter Riegel, 1977) — a standard, public-domain race
// equivalency model: T2 = T1 x (D2/D1)^1.06. Shared by the Pace/Race
// Predictor calculator and the session comparison tool, so both always use
// the exact same math rather than two copies that could drift apart.
export const RIEGEL_EXPONENT = 1.06;

export function predictTime(t1: number, d1: number, d2: number): number {
  return t1 * Math.pow(d2 / d1, RIEGEL_EXPONENT);
}

// Solves Riegel's exponent backward from two real known points (e.g. a
// training-session-implied performance and an actual race result), instead
// of assuming the generic 1.06 applies to everyone. This matters a lot for
// middle-distance specialists — the standard exponent is calibrated on
// average distance-runner data (mostly 5K-marathon) and has no way to know
// a given athlete has an unusually large "speed reserve," so it
// systematically undersells short/track-distance projections (mile, 800m)
// made from longer training paces for exactly that kind of athlete.
export function personalizedExponent(t1: number, d1: number, t2: number, d2: number): number | null {
  if (t1 <= 0 || d1 <= 0 || t2 <= 0 || d2 <= 0 || d1 === d2) return null;
  const k = Math.log(t2 / t1) / Math.log(d2 / d1);
  // Sanity bounds — a wildly out-of-range exponent (bad data, mismatched
  // efforts) shouldn't silently produce a worse prediction than the default.
  if (!Number.isFinite(k) || k <= 0 || k > 1.4) return null;
  return k;
}

export function predictTimeWithExponent(t1: number, d1: number, d2: number, exponent: number): number {
  return t1 * Math.pow(d2 / d1, exponent);
}

export function predictPaceAt(t1: number, d1: number, targetKm: number): number {
  return predictTime(t1, d1, targetKm) / targetKm;
}

// Solve for the Riegel-style exponent k that maps a known effort (t1 over d1)
// to a known result (t2 over d2): k = log(t2/t1) / log(d2/d1). Falls back to
// the standard exponent when the inputs are degenerate (same distance, zero
// or negative times) so callers never get NaN/Infinity.
export function personalizedExponent(
  t1: number,
  d1: number,
  t2: number,
  d2: number,
): number {
  if (t1 <= 0 || t2 <= 0 || d1 <= 0 || d2 <= 0 || d1 === d2) {
    return RIEGEL_EXPONENT;
  }
  const k = Math.log(t2 / t1) / Math.log(d2 / d1);
  return Number.isFinite(k) && k > 0 ? k : RIEGEL_EXPONENT;
}

export function predictTimeWithExponent(
  t1: number,
  d1: number,
  d2: number,
  exponent: number,
): number {
  return t1 * Math.pow(d2 / d1, exponent);
}

export const REFERENCE_DISTANCES = [
  { label: "800m", km: 0.8 },
  { label: "1000m", km: 1.0 },
  { label: "1500m", km: 1.5 },
  { label: "1 Mile", km: 1.60934 },
  { label: "3000m", km: 3 },
  { label: "2 Mile", km: 3.21868 },
  { label: "5000m", km: 5 },
  { label: "8K", km: 8 },
  { label: "10K", km: 10 },
  { label: "15K", km: 15 },
  { label: "10 Mile", km: 16.0934 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
];
