import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  CartesianGrid,
  Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { secToClock, metersFmt, paceFmt } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { useServerFn } from "@tanstack/react-start";
import { computeContinuousFatigue } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId/analysis")({
  component: SessionAnalysis,
});

type Sample = {
  t: number;
  d?: number;
  hr?: number;
  hrEnd?: number;
  hrRec?: number;
  hrDrop?: number;
  pace?: number;
  cadence?: number;
  elev?: number;
  vo?: number;
  gct?: number;
  lat?: number;
  lng?: number;
  stepId: string;
  stepKind: string;
  repNumber: number;
};

type ScopeKey = "full" | "warmup" | "work" | "recovery" | "cooldown" | "strides";

const STEP_COLORS: Record<string, string> = {
  warmup: "rgba(125, 211, 252, 0.18)",
  work: "rgba(248, 113, 113, 0.18)",
  recovery: "rgba(148, 163, 184, 0.18)",
  cooldown: "rgba(167, 243, 208, 0.22)",
  strides: "rgba(251, 191, 36, 0.20)",
};

const STEP_STROKE: Record<string, string> = {
  warmup: "#0ea5e9",
  work: "#ef4444",
  recovery: "#64748b",
  cooldown: "#10b981",
  strides: "#f59e0b",
};

const METRICS = [
  { key: "hr", label: "HR", color: "#ef4444", unit: "bpm", axis: "left" as const },
  { key: "pace", label: "Pace", color: "#3b82f6", unit: "/km", axis: "right" as const },
  { key: "cadence", label: "Cadence", color: "#8b5cf6", unit: "spm", axis: "leftInner" as const },
  { key: "elev", label: "Elevation", color: "#10b981", unit: "m", axis: "rightInner" as const },
  { key: "vo", label: "Vert Osc", color: "#f97316", unit: "cm", axis: "leftInner" as const },
  { key: "gct", label: "Gnd Contact", color: "#a855f7", unit: "ms", axis: "rightInner" as const },
] as const;

const SCOPE_OPTIONS: ScopeKey[] = ["full", "warmup", "work", "recovery", "cooldown", "strides"];

const SCOPE_LABELS: Record<ScopeKey, string> = {
  full: "Full session",
  warmup: "Warmup",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cooldown",
  strides: "Strides",
};

type MetricKey = (typeof METRICS)[number]["key"];

function SessionAnalysis() {
  const { sessionId } = Route.useParams();

  const [enabled, setEnabled] = useState<Record<MetricKey, boolean>>({
    hr: true,
    pace: true,
    cadence: false,
    elev: false,
    vo: false,
    gct: false,
  });

  const [xMode, setXMode] = useState<"time" | "distance">("time");
  const [scope, setScope] = useState<ScopeKey>("full");

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions").select("*, athletes(name)").eq("id", sessionId).single();

      if (error) {
        console.error("session error:", error);
        return null;
      }

      return data;
    },
    retry: false,
  });

  const { data: steps = [] } = useQuery({
    queryKey: ["steps", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("steps").select("*").eq("session_id", sessionId).order("step_order");

      if (error) {
        console.error("steps error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const stepIds = Array.isArray(steps) ? steps.map((s: any) => s.id) : [];

  const { data: results = [] } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results")
        .select("*")
        .in("step_id", stepIds)
        .order("set_number")
        .order("rep_number");

      if (error) {
        console.error("results error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const { data: zoneTime = [] } = useQuery({
    queryKey: ["zone-time", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_zone_time")
        .select("zone, seconds, source")
        .eq("session_id", sessionId);

      if (error) {
        console.error("zone-time error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const { data: fatigue = [] } = useQuery({
    queryKey: ["fatigue", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("session_fatigue").select("*").eq("session_id", sessionId);

      if (error) {
        console.error("fatigue error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const { data: rawPoints = [] } = useQuery({
    queryKey: ["raw-points", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_session_points")
        .select(
          "elapsed_s, distance_m, hr, pace_sec_per_km, cadence, elevation_m, lat, lng, segment_type, vertical_oscillation_cm, ground_contact_time_ms",
        )
        .eq("session_id", sessionId)
        .order("elapsed_s", { ascending: true });

      if (error) {
        console.error("raw-points error:", error);
        return [];
      }

      return data ?? [];
    },
  });

  const safeSteps = Array.isArray(steps) ? steps : [];
  const safeResults = Array.isArray(results) ? results : [];
  const safeZoneTime = Array.isArray(zoneTime) ? zoneTime : [];
  const safeFatigue = Array.isArray(fatigue) ? fatigue : [];
  const safeRawPoints = Array.isArray(rawPoints) ? rawPoints : [];

  const computeFatigue = useServerFn(computeContinuousFatigue);

  const { samples, bands, mode, hasMetric, gpsPoints, traceBuildFailed } = useMemo(() => {
    try {
      const built = buildSamples(safeSteps, safeResults, safeRawPoints);

      return {
        samples: Array.isArray(built?.samples) ? built.samples : [],
        bands: Array.isArray(built?.bands) ? built.bands : [],
        mode: built?.mode ?? "none",
        hasMetric: built?.hasMetric ?? {
          hr: false,
          pace: false,
          cadence: false,
          elev: false,
          vo: false,
          gct: false,
        },
        gpsPoints: Array.isArray(built?.gpsPoints) ? built.gpsPoints : [],
        traceBuildFailed: false,
      };
    } catch (err) {
      console.error("buildSamples error:", err);

      return {
        samples: [],
        bands: [],
        mode: "none",
        hasMetric: {
          hr: false,
          pace: false,
          cadence: false,
          elev: false,
          vo: false,
          gct: false,
        },
        gpsPoints: [],
        traceBuildFailed: true,
      };
    }
  }, [safeSteps, safeResults, safeRawPoints]);

  const availableScopes = SCOPE_OPTIONS;

  const visibleSamples = useMemo(() => {
    if (scope === "full") return samples;
    return samples.filter((s) => s.stepKind === scope);
  }, [samples, scope]);

  const visibleBands = useMemo(() => {
    if (scope === "full") return bands;
    return bands.filter((b) => b.kind === scope);
  }, [bands, scope]);

  const xCanUseDistance =
    Array.isArray(visibleSamples) && visibleSamples.length > 0 && visibleSamples.every((s) => s.d != null);

  const xKey: keyof Sample = xMode === "distance" && xCanUseDistance ? "d" : "t";

  const seriesData = useMemo(() => {
    return (visibleSamples ?? []).map((s) => ({
      x: (s[xKey] as number) ?? 0,
      stepKind: s.stepKind,
      hr: s.hr ?? null,
      hrEnd: s.hrEnd ?? null,
      hrRec: s.hrRec ?? null,
      hrDrop: s.hrDrop ?? null,
      pace: s.pace ?? null,
      cadence: s.cadence ?? null,
      elev: s.elev ?? null,
      vo: s.vo ?? null,
      gct: s.gct ?? null,
    }));
  }, [visibleSamples, xKey]);

  const hasRaw = safeRawPoints.length > 0;
  const hasRepData = safeResults.length > 0;

  // ✅ Manual-friendly analysis mode
  const isManualOnly = !hasRaw && hasRepData;

  // If raw exists but trace building failed, fall back to interval/empty instead of crashing
  const modeType = hasRaw && !traceBuildFailed ? "trace" : hasRepData ? "interval" : "empty";

  const continuousFatigue = safeFatigue.find((f: any) => f.method === "continuous_drift");
  const repFatigue = safeFatigue.filter((f: any) => f.method !== "continuous_drift");
  const isIntervals = session?.structure === "intervals";
  const showContinuousFatigueCard = hasRaw && !isIntervals;
  const showIntervalFatigueHint = isManualOnly && safeResults.length > 0;

  useEffect(() => {
    if (!session) return;
    if (session.structure !== "continuous") return;
    if (!hasRaw) return;
    if (continuousFatigue) return;
    computeFatigue({ data: { sessionId } }).catch((err) => {
      console.error("compute fatigue error:", err);
    });
  }, [session, hasRaw, continuousFatigue, computeFatigue, sessionId]);

  const hasGraphData =
    Array.isArray(visibleSamples) &&
    visibleSamples.length > 0 &&
    METRICS.some((m) => enabled[m.key] && hasMetric[m.key]);

  const recoveryRows = useMemo(() => {
    return safeResults
      .filter((r: any) => r.hr_end != null && r.hr_end_recovery != null)
      .map((r: any, idx: number) => ({
        x: idx + 1,
        label: `${(r.set_number ?? 1) > 1 ? `S${r.set_number} ` : ""}R${r.rep_number}`,
        hrEnd: Number(r.hr_end),
        hrRec: Number(r.hr_end_recovery),
        hrDrop: Number(r.hr_end) - Number(r.hr_end_recovery),
      }));
  }, [safeResults]);

  const manualRows = useMemo(() => {
    return safeResults.filter(
      (r: any) => r.actual_time_seconds != null || r.actual_distance_m != null || r.hr_avg != null || r.hr_end != null,
    );
  }, [safeResults]);

  const manualAvgHr = useMemo(() => {
    const rowsWithHr = manualRows.filter((r: any) => r.hr_avg != null);
    if (!rowsWithHr.length) return null;
    return Math.round(rowsWithHr.reduce((sum: number, r: any) => sum + Number(r.hr_avg ?? 0), 0) / rowsWithHr.length);
  }, [manualRows]);

  if (sessionLoading) {
    return (
      <AppShell>
        <p>Loading…</p>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="space-y-3 max-w-lg">
          <h1 className="text-lg font-semibold">Session unavailable</h1>
          <p className="text-sm text-muted-foreground">
            The session could not be loaded, or the analysis data is incomplete.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/sessions">← Back to sessions</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <Link
            to="/app/sessions/$sessionId"
            params={{ sessionId }}
            className="text-sm text-muted-foreground underline"
          >
            ← Back to details
          </Link>
          <h1 className="text-2xl font-bold mt-2">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.session_date} · {session.athletes?.name} · {sessionClassificationLabel(session as any)}
            {session.completed_at && <span className="ml-2 text-emerald-600">Completed</span>}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Session graph</CardTitle>
                <CardDescription>
                  {modeType === "trace"
                    ? "High-resolution trace"
                    : traceBuildFailed
                      ? "Trace data exists, but the detailed trace could not be rendered safely"
                      : modeType === "interval"
                        ? "Interval summary"
                        : "No data available for analysis"}
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant={xKey === "t" ? "default" : "outline"} onClick={() => setXMode("time")}>
                  Time
                </Button>
                <Button
                  size="sm"
                  variant={xKey === "d" ? "default" : "outline"}
                  disabled={!xCanUseDistance}
                  onClick={() => setXMode("distance")}
                >
                  Distance
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 mt-2">
              {SCOPE_OPTIONS.map((k) => {
                const hasData = k === "full" || samples.some((s) => s.stepKind === k);

                return (
                  <Button
                    key={k}
                    size="sm"
                    variant={scope === k ? "default" : "outline"}
                    disabled={!hasData}
                    onClick={() => hasData && setScope(k)}
                    title={!hasData ? "No data for this segment" : ""}
                  >
                    {SCOPE_LABELS[k]}
                  </Button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-1 mt-2">
              {METRICS.map((m) => {
                const avail = hasMetric[m.key];
                return (
                  <Button
                    key={m.key}
                    size="sm"
                    variant={enabled[m.key] && avail ? "default" : "outline"}
                    disabled={!avail}
                    title={!avail ? "no data" : ""}
                    onClick={() =>
                      setEnabled((p) => ({
                        ...p,
                        [m.key]: !p[m.key],
                      }))
                    }
                  >
                    <span className="h-2 w-2 rounded-full mr-1.5 inline-block" style={{ background: m.color }} />
                    {m.label}
                  </Button>
                );
              })}
            </div>
          </CardHeader>

          <CardContent>
            {modeType === "trace" && hasGraphData ? (
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={seriesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => (xKey === "t" ? secToClock(Number(v)) : metersFmt(Number(v)))}
                    />
                    <YAxis
                      yAxisId="hr"
                      orientation="left"
                      hide={!enabled.hr || !hasMetric.hr}
                      tick={{ fontSize: 11 }}
                      width={36}
                    />
                    <YAxis
                      yAxisId="pace"
                      orientation="right"
                      hide={!enabled.pace || !hasMetric.pace}
                      reversed
                      tick={{ fontSize: 11 }}
                      width={48}
                      tickFormatter={(v) => secToClock(Number(v))}
                    />
                    <YAxis
                      yAxisId="cadence"
                      orientation="left"
                      hide={!enabled.cadence || !hasMetric.cadence}
                      tick={{ fontSize: 11 }}
                      width={32}
                    />
                    <YAxis
                      yAxisId="elev"
                      orientation="right"
                      hide={!enabled.elev || !hasMetric.elev}
                      tick={{ fontSize: 11 }}
                      width={32}
                    />
                    <YAxis
                      yAxisId="vo"
                      orientation="left"
                      hide={!enabled.vo || !hasMetric.vo}
                      tick={{ fontSize: 11 }}
                      width={32}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}`}
                    />
                    <YAxis
                      yAxisId="gct"
                      orientation="right"
                      hide={!enabled.gct || !hasMetric.gct}
                      tick={{ fontSize: 11 }}
                      width={36}
                    />

                    <Tooltip
                      labelFormatter={(v) => (xKey === "t" ? secToClock(Number(v)) : metersFmt(Number(v)))}
                      formatter={(v: any, n: any) => {
                        if (v == null || Number.isNaN(Number(v))) return ["—", n];
                        if (n === "pace") return [paceFmt(Number(v)), "Pace"];
                        if (n === "hr") return [`${Math.round(Number(v))} bpm`, "HR"];
                        if (n === "cadence") return [`${Math.round(Number(v))} spm`, "Cadence"];
                        if (n === "elev") return [`${Math.round(Number(v))} m`, "Elevation"];
                        if (n === "vo") return [`${Number(v).toFixed(1)} cm`, "Vert Osc"];
                        if (n === "gct") return [`${Math.round(Number(v))} ms`, "Gnd Contact"];
                        return [v, n];
                      }}
                    />

                    <Legend />

                    {mode === "trace" &&
                      visibleBands.map((b, i) => (
                        <ReferenceArea
                          key={i}
                          x1={b[xKey === "t" ? "t1" : "d1"]}
                          x2={b[xKey === "t" ? "t2" : "d2"]}
                          yAxisId="hr"
                          fill={STEP_COLORS[b.kind] ?? "transparent"}
                          stroke={STEP_STROKE[b.kind]}
                          strokeOpacity={0.35}
                          strokeDasharray="2 2"
                        />
                      ))}

                    {enabled.hr && hasMetric.hr && (
                      <Line
                        yAxisId="hr"
                        dataKey="hr"
                        stroke="#ef4444"
                        dot={false}
                        type="monotone"
                        connectNulls
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    )}

                    {enabled.pace && hasMetric.pace && (
                      <Line
                        yAxisId="pace"
                        dataKey="pace"
                        stroke="#3b82f6"
                        dot={false}
                        type="monotone"
                        connectNulls
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    )}

                    {enabled.cadence && hasMetric.cadence && (
                      <Line
                        yAxisId="cadence"
                        dataKey="cadence"
                        stroke="#8b5cf6"
                        dot={false}
                        type="monotone"
                        connectNulls
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    )}

                    {enabled.elev && hasMetric.elev && (
                      <Line
                        yAxisId="elev"
                        dataKey="elev"
                        stroke="#10b981"
                        dot={false}
                        type="monotone"
                        connectNulls
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    )}

                    {enabled.vo && hasMetric.vo && (
                      <Line
                        yAxisId="vo"
                        dataKey="vo"
                        stroke="#f97316"
                        dot={false}
                        type="monotone"
                        connectNulls={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    )}

                    {enabled.gct && hasMetric.gct && (
                      <Line
                        yAxisId="gct"
                        dataKey="gct"
                        stroke="#a855f7"
                        dot={false}
                        type="monotone"
                        connectNulls={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : modeType === "interval" ? (
              <div className="h-[220px] w-full rounded border border-dashed flex flex-col items-center justify-center text-sm text-muted-foreground">
                <div>{traceBuildFailed ? "Trace rendering failed safely" : "Interval summary mode"}</div>
                <div className="text-xs mt-1 text-center max-w-md">
                  {traceBuildFailed
                    ? "This FIT session has raw data, but the detailed trace could not be rendered. Interval and recovery analysis can still be reviewed below."
                    : "No raw trace is available, but interval and recovery analysis can still be reviewed below."}
                </div>
              </div>
            ) : (
              <div className="h-[220px] w-full rounded border border-dashed flex flex-col items-center justify-center text-sm text-muted-foreground">
                <div>No detailed trace available for this session</div>
                <div className="text-xs mt-1">
                  {hasRepData
                    ? "This session has results recorded, but not enough chartable metrics."
                    : "This session was entered manually without file-based or rep-level data."}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              {Object.entries(STEP_STROKE).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-3 rounded-sm"
                    style={{
                      background: STEP_COLORS[k],
                      border: `1px dashed ${c}`,
                    }}
                  />
                  <span className="capitalize text-muted-foreground">{k}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {modeType === "interval" && manualRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Interval summary</CardTitle>
              <CardDescription>Rep-level performance for manually entered session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-2">
                {manualRows.map((r: any, i: number) => {
                  const label =
                    r.rep_number != null
                      ? `${(r.set_number ?? 1) > 1 ? `Set ${r.set_number} · ` : ""}Rep ${r.rep_number}`
                      : `Row ${i + 1}`;

                  const parts = [
                    r.actual_time_seconds != null ? `${Math.round(Number(r.actual_time_seconds))}s` : null,
                    r.actual_distance_m != null ? `${Math.round(Number(r.actual_distance_m))}m` : null,
                    r.hr_avg != null ? `${Math.round(Number(r.hr_avg))} bpm` : null,
                  ].filter(Boolean);

                  return (
                    <div key={i} className="flex justify-between border rounded px-3 py-2">
                      <span>{label}</span>
                      <span className="text-muted-foreground">{parts.length ? parts.join(" · ") : "—"}</span>
                    </div>
                  );
                })}
              </div>

              {manualAvgHr != null && (
                <div className="text-sm border rounded px-3 py-2 flex justify-between">
                  <span className="font-medium">Average HR</span>
                  <span>{manualAvgHr} bpm</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {recoveryRows.length >= 2 && <RecoveryPanel rows={recoveryRows} />}
        {Array.isArray(gpsPoints) &&
          gpsPoints.filter((p: any) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)).length >= 2 && (
            <MapPanel points={gpsPoints.filter((p: any) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))} />
          )}

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Stat label="Distance" value={metersFmt(session.total_distance_m)} />
              <Stat label="Duration" value={secToClock(session.total_time_seconds)} />
              <Stat label="Avg HR" value={session.avg_hr ? `${session.avg_hr} bpm` : "—"} />
              <Stat label="RPE" value={session.rpe != null ? String(session.rpe) : "—"} />
              <Stat label="Completion" value={session.completion_pct != null ? `${session.completion_pct}%` : "—"} />
            </div>
          </CardContent>
        </Card>

        <WorkSegmentPanel steps={safeSteps} results={safeResults} rawPoints={safeRawPoints} />

        <SplitsTable
          points={
            Array.isArray(rawPoints)
              ? rawPoints.filter((p: any) => p && (p.elapsed_s != null || p.distance_m != null))
              : []
          }
          results={safeResults}
          steps={safeSteps}
        />

        {showContinuousFatigueCard && (
          <Card>
            <CardHeader>
              <CardTitle>Run fatigue analysis</CardTitle>
              <CardDescription>Continuous-run drift analysis from uploaded trace data.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  computeFatigue({ data: { sessionId } })
                    .then(() => window.location.reload())
                    .catch((err) => console.error("recompute fatigue error:", err))
                }
              >
                Recompute run fatigue
              </Button>
            </CardContent>
          </Card>
        )}

        {showIntervalFatigueHint && (
          <Card>
            <CardHeader>
              <CardTitle>Fatigue insight</CardTitle>
              <CardDescription>Based on interval performance (manual session)</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Continuous fatigue analysis requires uploaded activity data. Interval-based trends can still be reviewed
              using rep times, heart rate, and recovery metrics above.
            </CardContent>
          </Card>
        )}

        {continuousFatigue && !isIntervals && (
          <Card>
            <CardHeader>
              <CardTitle>Overall run fatigue</CardTitle>
              <CardDescription>Continuous drift method</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between border rounded px-3 py-2">
                <span className="font-medium">Efficiency score</span>
                <span className="tabular-nums">{continuousFatigue.efficiency_score ?? "—"}/100</span>
              </div>
              <div className="flex justify-between border rounded px-3 py-2 text-muted-foreground">
                <span>HR drift</span>
                <span>
                  {continuousFatigue.hr_drift_bpm != null
                    ? `${Number(continuousFatigue.hr_drift_bpm).toFixed(1)} bpm`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between border rounded px-3 py-2 text-muted-foreground">
                <span>Pace drift</span>
                <span>
                  {continuousFatigue.pace_drift_pct != null
                    ? `${Number(continuousFatigue.pace_drift_pct).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {repFatigue.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Per-step fatigue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {repFatigue.map((f: any) => {
                const step = safeSteps.find((s: any) => s.id === f.step_id);
                return (
                  <div key={f.step_id} className="flex flex-wrap justify-between gap-2 border rounded px-3 py-2">
                    <span className="font-medium capitalize">{step?.kind ?? "step"}</span>
                    <span className="text-muted-foreground">
                      eff {f.efficiency_score ?? "—"} · pace drift{" "}
                      {f.pace_drift_pct != null ? `${Number(f.pace_drift_pct).toFixed(1)}%` : "—"} · HR drift{" "}
                      {f.hr_drift_bpm != null ? `${Number(f.hr_drift_bpm).toFixed(0)} bpm` : "—"}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <ZonePanel rows={safeZoneTime.filter((r: any) => r.source === "pace")} title="Pace zones" />
        <ZonePanel rows={safeZoneTime.filter((r: any) => r.source === "hr")} title="HR zones" />
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function RecoveryPanel({
  rows,
}: {
  rows: { x: number; label: string; hrEnd: number; hrRec: number; hrDrop: number }[];
}) {
  const best = Math.max(...rows.map((r) => r.hrDrop));
  const worst = Math.min(...rows.map((r) => r.hrDrop));
  const avg = Math.round(rows.reduce((a, r) => a + r.hrDrop, 0) / rows.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery between reps</CardTitle>
        <CardDescription>HR end, HR recovery, and HR drop per rep.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Best drop" value={`${best} bpm`} />
          <Stat label="Worst drop" value={`${worst} bpm`} />
          <Stat label="Avg drop" value={`${avg} bpm`} />
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} />
              <YAxis yAxisId="hr" orientation="left" tick={{ fontSize: 11 }} width={36} />
              <YAxis yAxisId="drop" orientation="right" tick={{ fontSize: 11 }} width={42} />
              <Tooltip
                formatter={(v: any, n: any) => {
                  if (n === "hrEnd") return [`${Math.round(Number(v))} bpm`, "HR end"];
                  if (n === "hrRec") return [`${Math.round(Number(v))} bpm`, "HR rec"];
                  if (n === "hrDrop") return [`${Math.round(Number(v))} bpm`, "HR drop"];
                  return [v, n];
                }}
                labelFormatter={(v) => `Rep ${v}`}
              />
              <Legend />
              <Line
                yAxisId="hr"
                dataKey="hrEnd"
                stroke="#ef4444"
                dot={false}
                type="monotone"
                strokeWidth={2}
                isAnimationActive={false}
                name="HR end"
              />
              <Line
                yAxisId="hr"
                dataKey="hrRec"
                stroke="#64748b"
                dot={false}
                type="monotone"
                strokeWidth={2}
                isAnimationActive={false}
                name="HR rec"
              />
              <Line
                yAxisId="drop"
                dataKey="hrDrop"
                stroke="#10b981"
                dot={false}
                type="monotone"
                strokeWidth={2}
                isAnimationActive={false}
                name="HR drop"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkSegmentPanel({ steps, results, rawPoints }: { steps: any[]; results: any[]; rawPoints: any[] }) {
  // ✅ Build corrected rep-aligned splits
  const repSplits = buildSplitsFromResults(results, steps, rawPoints).filter(
    (r) => r.type === "work" || r.type === "strides",
  );

  if (repSplits.length === 0) return null;

  // ✅ Aggregate stats (from corrected data)
  const totalTime = repSplits.reduce((a, r) => a + (r.durationS ?? 0), 0);
  const totalDist = repSplits.reduce((a, r) => a + (r.distanceM ?? 0), 0);

  const avgPace = totalDist > 0 ? (totalTime / totalDist) * 1000 : null;

  const hrs = repSplits.map((r) => r.avgHr).filter((x: any) => typeof x === "number");

  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;

  const maxHr = repSplits.reduce((m, r) => Math.max(m, Number(r.maxHr ?? 0)), 0) || null;

  const cads = repSplits.map((r) => r.avgCad).filter((x: any) => x);

  const avgCad = cads.length ? Math.round(cads.reduce((a: number, b: number) => a + Number(b), 0) / cads.length) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Work segment breakdown</CardTitle>
        <CardDescription>Aggregated from work reps only — excludes warmup, recovery, and cooldown.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ✅ Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Work distance" value={metersFmt(totalDist)} />
          <Stat label="Work duration" value={secToClock(totalTime)} />
          <Stat label="Avg pace" value={avgPace ? `${paceFmt(avgPace)} /km` : "—"} />
          <Stat label="Avg HR" value={avgHr ? `${avgHr} bpm` : "—"} />
          <Stat label="Max HR" value={maxHr ? `${maxHr} bpm` : "—"} />
          <Stat label="Avg cadence" value={avgCad ? `${avgCad} spm` : "—"} />
        </div>

        {/* ✅ Per-rep table */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">Per-rep</div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1 pr-2">Rep</th>
                  <th className="text-right py-1 pr-2">Time</th>
                  <th className="text-right py-1 pr-2">Dist</th>
                  <th className="text-right py-1 pr-2">Pace</th>
                  <th className="text-right py-1 pr-2">HR avg</th>
                  <th className="text-right py-1 pr-2">HR end</th>
                  <th className="text-right py-1 pr-2">HR rec</th>
                  <th className="text-right py-1 pr-2">Drop</th>
                  <th className="text-right py-1 pr-2">Cad</th>
                  <th className="text-right py-1">La</th>
                </tr>
              </thead>

              <tbody>
                {repSplits.map((r) => (
                  <tr key={r.index} className="border-b last:border-b-0">
                    <td className="py-1 pr-2">
                      {r.repLabel ?? `R${r.index}`}
                      {r.adjusted ? " *" : ""}
                    </td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.durationS ? secToClock(r.durationS) : "—"}</td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.distanceM ? metersFmt(r.distanceM) : "—"}</td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.avgPace ? paceFmt(r.avgPace) : "—"}</td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.avgHr ?? "—"}</td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.maxHr ?? "—"}</td>

                    <td className="py-1 pr-2 text-right tabular-nums">—</td>
                    <td className="py-1 pr-2 text-right tabular-nums">—</td>

                    <td className="py-1 pr-2 text-right tabular-nums">{r.avgCad ?? "—"}</td>

                    <td className="py-1 text-right tabular-nums">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ✅ Adjustment legend */}
          <div className="text-[11px] text-muted-foreground mt-2">
            * adjusted = rep exceeded target distance and was corrected using trace (e.g. watch not stopped exactly at
            rep end)
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const ZONE_ORDER = ["z1", "z2", "z3", "z4", "z5"];

const ZONE_LABEL: Record<string, string> = {
  z1: "Z1 Easy",
  z2: "Z2 Aerobic",
  z3: "Z3 Tempo",
  z4: "Z4 VO2/5K",
  z5: "Z5 Rep",
};

function ZonePanel({ rows, title }: { rows: any[]; title: string }) {
  if (rows.length === 0) return null;

  const total = rows.reduce((a, r) => a + Number(r.seconds || 0), 0) || 1;
  const sorted = [...rows].sort((a, b) => ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone));

  const colors: Record<string, string> = {
    z1: "bg-emerald-400",
    z2: "bg-sky-400",
    z3: "bg-amber-400",
    z4: "bg-orange-500",
    z5: "bg-red-500",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
          {sorted.map((r) => (
            <div
              key={r.zone}
              className={colors[r.zone] ?? "bg-muted"}
              style={{ width: `${(Number(r.seconds) / total) * 100}%` }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {sorted.map((r) => (
            <div key={r.zone} className="flex justify-between border rounded px-2 py-1">
              <span>{ZONE_LABEL[r.zone] ?? r.zone}</span>
              <span className="tabular-nums">{secToClock(Number(r.seconds))}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MapPanel({ points }: { points: { lat?: number; lng?: number }[] }) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState<"ready" | "unsupported" | "failed">("ready");

  const safePoints = useMemo(() => {
    return Array.isArray(points)
      ? points.filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
      : [];
  }, [points]);

  function browserSupportsWebGL() {
    if (typeof window === "undefined") return false;

    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return !!gl;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;
    if (safePoints.length < 2) return;

    // ✅ Prevent crash in environments where WebGL is blocked/disabled
    if (!browserSupportsWebGL()) {
      console.warn("MapPanel: WebGL unavailable, skipping map render");
      setMapStatus("unsupported");
      return;
    }

    let cancelled = false;
    let map: maplibregl.Map | null = null;

    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://demotiles.maplibre.org/style.json",
        interactive: true,
      });

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled || !map) return;

        const coords = safePoints.map((p) => [Number(p.lng), Number(p.lat)]);

        const geojson = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {},
        } as const;

        if (map.getSource("route")) {
          try {
            (map.getSource("route") as any).setData(geojson);
          } catch (err) {
            console.error("MapPanel source update error:", err);
          }
        } else {
          map.addSource("route", {
            type: "geojson",
            data: geojson,
          });

          map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            paint: {
              "line-color": "#ef4444",
              "line-width": 3,
            },
          });
        }

        try {
          const bounds = new maplibregl.LngLatBounds([coords[0][0], coords[0][1]], [coords[0][0], coords[0][1]]);

          coords.forEach((c) => bounds.extend([c[0], c[1]]));

          map.fitBounds(bounds, {
            padding: 24,
            duration: 0,
          });
        } catch (err) {
          console.error("MapPanel fitBounds error:", err);
        }
      });

      map.on("error", (e) => {
        console.error("MapPanel map error:", e);
        if (!cancelled) {
          setMapStatus("failed");
        }
      });
    } catch (err) {
      console.error("MapPanel init error:", err);
      if (!cancelled) {
        setMapStatus("failed");
      }
    }

    return () => {
      cancelled = true;
      try {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      } catch (err) {
        console.error("MapPanel cleanup error:", err);
      }
    };
  }, [safePoints]);

  if (safePoints.length < 2) return null;

  if (mapStatus === "unsupported" || mapStatus === "failed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Route map</CardTitle>
          <CardDescription>
            GPS points were found, but the map could not be rendered in this browser environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The session analysis can still be reviewed below without the map.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Route map</CardTitle>
        <CardDescription>GPS trace from uploaded activity data.</CardDescription>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="h-[320px] w-full rounded border" />
      </CardContent>
    </Card>
  );
}

function buildSamples(
  steps: any[],
  results: any[],
  rawPoints: any[],
): {
  samples: Sample[];
  bands: { kind: string; t1: number; t2: number; d1: number; d2: number }[];
  mode: "trace" | "rep" | "empty";
  hasMetric: Record<MetricKey, boolean>;
  gpsPoints: { lat: number; lng: number }[];
} {
  const has: Record<MetricKey, boolean> = {
    hr: false,
    pace: false,
    cadence: false,
    elev: false,
    vo: false,
    gct: false,
  };

  if (Array.isArray(rawPoints) && rawPoints.length > 10) {
    const samples: Sample[] = rawPoints.map((p: any, idx: number) => {
      const rawPace = p.pace_sec_per_km != null ? Number(p.pace_sec_per_km) : undefined;

      const currentT = Number(p.elapsed_s ?? idx);
      const currentD = p.distance_m != null ? Number(p.distance_m) : undefined;

      const prev = idx > 0 ? rawPoints[idx - 1] : null;
      const prevT = prev?.elapsed_s != null ? Number(prev.elapsed_s) : currentT;
      const prevD = prev?.distance_m != null ? Number(prev.distance_m) : (currentD ?? 0);

      const segmentDuration = Math.max(0, currentT - prevT);
      const segmentDistance = Math.max(0, (currentD ?? 0) - prevD);

      let normalizedKind = p.segment_type ?? "work";

      // ✅ Ignore tiny fake cooldown tails at the end of a work-only file
      if (normalizedKind === "cooldown" && segmentDuration < 120 && segmentDistance < 200) {
        normalizedKind = "work";
      }

      const s: Sample = {
        t: currentT,
        d: currentD,
        hr: p.hr != null ? Number(p.hr) : undefined,
        pace: rawPace != null && rawPace <= 600 ? rawPace : undefined,
        cadence: p.cadence != null ? Number(p.cadence) : undefined,
        elev: p.elevation_m != null ? Number(p.elevation_m) : undefined,
        vo:
          p.vertical_oscillation_cm != null && Number(p.vertical_oscillation_cm) > 0
            ? Number(p.vertical_oscillation_cm)
            : undefined,
        gct:
          p.ground_contact_time_ms != null && Number(p.ground_contact_time_ms) > 0
            ? Number(p.ground_contact_time_ms)
            : undefined,
        lat: p.lat != null ? Number(p.lat) : undefined,
        lng: p.lng != null ? Number(p.lng) : undefined,
        stepId: "trace",
        stepKind: normalizedKind,
        repNumber: 1,
      };

      if (s.hr != null) has.hr = true;
      if (s.pace != null) has.pace = true;
      if (s.cadence != null) has.cadence = true;
      if (s.elev != null) has.elev = true;
      if (s.vo != null) has.vo = true;
      if (s.gct != null) has.gct = true;

      return s;
    });

    const gpsPoints = samples
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));

    const bands: { kind: string; t1: number; t2: number; d1: number; d2: number }[] = [];

    if (samples.length > 0) {
      let currentKind = samples[0].stepKind || "work";
      let startT = samples[0].t;
      let startD = samples[0].d ?? 0;

      for (let i = 1; i < samples.length; i++) {
        const kind = samples[i].stepKind || "work";
        if (kind !== currentKind) {
          // ✅ close previous segment safely
          const endSamplePrev = samples[i - 1];
          const durationPrev = endSamplePrev.t - startT;
          const distancePrev = (endSamplePrev.d ?? 0) - startD;

          // 🚫 Skip tiny fake cooldown segments
          if (currentKind === "cooldown" && durationPrev < 120 && distancePrev < 200) {
            // do nothing (skip this band)
          } else {
            bands.push({
              kind: currentKind,
              t1: startT,
              t2: endSamplePrev.t,
              d1: startD,
              d2: endSamplePrev.d ?? startD,
            });
          }

          currentKind = kind;
          startT = samples[i].t;
          startD = samples[i].d ?? startD;
        }
      }

      // ✅ handle final segment safely
      const endSample = samples[samples.length - 1];
      const finalDuration = endSample.t - startT;
      const finalDistance = (endSample.d ?? 0) - startD;

      if (currentKind === "cooldown" && finalDuration < 120 && finalDistance < 200) {
        // 🚫 skip tiny cooldown at end
      } else {
        bands.push({
          kind: currentKind,
          t1: startT,
          t2: endSample.t,
          d1: startD,
          d2: endSample.d ?? startD,
        });
      }

      return {
        samples,
        bands,
        mode: "trace",
        hasMetric: has,
        gpsPoints,
      };
    }
  }

  if (Array.isArray(results) && results.length > 0) {
    const stepOrder = new Map<string, number>();
    steps.forEach((s) => stepOrder.set(s.id, s.step_order ?? 0));

    const sorted = [...results].sort((a, b) => {
      const so = (stepOrder.get(a.step_id) ?? 0) - (stepOrder.get(b.step_id) ?? 0);
      if (so !== 0) return so;
      const ss = (a.set_number ?? 1) - (b.set_number ?? 1);
      if (ss !== 0) return ss;
      return (a.rep_number ?? 0) - (b.rep_number ?? 0);
    });

    let cumulativeDistance = 0;

    const samples: Sample[] = sorted.map((r, idx) => {
      const dist = r.actual_distance_m != null ? Number(r.actual_distance_m) : null;
      if (dist != null && !Number.isNaN(dist)) {
        cumulativeDistance += dist;
      }

      const s: Sample = {
        t: idx + 1,
        d: dist != null ? cumulativeDistance : undefined,
        hr: r.hr_avg ?? r.hr_end ?? undefined,
        hrEnd: r.hr_end ?? undefined,
        hrRec: r.hr_end_recovery ?? undefined,
        hrDrop:
          r.hr_end != null && r.hr_end_recovery != null ? Number(r.hr_end) - Number(r.hr_end_recovery) : undefined,
        pace: r.actual_pace_sec_per_km ?? undefined,
        cadence: r.cadence ?? undefined,
        elev: undefined,
        lat: undefined,
        lng: undefined,
        stepId: r.step_id,
        stepKind: steps.find((st) => st.id === r.step_id)?.kind ?? "work",
        repNumber: r.rep_number ?? idx + 1,
      };

      if (s.hr != null) has.hr = true;
      if (s.pace != null) has.pace = true;
      if (s.cadence != null) has.cadence = true;

      return s;
    });

    return {
      samples,
      bands: [],
      mode: "rep",
      hasMetric: has,
      gpsPoints: [],
    };
  }

  return {
    samples: [],
    bands: [],
    mode: "empty",
    hasMetric: has,
    gpsPoints: [],
  };
}

type SplitRow = {
  index: number;
  type: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  durationS: number;
  distanceM: number;
  avgPace: number | null;
  maxPace: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCad: number | null;
  maxCad: number | null;
  elevGain: number | null;
  elevLoss: number | null;
  repLabel?: string | null;
  adjusted?: boolean;
};

type TraceGroup = {
  type: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  points: any[];
};

function buildTraceGroups(points: any[]): TraceGroup[] {
  if (!Array.isArray(points) || points.length === 0) return [];

  const groups: TraceGroup[] = [];
  let current: any[] = [];
  let currentType: TraceGroup["type"] | null = null;

  for (const p of points) {
    let t = ((p.segment_type ?? "work") as TraceGroup["type"]) || "work";

    if (t !== currentType) {
      if (current.length > 0 && currentType) {
        groups.push({ type: currentType, points: current });
      }
      current = [];
      currentType = t;
    }

    current.push(p);
  }

  if (current.length > 0 && currentType) {
    groups.push({ type: currentType, points: current });
  }

  // remove tiny fake cooldown tails
  return groups.filter((g, idx) => {
    if (g.type !== "cooldown") return true;
    const first = g.points[0];
    const last = g.points[g.points.length - 1];
    const durationS = Math.max(0, Number(last?.elapsed_s ?? 0) - Number(first?.elapsed_s ?? 0));
    const distanceM = Math.max(0, Number(last?.distance_m ?? 0) - Number(first?.distance_m ?? 0));

    if (durationS < 120 && distanceM < 200) {
      return false;
    }

    return true;
  });
}

function computeMetricsFromTraceSlice(slice: any[]) {
  if (!Array.isArray(slice) || slice.length === 0) {
    return {
      durationS: 0,
      distanceM: 0,
      avgPace: null,
      maxPace: null,
      avgHr: null,
      maxHr: null,
      avgCad: null,
      maxCad: null,
      elevGain: null,
      elevLoss: null,
    };
  }

  const first = slice[0];
  const last = slice[slice.length - 1];

  const durationS = Math.max(0, Number(last.elapsed_s ?? 0) - Number(first.elapsed_s ?? 0));
  const distanceM = Math.max(0, Number(last.distance_m ?? 0) - Number(first.distance_m ?? 0));

  const hrs = slice.map((p) => p.hr).filter((x: any): x is number => typeof x === "number" && x > 0);

  const paces = slice
    .map((p) => p.pace_sec_per_km)
    .filter((x: any): x is number => typeof x === "number" && x > 0 && x <= 900);

  const cads = slice.map((p) => p.cadence).filter((x: any): x is number => typeof x === "number" && x > 0);

  let gain = 0;
  let loss = 0;
  let haveElev = false;

  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1].elevation_m;
    const b = slice[i].elevation_m;

    if (typeof a === "number" && typeof b === "number") {
      haveElev = true;
      const d = b - a;
      if (d > 0) gain += d;
      else loss += -d;
    }
  }

  const avgPace =
    distanceM > 0 && durationS > 0
      ? (durationS / distanceM) * 1000
      : paces.length
        ? paces.reduce((a, b) => a + b, 0) / paces.length
        : null;

  return {
    durationS,
    distanceM,
    avgPace,
    maxPace: paces.length ? Math.min(...paces) : null,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgCad: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    maxCad: cads.length ? Math.max(...cads) : null,
    elevGain: haveElev ? Math.round(gain) : null,
    elevLoss: haveElev ? Math.round(loss) : null,
  };
}

function trimTraceGroupToDistance(group: any[], targetDistanceM: number) {
  if (!Array.isArray(group) || group.length === 0 || !targetDistanceM || targetDistanceM <= 0) {
    return computeMetricsFromTraceSlice(group);
  }

  const startDistance = Number(group[0]?.distance_m ?? 0);
  const targetAbsolute = startDistance + targetDistanceM;

  const slice: any[] = [group[0]];

  for (let i = 1; i < group.length; i++) {
    const p = group[i];
    slice.push(p);

    const d = Number(p?.distance_m ?? 0);
    if (d >= targetAbsolute) break;
  }

  return computeMetricsFromTraceSlice(slice);
}

function buildSplitsFromResults(results: any[], steps: any[], rawPoints: any[]): SplitRow[] {
  if (!Array.isArray(results) || results.length === 0) return [];

  const stepMap = new Map<string, any>();
  (steps ?? []).forEach((s: any) => stepMap.set(s.id, s));

  const sortedResults = [...results].sort((a, b) => {
    const aStep = stepMap.get(a.step_id);
    const bStep = stepMap.get(b.step_id);

    const stepOrderDiff = Number(aStep?.step_order ?? 0) - Number(bStep?.step_order ?? 0);
    if (stepOrderDiff !== 0) return stepOrderDiff;

    const setDiff = Number(a.set_number ?? 1) - Number(b.set_number ?? 1);
    if (setDiff !== 0) return setDiff;

    return Number(a.rep_number ?? 0) - Number(b.rep_number ?? 0);
  });

  const traceGroups = buildTraceGroups(rawPoints);
  const traceWorkGroups = traceGroups.filter((g) => g.type === "work" || g.type === "strides");
  const traceRecoveryGroups = traceGroups.filter((g) => g.type === "recovery");

  let workTraceIdx = 0;
  let recoveryTraceIdx = 0;
  let rowIndex = 1;

  const rows: SplitRow[] = [];

  for (const r of sortedResults) {
    const step = stepMap.get(r.step_id);
    const kind = (step?.kind ?? "work") as SplitRow["type"];

    const repLabel =
      kind === "work" || kind === "strides"
        ? `${(r.set_number ?? 1) > 1 ? `S${r.set_number} ` : ""}R${r.rep_number ?? rowIndex}`
        : null;

    const recordedDuration = Number(r.actual_time_seconds ?? 0);
    const recordedDistance = Number(r.actual_distance_m ?? 0);
    const recordedPace =
      r.actual_pace_sec_per_km != null
        ? Number(r.actual_pace_sec_per_km)
        : recordedDuration > 0 && recordedDistance > 0
          ? (recordedDuration / recordedDistance) * 1000
          : null;

    let finalMetrics = {
      durationS: Math.max(0, recordedDuration),
      distanceM: Math.max(0, recordedDistance),
      avgPace: recordedPace,
      maxPace: recordedPace,
      avgHr: r.hr_avg != null ? Number(r.hr_avg) : null,
      maxHr: r.hr_end != null ? Number(r.hr_end) : null,
      avgCad: r.cadence != null ? Number(r.cadence) : null,
      maxCad: r.cadence != null ? Number(r.cadence) : null,
      elevGain: null as number | null,
      elevLoss: null as number | null,
    };

    let adjusted = false;

    // ✅ Advanced correction:
    // If this is a work rep with a target distance and the recorded distance overruns materially,
    // recompute from the matching raw trace work chunk trimmed to target distance.
    if ((kind === "work" || kind === "strides") && step?.target_kind === "distance" && step?.target_distance_m) {
      const targetDistance = Number(step.target_distance_m);
      const recordedOverrun =
        recordedDistance > 0 && targetDistance > 0 ? recordedDistance > targetDistance * 1.05 : false;

      const matchingTraceGroup = traceWorkGroups[workTraceIdx];

      if (matchingTraceGroup?.points?.length) {
        if (recordedOverrun) {
          finalMetrics = trimTraceGroupToDistance(matchingTraceGroup.points, targetDistance);
          adjusted = true;
        } else {
          const traceMetrics = computeMetricsFromTraceSlice(matchingTraceGroup.points);

          // Prefer trace-derived support metrics if distance is broadly sane
          finalMetrics = {
            durationS: finalMetrics.durationS || traceMetrics.durationS,
            distanceM: finalMetrics.distanceM || traceMetrics.distanceM,
            avgPace: finalMetrics.avgPace ?? traceMetrics.avgPace,
            maxPace: traceMetrics.maxPace,
            avgHr: finalMetrics.avgHr ?? traceMetrics.avgHr,
            maxHr: finalMetrics.maxHr ?? traceMetrics.maxHr,
            avgCad: finalMetrics.avgCad ?? traceMetrics.avgCad,
            maxCad: finalMetrics.maxCad ?? traceMetrics.maxCad,
            elevGain: traceMetrics.elevGain,
            elevLoss: traceMetrics.elevLoss,
          };
        }
      }

      if (matchingTraceGroup) {
        workTraceIdx += 1;
      }
    }

    rows.push({
      index: rowIndex++,
      type: kind,
      durationS: finalMetrics.durationS,
      distanceM: finalMetrics.distanceM,
      avgPace: finalMetrics.avgPace,
      maxPace: finalMetrics.maxPace,
      avgHr: finalMetrics.avgHr,
      maxHr: finalMetrics.maxHr,
      avgCad: finalMetrics.avgCad,
      maxCad: finalMetrics.maxCad,
      elevGain: finalMetrics.elevGain,
      elevLoss: finalMetrics.elevLoss,
      repLabel,
      adjusted,
    });

    // Recovery row, anchored to structured recovery first, with trace support second
    const recoveryDuration = Number(r.recovery_time_seconds ?? 0);
    const recoveryDistance = Number(r.recovery_distance_m ?? 0);
    const recoveryHr = r.hr_end_recovery != null ? Number(r.hr_end_recovery) : null;

    const matchingRecoveryGroup = traceRecoveryGroups[recoveryTraceIdx];
    const recoveryTraceMetrics = matchingRecoveryGroup?.points?.length
      ? computeMetricsFromTraceSlice(matchingRecoveryGroup.points)
      : null;

    if (recoveryDuration > 0 || recoveryDistance > 0 || recoveryHr != null || recoveryTraceMetrics) {
      const finalRecoveryDuration = recoveryDuration > 0 ? recoveryDuration : (recoveryTraceMetrics?.durationS ?? 0);
      const finalRecoveryDistance = recoveryDistance > 0 ? recoveryDistance : (recoveryTraceMetrics?.distanceM ?? 0);

      const recoveryPace =
        finalRecoveryDuration > 0 && finalRecoveryDistance > 0
          ? (finalRecoveryDuration / finalRecoveryDistance) * 1000
          : (recoveryTraceMetrics?.avgPace ?? null);

      rows.push({
        index: rowIndex++,
        type: "recovery",
        durationS: finalRecoveryDuration,
        distanceM: finalRecoveryDistance,
        avgPace: recoveryPace,
        maxPace: recoveryTraceMetrics?.maxPace ?? recoveryPace ?? null,
        avgHr: recoveryHr ?? recoveryTraceMetrics?.avgHr ?? null,
        maxHr: recoveryHr ?? recoveryTraceMetrics?.maxHr ?? null,
        avgCad: recoveryTraceMetrics?.avgCad ?? null,
        maxCad: recoveryTraceMetrics?.maxCad ?? null,
        elevGain: recoveryTraceMetrics?.elevGain ?? null,
        elevLoss: recoveryTraceMetrics?.elevLoss ?? null,
        repLabel: repLabel ? `${repLabel} Rec` : null,
        adjusted: false,
      });

      if (matchingRecoveryGroup) {
        recoveryTraceIdx += 1;
      }
    }
  }

  return rows.filter((row) => row.durationS >= 5 || row.distanceM >= 10 || row.avgHr != null);
}

function buildSplitsFromTrace(points: any[]): SplitRow[] {
  if (!Array.isArray(points) || points.length === 0) return [];

  const groups = buildTraceGroups(points);

  return groups
    .map((g, idx) => {
      const metrics = computeMetricsFromTraceSlice(g.points);

      return {
        index: idx + 1,
        type: g.type,
        durationS: metrics.durationS,
        distanceM: metrics.distanceM,
        avgPace: metrics.avgPace,
        maxPace: metrics.maxPace,
        avgHr: metrics.avgHr,
        maxHr: metrics.maxHr,
        avgCad: metrics.avgCad,
        maxCad: metrics.maxCad,
        elevGain: metrics.elevGain,
        elevLoss: metrics.elevLoss,
        repLabel: null,
        adjusted: false,
      } as SplitRow;
    })
    .filter((row) => row.durationS >= 5 || row.distanceM >= 10 || row.avgHr != null);
}

function buildSplits(points: any[], results?: any[], steps?: any[]): SplitRow[] {
  const resultBased = buildSplitsFromResults(results ?? [], steps ?? [], points ?? []);
  if (resultBased.length > 0) return resultBased;
  return buildSplitsFromTrace(points ?? []);
}

function SplitsTable({ points, results, steps }: { points: any[]; results: any[]; steps: any[] }) {
  const rows = useMemo(() => buildSplits(points, results, steps), [points, results, steps]);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workout splits</CardTitle>
        <CardDescription>
          Rep-aligned splits from structured results, with smart trace correction for overruns and recovery shown
          between reps.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">Type</th>
                <th className="text-left py-1 pr-2">Label</th>
                <th className="text-right py-1 pr-2">Dist</th>
                <th className="text-right py-1 pr-2">Time</th>
                <th className="text-right py-1 pr-2">Avg pace</th>
                <th className="text-right py-1 pr-2">Max pace</th>
                <th className="text-right py-1 pr-2">Avg HR</th>
                <th className="text-right py-1 pr-2">Max HR</th>
                <th className="text-right py-1 pr-2">Avg cad</th>
                <th className="text-right py-1 pr-2">Max cad</th>
                <th className="text-right py-1 pr-2">↑</th>
                <th className="text-right py-1">↓</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.index}-${r.type}-${r.repLabel ?? ""}`}
                  className="border-b last:border-b-0"
                  style={{
                    backgroundColor: STEP_COLORS[r.type] ?? "transparent",
                    color: "#e5e7eb",
                    borderLeft: `3px solid ${STEP_STROKE[r.type] ?? "#444"}`,
                  }}
                >
                  <td className="py-1 pr-2 tabular-nums">{r.index}</td>
                  <td className="py-1 pr-2 capitalize">{r.type}</td>
                  <td className="py-1 pr-2">
                    {r.repLabel ?? "—"}
                    {r.adjusted ? " *" : ""}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.distanceM > 0 ? metersFmt(r.distanceM) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.durationS > 0 ? secToClock(r.durationS) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.avgPace ? paceFmt(r.avgPace) : "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.maxPace ? paceFmt(r.maxPace) : "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.avgHr ?? "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.maxHr ?? "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.avgCad ?? "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.maxCad ?? "—"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.elevGain != null ? `${r.elevGain}m` : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{r.elevLoss != null ? `${r.elevLoss}m` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-[11px] text-muted-foreground mt-2">
            * adjusted = recorded rep overran target distance, so pace/distance/time were corrected from the trace to
            the planned rep target.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
