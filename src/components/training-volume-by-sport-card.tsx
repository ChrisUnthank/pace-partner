import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PieChart } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

// Time (not distance) stacked by sport, per week — distance isn't a
// meaningful comparison across sports (pool laps vs. road km vs. a gym
// session), but minutes trained is. Simpler split than the full
// SESSION_TYPES breakdown already used in the weekly report pages (which
// further divides running by intent — easy/tempo/threshold/etc.) — this
// is deliberately just the top-level "what sports, how much" read Chris
// asked for, at a glance.

const SPORT_TYPES: { key: string; label: string; color: string }[] = [
  { key: "run", label: "Run", color: "#ef4444" },
  { key: "ride", label: "Ride", color: "#22c55e" },
  { key: "swim", label: "Swim", color: "#06b6d4" },
  { key: "gym", label: "Gym", color: "#a78bfa" },
  { key: "cross_train", label: "Cross-train (other)", color: "#94a3b8" },
];

function sportKey(s: { day_type?: string | null; activity_type?: string | null }): string {
  if (s.day_type === "cross_training") {
    if (s.activity_type === "ride" || s.activity_type === "swim" || s.activity_type === "gym") return s.activity_type;
    return "cross_train";
  }
  return "run";
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}
function weekLabel(key: string): string {
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
        .select("session_date, day_type, activity_type, total_time_seconds")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .gte("session_date", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  const chartData = useMemo(() => {
    const byWeek = new Map<string, Record<string, number>>();
    for (const s of sessions ?? []) {
      if (!s.session_date || !s.total_time_seconds) continue;
      const wk = weekKey(s.session_date);
      if (!byWeek.has(wk)) byWeek.set(wk, {});
      const bucket = byWeek.get(wk)!;
      const key = sportKey(s);
      bucket[key] = (bucket[key] ?? 0) + Number(s.total_time_seconds);
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, totals]) => ({
        week: weekLabel(wk),
        ...Object.fromEntries(SPORT_TYPES.map((t) => [t.key, Math.round(((totals[t.key] ?? 0) / 3600) * 10) / 10])),
      }));
  }, [sessions]);

  const hasAny = (sessions ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="h-4 w-4 text-[var(--accent-red)]" />
          Training Volume by Sport
        </CardTitle>
        <CardDescription>Hours per week, last {weeks} weeks — run, ride, swim, gym, cross-train.</CardDescription>
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
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} unit="h" width={36} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                  formatter={(v: number, name: string) => [`${v}h`, SPORT_TYPES.find((t) => t.key === name)?.label ?? name]}
                />
                <Legend
                  formatter={(name: string) => SPORT_TYPES.find((t) => t.key === name)?.label ?? name}
                  wrapperStyle={{ fontSize: 12 }}
                />
                {SPORT_TYPES.map((t) => (
                  <Bar key={t.key} dataKey={t.key} name={t.key} stackId="sport" fill={t.color} radius={0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
