import { Users, User, Bed, CircleDashed, Route, Dumbbell, Activity, Trophy, PlayCircle } from "lucide-react";

export type TrainingDayType =
  | "group_session"
  | "individual_program"
  | "rest"
  | "optional"
  | "long_run"
  | "cross_training"
  | "sport_specific_training"
  | "sport_specific_game_event"
  // Added directly in the database as an exact-case value ("Session"),
  // not snake_case like the others — kept as-is here since the string
  // has to match the enum exactly, not restyled to fit the pattern.
  | "Session";

export const DAY_TYPE_META: Record<TrainingDayType, { label: string; short: string; icon: any; colorCls: string; dotCls: string }> = {
  group_session: {
    label: "Group Session",
    short: "Group",
    icon: Users,
    colorCls: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    dotCls: "bg-purple-500",
  },
  individual_program: {
    label: "Individual Program",
    short: "Individual",
    icon: User,
    colorCls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    dotCls: "bg-sky-500",
  },
  rest: {
    label: "Rest Day",
    short: "Rest",
    icon: Bed,
    colorCls: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    dotCls: "bg-slate-500",
  },
  optional: {
    label: "Optional Session",
    short: "Optional",
    icon: CircleDashed,
    colorCls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    dotCls: "bg-amber-500",
  },
  long_run: {
    label: "Long Run",
    short: "Long Run",
    icon: Route,
    colorCls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    dotCls: "bg-emerald-500",
  },
  cross_training: {
    label: "Cross Training",
    short: "Cross Train",
    icon: Dumbbell,
    colorCls: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    dotCls: "bg-teal-500",
  },
  sport_specific_training: {
    label: "Sport Specific Training",
    short: "Sport Training",
    icon: Activity,
    colorCls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
    dotCls: "bg-fuchsia-500",
  },
  sport_specific_game_event: {
    label: "Sport Specific Game/Event",
    short: "Game/Event",
    icon: Trophy,
    colorCls: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    dotCls: "bg-rose-500",
  },
  Session: {
    label: "Session",
    short: "Session",
    icon: PlayCircle,
    colorCls: "bg-lime-500/15 text-lime-400 border-lime-500/30",
    dotCls: "bg-lime-500",
  },
};

export const DAY_TYPE_OPTIONS = Object.entries(DAY_TYPE_META).map(([value, meta]) => ({
  value: value as TrainingDayType,
  label: meta.label,
}));

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
