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

// Coarse, manually-assignable time of day for sessions with no uploaded
// file to derive a real start time from (e.g. a manually-logged Gym
// session). Same 3-way split session-files.functions.ts already uses when
// it auto-titles a session from a real recorded timestamp (Morning <11,
// Afternoon 11-16, Evening 16+) — reusing it means a manual "Afternoon"
// tag sorts into the same slot a real 1pm upload would, so the sessions
// list stays chronologically consistent whether or not a given session
// has a file behind it.
export const TIME_OF_DAY_VALUES = ["morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIME_OF_DAY_VALUES)[number];
export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning", afternoon: "Afternoon", evening: "Evening",
};
const TIME_OF_DAY_HOUR: Record<TimeOfDay, number> = {
  morning: 8, afternoon: 13, evening: 18,
};

// Same controlled vocabulary sessions.terrain, training_locations.surface,
// and training_locations.surrounding_terrain all share — one list, reused
// everywhere a terrain/surface value gets chosen, so "surface" on a saved
// location and "terrain" on a session can never quietly drift into
// different wording for the same thing.
export const TERRAIN_VALUES = ["track", "road", "trail", "path", "grass", "treadmill", "mixed"] as const;
export type Terrain = (typeof TERRAIN_VALUES)[number];
export const TERRAIN_LABEL: Record<Terrain, string> = {
  track: "Track", road: "Road", trail: "Trail", path: "Path",
  grass: "Grass", treadmill: "Treadmill", mixed: "Mixed",
};

/**
 * A comparable same-day timestamp (ms) derived from a session's explicit
 * time_of_day, or null if it's unset / the session has no date yet.
 * Used as a same-day sort key wherever a session might not have a real
 * file-derived start time to sort by.
 */
export function timeOfDayHintMs(session: { session_date?: string | null; time_of_day?: string | null }): number | null {
  const tod = session.time_of_day as TimeOfDay | null | undefined;
  if (!tod || !session.session_date || !(tod in TIME_OF_DAY_HOUR)) return null;
  return new Date(`${session.session_date}T${String(TIME_OF_DAY_HOUR[tod]).padStart(2, "0")}:00:00`).getTime();
}

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
