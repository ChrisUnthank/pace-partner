// Wind helpers — bearing-of-travel from GPS points, and classifying that
// against a wind reading (headwind/tailwind/crosswind). Dependency-free
// (same convention as session-metrics.ts / rep-split-analysis.ts) so it's
// independently testable with `node -e`.
//
// CONVENTIONS
// - Wind direction is METEOROLOGICAL: the direction the wind is blowing
//   FROM (0/360 = from the north), matching Open-Meteo's own convention
//   and the sessions.wind_direction_deg column directly — no conversion
//   needed between storage and this module.
// - Travel bearing is the direction the athlete is moving TOWARD (compass
//   bearing, 0 = north, 90 = east), computed from consecutive GPS points.
// - A true headwind means the wind is blowing FROM roughly the direction
//   the athlete is heading TOWARD — i.e. travel bearing and wind-from
//   direction are close together (small angular difference), not 180°
//   apart. A tailwind is the ~180°-apart case.

export type WindReading = {
  speedKmh: number | null;
  directionDeg: number | null; // meteorological, direction wind blows FROM
};

// Great-circle initial bearing between two points, in degrees (0-360,
// compass convention). Standard formula — not the haversine distance
// formula, which this deliberately doesn't need.
export function computeBearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  if (![lat1, lng1, lat2, lng2].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (lat1 === lat2 && lng1 === lng2) return null;

  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);

  return (toDeg(theta) + 360) % 360;
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// 16-point compass label for a direction in degrees (0-360).
export function compassLabel(deg: number | null): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_POINTS[index];
}

export type RelativeWind = "headwind" | "tailwind" | "crosswind" | "calm" | "unknown";

// A genuinely calm reading shouldn't get labelled headwind/tailwind off a
// noisy direction reading that barely matters at low speed anyway.
const CALM_THRESHOLD_KMH = 6;

// ±45° of straight-on (0°) = headwind, ±45° of straight-behind (180°) =
// tailwind, the two 90°-wide bands in between = crosswind. A simple,
// standard banding — not claiming more precision than a single hourly
// wind reading actually supports.
export function classifyRelativeWind(travelBearingDeg: number | null, wind: WindReading): RelativeWind {
  if (wind.speedKmh == null) return "unknown";
  if (wind.speedKmh < CALM_THRESHOLD_KMH) return "calm";
  if (travelBearingDeg == null || wind.directionDeg == null) return "unknown";

  // Angular difference between the direction the athlete is heading and
  // the direction the wind is blowing FROM. 0° = running straight into
  // where the wind is coming from = headwind. 180° = wind at their back =
  // tailwind.
  let diff = Math.abs(travelBearingDeg - wind.directionDeg) % 360;
  if (diff > 180) diff = 360 - diff;

  if (diff <= 45) return "headwind";
  if (diff >= 135) return "tailwind";
  return "crosswind";
}

// The component of wind speed actually working against (positive) or with
// (negative) the athlete, along their direction of travel — cos(angle) *
// speed. Useful for a rough "how much of this wind reading actually
// mattered on this bearing" figure rather than just a headwind/tailwind/
// crosswind label. Positive = headwind component, negative = tailwind
// component, near zero = mostly crosswind (pushes sideways, not
// forward/back).
export function effectiveWindComponentKmh(travelBearingDeg: number | null, wind: WindReading): number | null {
  if (travelBearingDeg == null || wind.directionDeg == null || wind.speedKmh == null) return null;
  const diffRad = ((travelBearingDeg - wind.directionDeg) * Math.PI) / 180;
  return Number((wind.speedKmh * Math.cos(diffRad)).toFixed(1));
}

export const RELATIVE_WIND_LABEL: Record<RelativeWind, string> = {
  headwind: "Headwind",
  tailwind: "Tailwind",
  crosswind: "Crosswind",
  calm: "Calm",
  unknown: "—",
};

// Rotation (degrees, for a CSS transform) for an arrow icon that points UP
// by default, so it reads correctly relative to the athlete's OWN
// direction of travel for that split — not true compass north. The arrow
// shows where the wind is blowing TOWARD:
//   0°   = blowing the same way the athlete is running -> arrow points up
//          (forward, "pushing from behind") = tailwind
//   180° = blowing back at the athlete -> arrow points down (toward them,
//          "in their face") = headwind
//   90°/270° = blowing across their path -> arrow points right/left =
//          crosswind
// This is deliberately travel-relative rather than true-compass, because
// a travel-relative arrow is what actually answers "was this stretch into
// the wind or not" at a glance — true-compass-north arrows on a small grid
// of 100m splits would need the reader to also track which way each split
// was actually heading, which defeats the point of a quick visual.
export function windArrowRotationDeg(travelBearingDeg: number | null, wind: WindReading): number | null {
  if (travelBearingDeg == null || wind.directionDeg == null) return null;
  const windBlowingToDeg = (wind.directionDeg + 180) % 360;
  return ((windBlowingToDeg - travelBearingDeg) % 360 + 360) % 360;
}
