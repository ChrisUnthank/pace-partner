import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LineChart, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { secToClock, metersFmt } from "@/lib/format";

// Reads get_athlete_fitness_history() (see
// supabase/migrations/20260801000002_athlete_fitness_history.sql,
// 20260801000003_fitness_history_trend.sql) — one row per week (recent
// window) or month (older data), all workout types combined, matching
// the TrainingPeaks "Fitness History" table Chris referenced.
// Deliberately does NOT include the peak-heart-rate-by-duration curve
// (5s/1m/5m/20m/60m) that table also shows — scoped out as a separate,
// heavier piece; this is volume + Load only.

type HistoryRow = {
  granularity: "week" | "month";
  period_start: string; // date
  duration_seconds: number | null;
  distance_m: number | null;
  tss: number | null;
  ctl_end: number | null; // Fitness/CTL as of the last day of this period
};

function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `Week of ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
function monthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// "Fitness" here specifically means Fitness/CTL, the same slow-moving
// rolling number shown everywhere else as "Fitness" — not the Load
// column in this same table, which is one period's training stress and
// can swing hard week to week without Fitness itself actually rising or
// falling. Comparing raw Load week-over-week would tell a misleading
// story (a big volume week reads as "fitness increasing" even during a
// block that's about to fade), so the arrow is driven off ctl_end
// specifically.
//
// +/-3% is the "stable" band — CTL is already a smoothed number by
// construction, so small week-to-week noise shouldn't flip the arrow
// back and forth; a judgment call, not a physiological constant, so
// worth revisiting if it reads as too twitchy or too sluggish in
// practice.
const STABLE_BAND_PCT = 0.03;

type Trend = "up" | "down" | "stable" | null;

function computeTrend(current: number | null, previous: number | null): Trend {
  if (current == null || previous == null || previous === 0) return null;
  const pctChange = (current - previous) / previous;
  if (Math.abs(pctChange) < STABLE_BAND_PCT) return "stable";
  return pctChange > 0 ? "up" : "down";
}

function TrendIcon({ trend, current, previous }: { trend: Trend; current: number | null; previous: number | null }) {
  if (trend == null) return <span className="text-muted-foreground">—</span>;
  const title =
    current != null && previous != null
      ? `Fitness ${Math.round(previous)} → ${Math.round(current)}`
      : undefined;
  if (trend === "up") {
    return <TrendingUp className="h-4 w-4 text-emerald-600 inline-block" title={title} />;
  }
  if (trend === "down") {
    return <TrendingDown className="h-4 w-4 text-rose-600 inline-block" title={title} />;
  }
  return <Minus className="h-4 w-4 text-muted-foreground inline-block" title={title} />;
}

export function FitnessHistoryCard({ athleteId }: { athleteId: string }) {
  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-fitness-history", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_fitness_history" as any, {
        _athlete_id: athleteId,
        _recent_weeks: 8,
      });
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });

  // Trend is computed against the FULL combined list (before splitting
  // into weeks/months below) so the oldest week row still compares
  // correctly against the newest month row — splitting first would lose
  // that boundary comparison.
  const trendByPeriod = new Map<string, { trend: Trend; current: number | null; previous: number | null }>();
  (rows ?? []).forEach((r, i) => {
    const prev = (rows ?? [])[i + 1];
    const previous = prev?.ctl_end ?? null;
    trendByPeriod.set(r.period_start, { trend: computeTrend(r.ctl_end, previous), current: r.ctl_end, previous });
  });

  // Rows already arrive ordered by period_start DESC from the function;
  // just need to know where "week" rows end and "month" rows begin so a
  // sub-header can be inserted between them, matching the TrainingPeaks
  // layout (recent weeks individually, then a "Recent Months" divider).
  const weeks = (rows ?? []).filter((r) => r.granularity === "week");
  const months = (rows ?? []).filter((r) => r.granularity === "month");
  const hasAny = (rows ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChart className="h-4 w-4 text-[var(--accent-red)]" />
          Fitness History
        </CardTitle>
        <CardDescription>
          Duration, distance, and training load — recent weeks individually, older data by month. All workout types.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load fitness history — {(error as any)?.message ?? "unknown error"}. If this mentions the
            function not existing, the <code className="text-xs">get_athlete_fitness_history</code> migration
            hasn't been run in Supabase yet.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            No completed sessions yet — history builds up here as sessions come in.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-bold">Period</th>
                  <th className="py-2 pr-3 font-bold text-right">Duration</th>
                  <th className="py-2 pr-3 font-bold text-right">Distance</th>
                  <th className="py-2 pr-3 font-bold text-right">Load</th>
                  <th className="py-2 font-bold text-center">Fitness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {weeks.map((r) => {
                  const t = trendByPeriod.get(r.period_start);
                  return (
                    <tr key={`w-${r.period_start}`}>
                      <td className="py-2 pr-3">{weekLabel(r.period_start)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{secToClock(r.duration_seconds)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{metersFmt(r.distance_m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.tss != null ? Math.round(r.tss) : "—"}</td>
                      <td className="py-2 text-center">
                        <TrendIcon trend={t?.trend ?? null} current={t?.current ?? null} previous={t?.previous ?? null} />
                      </td>
                    </tr>
                  );
                })}
                {months.length > 0 && (
                  <tr>
                    <td colSpan={5} className="pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Recent Months
                    </td>
                  </tr>
                )}
                {months.map((r) => {
                  const t = trendByPeriod.get(r.period_start);
                  return (
                    <tr key={`m-${r.period_start}`}>
                      <td className="py-2 pr-3">{monthLabel(r.period_start)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{secToClock(r.duration_seconds)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{metersFmt(r.distance_m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.tss != null ? Math.round(r.tss) : "—"}</td>
                      <td className="py-2 text-center">
                        <TrendIcon trend={t?.trend ?? null} current={t?.current ?? null} previous={t?.previous ?? null} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
