/**
 * Injuries and illnesses — one vocabulary, used everywhere they are shown.
 *
 * These labels previously lived inside app.injuries.tsx, so every other
 * surface wrote its own. The dashboard's "Worth a look" card said
 * "Active injury — {body_part}", which for an illness rendered as
 * "Active injury — " with nothing after it: wrong word, missing name. The
 * Health overview tile said "No active injuries" while an active illness sat
 * underneath it.
 *
 * That is the same drift that produced four volume estimators and a calendar
 * legend disagreeing with its own cells. One record type, one place that knows
 * how to name it.
 */

export type HealthKind = "injury" | "illness";

export const ILLNESS_TYPE_LABEL: Record<string, string> = {
  respiratory_upper: "Respiratory — head cold / throat",
  respiratory_lower: "Respiratory — chest",
  respiratory_other: "Respiratory — unspecified",
  asthma: "Asthma",
  allergies: "Allergies / hay fever",
  gastrointestinal: "Stomach / gut",
  fever: "Fever",
  viral: "Viral / flu-like",
  other: "Other",
};

/** Short form, for a calendar cell or a badge where the full label will not fit. */
export const ILLNESS_TYPE_SHORT: Record<string, string> = {
  respiratory_upper: "Head cold",
  respiratory_lower: "Chest",
  respiratory_other: "Respiratory",
  asthma: "Asthma",
  allergies: "Allergies",
  gastrointestinal: "Gut",
  fever: "Fever",
  viral: "Viral",
  other: "Illness",
};

export const TRAINING_IMPACT_LABEL: Record<string, string> = {
  none: "Trained as normal",
  modified: "Trained around it",
  stopped: "No training",
};

/**
 * What "trained around it" actually meant.
 *
 * `training_impact` on its own records that something changed but not what,
 * which is the part worth having six months later — "reduced volume for a
 * fortnight" and "no speed work but full mileage" are different training
 * histories and they explain different things about what followed.
 *
 * Stored as an array because these combine: a coach cutting volume usually
 * also drops the session intensity, and forcing one choice would lose half
 * of what happened.
 */
export const TRAINING_MODIFICATION_LABEL: Record<string, string> = {
  reduced_volume: "Reduced volume",
  reduced_intensity: "Reduced intensity",
  shorter_sessions: "Shorter sessions",
  easy_only: "Easy running only",
  no_speed_work: "No speed work",
  no_hills: "No hills",
  extra_rest_days: "Extra rest days",
  cross_training: "Cross-training substituted",
  pool_running: "Pool running",
  gym_only: "Gym / strength only",
  surface_changed: "Softer surfaces",
  no_racing: "No racing",
};

/** The order they appear in the picker — roughly least to most disruptive. */
export const TRAINING_MODIFICATION_ORDER: string[] = [
  "reduced_volume",
  "reduced_intensity",
  "shorter_sessions",
  "easy_only",
  "no_speed_work",
  "no_hills",
  "surface_changed",
  "extra_rest_days",
  "cross_training",
  "pool_running",
  "gym_only",
  "no_racing",
];

/** Conditions that are usually standing facts rather than episodes. */
export const USUALLY_CHRONIC = new Set(["asthma", "allergies"]);

export interface HealthEventLike {
  kind?: string | null;
  body_part?: string | null;
  side?: string | null;
  illness_type?: string | null;
  status?: string | null;
  onset_date?: string | null;
  resolved_date?: string | null;
  is_chronic?: boolean | null;
  training_impact?: string | null;
  training_modifications?: string[] | null;
}

export function healthKind(rec: HealthEventLike | null | undefined): HealthKind {
  return rec?.kind === "illness" ? "illness" : "injury";
}

/** "Achilles (left)" or "Asthma". Never blank, never the wrong noun. */
export function healthEventLabel(rec: HealthEventLike | null | undefined): string {
  if (!rec) return "Unknown";
  if (healthKind(rec) === "illness") {
    return ILLNESS_TYPE_LABEL[rec.illness_type ?? ""] ?? "Illness";
  }
  const part = (rec.body_part ?? "").trim();
  const side = rec.side && rec.side !== "n/a" ? ` (${rec.side})` : "";
  return part ? `${part}${side}` : "Unspecified injury";
}

export function healthEventShortLabel(rec: HealthEventLike | null | undefined): string {
  if (!rec) return "Unknown";
  if (healthKind(rec) === "illness") {
    return ILLNESS_TYPE_SHORT[rec.illness_type ?? ""] ?? "Illness";
  }
  return (rec.body_part ?? "").trim() || "Injury";
}

/** "injury" or "illness", for sentences that need the noun. */
export function healthKindNoun(rec: HealthEventLike | null | undefined): string {
  return healthKind(rec) === "illness" ? "illness" : "injury";
}

/**
 * Was this record live on the given date?
 *
 * Open-ended when unresolved — an active injury with no resolved_date covers
 * every day from onset to today, which is what a calendar overlay needs.
 *
 * Chronic conditions are EXCLUDED by default. Asthma covering every single day
 * of a calendar forever tells a coach nothing and would bury the acute events
 * that actually explain a bad week. Pass includeChronic when the question
 * really is "what conditions does this athlete have".
 */
export function isActiveOn(
  rec: HealthEventLike,
  isoDate: string,
  opts: { includeChronic?: boolean } = {},
): boolean {
  if (!rec?.onset_date) return false;
  if (rec.is_chronic && !opts.includeChronic) return false;
  if (isoDate < rec.onset_date) return false;
  if (rec.resolved_date) return isoDate <= rec.resolved_date;
  // Unresolved: still running. `status` is not consulted — a record left on
  // "monitoring" with no resolved date is still something that was going on.
  return true;
}

/** Colour for a calendar marker. Illness and injury read differently at a glance. */
export function healthEventColorClass(rec: HealthEventLike | null | undefined): string {
  return healthKind(rec) === "illness" ? "bg-violet-500" : "bg-amber-500";
}

/** One line summarising what training looked like. Empty when nothing was recorded. */
export function trainingImpactSummary(rec: HealthEventLike | null | undefined): string {
  if (!rec) return "";
  const impact = TRAINING_IMPACT_LABEL[rec.training_impact ?? ""] ?? "";
  const mods = (rec.training_modifications ?? [])
    .map((m) => TRAINING_MODIFICATION_LABEL[m] ?? m)
    .filter(Boolean);
  if (!impact && mods.length === 0) return "";
  if (mods.length === 0) return impact;
  return `${impact}: ${mods.join(", ").toLowerCase()}`;
}
