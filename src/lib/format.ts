// Shared "what does localStorage say" check — every *Fmt function below
// reads this the same way metersFmt always has, rather than importing
// units.ts's react-query-backed useMyProfile() into this file. This file
// stays dependency-free on purpose so it's safe to call from anywhere
// (including non-component contexts); units.ts's metersToDisplay /
// paceToDisplay are the explicit-units-param siblings of these, for
// call sites that already have a resolved Units value in hand (e.g. from
// a query) rather than needing to re-read localStorage. Keep the
// conversion constants identical between the two files if either one
// changes — they intentionally do the same math.
// Exported (not just used internally) so components with unit-sensitive
// values these *Fmt helpers don't cover — e.g. stride length, vertical
// oscillation, chart-axis-baked distance — can build their own
// conversion without re-implementing the same localStorage read.
export function isImperial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("strider:units") === "imperial";
  } catch {
    return false;
  }
}

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
// Previously always "/km" regardless of the user's units setting — the
// unit-aware version (paceToDisplay in units.ts) existed but was never
// actually called anywhere. Fixed to convert sec/km -> sec/mi the same
// way metersFmt already converts distance, so a pace shown anywhere
// paceFmt is used (session rows, analytics, zones, reports, race
// analysis, compare — 30+ call sites) now follows the units toggle
// automatically without those call sites needing to change.
export function paceFmt(secPerKm?: number | null): string {
  if (!secPerKm) return "—";
  if (isImperial()) {
    const secPerMile = secPerKm * 1.609344;
    return `${secToClock(secPerMile)} /mi`;
  }
  return `${secToClock(secPerKm)} /km`;
}
// Speed, by contrast to pace, is naturally expressed as a rate (km/h or
// mph) rather than a "time per unit distance" — takes km/h in (however
// it was computed — paceToSpeed, averageSpeedKmh, wind speed, etc.) and
// converts to mph for imperial.
export function speedFmt(kmh?: number | null): string {
  if (kmh == null || !Number.isFinite(kmh)) return "—";
  if (isImperial()) {
    return `${(kmh / 1.609344).toFixed(1)} mph`;
  }
  return `${kmh.toFixed(1)} km/h`;
}
export function elevationFmt(m?: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (isImperial()) {
    return `${Math.round(m * 3.28084)} ft`;
  }
  return `${Math.round(m)} m`;
}
export function tempFmt(c?: number | null): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (isImperial()) {
    return `${Math.round(c * 9 / 5 + 32)}°F`;
  }
  return `${c.toFixed(1)}°C`;
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
  if (isImperial()) {
    const miles = m / 1609.344;
    if (miles >= 0.1) return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
    return `${Math.round(m * 1.09361)} yd`;
  }
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km`;
  return `${Math.round(m)} m`;
}
export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// General-purpose version of the same fix todayISO() applies, for any
// Date — not just "right now". Round-tripping an arbitrary local Date
// through .toISOString() silently rolls it back a calendar day for
// anyone east of UTC (Monday 00:00 AEDT becomes Sunday 13:00 UTC), which
// is exactly what was producing wrong "this week" boundaries wherever a
// Date other than "today" needed converting. Builds the string from the
// Date's own local getFullYear/getMonth/getDate instead.
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
