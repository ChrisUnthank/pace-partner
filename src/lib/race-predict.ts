// Riegel's formula (Peter Riegel, 1977) — a standard, public-domain race
// equivalency model: T2 = T1 x (D2/D1)^1.06. Shared by the Pace/Race
// Predictor calculator and the session comparison tool, so both always use
// the exact same math rather than two copies that could drift apart.
export const RIEGEL_EXPONENT = 1.06;

export function predictTime(t1: number, d1: number, d2: number): number {
  return t1 * Math.pow(d2 / d1, RIEGEL_EXPONENT);
}

export function predictPaceAt(t1: number, d1: number, targetKm: number): number {
  return predictTime(t1, d1, targetKm) / targetKm;
}

export const REFERENCE_DISTANCES = [
  { label: "1 Mile", km: 1.60934 },
  { label: "3K", km: 3 },
  { label: "5K", km: 5 },
  { label: "8K", km: 8 },
  { label: "10K", km: 10 },
  { label: "15K", km: 15 },
  { label: "10 Mile", km: 16.0934 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
];
