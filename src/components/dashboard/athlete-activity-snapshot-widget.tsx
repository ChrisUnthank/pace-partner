import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { ActivityIcon } from "@/lib/activity-icon";
import { SPORT_TYPES, sportKey } from "@/components/training-volume-by-sport-card";

// Strava's profile-page "Last 4 Weeks" snapshot — total activity count,
// a 4x7 grid of active days, and a duration bar per sport. Same
// COALESCE(total_moving_time_seconds, total_time_seconds) pattern as
// Training Volume by Sport and the rest of the app (weekly reports,
// calendar day cells) — raw total_time_seconds is full elapsed time
// including any genuine stops, not "time spent training".
//
// Weeks are Mon-Sun (matches every other weekly rollup in the app —
// Fitness History, Records & Milestones' weekly-volume records). The
// grid always shows exactly 4 completed-or-in-progress calendar weeks
// ending on the current week, oldest first (top row), same reading
// order as Strava's own grid.

function mondayOf(d: Date): Date {
  const day = d.getDay() || 7; // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHoursMinutes(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function AthleteActivitySnapshotWidget({ athleteId }: { athleteId: string }) {
  const windowStart = useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - 21); // 3 weeks before this week = 4 weeks total
    return start;
  }, []);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["home-activity-snapshot", athleteId, isoDate(windowStart)],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("session_date, day_type, activity_type, total_time_seconds, total_moving_time_seconds")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", isoDate(windowStart));
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeDaySet = useMemo(() => new Set((sessions ?? []).map((s) => s.session_date)), [sessions]);

  const weeks = useMemo(() => {
    const out: { date: Date; iso: string; active: boolean }[][] = [];
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(windowStart);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const row: { date: Date; iso: string; active: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + d);
        const iso = isoDate(day);
        row.push({ date: day, iso, active: activeDaySet.has(iso) });
      }
      out.push(row);
    }
    return out;
  }, [windowStart, activeDaySet]);

  const durationBySport = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const s of sessions ?? []) {
      const durationS = s.total_moving_time_seconds ?? s.total_time_seconds;
      if (!durationS) continue;
      const key = sportKey(s);
      totals[key] = (totals[key] ?? 0) + Number(durationS);
    }
    return totals;
  }, [sessions]);

  const totalActivities = (sessions ?? []).length;
  const maxDuration = Math.max(1, ...SPORT_TYPES.map((t) => durationBySport[t.key] ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-[var(--accent-red)]" />
          Activity Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-start gap-8">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Last 4 Weeks</div>
              <div className="font-display text-4xl font-extrabold tabular-nums">{totalActivities}</div>
              <div className="text-xs text-muted-foreground">Total Activities</div>
            </div>

            <div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground mb-1">
                {DAY_LETTERS.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
              <div className="space-y-1">
                {weeks.map((row, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-1">
                    {row.map((day) => (
                      <span
                        key={day.iso}
                        title={day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        className={`h-2.5 w-2.5 rounded-full mx-auto ${day.active ? "bg-foreground" : "bg-muted"}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[180px] space-y-2">
              {SPORT_TYPES.map((t) => {
                const secs = durationBySport[t.key] ?? 0;
                if (secs === 0) return null;
                const pct = Math.max(4, (secs / maxDuration) * 100);
                const iconSession =
                  t.key === "run"
                    ? { activity_type: "run" }
                    : t.key === "cross_train"
                      ? { day_type: "cross_training", activity_type: null }
                      : { day_type: "cross_training", activity_type: t.key };
                return (
                  <div key={t.key} className="flex items-center gap-2">
                    <ActivityIcon session={iconSession as any} size={14} className="text-muted-foreground shrink-0" />
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.color }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">
                      {formatHoursMinutes(secs)}
                    </span>
                  </div>
                );
              })}
              {totalActivities === 0 && (
                <p className="text-xs text-muted-foreground">No completed activities in the last 4 weeks yet.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
