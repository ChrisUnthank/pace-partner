/**
 * What a coaching plan can include.
 *
 * Curated here rather than constrained in the database. The list is
 * open-ended by design — the brief for it ended in "etc" — and a coach adding
 * "strength programming" or "video analysis" next season should be a one-line
 * change here, not a migration.
 *
 * Grouped because the list is long enough that a flat row of a dozen
 * checkboxes is harder to read than the same twelve under three headings, and
 * because the groups answer different questions: what training is provided,
 * how much of the coach's time comes with it, and what happens around
 * racing.
 */

export interface PlanInclusion {
  key: string;
  label: string;
  group: "training" | "access" | "racing";
}

export const PLAN_INCLUSIONS: PlanInclusion[] = [
  // What training is provided.
  { key: "weekly_squad_sessions", label: "Weekly squad sessions", group: "training" },
  { key: "weekly_training_plan", label: "Weekly training plan", group: "training" },
  { key: "monthly_training_plan", label: "Monthly training plan", group: "training" },
  { key: "one_on_one", label: "One-to-one sessions", group: "training" },
  { key: "strength_programming", label: "Strength programming", group: "training" },

  // How much of the coach comes with it.
  { key: "full_coach_access", label: "Full coach access", group: "access" },
  { key: "online_coach_access", label: "Online coach access", group: "access" },
  { key: "session_feedback", label: "Session-by-session feedback", group: "access" },
  { key: "monthly_review", label: "Monthly review call", group: "access" },

  // Around racing.
  { key: "racing_tactical_advice", label: "Racing and tactical advice", group: "racing" },
  { key: "race_day_attendance", label: "Race day attendance", group: "racing" },
  { key: "season_planning", label: "Season planning", group: "racing" },
];

export const PLAN_INCLUSION_GROUP_LABEL: Record<PlanInclusion["group"], string> = {
  training: "Training",
  access: "Coach access",
  racing: "Racing",
};

/**
 * Label for a stored key.
 *
 * Falls back to the raw key rather than dropping it. A value written before a
 * rename — or typed straight into the database — is still something the coach
 * meant, and showing "video_analysis" is more useful than showing nothing and
 * leaving them wondering where it went.
 */
export function inclusionLabel(key: string): string {
  return PLAN_INCLUSIONS.find((i) => i.key === key)?.label ?? key;
}

/** Ordered labels for a plan, for a one-line summary. */
export function inclusionLabels(keys?: string[] | null): string[] {
  if (!keys || keys.length === 0) return [];
  const order = new Map(PLAN_INCLUSIONS.map((i, idx) => [i.key, idx]));
  return [...keys]
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    .map(inclusionLabel);
}
