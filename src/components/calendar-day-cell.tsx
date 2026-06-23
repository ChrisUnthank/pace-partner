import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { sessionClassificationLabel, INTENT_LABEL, DAY_TYPE_LABEL } from "@/lib/session-categories";
import { ActivityIcon } from "@/lib/activity-icon";

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
};

export type DayData = {
  date: string; // YYYY-MM-DD
  sessions: CalendarSession[];
  readiness_status?: "green" | "amber" | "red" | null;
  readiness_score?: number | null;
  training_load?: number | null;
  efficiencyBySession?: Record<string, number | null>;
};

// Tailwind colors keyed by intent/day_type — reused from session-categories vocabulary.
const INTENT_BAR: Record<string, string> = {
  easy: "bg-emerald-500",
  aerobic: "bg-teal-500",
  tempo: "bg-amber-500",
  threshold: "bg-orange-500",
  vo2: "bg-red-500",
  anaerobic: "bg-rose-600",
  speed: "bg-fuchsia-500",
};
const DAYTYPE_BAR: Record<string, string> = {
  race: "bg-purple-600",
  recovery: "bg-sky-400",
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
  onMultiClick,
}: {
  day: DayData;
  inMonth: boolean;
  isToday: boolean;
  compact?: boolean;
  onMultiClick?: (day: DayData) => void;
}) {
  const sessions = day.sessions;
  const dayNum = Number(day.date.slice(8, 10));
  const readinessCls = day.readiness_status ? READINESS_DOT[day.readiness_status] : null;

  const header = (
    <div className="flex items-start justify-between px-1.5 pt-1">
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
      {readinessCls && (
        <span
          className={cn("h-2 w-2 rounded-full mt-0.5", readinessCls)}
          title={`Readiness${day.readiness_score != null ? ` ${Math.round(day.readiness_score)}` : ""}`}
        />
      )}
    </div>
  );

  if (compact) {
    // Mobile: date + tiny color bar + dots
    return (
      <button
        type="button"
        onClick={() => sessions.length && onMultiClick?.(day)}
        className={cn(
          "h-16 w-full border rounded-md bg-background text-left flex flex-col overflow-hidden",
          !inMonth && "opacity-50",
          isToday && "ring-1 ring-primary",
        )}
      >
        {header}
        <div className="flex-1 flex items-end gap-0.5 px-1 pb-1 flex-wrap">
          {sessions.slice(0, 4).map((s) => (
            <span key={s.id} className={cn("h-1.5 w-1.5 rounded-full", sessionColorClass(s), s.is_planned && !s.completed_at && "opacity-50")} />
          ))}
        </div>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "min-h-[110px] border rounded-md bg-background flex flex-col overflow-hidden",
        !inMonth && "opacity-50",
        isToday && "ring-1 ring-primary",
      )}
    >
      {header}
      <div className="flex-1 flex flex-col gap-1 px-1.5 pb-1.5 mt-1">
        {sessions.slice(0, 2).map((s) => (
          <SessionPill key={s.id} s={s} load={day.training_load} eff={day.efficiencyBySession?.[s.id]} singleSession={sessions.length === 1} />
        ))}
        {sessions.length > 2 && (
          <button
            type="button"
            onClick={() => onMultiClick?.(day)}
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
  return (
    <Link
      to="/app/sessions/$sessionId"
      params={{ sessionId: s.id }}
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