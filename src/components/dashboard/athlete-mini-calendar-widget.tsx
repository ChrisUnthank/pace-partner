import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { sessionColorClass, type CalendarSession } from "@/components/calendar-day-cell";

// Compact month-grid calendar for Home — a scaled-down read of the full
// Calendar page (app.sessions.calendar.tsx), reusing its exact
// sessionColorClass palette so a session's color reads the same here as
// it does everywhere else, rather than inventing a second color scheme.
// Deliberately no drag-and-drop, no session details, no readiness/PB
// decorations — those live on the real Calendar; this is a glance-and-
// click widget, not a second calendar editor.

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mondayOf(d: Date): Date {
  const day = d.getDay() || 7; // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function AthleteMiniCalendarWidget({ athleteId }: { athleteId: string }) {
  const today = useMemo(() => new Date(), []);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  // Grid always shows full weeks (Mon-start), including the trailing
  // days of the previous/next month needed to fill the first/last row —
  // same convention the full Calendar page's month view uses.
  const gridStart = useMemo(() => mondayOf(monthAnchor), [monthAnchor]);
  const gridDays = useMemo(() => {
    const days: Date[] = [];
    const cursor = new Date(gridStart);
    // 6 rows always, so the grid height doesn't jump between months.
    for (let i = 0; i < 42; i++) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [gridStart]);
  const gridEnd = gridDays[gridDays.length - 1];

  const { data: sessions } = useQuery({
    queryKey: ["home-mini-calendar", athleteId, isoDate(gridStart), isoDate(gridEnd)],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, session_date, day_type, intent, structure, is_long_run, completed_at, is_planned")
        .eq("athlete_id", athleteId)
        .gte("session_date", isoDate(gridStart))
        .lte("session_date", isoDate(gridEnd));
      if (error) throw error;
      return (data ?? []) as CalendarSession[];
    },
  });

  const sessionsByDay = useMemo(() => {
    const m = new Map<string, CalendarSession[]>();
    for (const s of sessions ?? []) {
      const arr = m.get(s.session_date) ?? [];
      arr.push(s);
      m.set(s.session_date, arr);
    }
    return m;
  }, [sessions]);

  const todayIso = isoDate(today);
  const monthLabel = monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-[var(--accent-red)]" />
          {monthLabel}
        </CardTitle>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="h-6 w-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="h-6 w-6 grid place-items-center rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground mb-1">
          {DAY_LETTERS.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 grid-rows-6 gap-0.5 flex-1">
          {gridDays.map((day) => {
            const iso = isoDate(day);
            const inMonth = day.getMonth() === monthAnchor.getMonth();
            const isToday = iso === todayIso;
            const daySessions = sessionsByDay.get(iso) ?? [];
            return (
              <Link
                key={iso}
                to="/app/sessions/calendar"
                // athleteId matters as much as the date: without it the
                // calendar falls back to the viewer's own athlete, so a coach
                // clicking a day on an athlete's dashboard landed on their own
                // calendar rather than that athlete's.
                search={{ date: iso, athleteId } as any}
                className={`rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors hover:bg-accent/60 ${
                  isToday ? "ring-1 ring-[var(--accent-red)]" : ""
                } ${inMonth ? "" : "opacity-30"}`}
              >
                <span className={isToday ? "font-bold" : ""}>{day.getDate()}</span>
                {daySessions.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    {daySessions.slice(0, 3).map((s) => (
                      <span
                        key={s.id}
                        className={`h-1 w-1 rounded-full ${sessionColorClass(s)} ${
                          s.completed_at ? "" : "opacity-40"
                        }`}
                      />
                    ))}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="flex justify-end mt-2">
          <Link
            to="/app/sessions/calendar"
            search={{ athleteId } as any}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Open full calendar →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
