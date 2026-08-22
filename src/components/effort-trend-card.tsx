import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from "recharts";
import { TrendingUp, TrendingDown, Minus, Thermometer } from "lucide-react";
import { analyseRpeTrend, expectedRpe, type RpeSession } from "@/lib/rpe-trends";
import { healthStateOn } from "@/lib/health-events";
import { cn } from "@/lib/utils";

/**
 * Effort trend — is the same training feeling harder?
 *
 * Plots the mean RPE DELTA per week: what sessions were rated, minus what a
 * session of that type is normally rated. Zero means effort is tracking where
 * it should; positive means the work is costing more than it usually does.
 *
 * A raw weekly RPE average would have been easier and close to useless, since
 * it moves with the shape of the week — two hard sessions instead of one
 * "raises effort" without anything having changed about the athlete.
 *
 * Weeks containing an active illness or injury are drawn differently and
 * excluded from the comparison. Effort rises and feel falls when someone is
 * unwell; reading that as accumulated training fatigue would point a coach at
 * exactly the wrong response.
 */
export function EffortTrendCard({ athleteId, weeks = 10 }: { athleteId: string; weeks?: number }) {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString().slice(0, 10);
  }, [weeks]);

  const { data: sessions = [] } = useQuery({
    queryKey: ["effort-trend-sessions", athleteId, since],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("session_date, rpe, intent, day_type")
        .eq("athlete_id", athleteId)
        .gte("session_date", since)
        .not("completed_at", "is", null)
        .neq("day_type", "rest")
        .order("session_date");
      return (data ?? []) as any[];
    },
  });

  const { data: feelRows = [] } = useQuery({
    queryKey: ["effort-trend-feel", athleteId, since],
    enabled: !!athleteId,
    queryFn: async () => {
      // feel_score lives on session_insights, not sessions — the same split
      // the detail page writes to.
      const { data } = await (supabase as any)
        .from("session_insights")
        .select("session_id, feel_score, sessions(session_date)")
        .eq("athlete_id", athleteId)
        .not("feel_score", "is", null);
      return (data ?? []) as any[];
    },
  });

  const { data: healthRecords = [] } = useQuery({
    queryKey: ["effort-trend-health", athleteId, since],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("injuries")
        .select("onset_date, resolved_date, expected_resolved_date, is_chronic, training_impact, kind, illness_type, body_part")
        .eq("athlete_id", athleteId)
        .eq("archived", false);
      return (data ?? []) as any[];
    },
  });

  const trend = useMemo(() => {
    const feelByDate = new Map<string, number>();
    for (const r of feelRows as any[]) {
      const d = r.sessions?.session_date;
      if (d && r.feel_score != null) feelByDate.set(d, Number(r.feel_score));
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows: RpeSession[] = (sessions as any[]).map((s) => ({
      session_date: s.session_date,
      rpe: s.rpe,
      feel: feelByDate.get(s.session_date) ?? null,
      intent: s.intent,
      day_type: s.day_type,
      // Chronic conditions deliberately included here, unlike on the calendar:
      // asthma genuinely does raise the effort of a session, and excluding it
      // would attribute that cost to training instead.
      health_affected: (healthRecords as any[]).some(
        (h) => healthStateOn(h, s.session_date, { today, includeChronic: true }) !== null,
      ),
    }));

    return analyseRpeTrend(rows);
  }, [sessions, feelRows, healthRecords]);

  const chartData = trend.weeks
    .filter((w) => w.meanDelta != null)
    .map((w) => ({
      week: w.weekStart.slice(5),
      delta: w.meanDelta,
      feel: w.meanFeel,
      rated: w.rated,
      affected: w.healthAffected,
      dominated: w.healthDominated,
    }));

  const Icon =
    trend.direction === "rising" ? TrendingUp : trend.direction === "falling" ? TrendingDown : Minus;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Icon
                className={cn(
                  "h-4 w-4",
                  trend.direction === "rising"
                    ? "text-amber-600"
                    : trend.direction === "falling"
                      ? "text-emerald-600"
                      : "text-muted-foreground",
                )}
              />
              Effort trend
            </CardTitle>
            <CardDescription>
              How sessions are being rated against what that type of session usually feels like.
            </CardDescription>
          </div>
          {trend.excludedWeeks > 0 && (
            <Badge variant="outline" className="shrink-0 text-[10px] gap-1">
              <Thermometer className="h-3 w-3" />
              {trend.excludedWeeks} week{trend.excludedWeeks === 1 ? "" : "s"} excluded
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm">{trend.note}</p>

        {chartData.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No rated sessions yet. RPE can be added straight from the sessions list.
          </p>
        ) : (
          <>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  {/* Zero is "normal for this type of session", so it is the
                      line that matters — not the bottom of the axis. */}
                  <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} />
                  <XAxis dataKey="week" fontSize={10} />
                  <YAxis fontSize={10} domain={["auto", "auto"]} />
                  <Tooltip
                    formatter={(v: any, name: string) =>
                      name === "delta"
                        ? [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)} vs typical`, "Effort"]
                        : [Number(v).toFixed(1), "Feel"]
                    }
                  />
                  <Bar dataKey="delta" radius={[3, 3, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        // Illness weeks muted, so they read as context rather
                        // than as part of the trend they are excluded from.
                        fill={d.dominated ? "#a1a1aa" : (d.delta ?? 0) > 0 ? "#f59e0b" : "#10b981"}
                        fillOpacity={d.dominated ? 0.45 : 0.9}
                      />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="feel" stroke="var(--accent-red)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Bars are effort against a typical session of that type — above the line means it cost more than usual.
              The line is feel. Grey bars are weeks with illness or injury, shown but left out of the comparison.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
