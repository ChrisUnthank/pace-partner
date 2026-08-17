import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { Gauge, Info } from "lucide-react";
import { computeMei, fitPaceModel, predictMei, paceFromSample } from "@/lib/mei-self-referenced";

// ----------------------------------------------------------------------------
// Speed Economy Curve — rebuilt on PACE-ADJUSTED mechanics.
//
// WHY THE OLD VERSION COULDN'T WORK
//
// It plotted avg_biomechanical_score against pace. That score is 35% MEI, and
// MEI is a function of pace: measured across 113 sessions, pace explains 98.7%
// of its variance (log-log r² 0.987), with residuals inside ±1% in every
// populated band. Plotting a pace-derived score against pace produces a line
// that slopes by construction.
//
// Two things followed. "Optimal Mechanical Pace" tended to pick whatever fast
// bucket had enough sessions — reporting where the athlete runs fast, not
// where they move well. And "Mechanical–Aerobic Gap", being threshold minus
// optimal, was then almost always positive, so the card nearly always
// concluded aerobic capacity was the limiter. That is a coaching
// recommendation produced by arithmetic.
//
// The Z1–Z6 filter was added to stop the curve peaking on easy running. The
// real cause of that peak was different: biomechanical_score is null unless
// all four components exist, and Rhythm and Fatigue were null on every
// interval session because interval_results.stride_length_cm was never
// populated. Interval sessions were therefore excluded from the curve
// entirely and only easy runs remained. The filter treated a symptom of
// missing data.
//
// It also broke what it sat inside. A pace zone IS a pace range — Z5 spans
// about 19 s/km against 15 s/km buckets — so a filtered curve held at most
// one or two buckets while "optimal" needs three. Filtered, it could never
// appear.
//
// WHAT THIS PLOTS INSTEAD
//
// Each session's MEI as a percentage above or below what its own pace
// predicts. Zero means "moved exactly as expected for that speed". A peak now
// means something real: a pace at which this athlete moves better than their
// own pace model says they should.
//
// The zone filter is gone — unnecessary once the y-axis no longer tracks
// pace, and it was preventing the only interesting output.
// ----------------------------------------------------------------------------

type TrendRow = {
  session_id: string;
  session_date: string;
  workout_type: string | null;
  stride_length_m: number | null;
  avg_gct_ms: number | null;
  avg_vo_cm: number | null;
  avg_cadence: number | null;
};

// Wider than the old 15 s/km because the y-axis is now a residual rather than
// a level: neighbouring paces no longer differ systematically, so pooling them
// costs nothing and each bucket gets more sessions behind it.
const BUCKET_SEC = 20;

// A single session's mechanics reflect that day — fatigue, wind, terrain —
// rather than a pattern.
const MIN_SESSIONS_PER_BUCKET = 3;

// Two points describe a slope, not a peak.
const MIN_BUCKETS_FOR_OPTIMAL = 3;

// Session-to-session MEI variation within a workout type measured around 2%,
// so a peak has to clear that to mean anything.
const MEANINGFUL_RESIDUAL_PCT = 2;

function paceLabel(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SpeedEconomyCurveCard({ athleteId }: { athleteId: string }) {
  const [showRaw, setShowRaw] = useState(false);

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["speed-economy-residual", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      // Same source and segment filter as the Efficiency Scores card, so the
      // two cannot disagree about what a session's mechanics were.
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 200,
        _segment_type: "work",
      });
      if (error) throw error;
      return (data ?? []) as TrendRow[];
    },
  });

  const { data: zoneProfile } = useQuery({
    queryKey: ["speed-economy-threshold", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_zone_profiles")
        .select("pace_threshold_sec_per_km")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { chartData, model, optimal, usableSessions } = useMemo(() => {
    const samples = (rows ?? []).map((r) => ({
      sessionId: r.session_id,
      date: r.session_date,
      workoutType: r.workout_type,
      strideM: r.stride_length_m,
      gctMs: r.avg_gct_ms,
      voCm: r.avg_vo_cm,
      cadence: r.avg_cadence,
    }));

    const points = samples
      .map((s) => ({ pace: paceFromSample(s), mei: computeMei(s) }))
      .filter((p): p is { pace: number; mei: number } => p.pace != null && p.mei != null);

    const m = fitPaceModel(points);
    if (!m) return { chartData: [], model: null, optimal: null, usableSessions: points.length };

    // Residual per session, then averaged per bucket — not bucket-then-
    // residualise. The model is non-linear, so the residual of a mean is not
    // the mean of the residuals.
    const buckets = new Map<number, { sum: number; n: number; rawSum: number }>();
    for (const p of points) {
      const expected = predictMei(m, p.pace);
      if (expected == null || expected <= 0) continue;
      const residualPct = ((p.mei - expected) / expected) * 100;
      const center = Math.round(p.pace / BUCKET_SEC) * BUCKET_SEC;
      const b = buckets.get(center) ?? { sum: 0, n: 0, rawSum: 0 };
      b.sum += residualPct;
      b.rawSum += p.mei;
      b.n += 1;
      buckets.set(center, b);
    }

    const data = Array.from(buckets.entries())
      .filter(([, b]) => b.n >= MIN_SESSIONS_PER_BUCKET)
      // Slowest first, so the chart reads left-to-right as "getting faster".
      .sort((a, b) => b[0] - a[0])
      .map(([center, b]) => ({
        paceLabel: paceLabel(center),
        pace: center,
        residual: Math.round((b.sum / b.n) * 10) / 10,
        rawMei: Math.round((b.rawSum / b.n) * 10) / 10,
        sessionCount: b.n,
      }));

    // An optimum only when the best bucket is meaningfully above zero. A curve
    // flat within noise has no optimum, and saying so is more useful than
    // pointing at the highest of several equivalent numbers.
    let best: (typeof data)[number] | null = null;
    if (data.length >= MIN_BUCKETS_FOR_OPTIMAL) {
      const top = data.reduce((acc, d) => (d.residual > acc.residual ? d : acc), data[0]);
      if (top.residual >= MEANINGFUL_RESIDUAL_PCT) best = top;
    }

    return { chartData: data, model: m, optimal: best, usableSessions: points.length };
  }, [rows]);

  const thresholdPace = zoneProfile?.pace_threshold_sec_per_km ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[var(--accent-red)]" /> Speed Economy Curve
          </CardTitle>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            {showRaw ? "Show pace-adjusted" : "Show raw MEI"}
          </button>
        </div>
        <CardDescription>
          {showRaw
            ? "Raw mechanical efficiency by pace. This slopes by construction — MEI rises with speed — which is why the adjusted view is the one that says anything."
            : "How far mechanics sit above or below what each pace predicts. Zero is exactly as expected; a peak is a pace where this athlete moves better than their own model says they should."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">{(error as any)?.message ?? "Couldn't load the curve."}</p>}

        {!isLoading && !isError && chartData.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {usableSessions < 8
              ? `Needs at least 8 sessions with stride, ground contact and oscillation data to fit a pace model — currently ${usableSessions}.`
              : `No pace range yet has ${MIN_SESSIONS_PER_BUCKET}+ sessions behind it.`}
          </p>
        )}

        {chartData.length > 0 && (
          <>
            <div className="h-[240px] w-full">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="paceLabel" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={46}
                    tickFormatter={(v) => (showRaw ? `${v}` : `${Number(v) > 0 ? "+" : ""}${v}%`)}
                    domain={showRaw ? ["dataMin - 5", "dataMax + 5"] : ["dataMin - 2", "dataMax + 2"]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      fontSize: 12,
                    }}
                    formatter={(v: any, _n: any, p: any) => [
                      showRaw ? `MEI ${v}` : `${Number(v) > 0 ? "+" : ""}${v}% vs predicted`,
                      `${p?.payload?.sessionCount} session(s)`,
                    ]}
                    labelFormatter={(l) => `${l} /km`}
                  />
                  {!showRaw && <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
                  <Line
                    type="monotone"
                    dataKey={showRaw ? "rawMei" : "residual"}
                    stroke="var(--accent-red)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div className="border rounded-lg p-3">
                <div className="text-[11px] text-muted-foreground">Best mechanical pace</div>
                {optimal ? (
                  <>
                    <div className="text-lg font-bold tabular-nums">{optimal.paceLabel} /km</div>
                    <div className="text-[11px] text-muted-foreground">
                      +{optimal.residual}% above predicted, {optimal.sessionCount} sessions
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {chartData.length < MIN_BUCKETS_FOR_OPTIMAL
                      ? `Needs ${MIN_BUCKETS_FOR_OPTIMAL} pace ranges with ${MIN_SESSIONS_PER_BUCKET}+ sessions each.`
                      : "No pace stands out — mechanics track pace closely, which is the normal result."}
                  </div>
                )}
              </div>

              <div className="border rounded-lg p-3">
                <div className="text-[11px] text-muted-foreground">Current threshold pace</div>
                <div className="text-lg font-bold tabular-nums">
                  {thresholdPace ? `${paceLabel(thresholdPace)} /km` : "—"}
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="text-[11px] text-muted-foreground">Pace model fit</div>
                <div className="text-lg font-bold tabular-nums">{model ? `r² ${model.r2.toFixed(3)}` : "—"}</div>
                <div className="text-[11px] text-muted-foreground">{model ? `${model.n} sessions` : ""}</div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-snug flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>
                {model && model.r2 > 0.95 ? (
                  <>
                    Pace explains {(model.r2 * 100).toFixed(1)}% of this athlete's mechanical efficiency, so the
                    adjusted curve is mostly flat by nature. Departures from zero are the signal — a bucket sitting
                    +{MEANINGFUL_RESIDUAL_PCT}% or more above the line is doing something pace alone doesn't explain.{" "}
                  </>
                ) : null}
                A single session can reflect fatigue, terrain or weather rather than a pattern; trust this across a
                training block rather than from one strong or weak week.
              </span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
