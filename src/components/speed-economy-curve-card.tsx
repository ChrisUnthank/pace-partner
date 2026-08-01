import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { paceFmt } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Reads get_athlete_speed_economy_curve() (see
// supabase/migrations/20260801000017_speed_economy_zone_filter.sql) —
// each point is realized pace vs. this athlete's already-computed
// Biomechanical Score, averaged per 15 sec/km bucket. NOT a second,
// independently-scored curve — same underlying score as the Biomechanics
// page's Efficiency Scores card.
//
// Workout-type filter added per direct feedback: an unfiltered curve
// naturally skews toward whatever paces have the most logged volume —
// almost always easy/recovery — which can make "Optimal Mechanical
// Pace" land on a well-populated easy bucket rather than reflecting
// genuine mechanical quality at race-relevant intensities. Filtering to
// a single workout type (e.g. Threshold only) isolates that bucket's
// own pace variation instead of comparing across templates.
//
// Real caveat worth remembering: since Biomechanical Score is scored
// relative to EACH SESSION'S OWN workout-type template, and several of
// those templates are interpolated guesses rather than sourced
// research (see 20260801000008's notes), a curve that looks like it
// peaks at an easy pace may reflect template calibration differences
// between workout types more than true mechanical quality — not
// something this filter alone fixes, just something it helps you look
// at more directly one bucket at a time.
//
// "Optimal Mechanical Pace" (the bucket with the highest average score)
// is only ever named once there are at least 3 qualifying buckets —
// enough to see an actual curve shape, not 1-2 lonely points calling
// themselves a trend.
//
// "Mechanical-Aerobic Gap" compares Optimal Mechanical Pace against the
// athlete's current threshold pace (athlete_zone_profiles) — the same
// number already used to build this athlete's pace zones, not a second
// disagreeing threshold figure.

type CurvePoint = {
  pace_bucket_center_sec_per_km: number;
  avg_biomechanical_score: number;
  session_count: number;
};

const MIN_BUCKETS_FOR_OPTIMAL = 3;

// Matches the workout_type bucket keys get_athlete_biomechanics_trend
// classifies sessions into (see the mapping note in
// 20260801000008_mechanics_workout_templates.sql) — same list already
// used on the Running Dynamics card's session-type filter.
const WORKOUT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "recovery", label: "Recovery Run" },
  { value: "easy", label: "Easy Run" },
  { value: "long_run", label: "Long Run" },
  { value: "aerobic", label: "Aerobic" },
  { value: "tempo", label: "Tempo" },
  { value: "threshold", label: "Threshold" },
  { value: "vo2", label: "VO2 Max" },
  { value: "anaerobic", label: "Anaerobic" },
  { value: "speed", label: "Sprint/Speed" },
  { value: "time_trial", label: "Time Trial" },
  { value: "race", label: "Race" },
];

// paceFmt() already appends the unit suffix itself (" /km" or " /mi"
// depending on the Imperial/Metric setting) — do not append a second
// "/km" on top of it.
function paceLabel(secPerKm: number): string {
  return paceFmt(secPerKm);
}

export function SpeedEconomyCurveCard({ athleteId }: { athleteId: string }) {
  const [workoutType, setWorkoutType] = useState("all");

  const { data: curve, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-speed-economy-curve", athleteId, workoutType],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_speed_economy_curve" as any, {
        _athlete_id: athleteId,
        _limit: 200,
        _workout_type: workoutType === "all" ? null : workoutType,
      });
      if (error) throw error;
      return (data ?? []) as CurvePoint[];
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

  // Chart reads fastest-to-slowest left-to-right feels backwards for a
  // pace axis — sort slowest-to-fastest (ascending seconds/km = faster,
  // so descending numeric value) for a left-to-right "getting faster"
  // read, matching how a coach would sketch this by hand.
  const chartData = useMemo(
    () =>
      [...(curve ?? [])]
        .sort((a, b) => b.pace_bucket_center_sec_per_km - a.pace_bucket_center_sec_per_km)
        .map((c) => ({
          paceLabel: paceLabel(c.pace_bucket_center_sec_per_km),
          pace: c.pace_bucket_center_sec_per_km,
          score: c.avg_biomechanical_score,
          sessionCount: c.session_count,
        })),
    [curve],
  );

  const hasEnoughForOptimal = (curve ?? []).length >= MIN_BUCKETS_FOR_OPTIMAL;

  const optimal = useMemo(() => {
    if (!hasEnoughForOptimal) return null;
    return (curve ?? []).reduce((best, c) =>
      c.avg_biomechanical_score > best.avg_biomechanical_score ? c : best,
    );
  }, [curve, hasEnoughForOptimal]);

  const thresholdPace = zoneProfile?.pace_threshold_sec_per_km ?? null;
  // threshold − optimal (not optimal − threshold): a FASTER optimal
  // mechanical pace than current threshold pace means mechanics could
  // already handle faster running than the aerobic engine currently
  // sustains — a positive gap, aerobic capacity is the likely limiter.
  // A slower optimal pace than threshold means the athlete is being
  // asked to hold a pace their mechanics aren't actually best suited to
  // — form is the limiter at that intensity.
  const gapSeconds =
    optimal != null && thresholdPace != null ? thresholdPace - optimal.pace_bucket_center_sec_per_km : null;

  const hasAny = (curve ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-[var(--accent-red)]" />
              Speed Economy Curve
            </CardTitle>
            <CardDescription>
              Biomechanical Score by realized pace, across the last 200 running sessions with device data.
            </CardDescription>
          </div>
          <Select value={workoutType} onValueChange={setWorkoutType}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKOUT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load the speed economy curve — {(error as any)?.message ?? "unknown error"}. If this mentions
            the function not existing, the <code className="text-xs">get_athlete_speed_economy_curve</code>{" "}
            migration hasn't been run in Supabase yet.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            Not enough repeated sessions at any single pace yet — each point on this curve needs at least 2 sessions
            at a similar pace to be trustworthy.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="h-[220px] w-full">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="paceLabel" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} width={32} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v: number, _n: string, item: any) => [
                      `${v} (${item?.payload?.sessionCount ?? "?"} sessions)`,
                      "Biomechanical Score",
                    ]}
                  />
                  {optimal && (
                    <ReferenceLine
                      x={paceLabel(optimal.pace_bucket_center_sec_per_km)}
                      stroke="var(--accent-red)"
                      strokeDasharray="4 4"
                      label={{ value: "Optimal", fontSize: 10, fill: "var(--accent-red)" }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Optimal Mechanical Pace</div>
                {optimal ? (
                  <div className="font-display text-2xl font-extrabold tabular-nums mt-1">
                    {paceLabel(optimal.pace_bucket_center_sec_per_km)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mt-2">
                    Needs {MIN_BUCKETS_FOR_OPTIMAL}+ distinct pace ranges with repeated sessions
                  </div>
                )}
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Threshold Pace</div>
                <div className="font-display text-2xl font-extrabold tabular-nums mt-1">
                  {thresholdPace != null ? paceLabel(thresholdPace) : "—"}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mechanical–Aerobic Gap</div>
                {gapSeconds != null ? (
                  <>
                    <div className="font-display text-2xl font-extrabold tabular-nums mt-1">
                      {Math.abs(Math.round(gapSeconds))}s/km
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {gapSeconds > 0
                        ? "Mechanics can go faster than current aerobic threshold allows — aerobic capacity is the likely limiter."
                        : "Threshold pace is at or beyond optimal mechanics — form may be the limiter at this intensity."}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground mt-2">Needs both figures available</div>
                )}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              A single session's mechanics can reflect fatigue, terrain, or weather rather than a real pattern —
              trust this curve more once it holds consistently across a full training block, not from one strong or
              weak session. Scores are relative to each session's own workout-type template — comparing across
              different workout types (e.g. Easy vs. Threshold) can also reflect template calibration differences,
              not just true mechanics. Filtering to one type above removes that specific risk.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
