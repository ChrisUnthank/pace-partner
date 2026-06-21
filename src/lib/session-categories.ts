export const SESSION_CATEGORIES = [
  "easy",
  "long",
  "tempo",
  "threshold",
  "intervals",
  "reps",
  "fartlek",
  "steady",
  "race",
  "recovery",
  "cross_training",
  "rest",
] as const;

export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<SessionCategory, string> = {
  easy: "Easy",
  long: "Long",
  tempo: "Tempo",
  threshold: "Threshold",
  intervals: "Intervals",
  reps: "Reps",
  fartlek: "Fartlek",
  steady: "Steady run",
  race: "Race",
  recovery: "Recovery",
  cross_training: "Cross-training",
  rest: "Rest",
};

export function categoryLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (CATEGORY_LABEL as Record<string, string>)[value] ?? value;
}