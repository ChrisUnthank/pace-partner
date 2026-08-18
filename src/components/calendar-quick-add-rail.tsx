import type { ComponentType } from "react";
import {
  Footprints,
  Wind,
  Route,
  Gauge,
  Flame,
  Zap,
  Activity,
  Timer,
  Trophy,
  Leaf,
  Dumbbell,
  Bike,
  Waves,
  Moon,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { INTENT_BAR, DAYTYPE_BAR } from "@/components/calendar-day-cell";

/**
 * One placeable activity on the calendar's quick-add rail.
 *
 * These map 1:1 onto the columns app.sessions.new.tsx writes, deliberately
 * — a quick-added session and a form-created one of the same kind must be
 * indistinguishable in the database, or every downstream consumer
 * (classification labels, analytics splits, training load) has to learn
 * about two ways of saying the same thing.
 */
export type QuickAddItem = {
  key: string;
  /** Shown in the expanded rail and in the armed banner. */
  label: string;
  /** sessions.title on the created row. */
  title: string;
  day_type: "training" | "race" | "recovery" | "cross_training" | "rest";
  /** Only ever set for day_type "training" — matches the new-session form's own rule. */
  intent: string | null;
  /**
   * Only set where it's definitional rather than a coaching choice.
   *
   * An easy/aerobic/long/tempo run IS continuous by construction, so
   * writing that is describing the item, not guessing. Threshold, VO2,
   * anaerobic and speed can each legitimately be continuous OR
   * reps/intervals — that's a real decision the coach makes when they
   * open the session to build the blocks (which they must do anyway,
   * since quick-add creates no steps). Writing a plausible-looking
   * default here would put a structure on the session that nobody chose.
   */
  structure: "continuous" | "reps_intervals" | "intervals" | null;
  is_long_run: boolean;
  /**
   * Same rule as app.sessions.new.tsx: the coach's chosen sport for
   * cross-training, null for rest (nothing happened to name), "run" for
   * everything else.
   */
  activity_type: string | null;
  /**
   * Sourced from the same maps calendar-day-cell.tsx colours real cells
   * with, never a parallel list — a rail whose colours drifted from the
   * cells would be worse than no rail at all.
   */
  colorClass: string;
  Icon: ComponentType<{ className?: string }>;
};

export const QUICK_ADD_ITEMS: QuickAddItem[] = [
  {
    key: "easy",
    label: "Easy",
    title: "Easy Run",
    day_type: "training",
    intent: "easy",
    structure: "continuous",
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.easy,
    Icon: Footprints,
  },
  {
    key: "aerobic",
    label: "Aerobic",
    title: "Aerobic Run",
    day_type: "training",
    intent: "aerobic",
    structure: "continuous",
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.aerobic,
    Icon: Wind,
  },
  {
    key: "long",
    label: "Long run",
    title: "Long Run",
    day_type: "training",
    intent: "aerobic",
    // Shares aerobic's colour on purpose: a long run IS an aerobic
    // session in this data model, and that's how the day cell will
    // colour it. The icon is what tells the two rail entries apart.
    structure: "continuous",
    is_long_run: true,
    activity_type: "run",
    colorClass: INTENT_BAR.aerobic,
    Icon: Route,
  },
  {
    key: "tempo",
    label: "Tempo",
    title: "Tempo Run",
    day_type: "training",
    intent: "tempo",
    structure: "continuous",
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.tempo,
    Icon: Gauge,
  },
  {
    key: "threshold",
    label: "Threshold",
    title: "Threshold Session",
    day_type: "training",
    intent: "threshold",
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.threshold,
    Icon: Flame,
  },
  {
    key: "vo2",
    label: "VO2",
    title: "VO2 Session",
    day_type: "training",
    intent: "vo2",
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.vo2,
    Icon: Zap,
  },
  {
    key: "anaerobic",
    label: "Anaerobic",
    title: "Anaerobic Session",
    day_type: "training",
    intent: "anaerobic",
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.anaerobic,
    Icon: Activity,
  },
  {
    key: "speed",
    label: "Speed",
    title: "Speed Session",
    day_type: "training",
    intent: "speed",
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: INTENT_BAR.speed,
    Icon: Timer,
  },
  {
    key: "race",
    label: "Race",
    title: "Race",
    day_type: "race",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: DAYTYPE_BAR.race,
    Icon: Trophy,
  },
  {
    key: "recovery",
    label: "Recovery",
    title: "Recovery Run",
    day_type: "recovery",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: "run",
    colorClass: DAYTYPE_BAR.recovery,
    Icon: Leaf,
  },
  {
    key: "gym",
    label: "Gym",
    title: "Gym",
    day_type: "cross_training",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: "gym",
    colorClass: DAYTYPE_BAR.cross_training,
    Icon: Dumbbell,
  },
  {
    key: "ride",
    label: "Ride",
    title: "Ride",
    day_type: "cross_training",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: "ride",
    colorClass: DAYTYPE_BAR.cross_training,
    Icon: Bike,
  },
  {
    key: "swim",
    label: "Swim",
    title: "Swim",
    day_type: "cross_training",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: "swim",
    colorClass: DAYTYPE_BAR.cross_training,
    Icon: Waves,
  },
  {
    key: "rest",
    label: "Rest",
    title: "Rest Day",
    day_type: "rest",
    intent: null,
    structure: null,
    is_long_run: false,
    activity_type: null,
    colorClass: DAYTYPE_BAR.rest,
    Icon: Moon,
  },
];

export function quickAddItemFor(key: string | null): QuickAddItem | null {
  if (!key) return null;
  return QUICK_ADD_ITEMS.find((i) => i.key === key) ?? null;
}

/**
 * Vertical activity rail down the left edge of the calendar grid.
 *
 * Collapsed it's a 44px strip of coloured icons. Hovering expands an
 * OVERLAY panel — absolutely positioned rather than widening in flow, so
 * the calendar grid never reflows underneath the pointer. Clicking a pill
 * arms it; the calendar then places that activity on whatever day is
 * clicked next, and stays armed so a week can be laid out in one click
 * per day. Clicking the armed pill again disarms.
 *
 * Deliberately costs the template-first coach nothing: collapsed it's a
 * thin colour strip that does nothing until hovered, and every existing
 * entry point (the per-day "+" menu, the full new-session form) is
 * untouched.
 *
 * No hover on touch, so the panel stays collapsed there — the icons are
 * still tappable at 44px (the standard touch target), and the armed
 * banner above the grid names whatever's been selected.
 */
export function CalendarQuickAddRail({
  armedKey,
  onArm,
  disabled = false,
}: {
  armedKey: string | null;
  /** Called with the item key, or null to disarm. */
  onArm: (key: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="group/rail relative w-11 shrink-0 self-stretch">
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex w-11 flex-col overflow-hidden rounded-l-xl border-r bg-card transition-[width] duration-150",
          "group-hover/rail:w-52 group-hover/rail:shadow-lg",
        )}
      >
        <div className="flex h-7 shrink-0 items-center border-b px-2">
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="ml-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
            Quick add
          </span>
        </div>

        {/* brand-scrollbar per the app-wide convention for inner scrollable
            containers — fourteen items overflow a short viewport. */}
        <div className="brand-scrollbar flex-1 overflow-y-auto py-1">
          {QUICK_ADD_ITEMS.map((item) => {
            const armed = armedKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                disabled={disabled}
                title={`Add ${item.label} — click, then click any day`}
                aria-pressed={armed}
                onClick={() => onArm(armed ? null : item.key)}
                className={cn(
                  "flex w-full items-center gap-2 px-[7px] py-1 text-left transition-colors",
                  "hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40",
                  armed && "bg-accent",
                )}
              >
                <span
                  className={cn(
                    "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-white",
                    item.colorClass,
                    armed && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
                  )}
                >
                  <item.Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-xs opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
                  {item.label}
                </span>
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
