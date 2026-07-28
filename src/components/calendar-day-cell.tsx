import { Link } from "@tanstack/react-router";
import { Plus, Thermometer, Wind, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionClassificationLabel, INTENT_LABEL, DAY_TYPE_LABEL } from "@/lib/session-categories";
import { ActivityIcon } from "@/lib/activity-icon";
import { metersFmt, secToClock, paceFmt } from "@/lib/format";

export type CalendarSession = {
  id: string;
  title: string;
  session_date: string;
  day_type: string | null;
  intent: string | null;
  structure: string | null;
  is_long_run: boolean | null;
  completed_at: string | null;
  is_planned: boolean | null;
  activity_type?: string | null;
  total_distance_m?: number | null;
  total_time_seconds?: number | null;
  total_moving_time_seconds?: number | null;
  // Resolved workout target for PLANNED sessions (Phase 3), e.g.
  // "95% thr · 4:07–4:20/km" — computed by the calendar page from the
  // session's first work step + the athlete's zone profile. Null/absent
  // for completed sessions (they show actuals instead) and Open targets.
  targetLabel?: string | null;
};

export type DayData = {
  date: string; // YYYY-MM-DD
  sessions: CalendarSession[];
  readiness_status?: "green" | "amber" | "red" | null;
  readiness_score?: number | null;
  training_load?: number | null;
  efficiencyBySession?: Record<string, number | null>;
  // Resting HR logged for this day via the Daily Log — surfaced on the
  // calendar the same way TrainingPeaks' Metrics card shows it, reusing data
  // that already exists rather than building a new tracking pipeline.
  restingHr?: number | null;
};

// Forecast for a single future day — only ever populated for days ahead of
// today within Open-Meteo's free forecast horizon (~14-16 days). Deliberately
// separate from DayData rather than folded into it: forecast is fetched
// once per athlete location and applies independent of whatever sessions
// exist that day, whereas DayData is entirely session/load-driven.
export type DayForecast = {
  tempMax: number | null;
  tempMin: number | null;
  windMax: number | null;
};

// Tailwind colors keyed by intent/day_type. The zone-derived intents (easy
// through anaerobic) are colored to exactly match their corresponding zone
// rank from the classifier (session-files.functions.ts's RANK_TO_INTENT:
// Z1 easy, Z2 aerobic, Z3 tempo, Z4 threshold, Z5 vo2, Z6 anaerobic) — same
// palette as the Zones card, session analysis, and race analysis pages, so
// a session's color reads the same everywhere regardless of which page
// it's viewed from. `speed` isn't zone-derived (the classifier never
// produces it), so it keeps its own distinct color rather than borrowing
// one of the six.
const INTENT_BAR: Record<string, string> = {
  easy: "bg-emerald-400",
  aerobic: "bg-sky-400",
  tempo: "bg-amber-400",
  threshold: "bg-orange-500",
  vo2: "bg-red-500",
  anaerobic: "bg-purple-600",
  speed: "bg-fuchsia-500",
};
const DAYTYPE_BAR: Record<string, string> = {
  // pink-600 and teal-500 — chosen specifically to NOT collide with any
  // INTENT_BAR color above (race previously shared purple-600 with
  // anaerobic, recovery previously shared sky-400 with aerobic; a session
  // is only ever colored from ONE of these two tables at a time, so the
  // collision was invisible on the calendar itself, but became obvious
  // wherever both dimensions get merged into one combined legend, e.g. the
  // Analytics "Time by Training Intent" chart).
  race: "bg-pink-600",
  recovery: "bg-teal-500",
  cross_training: "bg-slate-400",
  rest: "bg-stone-300",
  training: "bg-muted",
};
const READINESS_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function sessionColorClass(s: CalendarSession): string {
  const dt = s.day_type ?? "training";
  if (dt !== "training") return DAYTYPE_BAR[dt] ?? "bg-muted";
  return (s.intent && INTENT_BAR[s.intent]) || "bg-muted";
}

export function sessionShortLabel(s: CalendarSession): string {
  const dt = s.day_type ?? "training";
  if (dt !== "training") return DAY_TYPE_LABEL[dt as keyof typeof DAY_TYPE_LABEL] ?? dt;
  if (s.intent) return INTENT_LABEL[s.intent as keyof typeof INTENT_LABEL] ?? s.intent;
  return "Training";
}

export function CalendarDayCell({
  day,
  inMonth,
  isToday,
  compact = false,
  weather,
  onMultiClick,
  onAdd,
}: {
  day: DayData;
  inMonth: boolean;
  isToday: boolean;
  compact?: boolean;
  /** Forecast for this specific day — only ever passed for future days within the forecast horizon. */
  weather?: DayForecast | null;
  onMultiClick?: (day: DayData) => void;
  /** Opens the "add to this day" menu (upload file / create session / manual entry). Works on any day, not just empty ones — existing sessions stay reachable via their own pills/sheet. */
  onAdd?: (date: string) => void;
}) {
  const sessions = day.sessions;
  const dayNum = Number(day.date.slice(8, 10));
  const readinessCls = day.readiness_status ? READINESS_DOT[day.readiness_status] : null;

  const addButton = onAdd && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAdd(day.date);
      }}
      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent shrink-0"
      title="Add to this day"
      aria-label={`Add session or upload for ${day.date}`}
    >
      <Plus className="h-3 w-3" />
    </button>
  );

  const header = (
    <div className="flex items-start justify-between px-1.5 pt-1 gap-1">
      <span
        className={cn(
          "text-[11px] leading-none",
          !inMonth && "text-muted-foreground/50",
          inMonth && !isToday && "text-muted-foreground",
          isToday && "font-bold text-foreground bg-primary/15 rounded px-1 py-0.5",
        )}
      >
        {dayNum}
      </span>
      <div className="flex items-center gap-1">
        {readinessCls && (
          <span
            className={cn("h-2 w-2 rounded-full", readinessCls)}
            title={`Readiness${day.readiness_score != null ? ` ${Math.round(day.readiness_score)}` : ""}`}
          />
        )}
        {addButton}
      </div>
    </div>
  );

  if (compact) {
    // Mobile: date + tiny color bar + dots. Uses a div (not button) as the
    // outer element since it now contains its own nested "+" button —
    // nesting <button> inside <button> is invalid HTML and breaks clicks.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => sessions.length && onMultiClick?.(day)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && sessions.length) onMultiClick?.(day);
        }}
        className={cn(
          "h-16 w-full border rounded-md bg-background text-left flex flex-col overflow-hidden cursor-pointer",
          !inMonth && "opacity-50",
          isToday && "ring-1 ring-primary",
        )}
      >
        {header}
        <div className="flex-1 flex items-end gap-0.5 px-1 pb-1 flex-wrap">
          {sessions.slice(0, 4).map((s) => (
            <span
              key={s.id}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                sessionColorClass(s),
                s.is_planned && !s.completed_at && "opacity-50",
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onMultiClick?.(day)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onMultiClick?.(day);
      }}
      className={cn(
        "min-h-[110px] lg:min-h-[135px] border rounded-md bg-background flex flex-col overflow-hidden cursor-pointer hover:bg-accent/20 transition-colors",
        !inMonth && "opacity-50",
        isToday && "ring-1 ring-primary",
      )}
    >
      {header}
      {day.restingHr != null && (
        <div className="flex items-center gap-2 px-1.5 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5" title={`Resting HR ${day.restingHr} bpm`}>
            <HeartPulse className="h-2.5 w-2.5" />
            {day.restingHr} bpm
          </span>
        </div>
      )}
      {weather && (weather.tempMax != null || weather.windMax != null) && (
        <div className="flex items-center gap-2 px-1.5 text-[9px] text-muted-foreground">
          {weather.tempMax != null && (
            <span className="flex items-center gap-0.5">
              <Thermometer className="h-2.5 w-2.5" />
              {Math.round(weather.tempMax)}°
              {weather.tempMin != null && <span className="opacity-70">/{Math.round(weather.tempMin)}°</span>}
            </span>
          )}
          {weather.windMax != null && (
            <span className="flex items-center gap-0.5">
              <Wind className="h-2.5 w-2.5" />
              {Math.round(weather.windMax)}
            </span>
          )}
        </div>
      )}
      <div className="flex-1 flex flex-col gap-1 px-1.5 pb-1.5 mt-1">
        {sessions.slice(0, 2).map((s) => (
          <SessionPill
            key={s.id}
            s={s}
            load={day.training_load}
            eff={day.efficiencyBySession?.[s.id]}
            singleSession={sessions.length === 1}
          />
        ))}
        {sessions.length > 2 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMultiClick?.(day);
            }}
            className="text-[10px] text-muted-foreground hover:text-foreground self-start"
          >
            +{sessions.length - 2} more
          </button>
        )}
      </div>
    </div>
  );
}

function SessionPill({
  s,
  load,
  eff,
  singleSession,
}: {
  s: CalendarSession;
  load?: number | null;
  eff?: number | null;
  singleSession: boolean;
}) {
  const isFuturePlanned = !s.completed_at;

  // Distance/pace shown on every completed session's card, not just when
  // it's the only one that day — this is the actual recorded outcome, the
  // same thing a coach scanning a week wants to see without opening each
  // session individually. Planned (not yet completed) sessions have no
  // actual distance/time recorded yet, so nothing fabricated is shown for
  // those — just the intent label as before.
  const distanceM = s.total_distance_m ?? null;
  const timeS = s.total_time_seconds ?? null;
  // Same moving-time preference as the session detail page's Total Avg
  // Pace — a mid-run stop shouldn't make a calendar card's pace look a
  // minute per km slower than the run actually was.
  const timeForPace = s.total_moving_time_seconds ?? timeS;
  const paceSecPerKm = distanceM && timeForPace && distanceM > 0 ? (timeForPace / distanceM) * 1000 : null;

  return (
    <Link
      to="/app/sessions/$sessionId"
      params={{ sessionId: s.id }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex items-stretch gap-1 rounded-sm overflow-hidden hover:bg-accent/40 group",
        isFuturePlanned && "opacity-80",
      )}
      title={`${s.title} — ${sessionClassificationLabel(s)}`}
    >
      <span className={cn("w-1 shrink-0 rounded-sm", sessionColorClass(s), isFuturePlanned && "opacity-60")} />
      <span className="flex-1 min-w-0 py-0.5">
        <span className="block text-[11px] leading-tight font-medium truncate">
          <ActivityIcon session={s} size={11} className="inline-block mr-1 -mt-0.5 text-muted-foreground" />
          {sessionShortLabel(s)}
          {isFuturePlanned && <span className="text-muted-foreground font-normal"> · planned</span>}
        </span>
        <span className="block text-[10px] leading-tight text-muted-foreground truncate">{s.title}</span>
        {isFuturePlanned && s.targetLabel && (
          <span className="block text-[10px] leading-tight text-[var(--accent-red)] truncate">{s.targetLabel}</span>
        )}
        {!isFuturePlanned && (distanceM || timeS) && (
          <span className="block text-[10px] leading-tight text-muted-foreground tabular-nums">
            {distanceM ? metersFmt(distanceM) : null}
            {distanceM && timeS ? " · " : null}
            {timeS ? secToClock(timeS) : null}
            {paceSecPerKm ? ` · ${paceFmt(paceSecPerKm)}` : null}
          </span>
        )}
        {!isFuturePlanned && singleSession && (load != null || eff != null) && (
          <span className="block text-[10px] leading-tight text-muted-foreground">
            {load != null && <>TL {Math.round(load)}</>}
            {load != null && eff != null && " · "}
            {eff != null && <>eff {Math.round(eff)}</>}
          </span>
        )}
      </span>
    </Link>
  );
}

// One per week-row, sitting alongside that week's 7 day cells — mirrors
// Final Surge's weekly totals column. Sums only COMPLETED sessions (not
// planned ones still ahead in the week), since a "week total" that included
// not-yet-run planned distance would overstate what actually happened,
// which is the whole point of a totals column a coach scans at a glance.
export function WeekTotalCell({
  distanceM,
  timeS,
  sessionCount,
}: {
  distanceM: number;
  timeS: number;
  sessionCount: number;
}) {
  const hasData = sessionCount > 0 && (distanceM > 0 || timeS > 0);
  return (
    <div className="min-h-[110px] lg:min-h-[135px] border rounded-md bg-muted/30 flex flex-col overflow-hidden">
      <div className="px-1.5 pt-1">
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Total</span>
      </div>
      <div className="flex-1 flex flex-col justify-center items-center px-1.5 pb-1.5 text-center">
        {hasData ? (
          <>
            <span className="text-sm font-bold tabular-nums leading-tight">{metersFmt(distanceM)}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums leading-tight mt-0.5">
              {secToClock(timeS)}
            </span>
            <span className="text-[9px] text-muted-foreground mt-1">
              {sessionCount} session{sessionCount === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
