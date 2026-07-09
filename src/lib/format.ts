export function secToClock(s?: number | null): string {
  if (s == null || isNaN(s)) return "—";
  const sign = s < 0 ? "-" : "";
  const abs = Math.round(Math.abs(s));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = abs % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${sign}${m}:${String(sec).padStart(2, "0")}`;
}
export function paceFmt(secPerKm?: number | null): string {
  if (!secPerKm) return "—";
  return `${secToClock(secPerKm)} /km`;
}
export function clockToSec(v: string): number | null {
  if (!v) return null;
  const parts = v.split(":").map((p) => Number(p));
  if (parts.some((n) => isNaN(n))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// Rounds a recovery duration to the nearest 15 seconds for display — e.g. a
// recorded 97s recovery between reps shows as "1:30" instead of "1:37".
// Coaches think in clean round intervals, not raw GPS/lap-boundary timing
// noise, so this only affects how a value is *displayed* (the underlying
// recorded seconds used for analysis/fatigue calcs are untouched).
export function roundRecoverySeconds(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return sec;
  return Math.round(sec / 15) * 15;
}
// Rounds a GPS-measured distance to a clean, sensible display value —
// e.g. a recorded 998m interval rep shows as "1000m" instead of the raw
// GPS noise. Only for workout structure labels (rep/step distances), not
// for actual session totals which should stay precise.
export function roundDistanceForDisplay(m: number): number {
  if (m < 1000) return Math.round(m / 25) * 25;
  if (m < 3000) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}

export function metersFmt(m?: number | null): string {
  if (m == null) return "—";
  // Honour the user's units preference when running in the browser.
  if (typeof window !== "undefined") {
    try {
      const u = window.localStorage.getItem("strider:units");
      if (u === "imperial") {
        const miles = m / 1609.344;
        if (miles >= 0.1) return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
        return `${Math.round(m * 1.09361)} yd`;
      }
    } catch {
      /* ignore */
    }
  }
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km`;
  return `${Math.round(m)} m`;
}
export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
