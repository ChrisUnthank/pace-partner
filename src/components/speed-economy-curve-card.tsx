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

// 10 s/km, not 20.
//
// Measured on real zone boundaries, the hard zones are NARROWER than a 20s
// bucket: z4 spans 13.2 s/km, z5 13.2, z6 18.8. A 20s bucket therefore cannot
// sit inside any of them, so those zones could never be represented — Z4 went
// missing entirely despite having 13 threshold sessions, because the bucket
// holding them was centred at 200 while z4 ends at 195.9.
//
// 10s buckets fit inside every zone. The cost is fewer sessions per bucket,
// which the minimum below accounts for.
const BUCKET_SEC = 10;

// A single session's mechanics reflect that day — fatigue, wind, terrain —
// rather than a pattern. Two is the floor at 10s buckets: three would drop
// most of the fast end, where sessions are naturally scarcer, and losing the
// hard zones is exactly the failure this width was chosen to avoid.
const MIN_SESSIONS_PER_BUCKET = 2;

// Two points describe a slope, not a peak.
const MIN_BUCKETS_FOR_OPTIMAL = 3;

// Session-to-session MEI variation within a workout type measured around 2%,
// so a peak has to clear that to mean anything.
const MEANINGFUL_RESIDUAL_PCT = 2;

// Same palette and labels as the Efficiency Scores card and the Zone
// Boundaries card — a zone colour has to mean the same thing everywhere or it
// stops being a shortcut and becomes a thing to look up.
const ZONE_META: { key: string; label: string; color: string }[] = [
  { key: "z1", label: "Z1 Recovery", color: "#34d399" },
  { key: "z2", label: "Z2 Easy/Aerobic", color: "#38bdf8" },
  { key: "z3", label: "Z3 Steady/Tempo", color: "#fbbf24" },
  { key: "z4", label: "Z4 Threshold", color: "#f97316" },
  { key: "z5", label: "Z5 VO2", color: "#ef4444" },
  { key: "z6", label: "Z6 Anaerobic/Max", color: "#9333ea" },
];
const ZONE_COLOR: Record<string, string> = Object.fromEntries(ZONE_META.map((z) => [z.key, z.color]));
const ZONE_LABEL: Record<string, string> = Object.fromEntries(ZONE_META.map((z) => [z.key, z.label]));

/**
 * Which pace zone a bucket centre falls in.
 *
 * pace_zN_max_sec_per_km is the SLOWEST pace still inside zone N, so the
 * boundaries descend as the zones get harder — z1_max is the largest number.
 * A pace is in the first zone whose max it doesn't exceed, walking from
 * easiest to hardest.
 *
 * Returns null when the athlete has no pace zones set, so the chart falls
 * back to a single uncoloured line rather than inventing zones.
 */
function zoneForPace(pace: number, zp: any): string | null {
  if (!zp) return null;
  // The annotation lives on the LITERAL, not on the filtered result.
  // Declaring `const bounds: {max: number|null}[] = [...].filter(predicate)`
  // widened the narrowed type straight back again — the annotation wins over
  // the predicate, so b.max stayed nullable and the comparison below was
  // still unguarded.
  const raw: { key: string; max: number | null }[] = [
    { key: "z1", max: zp.pace_z1_max_sec_per_km },
    { key: "z2", max: zp.pace_z2_max_sec_per_km },
    { key: "z3", max: zp.pace_z3_max_sec_per_km },
    { key: "z4", max: zp.pace_z4_max_sec_per_km },
    { key: "z5", max: zp.pace_z5_max_sec_per_km },
    { key: "z6", max: zp.pace_z6_max_sec_per_km },
  ];
  // A type PREDICATE, not a cast. `as` silences the checker while leaving
  // b.max nullable in reality; the predicate actually narrows it, so a null
  // boundary cannot reach the comparison below and quietly compare as false.
  const bounds = raw.filter((b): b is { key: string; max: number } => b.max != null);
  if (bounds.length === 0) return null;
  for (const b of bounds) {
    if (pace >= b.max) return b.key;
  }
  // Faster than every boundary — belongs to the hardest zone defined.
  return bounds[bounds.length - 1].key;
}

function paceLabel(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SpeedEconomyCurveCard({ athleteId }: { athleteId: string }) {
  const [showRaw, setShowRaw] = useState(false);
  // "combined" draws one line with each point coloured by the zone its pace
  // falls in — the shape of the whole curve stays readable. "split" draws a
  // separate line per zone, which makes within-zone shape visible but breaks
  // the curve into disconnected pieces. Neither is strictly better, hence the
  // toggle rather than a decision.
  const [zoneView, setZoneView] = useState<"combined" | "split">("combined");

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
        .select(
          "pace_threshold_sec_per_km, pace_z1_max_sec_per_km, pace_z2_max_sec_per_km, pace_z3_max_sec_per_km, pace_z4_max_sec_per_km, pace_z5_max_sec_per_km, pace_z6_max_sec_per_km",
        )
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { chartData, model, optimal, usableSessions, zonesPresent } = useMemo(() => {
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
    if (!m)
      return { chartData: [], model: null, optimal: null, usableSessions: points.length, zonesPresent: [] as string[] };

    // Residual per session, then averaged per bucket — not bucket-then-
    // residualise. The model is non-linear, so the residual of a mean is not
    // the mean of the residuals.
    const buckets = new Map<number, { sum: number; n: number; rawSum: number; zones: Map<string, number> }>();
    for (const p of points) {
      const expected = predictMei(m, p.pace);
      if (expected == null || expected <= 0) continue;
      const residualPct = ((p.mei - expected) / expected) * 100;
      const center = Math.round(p.pace / BUCKET_SEC) * BUCKET_SEC;
      const b = buckets.get(center) ?? { sum: 0, n: 0, rawSum: 0, zones: new Map<string, number>() };
      b.sum += residualPct;
      b.rawSum += p.mei;
      b.n += 1;
      // Zone of the SESSION's own pace, not of the bucket centre. A bucket
      // straddling a boundary would otherwise take its colour from a rounded
      // midpoint that no session actually ran at — which is how 13 threshold
      // sessions ended up coloured as Z3.
      const sz = zoneForPace(p.pace, zoneProfile);
      if (sz) b.zones.set(sz, (b.zones.get(sz) ?? 0) + 1);
      buckets.set(center, b);
    }

    const data = Array.from(buckets.entries())
      .filter(([, b]) => b.n >= MIN_SESSIONS_PER_BUCKET)
      // Slowest first, so the chart reads left-to-right as "getting faster".
      .sort((a, b) => b[0] - a[0])
      .map(([center, b]) => {
        // Majority zone among the sessions in the bucket. Ties fall to the
        // harder zone, since at a boundary the faster classification is the
        // more informative one for a coach.
        const zone =
          b.zones.size === 0
            ? null
            : Array.from(b.zones.entries()).sort(
                (x, y) => y[1] - x[1] || ZONE_META.findIndex((z) => z.key === y[0]) - ZONE_META.findIndex((z) => z.key === x[0]),
              )[0][0];
        const row: any = {
          paceLabel: paceLabel(center),
          pace: center,
          residual: Math.round((b.sum / b.n) * 10) / 10,
          rawMei: Math.round((b.rawSum / b.n) * 10) / 10,
          sessionCount: b.n,
          zone,
        };
        // One series PER ZONE, so "split by zone" can draw a separate line for
        // each without re-shaping the data. Recharts needs the value present
        // under the series key and absent (undefined) elsewhere — nulls would
        // still be plotted as gaps in the wrong series.
        if (zone) {
          row[`res_${zone}`] = row.residual;
          row[`raw_${zone}`] = row.rawMei;
        }
        return row;
      });

    // An optimum only when the best bucket is meaningfully above zero. A curve
    // flat within noise has no optimum, and saying so is more useful than
    // pointing at the highest of several equivalent numbers.
    let best: (typeof data)[number] | null = null;
    if (data.length >= MIN_BUCKETS_FOR_OPTIMAL) {
      const top = data.reduce((acc, d) => (d.residual > acc.residual ? d : acc), data[0]);
      if (top.residual >= MEANINGFUL_RESIDUAL_PCT) best = top;
    }

    const zonesPresent = ZONE_META.map((z) => z.key).filter((k) => data.some((d) => d.zone === k));

    return { chartData: data, model: m, optimal: best, usableSessions: points.length, zonesPresent };
  }, [rows, zoneProfile]);

  const thresholdPace = zoneProfile?.pace_threshold_sec_per_km ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[var(--accent-red)]" /> Speed Economy Curve
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {zonesPresent.length > 1 && (
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                <button
                  type="button"
                  onClick={() => setZoneView("combined")}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    zoneView === "combined" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  One curve
                </button>
                <button
                  type="button"
                  onClick={() => setZoneView("split")}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    zoneView === "split" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  Split by zone
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              {showRaw ? "Show pace-adjusted" : "Show raw MEI"}
            </button>
          </div>
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
                      `${p?.payload?.sessionCount} session(s)${
                        p?.payload?.zone ? ` · ${ZONE_LABEL[p.payload.zone]}` : ""
                      }`,
                    ]}
                    labelFormatter={(l) => `${l} /km`}
                  />
                  {!showRaw && <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}

                  {zoneView === "split" && zonesPresent.length > 1 ? (
                    // One line per zone. connectNulls={false} so a zone's line
                    // stops where that zone stops, rather than leaping across
                    // paces it never covered.
                    zonesPresent.map((z) => (
                      <Line
                        key={z}
                        type="monotone"
                        dataKey={showRaw ? `raw_${z}` : `res_${z}`}
                        name={ZONE_LABEL[z]}
                        stroke={ZONE_COLOR[z]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls={false}
                      />
                    ))
                  ) : (
                    <Line
                      type="monotone"
                      dataKey={showRaw ? "rawMei" : "residual"}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      // The line stays neutral and the DOTS carry the zone
                      // colour. Colouring the line itself would need a
                      // gradient per segment, and a segment spanning two zones
                      // has no single correct colour anyway.
                      dot={(props: any) => {
                        const z = props?.payload?.zone;
                        return (
                          <circle
                            key={`${props?.payload?.pace}`}
                            cx={props.cx}
                            cy={props.cy}
                            r={4}
                            fill={z ? ZONE_COLOR[z] : "var(--accent-red)"}
                            stroke="hsl(var(--background))"
                            strokeWidth={1.5}
                          />
                        );
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {zonesPresent.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {zonesPresent.map((z) => (
                  <span key={z} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full inline-block" style={{ background: ZONE_COLOR[z] }} />
                    {ZONE_LABEL[z]}
                  </span>
                ))}
              </div>
            )}

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
