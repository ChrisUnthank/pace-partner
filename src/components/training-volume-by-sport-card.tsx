import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PieChart, Footprints, Bike, Waves, Dumbbell, Shuffle } from "lucide-react";

// Time (not distance) totalled by sport, over the period — distance isn't
// a meaningful comparison across sports (pool laps vs. road km vs. a gym
// session), but minutes trained is. Kept as a totals-for-the-period
// breakdown (was a weekly-stacked-bar trend before) — a coach glancing at
// this wants "how has this athlete's training actually split across
// sports lately," not a week-by-week trend line, which read as more
// chart-to-interpret than the at-a-glance answer this needed to be.

export const SPORT_TYPES: { key: string; label: string; color: string; icon: any }[] = [
  { key: "run", label: "Run", color: "#ef4444", icon: Footprints },
  { key: "ride", label: "Ride", color: "#22c55e", icon: Bike },
  { key: "swim", label: "Swim", color: "#06b6d4", icon: Waves },
  { key: "walk", label: "Walk", color: "#f59e0b", icon: Footprints },
  { key: "gym", label: "Gym", color: "#a78bfa", icon: Dumbbell },
  { key: "cross_train", label: "Cross-train (other)", color: "#94a3b8", icon: Shuffle },
];

export function sportKey(s: { day_type?: string | null; activity_type?: string | null }): string {
  if (s.day_type === "cross_training") {
    if (s.activity_type === "ride" || s.activity_type === "swim" || s.activity_type === "gym" || s.activity_type === "walk")
      return s.activity_type;
    return "cross_train";
  }
  return "run";
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}m` : `${whole}h`;
}

// Hand-rolled SVG ring rather than pulling in a chart library for one
// shape per tile — a coloured arc over a faint full-circle track,
// starting at 12 o'clock, same convention as most progress-ring UI.
function ProgressRing({ pct, color, size = 64, stroke = 4 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, pct / 100)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function SportTile({ sport, hours, pct }: { sport: (typeof SPORT_TYPES)[number]; hours: number; pct: number }) {
  const Icon = sport.icon;
  return (
    <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg hover:bg-accent/30 transition-colors">
      <div className="relative h-16 w-16 shrink-0">
        <ProgressRing pct={pct} color={sport.color} />
        <div
          className="absolute inset-[6px] rounded-full grid place-items-center"
          style={{ background: `${sport.color}1a` }}
        >
          <Icon className="h-6 w-6" style={{ color: sport.color }} strokeWidth={2} />
        </div>
      </div>
      <div>
        <div className="font-display text-lg font-extrabold tabular-nums leading-tight">{formatHours(hours)}</div>
        <div className="text-xs text-muted-foreground">{sport.label}</div>
        <div className="text-[11px] font-medium tabular-nums" style={{ color: sport.color }}>
          {pct}% of volume
        </div>
      </div>
    </div>
  );
}

export function TrainingVolumeBySportCard({ athleteId, weeks = 10 }: { athleteId: string; weeks?: number }) {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString().slice(0, 10);
  }, [weeks]);

  const { data: sessions, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-volume-by-sport", athleteId, since],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("session_date, day_type, activity_type, total_time_seconds, total_moving_time_seconds")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tiles = useMemo(() => {
    const totalsBySport: Record<string, number> = {};
    for (const s of sessions ?? []) {
      // Moving time only — was falling back to total_time_seconds (whole
      // elapsed time, including stopped/paused time) for any session
      // without moving time recorded, which overstated actual training
      // time for those sessions. A session with no moving-time data now
      // contributes 0 here rather than an inflated elapsed-time figure.
      const durationS = s.total_moving_time_seconds;
      if (!durationS) continue;
      const key = sportKey(s);
      totalsBySport[key] = (totalsBySport[key] ?? 0) + Number(durationS);
    }
    const totalSeconds = Object.values(totalsBySport).reduce((a, b) => a + b, 0);
    // No longer filtered to hours > 0 — every sport type shows, including
    // ones with zero logged time this period, so the grid reads as a
    // complete, consistent breakdown rather than only whatever happened
    // to have data.
    return SPORT_TYPES.map((sport) => {
      const seconds = totalsBySport[sport.key] ?? 0;
      return {
        sport,
        hours: seconds / 3600,
        pct: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0,
      };
    });
  }, [sessions]);

  const hasAny = (sessions ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="h-4 w-4 text-[var(--accent-red)]" />
          Training Volume by Sport
        </CardTitle>
        <CardDescription>Total hours by activity, last {weeks} weeks — run, ride, swim, walk, gym, cross-train. Moving time only.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load training volume — {(error as any)?.message ?? "unknown error"}.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">No completed sessions in this window yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {tiles.map((t) => (
              <SportTile key={t.sport.key} sport={t.sport} hours={t.hours} pct={t.pct} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
