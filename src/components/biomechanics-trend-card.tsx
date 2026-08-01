import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

// Reads get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000004_athlete_biomechanics_trend.sql) —
// one row per recent running session. Deliberately running-only; form
// metrics from a bike/gym/swim session wouldn't mean the same thing.
//
// Left/right ground-contact balance from the original Biomechanics
// "coming soon" copy is NOT included — no device data captures L/R
// split anywhere in the pipeline (raw_session_points has no such
// column), so there's nothing real to show. Flagged rather than faked.

type TrendRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  avg_cadence: number | null;
  stride_length_m: number | null;
  avg_vo_cm: number | null;
  avg_gct_ms: number | null;
  hr_drift_bpm: number | null;
};

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
  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-biomechanics-trend", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as TrendRow[];
    },
  });

  // Function returns newest-first; charts read left-to-right chronologically.
  const chronological = [...(rows ?? [])].reverse();

  const cadenceData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.avg_cadence != null ? Math.round(r.avg_cadence) : null }));
  const strideData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.stride_length_m != null ? Number(r.stride_length_m.toFixed(2)) : null }));
  const voData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.avg_vo_cm != null ? Number(r.avg_vo_cm.toFixed(1)) : null }));
  const gctData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.avg_gct_ms != null ? Math.round(r.avg_gct_ms) : null }));
  const hrDriftData = chronological.map((r) => ({ label: dayLabel(r.session_date), value: r.hr_drift_bpm != null ? Number(r.hr_drift_bpm.toFixed(1)) : null }));

  const hasAny = (rows ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-[var(--accent-red)]" />
          Running Dynamics
        </CardTitle>
        <CardDescription>
          Cadence, stride length, vertical oscillation, ground contact time, and HR drift across the last 20 running
          sessions.
        </CardDescription>
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
            No completed running sessions with device data yet — this fills in as FIT/GPX uploads come in.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Cadence (spm)</div>
              <MiniTrendChart data={cadenceData} dataKey="Cadence" unit=" spm" color="#8b5cf6" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Stride length (m)</div>
              <MiniTrendChart data={strideData} dataKey="Stride" unit=" m" color="#3b82f6" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Vertical oscillation (cm)</div>
              <MiniTrendChart data={voData} dataKey="VO" unit=" cm" color="#f97316" />
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
