export const SESSION_INTENTS = ["easy","aerobic","tempo","threshold","vo2","anaerobic","speed","time_trial"] as const;
export type SessionIntent = (typeof SESSION_INTENTS)[number];
export const INTENT_LABEL: Record<SessionIntent, string> = {
  easy: "Easy", aerobic: "Aerobic", tempo: "Tempo", threshold: "Threshold",
  vo2: "VO2", anaerobic: "Anaerobic", speed: "Speed", time_trial: "Time Trial",
};

export const SESSION_STRUCTURES = ["continuous","reps_intervals","intervals"] as const;
export type SessionStructure = (typeof SESSION_STRUCTURES)[number];
export const STRUCTURE_LABEL: Record<SessionStructure, string> = {
  continuous: "Continuous",
  reps_intervals: "Reps/Intervals",
  intervals: "Intervals",
};
export const STRUCTURE_LABELS: Record<string, string> = {
  ...STRUCTURE_LABEL,
};

export const SESSION_DAY_TYPES = ["training","race","recovery","cross_training","rest"] as const;
export type SessionDayType = (typeof SESSION_DAY_TYPES)[number];
export const DAY_TYPE_LABEL: Record<SessionDayType, string> = {
  training: "Training", race: "Race", recovery: "Recovery",
  cross_training: "Cross-training", rest: "Rest",
};

export function sessionClassificationLabel(s: {
  day_type?: string | null;
  intent?: string | null;
  structure?: string | null;
  is_long_run?: boolean | null;
}): string {
  const dt = s.day_type ?? "training";
  if (dt !== "training") return (DAY_TYPE_LABEL as Record<string,string>)[dt] ?? dt;
  const parts: string[] = [];
  if (s.intent) parts.push((INTENT_LABEL as Record<string,string>)[s.intent] ?? s.intent);
  if (s.structure) parts.push(STRUCTURE_LABELS[s.structure] ?? s.structure);
  if (s.is_long_run) parts.push("Long run");
  return parts.join(" · ") || "Training";
}