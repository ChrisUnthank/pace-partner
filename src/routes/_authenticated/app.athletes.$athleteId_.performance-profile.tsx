import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { secToClock, metersFmt } from "@/lib/format";

// Reads get_athlete_fitness_history() (see
// supabase/migrations/20260801000002_athlete_fitness_history.sql) — one
// row per week (recent window) or month (older data), all workout types
// combined, matching the TrainingPeaks "Fitness History" table Chris
// referenced. Deliberately does NOT include the peak-heart-rate-by-
// duration curve (5s/1m/5m/20m/60m) that table also shows — scoped out
// as a separate, heavier piece; this is volume + TSS only.

type HistoryRow = {
  granularity: "week" | "month";
  period_start: string; // date
  duration_seconds: number | null;
  distance_m: number | null;
  tss: number | null;
};

function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `Week of ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
function monthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
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
                  <th className="py-2 font-bold text-right">TSS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {weeks.map((r) => (
                  <tr key={`w-${r.period_start}`}>
                    <td className="py-2 pr-3">{weekLabel(r.period_start)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{secToClock(r.duration_seconds)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{metersFmt(r.distance_m)}</td>
                    <td className="py-2 text-right tabular-nums">{r.tss != null ? Math.round(r.tss) : "—"}</td>
                  </tr>
                ))}
                {months.length > 0 && (
                  <tr>
                    <td colSpan={4} className="pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Recent Months
                    </td>
                  </tr>
                )}
                {months.map((r) => (
                  <tr key={`m-${r.period_start}`}>
                    <td className="py-2 pr-3">{monthLabel(r.period_start)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{secToClock(r.duration_seconds)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{metersFmt(r.distance_m)}</td>
                    <td className="py-2 text-right tabular-nums">{r.tss != null ? Math.round(r.tss) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
