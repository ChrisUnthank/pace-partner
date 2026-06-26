import { createFileRoute, Link } from "@tanstack/react-router";
("@tanstack/react-query");
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

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions").select("*, athletes(name)").eq("id", sessionId).single();

      if (error) throw error;
      return data;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["steps", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("steps").select("*").eq("session_id", sessionId).order("step_order");

      if (error) throw error;
      return data ?? [];
    },
  });

  const stepIds = Array.isArray(steps) ? steps.map((s: any) => s.id) : [];

  const { data: results } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results")
        .select("*")
        .in("step_id", stepIds)
        .order("set_number")
        .order("rep_number");

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["zone-time", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_zone_time")
        .select("zone, seconds, source")
        .eq("session_id", sessionId);

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: fatigue } = useQuery({
    queryKey: ["fatigue", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("session_fatigue").select("*").eq("session_id", sessionId);

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rawPoints } = useQuery({
    queryKey: ["raw-points", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_session_points")
        .select(
          "elapsed_s, distance_m, hr, pace_sec_per_km, cadence, elevation_m, lat, lng, segment_type, vertical_oscillation_cm, ground_contact_time_ms",
        )
        .eq("session_id", sessionId)
        .order("elapsed_s", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });

  const safeSteps = Array.isArray(steps) ? steps : [];
  const safeResults = Array.isArray(results) ? results : [];
  const safeZoneTime = Array.isArray(zoneTime) ? zoneTime : [];
  const safeFatigue = Array.isArray(fatigue) ? fatigue : [];
  const safeRawPoints = Array.isArray(rawPoints) ? rawPoints : [];

  const computeFatigue = useServerFn(computeContinuousFatigue);

  const { samples, bands, mode, hasMetric, gpsPoints } = useMemo(
    () => buildSamples(safeSteps, safeResults, safeRawPoints),
    [safeSteps, safeResults, safeRawPoints],
  );

  const availableScopes = useMemo(() => {
    const kinds = new Set(samples.map((s) => s.stepKind).filter(Boolean));
    return SCOPE_OPTIONS.filter((k) => k === "full" || kinds.has(k));
  }, [samples]);

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

  const continuousFatigue = safeFatigue.find((f: any) => f.method === "continuous_drift");
  const repFatigue = safeFatigue.filter((f: any) => f.method !== "continuous_drift");

  const isIntervals = session?.structure === "intervals";
  const showContinuousFatigueCard = hasRaw && !isIntervals;

  useEffect(() => {
    if (!session) return;
    if (session.structure !== "continuous") return;
    if (!hasRaw) return;
    if (continuousFatigue) return;

    computeFatigue({ data: { sessionId } }).catch(() => {});
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

  if (!session) {
    return (
      <AppShell>
        <p>Loading…</p>
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
                  {mode === "trace"
                    ? "High-resolution trace"
                    : mode === "rep"
                      ? "Rep summary view"
                      : "No detailed trace available for this session"}
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
              {availableScopes.map((k) => (
                <Button key={k} size="sm" variant={scope === k ? "default" : "outline"} onClick={() => setScope(k)}>
                  {SCOPE_LABELS[k]}
                </Button>
              ))}
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
            {hasGraphData ? (
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

        {recoveryRows.length >= 2 && <RecoveryPanel rows={recoveryRows} />}

        {gpsPoints.length >= 2 && <MapPanel points={gpsPoints} />}

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

        <WorkSegmentPanel steps={safeSteps} results={safeResults} />

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
                onClick={() => computeFatigue({ data: { sessionId } }).then(() => window.location.reload())}
              >
                Recompute run fatigue
              </Button>
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

function WorkSegmentPanel({ steps, results }: { steps: any[]; results: any[] }) {
  const workStepIds = new Set(steps.filter((s) => s.kind === "work").map((s) => s.id));

  const workResults = results.filter(
    (r) => workStepIds.has(r.step_id) && (r.actual_time_seconds || r.actual_distance_m),
  );

  if (workResults.length === 0) return null;

  const totalTime = workResults.reduce((a, r) => a + Number(r.actual_time_seconds ?? 0), 0);
  const totalDist = workResults.reduce((a, r) => a + Number(r.actual_distance_m ?? 0), 0);
  const hrSec = workResults.reduce((a, r) => a + (r.hr_avg ? Number(r.actual_time_seconds ?? 0) : 0), 0);
  const hrWeighted = workResults.reduce(
    (a, r) => a + (r.hr_avg ? Number(r.hr_avg) * Number(r.actual_time_seconds ?? 0) : 0),
    0,
  );

  const avgHr = hrSec > 0 ? Math.round(hrWeighted / hrSec) : null;
  const maxHr = workResults.reduce((m, r) => Math.max(m, Number(r.hr_max ?? r.hr_end ?? 0)), 0) || null;

  const cads = workResults.map((r) => r.cadence).filter((x: any) => x);
  const avgCad = cads.length ? Math.round(cads.reduce((a: number, b: number) => a + Number(b), 0) / cads.length) : null;

  const avgPace = totalDist > 0 ? (totalTime / totalDist) * 1000 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Work segment breakdown</CardTitle>
        <CardDescription>Aggregated from work reps only — excludes warmup, recovery, and cooldown.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Work distance" value={metersFmt(totalDist)} />
          <Stat label="Work duration" value={secToClock(totalTime)} />
          <Stat label="Avg pace" value={avgPace ? `${paceFmt(avgPace)} /km` : "—"} />
          <Stat label="Avg HR" value={avgHr ? `${avgHr} bpm` : "—"} />
          <Stat label="Max HR" value={maxHr ? `${maxHr} bpm` : "—"} />
          <Stat label="Avg cadence" value={avgCad ? `${avgCad} spm` : "—"} />
        </div>

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
                {workResults.map((r) => {
                  const p =
                    r.actual_pace_sec_per_km ??
                    (r.actual_time_seconds && r.actual_distance_m
                      ? (r.actual_time_seconds / r.actual_distance_m) * 1000
                      : null);

                  const drop =
                    r.hr_end != null && r.hr_end_recovery != null ? Number(r.hr_end) - Number(r.hr_end_recovery) : null;

                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-1 pr-2">
                        {(r.set_number ?? 1) > 1 ? `S${r.set_number} ` : ""}R{r.rep_number}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {r.actual_time_seconds ? secToClock(r.actual_time_seconds) : "—"}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {r.actual_distance_m ? metersFmt(r.actual_distance_m) : "—"}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{p ? paceFmt(p) : "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.hr_avg ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.hr_end ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.hr_end_recovery ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{drop ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.cadence ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">
                        {r.lactate_taken && r.lactate_mmol != null ? Number(r.lactate_mmol).toFixed(1) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

function MapPanel({ points }: { points: { lat: number; lng: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !points.length) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [points[0].lng, points[0].lat],
      zoom: 13,
    });

    map.on("load", () => {
      const coords = points.map((p) => [p.lng, p.lat]);

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords as any },
        },
      });

      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ef4444", "line-width": 4 },
      });

      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(coords[0] as any, coords[0] as any),
      );

      map.fitBounds(bounds, { padding: 30, duration: 0 });
    });

    return () => map.remove();
  }, [points]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Route</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={ref} className="h-[320px] w-full rounded overflow-hidden" />
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

      const s: Sample = {
        t: Number(p.elapsed_s ?? idx),
        d: p.distance_m != null ? Number(p.distance_m) : undefined,
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
        stepKind: p.segment_type ?? "work",
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
          bands.push({
            kind: currentKind,
            t1: startT,
            t2: samples[i - 1].t,
            d1: startD,
            d2: samples[i - 1].d ?? startD,
          });
          currentKind = kind;
          startT = samples[i].t;
          startD = samples[i].d ?? startD;
        }
      }

      bands.push({
        kind: currentKind,
        t1: startT,
        t2: samples[samples.length - 1].t,
        d1: startD,
        d2: samples[samples.length - 1].d ?? startD,
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
