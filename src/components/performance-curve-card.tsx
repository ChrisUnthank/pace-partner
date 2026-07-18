import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { secToClock, paceFmt } from "@/lib/format";
import { RefreshCw, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

// Phase 2 — Performance Profile. Deliberately no new migration: every field
// the spec asks for (date, event, time, venue-via-event_name, conditions,
// splits, race vs training via `context`, source) already exists on
// `performances`, and custom events were already supported (event/distance
// is free text on both the single-add and bulk-import paths in
// app.profile.tsx's PBsCard). This component only adds a *view* — the
// curve — on top of data that already exists.
//
// "Relative observations" deliberately reuses the existing
// athlete_physio_profile / recompute_physio_profile() system (same table
// PhysiologyCard on the main athlete page reads) rather than building a
// second, parallel insight engine — that system already does exactly what
// the spec asks for here (ratio-based, relative, recalculated on every new
// PB, never a fixed label). This card just surfaces it in the Performance
// Profile context and adds a way to force a recompute.

// Canonical labels for the spec's named distances; anything else falls
// back to a plain "Nm"/"Nkm" label. Matched by nearest-meter rather than
// exact equality, since imported results can be a few meters off nominal
// (e.g. a road 10K logged as 10001m).
const KNOWN_DISTANCES: Array<{ m: number; label: string }> = [
  { m: 100, label: "100m" },
  { m: 200, label: "200m" },
  { m: 400, label: "400m" },
  { m: 600, label: "600m" },
  { m: 800, label: "800m" },
  { m: 1000, label: "1000m" },
  { m: 1500, label: "1500m" },
  { m: 1609, label: "Mile" },
  { m: 3000, label: "3000m" },
  { m: 5000, label: "5km" },
  { m: 10000, label: "10km" },
  { m: 21097, label: "Half Marathon" },
  { m: 42195, label: "Marathon" },
];

function distanceLabel(m: number): string {
  const known = KNOWN_DISTANCES.find((d) => Math.abs(d.m - m) <= Math.max(5, d.m * 0.01));
  if (known) return known.label;
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km`;
  return `${Math.round(m)}m`;
}

type PerfRow = {
  id: string;
  performance_date: string;
  distance_m: number;
  time_seconds: number;
  event_name: string | null;
  race_type: string | null;
  context: string | null;
};

export function PerformanceCurveCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: performances, isLoading } = useQuery({
    queryKey: ["performances-for-curve", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, performance_date, distance_m, time_seconds, event_name, race_type, context")
        .eq("athlete_id", athleteId)
        .order("distance_m", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PerfRow[];
    },
  });

  const { data: physio } = useQuery({
    // Same key PhysiologyCard uses on the main athlete page — sharing it
    // means a refresh triggered from either place updates both.
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data;
    },
  });

  // Best (fastest) time per distance, across race types — the curve is
  // about the athlete's speed-vs-distance shape, not a single race-type PB
  // list, and sample sizes per athlete are usually too small to split by
  // race type without gaps.
  const curvePoints = useMemo(() => {
    const bestByDistance = new Map<number, PerfRow>();
    for (const p of performances ?? []) {
      if (p.time_seconds == null || p.distance_m == null || p.distance_m <= 0) continue;
      const existing = bestByDistance.get(p.distance_m);
      if (!existing || p.time_seconds < existing.time_seconds) {
        bestByDistance.set(p.distance_m, p);
      }
    }
    return Array.from(bestByDistance.values())
      .sort((a, b) => a.distance_m - b.distance_m)
      .map((p) => ({
        ...p,
        label: distanceLabel(p.distance_m),
        paceSecPerKm: (p.time_seconds / p.distance_m) * 1000,
      }));
  }, [performances]);

  async function refreshPhysio() {
    setRefreshing(true);
    const { error } = await supabase.rpc("recompute_physio_profile", { _athlete_id: athleteId });
    setRefreshing(false);
    if (error) {
      return;
    }
    qc.invalidateQueries({ queryKey: ["physio", athleteId] });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (curvePoints.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance curve</CardTitle>
          <CardDescription>Needs at least 2 distances with a recorded time to draw a curve.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {curvePoints.length === 0
              ? "No performances logged yet."
              : `Only one distance logged (${curvePoints[0].label}) — add a second at a different distance to see the curve.`}{" "}
            PBs can be added from the athlete's own Profile page (Personal bests & performances).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-[var(--accent-red)]" />
            Performance curve
          </CardTitle>
          <CardDescription>
            Best time at each distance logged, plotted as pace — recalculates automatically as new performances are
            added.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curvePoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  reversed
                  tickFormatter={(v) => secToClock(v)}
                  tick={{ fontSize: 11 }}
                  width={55}
                  domain={["dataMin", "dataMax"]}
                />
                <Tooltip
                  formatter={(value: number) => [paceFmt(value), "Pace"]}
                  labelFormatter={(label) => label}
                />
                <Line type="monotone" dataKey="paceSecPerKm" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 divide-y border rounded">
            {curvePoints.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium shrink-0">{p.label}</span>
                  {p.event_name && <span className="text-muted-foreground truncate">{p.event_name}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums">{secToClock(p.time_seconds)}</span>
                  <span className="tabular-nums text-muted-foreground">{paceFmt(p.paceSecPerKm)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {p.context === "training" ? "Training" : "Race"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{p.performance_date}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Relative profile</CardTitle>
            <CardDescription>
              A relative observation from this curve, not a fixed label — it changes automatically as new PBs are
              logged.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={refreshPhysio} disabled={refreshing}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent>
          {!physio || physio.status !== "ok" ? (
            <p className="text-sm text-muted-foreground">
              {physio?.coaching_note ?? "Log PBs at two or more distances (ideally 1500m and 5000m) to generate a relative profile."}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{physio.archetype}</Badge>
                {physio.speed_reserve_bucket && (
                  <Badge variant="outline">{physio.speed_reserve_bucket} speed reserve</Badge>
                )}
              </div>
              <p className="text-sm leading-relaxed border-l-2 pl-3 text-muted-foreground">{physio.coaching_note}</p>
              <div className="text-[10px] text-muted-foreground">Updated {physio.updated_at?.slice(0, 10)}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
