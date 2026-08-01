import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { isImperial } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Reads get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000010_biomechanics_filters.sql) — one
// row per recent running session. Deliberately running-only; form
// metrics from a bike/gym/swim session wouldn't mean the same thing.
//
// Two filter dimensions:
// - Session type (client-side): which SESSIONS are shown, filtered from
//   the already-fetched rows by `workout_type` — no extra round trip
//   needed since the fetch already pulls a generous window.
// - Workout component (server-side, via `_segment_type`): which PART of
//   each session the metrics are computed from. This actually changes
//   what the database computes (a different points subset), so it goes
//   back to the server rather than being filtered client-side.
//
// Left/right ground-contact balance from the original Biomechanics
// "coming soon" copy is NOT included — no device data captures L/R
// split anywhere in the pipeline (raw_session_points has no such
// column), so there's nothing real to show. Flagged rather than faked.

type TrendRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  workout_type: string | null;
  avg_cadence: number | null;
  stride_length_m: number | null;
  avg_vo_cm: number | null;
  avg_gct_ms: number | null;
  hr_drift_bpm: number | null;
};

const SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Whole session" },
  { value: "warmup", label: "Warmup" },
  { value: "work", label: "Work" },
  { value: "recovery", label: "Recovery" },
  { value: "cooldown", label: "Cooldown" },
];

// Matches the workout_type bucket keys the SQL function classifies
// sessions into (see the mapping note in
// 20260801000008_mechanics_workout_templates.sql) — same 11 buckets,
// same labels as the template table's `label` column.
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

function dayLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MiniTrendChart({
  data,
  dataKey,
  unit,
  color,
}: {
  data: { label: string; value: number | null }[];
  dataKey: string;
  unit: string;
  color: string;
}) {
  const hasData = data.some((d) => d.value != null);
  if (!hasData) {
    return <p className="text-xs text-muted-foreground py-6 text-center">Not enough data yet</p>;
  }
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
          <YAxis tick={{ fontSize: 10 }} width={36} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
            formatter={(v: number) => [`${v}${unit}`, undefined]}
          />
          <Line type="monotone" dataKey="value" name={dataKey} stroke={color} strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BiomechanicsTrendCard({ athleteId }: { athleteId: string }) {
  const [segment, setSegment] = useState("all");
  const [workoutType, setWorkoutType] = useState("all");

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-biomechanics-trend", athleteId, segment],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 40,
        _segment_type: segment === "all" ? null : segment,
      });
      if (error) throw error;
      return (data ?? []) as TrendRow[];
    },
  });

  const filteredRows = useMemo(
    () => (rows ?? []).filter((r) => workoutType === "all" || r.workout_type === workoutType),
    [rows, workoutType],
  );

  // Function returns newest-first; charts read left-to-right chronologically.
  const chronological = [...filteredRows].reverse();

  const cadenceData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.avg_cadence != null ? Math.round(r.avg_cadence) : null }));
  const imperial = isImperial();
  const strideUnit = imperial ? " ft" : " m";
  const voUnit = imperial ? " in" : " cm";
  const strideData = chronological.map((r) => ({
    label: dayLabel(r.session_date),
    value: r.stride_length_m != null ? Number((imperial ? r.stride_length_m * 3.28084 : r.stride_length_m).toFixed(2)) : null,
  }));
  const voData = chronological.map((r) => ({
    label: dayLabel(r.session_date),
    value: r.avg_vo_cm != null ? Number((imperial ? r.avg_vo_cm * 0.393701 : r.avg_vo_cm).toFixed(1)) : null,
  }));
  const gctData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.avg_gct_ms != null ? Math.round(r.avg_gct_ms) : null }));
  const hrDriftData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.hr_drift_bpm != null ? Number(r.hr_drift_bpm.toFixed(1)) : null }));

  const hasAny = filteredRows.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-[var(--accent-red)]" />
              Running Dynamics
            </CardTitle>
            <CardDescription>
              Cadence, stride length, vertical oscillation, ground contact time, and HR drift across the last 40
              running sessions.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={segment} onValueChange={setSegment}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={workoutType} onValueChange={setWorkoutType}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
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
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load running dynamics — {(error as any)?.message ?? "unknown error"}. If this mentions the
            function not existing, the <code className="text-xs">get_athlete_biomechanics_trend</code> migration
            hasn't been run in Supabase yet.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            No completed running sessions with device data match this filter yet.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Cadence (spm)</div>
              <MiniTrendChart data={cadenceData} dataKey="Cadence" unit=" spm" color="#8b5cf6" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Stride length ({imperial ? "ft" : "m"})</div>
              <MiniTrendChart data={strideData} dataKey="Stride" unit={strideUnit} color="#3b82f6" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Vertical oscillation ({imperial ? "in" : "cm"})</div>
              <MiniTrendChart data={voData} dataKey="VO" unit={voUnit} color="#f97316" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Ground contact time (ms)</div>
              <MiniTrendChart data={gctData} dataKey="GCT" unit=" ms" color="#ec4899" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">HR drift (bpm)</div>
              <MiniTrendChart data={hrDriftData} dataKey="HR drift" unit=" bpm" color="#ef4444" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
