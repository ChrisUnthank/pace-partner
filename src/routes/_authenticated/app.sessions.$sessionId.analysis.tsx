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
import { Badge } from "@/components/ui/badge";
import { secToClock, metersFmt, paceFmt } from "@/lib/format";
import { sessionClassificationLabel } from "@/lib/session-categories";
import { useServerFn } from "@tanstack/react-start";
import { computeContinuousFatigue } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId/analysis")({
  component: SessionAnalysis,
});

type Sample = {
  t: number; // seconds from session start
  d?: number; // meters from session start
  hr?: number;
  pace?: number;
  cadence?: number;
  elev?: number;
  lat?: number;
  lng?: number;
  stepId: string;
  stepKind: string;
  repNumber: number;
};

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
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

function SessionAnalysis() {
  const { sessionId } = Route.useParams();
  const [enabled, setEnabled] = useState<Record<MetricKey, boolean>>({
    hr: true, pace: true, cadence: false, elev: false,
  });
  const [xMode, setXMode] = useState<"time" | "distance">("time");

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions").select("*, athletes(name)").eq("id", sessionId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["steps", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps").select("*").eq("session_id", sessionId).order("step_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stepIds = (steps ?? []).map((s: any) => s.id);
  const { data: results } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results").select("*").in("step_id", stepIds)
        .order("set_number").order("rep_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["zone-time", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_zone_time").select("zone, seconds, source").eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: fatigue } = useQuery({
    queryKey: ["fatigue", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("session_fatigue").select("*").eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: rawPoints } = useQuery({
    queryKey: ["raw-points", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("raw_session_points")
        .select("elapsed_s, hr, pace_sec_per_km, cadence, elevation_m, lat, lng, segment_type")
        .eq("session_id", sessionId).order("elapsed_s").limit(5000);
      return data ?? [];
    },
  });

  const computeFatigue = useServerFn(computeContinuousFatigue);

  const { samples, bands, mode, hasMetric, gpsPoints } = useMemo(
    () => buildSamples(steps ?? [], results ?? []),
    [steps, results],
  );

  const xCanUseDistance = samples.length > 0 && samples.every((s) => s.d != null);
  const xKey: keyof Sample = xMode === "distance" && xCanUseDistance ? "d" : "t";

  // Build per-metric series so React doesn't have to skip nulls
  const seriesData = useMemo(() => {
    return samples.map((s) => ({
      x: (s[xKey] as number) ?? 0,
      stepKind: s.stepKind,
      hr: s.hr,
      pace: s.pace,
      cadence: s.cadence,
      elev: s.elev,
    }));
  }, [samples, xKey]);

  if (!session) return <AppShell><p>Loading…</p></AppShell>;

  const noResults = (results ?? []).length === 0;
  const hasRaw = (rawPoints ?? []).length > 0;
  const continuousFatigue = (fatigue ?? []).find((f: any) => f.method === "continuous_drift");
  const repFatigue = (fatigue ?? []).filter((f: any) => f.method !== "continuous_drift");

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <Link to="/app/sessions/$sessionId" params={{ sessionId }}
            className="text-sm text-muted-foreground underline">← Back to details</Link>
          <h1 className="text-2xl font-bold mt-2">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.session_date} · {session.athletes?.name} · {sessionClassificationLabel(session as any)}
            {session.completed_at && <span className="ml-2 text-emerald-600">Completed</span>}
          </p>
        </div>

        {noResults && !hasRaw ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Detailed analysis available after device sync (coming in the next phase).{" "}
              For now, see{" "}
              <Link to="/app/sessions/$sessionId" params={{ sessionId }} className="underline">
                the session detail
              </Link>{" "}
              for logged totals and per-rep entries.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Session graph</CardTitle>
                  <CardDescription>
                    {mode === "trace" ? "High-resolution trace" : "Summary view — no high-res trace recorded"}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant={xKey === "t" ? "default" : "outline"}
                    onClick={() => setXMode("time")}>Time</Button>
                  <Button size="sm" variant={xKey === "d" ? "default" : "outline"}
                    disabled={!xCanUseDistance}
                    onClick={() => setXMode("distance")}>Distance</Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {METRICS.map((m) => {
                  const avail = hasMetric[m.key];
                  return (
                    <Button key={m.key} size="sm"
                      variant={enabled[m.key] && avail ? "default" : "outline"}
                      disabled={!avail}
                      title={!avail ? "no data" : ""}
                      onClick={() => setEnabled((p) => ({ ...p, [m.key]: !p[m.key] }))}>
                      <span className="h-2 w-2 rounded-full mr-1.5 inline-block"
                        style={{ background: m.color }} />
                      {m.label}
                    </Button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={seriesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => xKey === "t" ? secToClock(v) : metersFmt(v)}
                    />
                    <YAxis yAxisId="hr" orientation="left" hide={!enabled.hr || !hasMetric.hr}
                      tick={{ fontSize: 11 }} width={36} />
                    <YAxis yAxisId="pace" orientation="right" hide={!enabled.pace || !hasMetric.pace}
                      reversed tick={{ fontSize: 11 }} width={48}
                      tickFormatter={(v) => secToClock(v)} />
                    <YAxis yAxisId="cadence" orientation="left" hide={!enabled.cadence || !hasMetric.cadence}
                      tick={{ fontSize: 11 }} width={32} />
                    <YAxis yAxisId="elev" orientation="right" hide={!enabled.elev || !hasMetric.elev}
                      tick={{ fontSize: 11 }} width={32} />
                    <Tooltip
                      labelFormatter={(v) => xKey === "t" ? secToClock(Number(v)) : metersFmt(Number(v))}
                      formatter={(v: any, n: any) => {
                        if (n === "pace") return [paceFmt(Number(v)), "Pace"];
                        if (n === "hr") return [`${Math.round(Number(v))} bpm`, "HR"];
                        if (n === "cadence") return [`${Math.round(Number(v))} spm`, "Cadence"];
                        if (n === "elev") return [`${Math.round(Number(v))} m`, "Elevation"];
                        return [v, n];
                      }}
                    />
                    <Legend />
                    {bands.map((b, i) => (
                      <ReferenceArea key={i}
                        x1={b[xKey === "t" ? "t1" : "d1"]} x2={b[xKey === "t" ? "t2" : "d2"]}
                        yAxisId="hr"
                        fill={STEP_COLORS[b.kind] ?? "transparent"}
                        stroke={STEP_STROKE[b.kind]} strokeOpacity={0.35} strokeDasharray="2 2" />
                    ))}
                    {enabled.hr && hasMetric.hr && (
                      <Line yAxisId="hr" dataKey="hr" stroke="#ef4444" dot={false}
                        type="monotone" connectNulls strokeWidth={2} isAnimationActive={false} />
                    )}
                    {enabled.pace && hasMetric.pace && (
                      <Line yAxisId="pace" dataKey="pace" stroke="#3b82f6" dot={false}
                        type="monotone" connectNulls strokeWidth={2} isAnimationActive={false} />
                    )}
                    {enabled.cadence && hasMetric.cadence && (
                      <Line yAxisId="cadence" dataKey="cadence" stroke="#8b5cf6" dot={false}
                        type="monotone" connectNulls strokeWidth={1.5} isAnimationActive={false} />
                    )}
                    {enabled.elev && hasMetric.elev && (
                      <Line yAxisId="elev" dataKey="elev" stroke="#10b981" dot={false}
                        type="monotone" connectNulls strokeWidth={1.5} isAnimationActive={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {Object.entries(STEP_STROKE).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="h-2 w-3 rounded-sm" style={{ background: STEP_COLORS[k], border: `1px dashed ${c}` }} />
                    <span className="capitalize text-muted-foreground">{k}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {gpsPoints.length >= 2 && <MapPanel points={gpsPoints} />}

        <Card>
          <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
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

        {(fatigue ?? []).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Per-step fatigue</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(fatigue ?? []).map((f: any) => {
                const step = (steps ?? []).find((s: any) => s.id === f.step_id);
                return (
                  <div key={f.step_id} className="flex flex-wrap justify-between gap-2 border rounded px-3 py-2">
                    <span className="font-medium capitalize">{step?.kind ?? "step"}</span>
                    <span className="text-muted-foreground">
                      eff {f.efficiency_score ?? "—"} · pace drift {f.pace_drift_pct != null ? `${Number(f.pace_drift_pct).toFixed(1)}%` : "—"} · HR drift {f.hr_drift_bpm != null ? `${Number(f.hr_drift_bpm).toFixed(0)} bpm` : "—"}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <ZonePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "pace")} title="Pace zones" />
        <ZonePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "hr")} title="HR zones" />
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

const ZONE_ORDER = ["z1", "z2", "z3", "z4", "z5"];
const ZONE_LABEL: Record<string, string> = {
  z1: "Z1 Easy", z2: "Z2 Aerobic", z3: "Z3 Tempo", z4: "Z4 VO2/5K", z5: "Z5 Rep",
};
function ZonePanel({ rows, title }: { rows: any[]; title: string }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((a, r) => a + Number(r.seconds || 0), 0) || 1;
  const sorted = [...rows].sort((a, b) => ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone));
  const colors: Record<string, string> = {
    z1: "bg-emerald-400", z2: "bg-sky-400", z3: "bg-amber-400",
    z4: "bg-orange-500", z5: "bg-red-500",
  };
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
          {sorted.map((r) => (
            <div key={r.zone} className={colors[r.zone] ?? "bg-muted"}
              style={{ width: `${(Number(r.seconds) / total) * 100}%` }} />
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
    if (!ref.current) return;
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
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords as any } },
      });
      map.addLayer({
        id: "route", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ef4444", "line-width": 4 },
      });
      const bounds = coords.reduce((b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(coords[0] as any, coords[0] as any));
      map.fitBounds(bounds, { padding: 30, duration: 0 });
    });
    return () => map.remove();
  }, [points]);
  return (
    <Card>
      <CardHeader><CardTitle>Route</CardTitle></CardHeader>
      <CardContent>
        <div ref={ref} className="h-[320px] w-full rounded overflow-hidden" />
      </CardContent>
    </Card>
  );
}

// --- Sample assembly ---
function buildSamples(steps: any[], results: any[]): {
  samples: Sample[];
  bands: { kind: string; t1: number; t2: number; d1: number; d2: number }[];
  mode: "trace" | "summary";
  hasMetric: Record<MetricKey, boolean>;
  gpsPoints: { lat: number; lng: number }[];
} {
  // sort results by step_order then set, rep
  const stepOrder = new Map<string, number>();
  steps.forEach((s) => stepOrder.set(s.id, s.step_order ?? 0));
  const stepKind = new Map<string, string>();
  steps.forEach((s) => stepKind.set(s.id, s.kind ?? "work"));
  const sorted = [...results].sort((a, b) => {
    const so = (stepOrder.get(a.step_id) ?? 0) - (stepOrder.get(b.step_id) ?? 0);
    if (so !== 0) return so;
    const ss = (a.set_number ?? 1) - (b.set_number ?? 1);
    if (ss !== 0) return ss;
    return (a.rep_number ?? 0) - (b.rep_number ?? 0);
  });

  const samples: Sample[] = [];
  const bands: { kind: string; t1: number; t2: number; d1: number; d2: number }[] = [];
  const gpsPoints: { lat: number; lng: number }[] = [];
  let cursorT = 0;
  let cursorD = 0;
  let anyTrace = false;
  const has: Record<MetricKey, boolean> = { hr: false, pace: false, cadence: false, elev: false };

  const byStep = new Map<string, any[]>();
  for (const r of sorted) {
    if (!byStep.has(r.step_id)) byStep.set(r.step_id, []);
    byStep.get(r.step_id)!.push(r);
  }

  for (const step of steps) {
    const stepResults = byStep.get(step.id) ?? [];
    if (stepResults.length === 0) continue;
    const t1 = cursorT, d1 = cursorD;
    for (const r of stepResults) {
      const trace = Array.isArray(r.rep_trace) ? r.rep_trace : null;
      const dur = Number(r.actual_time_seconds ?? 0);
      const dist = Number(r.actual_distance_m ?? 0);
      if (trace && trace.length > 0) {
        anyTrace = true;
        for (const p of trace) {
          const t = cursorT + Number(p.t ?? 0);
          const d = p.d != null ? cursorD + Number(p.d) : (dist > 0 ? cursorD + Number(p.t ?? 0) / Math.max(dur, 1) * dist : undefined);
          const s: Sample = {
            t, d,
            hr: p.hr != null ? Number(p.hr) : undefined,
            pace: p.pace != null ? Number(p.pace) : undefined,
            cadence: p.cadence != null ? Number(p.cadence) : undefined,
            elev: p.elev != null ? Number(p.elev) : undefined,
            lat: p.lat != null ? Number(p.lat) : undefined,
            lng: p.lng != null ? Number(p.lng) : undefined,
            stepId: step.id, stepKind: step.kind ?? "work", repNumber: r.rep_number,
          };
          if (s.hr != null) has.hr = true;
          if (s.pace != null) has.pace = true;
          if (s.cadence != null) has.cadence = true;
          if (s.elev != null) has.elev = true;
          if (s.lat != null && s.lng != null) gpsPoints.push({ lat: s.lat, lng: s.lng });
          samples.push(s);
        }
      } else {
        // synthesize one point at the midpoint of the rep
        const tMid = cursorT + dur / 2;
        const dMid = cursorD + dist / 2;
        const s: Sample = {
          t: tMid,
          d: dist > 0 ? dMid : undefined,
          hr: r.hr_avg ?? undefined,
          pace: r.actual_pace_sec_per_km ?? undefined,
          cadence: r.cadence ?? undefined,
          stepId: step.id, stepKind: step.kind ?? "work", repNumber: r.rep_number,
        };
        if (s.hr != null) has.hr = true;
        if (s.pace != null) has.pace = true;
        if (s.cadence != null) has.cadence = true;
        samples.push(s);
      }
      cursorT += dur;
      cursorD += dist;
    }
    bands.push({ kind: step.kind ?? "work", t1, t2: cursorT, d1, d2: cursorD });
  }

  return { samples, bands, mode: anyTrace ? "trace" : "summary", hasMetric: has, gpsPoints };
}