// Rep Split Analysis popup — click a rep bar on the Session Analysis "Lap
// times" chart to see that rep broken into 100m splits: summary stats,
// colour-coded split grid, a pace-through-the-rep chart, running-dynamics
// drift (cadence/stride/GCT/VO), HR drift, a fatigue read (first 200m vs
// last 200m), the best 400m window, and time-in-pace-band distribution.
//
// Only meaningful for a genuine interval/rep session with a real raw GPS/
// watch point trace — a continuous run has no reps to click in the first
// place (the trigger only exists in "By reps" mode), and a session with no
// raw_session_points at all (manually-logged results, no file upload) has
// nothing to sub-split, which this dialog states plainly rather than
// showing empty charts.
//
// NOTE ON POWER: this app's raw_session_points schema has no power field
// (no footpod/Stryd integration), so "power drift" and a per-window power
// reading — both present in the original 10-item feature spec this was
// built from — are intentionally left out rather than fabricated.

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ruler, TrendingUp, HeartPulse, Gauge, Trophy, BarChart3, Wind, ArrowUp, Map as MapIcon } from "lucide-react";
import { paceFmt } from "@/lib/format";
import {
  sliceRepPoints,
  build100mSplits,
  computeSplitSummary,
  colorForSplit,
  computeDynamicsDrift,
  computeHrDrift,
  computeFatigueScore,
  computeBestSection,
  computePaceDistribution,
  type RepPointLike,
  type RepRowLike,
  type Split,
  type FatigueLevel,
} from "@/lib/rep-split-analysis";
import {
  classifyRelativeWind,
  effectiveWindComponentKmh,
  compassLabel,
  windArrowRotationDeg,
  RELATIVE_WIND_LABEL,
  type WindReading,
  type RelativeWind,
} from "@/lib/wind";

const SPLIT_COLOR_CLASSES: Record<string, string> = {
  green: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  yellow: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40",
  red: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40",
  none: "bg-muted text-muted-foreground border-border",
};

// A 100m split's own natural unit is "seconds for this split" (e.g. 17.9s,
// 18.4s) — a coach thinking in track-interval terms reads that far faster
// than a "/km" pace figure for a segment this short. Pace per km stays
// available as a toggle for anyone who prefers that framing. Every split's
// paceSecPerKm is already a normalized rate (seconds it would take to cover
// 1000m at that split's pace), so seconds-per-100m is just ÷10 — an exact
// unit conversion, not a re-derivation, and colour-coding/consistency/CV
// stay identical either way since % deviation is unit-invariant.
type SplitTimeUnit = "sec100" | "pace";

function formatSplitTime(paceSecPerKm: number | null | undefined, unit: SplitTimeUnit): string {
  if (paceSecPerKm == null) return "—";
  if (unit === "pace") return paceFmt(paceSecPerKm);
  return `${(paceSecPerKm / 10).toFixed(1)}s`;
}

// For a delta/range value already expressed in "per km" seconds (e.g.
// pacing range, std dev) — same ÷10 conversion, just without the "—" guard
// clause formatSplitTime has for a single split value.
function convertPerKmToUnit(valueSecPerKm: number, unit: SplitTimeUnit): number {
  return unit === "pace" ? valueSecPerKm : valueSecPerKm / 10;
}

const WIND_BADGE_CLASSES: Record<RelativeWind, string> = {
  headwind: "text-red-500 border-red-500/40",
  tailwind: "text-emerald-500 border-emerald-500/40",
  crosswind: "text-amber-500 border-amber-500/40",
  calm: "text-muted-foreground border-border",
  unknown: "text-muted-foreground border-border",
};

// Compact per-split wind indicator — an arrow rotated relative to THIS
// split's own travel bearing (see windArrowRotationDeg in src/lib/wind.ts):
// pointing up/forward = tailwind, down/back at the runner = headwind,
// sideways = crosswind. Colour-coded the same way (red/green/amber).
// Tooltip spells out the actual compass heading and wind-from direction
// for that split, since the arrow itself is travel-relative, not
// true-north. Only rendered when both a real wind reading and a real GPS
// bearing for that split exist; a split with no lat/lng (GPS dropout) or a
// session with no wind reading yet just shows nothing here rather than a
// misleading default.
function WindBadge({ split, wind }: { split: Split; wind: WindReading }) {
  const relative = classifyRelativeWind(split.bearingDeg, wind);
  if (relative === "unknown") return null;

  const component = effectiveWindComponentKmh(split.bearingDeg, wind);
  const rotation = windArrowRotationDeg(split.bearingDeg, wind);
  const headingLabel = compassLabel(split.bearingDeg);
  const windFromLabel = compassLabel(wind.directionDeg);

  const titleParts = [RELATIVE_WIND_LABEL[relative]];
  if (headingLabel) titleParts.push(`heading ${headingLabel}`);
  if (windFromLabel && wind.speedKmh != null) titleParts.push(`wind ${Math.round(wind.speedKmh)} km/h from ${windFromLabel}`);
  if (component != null) titleParts.push(`~${Math.abs(component).toFixed(0)} km/h along direction of travel`);

  return (
    <span className={`inline-flex items-center ${WIND_BADGE_CLASSES[relative]}`} title={titleParts.join(" • ")}>
      {rotation != null ? (
        <ArrowUp className="h-3 w-3" style={{ transform: `rotate(${rotation}deg)` }} />
      ) : (
        <Wind className="h-2.5 w-2.5" />
      )}
    </span>
  );
}

const FATIGUE_TONE: Record<FatigueLevel, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  medium: { label: "Medium", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  high: { label: "High", className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40" },
};

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DriftRow({
  label,
  unit,
  startValue,
  endValue,
  deltaAbs,
  deltaPct,
  precision = 0,
}: {
  label: string;
  unit: string;
  startValue: number | null;
  endValue: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  precision?: number;
}) {
  if (startValue == null || endValue == null) {
    return (
      <div className="flex items-center justify-between py-1.5 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">No data</span>
      </div>
    );
  }
  const rose = (deltaAbs ?? 0) > 0;
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/60 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 tabular-nums">
        <span>{startValue.toFixed(precision)}</span>
        <span className="text-muted-foreground">→</span>
        <span>{endValue.toFixed(precision)} {unit}</span>
        {deltaPct != null && (
          <Badge
            variant="outline"
            className={rose ? "text-red-500 border-red-500/40" : "text-emerald-500 border-emerald-500/40"}
          >
            {rose ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </Badge>
        )}
      </div>
    </div>
  );
}

function PaceThroughRepChart({ splits, unit }: { splits: Split[]; unit: SplitTimeUnit }) {
  const data = splits.map((s) => ({
    cumulativeDistanceM: s.cumulativeDistanceM,
    label: `${Math.round(s.cumulativeDistanceM)}m`,
    pace: s.paceSecPerKm,
  }));

  const avgPace = useMemo(() => {
    const paces = splits.map((s) => s.paceSecPerKm).filter((x): x is number => typeof x === "number");
    return paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null;
  }, [splits]);

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            reversed
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatSplitTime(v, unit)}
            width={64}
            domain={["dataMin - 5", "dataMax + 5"]}
          />
          <Tooltip
            formatter={(value: any) => [formatSplitTime(Number(value), unit), unit === "pace" ? "Pace" : "Split time"]}
            labelFormatter={(label) => `${label} into rep`}
            contentStyle={{ fontSize: 12 }}
          />
          {avgPace != null && (
            <ReferenceLine
              y={avgPace}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="4 4"
              className="text-muted-foreground"
            />
          )}
          <Line
            type="monotone"
            dataKey="pace"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------
// Route shape — a simplified schematic of the rep's actual GPS path,
// colour-coded per split, oriented true-north-up with a compass badge.
// ---------------------------------------------------------------------

type ProjectedPoint = { x: number; y: number };

// Local equirectangular projection — accurate enough for a single rep
// (rarely more than a couple of km across) and, critically, preserves
// TRUE SHAPE: longitude is scaled by cos(latitude) before treating both
// axes as equivalent "metres", so a track oval renders as an oval and a
// straight road stays straight, rather than getting stretched by naively
// mapping lat/lng degrees directly onto x/y (a degree of longitude is a
// different real-world distance than a degree of latitude almost
// everywhere except the equator). A single uniform scale factor (fit to
// whichever of width/height spans further) is then applied to both axes
// together, never independently — independent axis scaling is exactly
// what would turn an oval into an egg.
function projectRoutePoints(
  allPoints: { lat: number; lng: number }[],
): { project: (p: { lat: number; lng: number }) => ProjectedPoint; size: number } | null {
  if (allPoints.length < 2) return null;

  const lats = allPoints.map((p) => p.lat);
  const lngs = allPoints.map((p) => p.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const METERS_PER_DEG_LAT = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);

  const metersPoints = allPoints.map((p) => ({
    xM: (p.lng - centerLng) * metersPerDegLng,
    yM: (p.lat - centerLat) * METERS_PER_DEG_LAT,
  }));

  const xs = metersPoints.map((p) => p.xM);
  const ys = metersPoints.map((p) => p.yM);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  // Guards a near-zero span (e.g. a dead-straight short rep run almost
  // due north/south, where spanX could be a few centimetres) from
  // producing a degenerate near-infinite zoom.
  const span = Math.max(spanX, spanY, 10);

  const PADDING_FRAC = 0.15;
  const size = span * (1 + PADDING_FRAC * 2);
  const half = size / 2;

  // xM/yM are already centred on 0 by construction (centerLat/centerLng
  // are the exact midpoints of the data), so adding `half` (half of
  // whichever span is larger, plus padding) centres both axes correctly
  // inside the square SVG canvas regardless of which axis is the limiting
  // one.
  function project(p: { lat: number; lng: number }): ProjectedPoint {
    const xM = (p.lng - centerLng) * metersPerDegLng;
    const yM = (p.lat - centerLat) * METERS_PER_DEG_LAT;
    return { x: xM + half, y: -yM + half }; // flip Y: higher latitude (north) = up = smaller SVG y
  }

  return { project, size };
}

const ROUTE_SPLIT_STROKE: Record<string, string> = {
  headwind: "#ef4444",
  tailwind: "#10b981",
  crosswind: "#f59e0b",
  calm: "#9ca3af",
  unknown: "#9ca3af",
};

// Midpoint of a split's own path — used to place its number label roughly
// centred on its stretch of the route, rather than at its start (which
// would visually crowd against the previous split's end on a tight bend).
function pathMidpoint(path: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (!path.length) return null;
  return path[Math.floor(path.length / 2)];
}

function RepRouteShapeCard({ splits, wind }: { splits: Split[]; wind?: WindReading }) {
  const allPoints = useMemo(() => splits.flatMap((s) => s.path), [splits]);
  const projection = useMemo(() => projectRoutePoints(allPoints), [allPoints]);
  const hasWind = wind?.speedKmh != null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MapIcon className="h-4 w-4 text-muted-foreground" />
          Route shape
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!projection ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No GPS trace for this rep — can't draw its route shape. This is usually a treadmill/indoor session or a
            manually-logged rep with no file upload.
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-xs mx-auto aspect-square">
              <svg viewBox={`0 0 ${projection.size} ${projection.size}`} className="w-full h-full">
                {splits.map((s) => {
                  if (s.path.length < 2) return null;
                  // Coloured by relative WIND on this stretch (not pace) —
                  // the split-by-split time grid above already covers
                  // pace deviation with its own colours, and colouring the
                  // map by pace too made overlapping loops (a track
                  // session run over multiple laps) unreadable, since
                  // pace-colour and position don't correspond to anything
                  // spatially meaningful. Wind direction DOES have a real
                  // spatial meaning — the same bend is always the same
                  // wind angle every lap — so it's what the shape is
                  // actually useful for showing.
                  const relative = hasWind ? classifyRelativeWind(s.bearingDeg, wind!) : "unknown";
                  const pointsAttr = s.path
                    .map((p) => {
                      const { x, y } = projection.project(p);
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(" ");
                  const strokeWidth = Math.max(2, projection.size * 0.012);
                  return (
                    <polyline
                      key={s.index}
                      points={pointsAttr}
                      fill="none"
                      stroke={ROUTE_SPLIT_STROKE[relative] ?? ROUTE_SPLIT_STROKE.unknown}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <title>
                        {`Split ${s.index} — ${RELATIVE_WIND_LABEL[relative]}${s.paceSecPerKm != null ? ` · ${(s.paceSecPerKm / 10).toFixed(1)}s/100m` : ""} · ${Math.round(s.cumulativeDistanceM)}m into rep`}
                      </title>
                    </polyline>
                  );
                })}
                {/* Numbered split labels — matches the same index shown on
                    each cell in the "Split-by-split time" grid above, so a
                    specific 100m can be located on the map from its number
                    in the grid, or vice versa. A small background disc
                    keeps the number legible over the coloured line and
                    over any earlier lap the path crosses again. */}
                {splits.map((s) => {
                  const mid = pathMidpoint(s.path);
                  if (!mid) return null;
                  const { x, y } = projection.project(mid);
                  const r = Math.max(4, projection.size * 0.02);
                  return (
                    <g key={`label-${s.index}`}>
                      <circle cx={x} cy={y} r={r} fill="var(--background, #fff)" stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.5} className="text-foreground" />
                      <text
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={r * 1.1}
                        fontWeight={600}
                        className="fill-foreground"
                      >
                        {s.index}
                      </text>
                    </g>
                  );
                })}
                {(() => {
                  const firstWithPath = splits.find((s) => s.path.length > 0);
                  const firstPoint = firstWithPath?.path[0];
                  if (!firstPoint) return null;
                  const { x, y } = projection.project(firstPoint);
                  const r = Math.max(2.5, projection.size * 0.014);
                  return <circle cx={x} cy={y} r={r} fill="#3b82f6" />;
                })()}
                {(() => {
                  const lastWithPath = [...splits].reverse().find((s) => s.path.length > 0);
                  const lastPoint = lastWithPath?.path[lastWithPath.path.length - 1];
                  if (!lastPoint) return null;
                  const { x, y } = projection.project(lastPoint);
                  const r = Math.max(2.5, projection.size * 0.014);
                  return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill="currentColor" className="text-foreground" />;
                })()}
              </svg>
              {/* Compass badge — the projection above is always drawn
                  true-north-up (see projectRoutePoints), so this never
                  needs to rotate; it's a static confirmation of that
                  orientation for the viewer, not a live indicator. */}
              <div className="absolute top-1 right-1 w-8 h-8 rounded-full border border-border bg-background/90 flex items-center justify-center">
                <span className="absolute top-0 text-[8px] font-semibold text-foreground leading-none pt-0.5">N</span>
                <span className="absolute bottom-0 text-[8px] text-muted-foreground leading-none pb-0.5">S</span>
                <span className="absolute left-0.5 text-[8px] text-muted-foreground leading-none">W</span>
                <span className="absolute right-0.5 text-[8px] text-muted-foreground leading-none">E</span>
                <div className="w-px h-3 bg-foreground/30" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              {hasWind ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-4 rounded bg-red-500 inline-block" /> Headwind
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-4 rounded bg-emerald-500 inline-block" /> Tailwind
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-4 rounded bg-amber-500 inline-block" /> Crosswind
                  </span>
                </>
              ) : (
                <span>No wind reading for this session — path shown uncoloured.</span>
              )}
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Start
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 bg-foreground inline-block" /> Finish
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              Numbers match the split-by-split grid above — find a number here to see where that 100m was actually run.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// High-res trace — the same look and feel as the "Session graph" at the
// top of the Session Analysis page (toggle buttons per metric, an
// averages sidebar) but scoped to just this rep's own raw point trace,
// not bucketed into 100m splits. Deliberately a separate, self-contained
// implementation rather than reusing the Session graph component
// directly — that component is tightly wired into the analysis page's
// own state (session-wide scope filters, zone shading, multi-thousand-
// point virtualisation) and pulling a rep-scoped slice out of it safely
// would be a much larger, riskier refactor of an already-complex, already
// -working 4000+ line file. This mirrors its metric palette, toggle
// pattern, and sidebar layout closely enough to read as "the same style,"
// without touching that file at all.
//
// SIMPLIFICATION vs the Session graph: the Session graph supports up to
// 4 independent Y-axes (left/right/leftInner/rightInner) so many metrics
// can each get their own correctly-scaled axis at once. This version uses
// just 2 visible axes (left/right) — the first two enabled metrics get a
// real axis, any further enabled metric still plots correctly but shares
// the nearest axis's visual scale. For a single rep (a few hundred points,
// rarely more than 2-3 metrics toggled at once to actually read), that
// trade-off keeps this readable without the extra axis-management
// complexity a modal this size doesn't have room for anyway.
type RepTraceMetricKey = "hr" | "pace" | "cadence" | "elev" | "vo" | "gct";

const REP_TRACE_METRICS: { key: RepTraceMetricKey; label: string; color: string; unit: string; axis: "left" | "right" }[] = [
  { key: "hr", label: "HR", color: "#ef4444", unit: "bpm", axis: "left" },
  { key: "pace", label: "Pace", color: "#3b82f6", unit: "/km", axis: "right" },
  { key: "cadence", label: "Cadence", color: "#8b5cf6", unit: "spm", axis: "left" },
  { key: "elev", label: "Elevation", color: "#10b981", unit: "m", axis: "right" },
  { key: "vo", label: "Vert Osc", color: "#f97316", unit: "cm", axis: "left" },
  { key: "gct", label: "Gnd Contact", color: "#ec4899", unit: "ms", axis: "right" },
];

function paceToSpeedKmh(paceSecPerKm?: number | null): number | null {
  if (!paceSecPerKm || paceSecPerKm <= 0) return null;
  return 3600 / paceSecPerKm;
}

function formatRepTraceAverage(key: RepTraceMetricKey, value: number, speedMode: "pace" | "speed"): string {
  switch (key) {
    case "hr":
      return `${Math.round(value)} bpm`;
    case "pace":
      return speedMode === "speed" ? `${value.toFixed(1)} km/h` : `${paceFmt(value)}/km`;
    case "cadence":
      return `${Math.round(value)} spm`;
    case "elev":
      return `${Math.round(value)} m`;
    case "vo":
      return `${value.toFixed(1)} cm`;
    case "gct":
      return `${Math.round(value)} ms`;
    default:
      return `${value}`;
  }
}

function RepTraceChart({ repPoints }: { repPoints: RepPointLike[] }) {
  const [enabled, setEnabled] = useState<Record<RepTraceMetricKey, boolean>>({
    hr: true,
    pace: true,
    cadence: false,
    elev: false,
    vo: false,
    gct: false,
  });
  const [speedMode, setSpeedMode] = useState<"pace" | "speed">("pace");

  const hasMetric = useMemo(() => {
    const has = (pred: (p: RepPointLike) => boolean) => repPoints.some(pred);
    return {
      hr: has((p) => typeof p.hr === "number" && p.hr > 0),
      pace: has((p) => typeof p.pace_sec_per_km === "number" && p.pace_sec_per_km > 0 && p.pace_sec_per_km <= 1800),
      cadence: has((p) => typeof p.cadence === "number" && p.cadence > 0),
      elev: has((p) => typeof p.elevation_m === "number"),
      vo: has((p) => typeof p.vertical_oscillation_cm === "number" && p.vertical_oscillation_cm > 0),
      gct: has((p) => typeof p.ground_contact_time_ms === "number" && p.ground_contact_time_ms > 0),
    } as Record<RepTraceMetricKey, boolean>;
  }, [repPoints]);

  const chartData = useMemo(() => {
    if (!repPoints.length) return [];
    const sorted = [...repPoints].sort((a, b) => Number(a.elapsed_s ?? 0) - Number(b.elapsed_s ?? 0));
    const t0 = Number(sorted[0].elapsed_s ?? 0);
    const d0 = Number(sorted[0].distance_m ?? 0);
    return sorted.map((p) => {
      const rawPace =
        typeof p.pace_sec_per_km === "number" && p.pace_sec_per_km > 0 && p.pace_sec_per_km <= 1800
          ? p.pace_sec_per_km
          : null;
      return {
        t: Number(p.elapsed_s ?? 0) - t0,
        distanceM: p.distance_m != null ? Number(p.distance_m) - d0 : null,
        hr: typeof p.hr === "number" && p.hr > 0 ? p.hr : null,
        pace: rawPace != null ? (speedMode === "speed" ? paceToSpeedKmh(rawPace) : rawPace) : null,
        cadence: typeof p.cadence === "number" && p.cadence > 0 ? p.cadence : null,
        elev: typeof p.elevation_m === "number" ? p.elevation_m : null,
        vo: typeof p.vertical_oscillation_cm === "number" && p.vertical_oscillation_cm > 0 ? p.vertical_oscillation_cm : null,
        gct: typeof p.ground_contact_time_ms === "number" && p.ground_contact_time_ms > 0 ? p.ground_contact_time_ms : null,
      };
    });
  }, [repPoints, speedMode]);

  const averages = useMemo(() => {
    const avg = (key: RepTraceMetricKey) => {
      const vals = chartData.map((d) => d[key]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      hr: avg("hr"),
      pace: avg("pace"),
      cadence: avg("cadence"),
      elev: avg("elev"),
      vo: avg("vo"),
      gct: avg("gct"),
    } as Record<RepTraceMetricKey, number | null>;
  }, [chartData]);

  const activeMetrics = REP_TRACE_METRICS.filter((m) => enabled[m.key] && hasMetric[m.key]);
  // Only the first metric assigned to each side gets that side's visible
  // axis — see the SIMPLIFICATION note above the component.
  const leftAxisMetric = activeMetrics.find((m) => m.axis === "left");
  const rightAxisMetric = activeMetrics.find((m) => m.axis === "right");

  if (!repPoints.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            High-res trace
          </CardTitle>
          {hasMetric.pace && (
            <div className="flex border rounded-md overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setSpeedMode("pace")}
                className={`px-2 py-0.5 ${speedMode === "pace" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
              >
                Pace
              </button>
              <button
                type="button"
                onClick={() => setSpeedMode("speed")}
                className={`px-2 py-0.5 border-l ${speedMode === "speed" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
              >
                km/h
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {REP_TRACE_METRICS.map((m) => {
            const avail = hasMetric[m.key];
            return (
              <button
                key={m.key}
                type="button"
                disabled={!avail}
                title={!avail ? "No data" : ""}
                onClick={() => setEnabled((p) => ({ ...p, [m.key]: !p[m.key] }))}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs ${
                  enabled[m.key] && avail
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent"
                } ${!avail ? "opacity-40 cursor-default" : ""}`}
              >
                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: m.color }} />
                {m.label}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3">
          <div className="flex-1 h-56 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${Math.round(v)}s`}
                />
                {leftAxisMetric && (
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    reversed={leftAxisMetric.key === "pace" && speedMode === "pace"}
                    tickFormatter={(v) => (leftAxisMetric.key === "pace" ? formatSplitTime(v, "pace") : `${Math.round(v)}`)}
                    width={40}
                  />
                )}
                {rightAxisMetric && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    reversed={rightAxisMetric.key === "pace" && speedMode === "pace"}
                    tickFormatter={(v) => (rightAxisMetric.key === "pace" ? formatSplitTime(v, "pace") : `${Math.round(v)}`)}
                    width={40}
                  />
                )}
                <Tooltip
                  labelFormatter={(t) => `${Math.round(Number(t))}s into rep`}
                  formatter={(value: any, name: any) => {
                    const metric = REP_TRACE_METRICS.find((m) => m.key === name);
                    if (!metric) return [value, name];
                    const formatted =
                      metric.key === "pace"
                        ? speedMode === "speed"
                          ? `${Number(value).toFixed(1)} km/h`
                          : `${formatSplitTime(Number(value), "pace")}/km`
                        : `${Number(value).toFixed(metric.key === "vo" ? 1 : 0)} ${metric.unit}`;
                    return [formatted, metric.label];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                {activeMetrics.map((m) => (
                  <Line
                    key={m.key}
                    yAxisId={m.axis}
                    type="monotone"
                    dataKey={m.key}
                    name={m.key}
                    stroke={m.color}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Averages sidebar — mirrors the Session graph's own sidebar:
              one small card per currently-toggled-on, available metric. */}
          {activeMetrics.length > 0 && (
            <div className="w-20 shrink-0 flex flex-col gap-1.5">
              {activeMetrics.map((m) => {
                const avgValue = averages[m.key];
                if (avgValue == null) return null;
                return (
                  <div key={m.key} className="rounded-md border border-border bg-muted/30 px-1.5 py-1 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: m.color }} />
                      <span className="text-[9px] text-muted-foreground uppercase">{m.label}</span>
                    </div>
                    <div className="text-[11px] font-semibold tabular-nums">
                      {formatRepTraceAverage(m.key, avgValue, speedMode)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function RepSplitAnalysisDialog({
  open,
  onOpenChange,
  points,
  repRows,
  selectedRepIndex,
  repLabel,
  targetPaceSecPerKm,
  wind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  points: RepPointLike[];
  repRows: RepRowLike[];
  selectedRepIndex: number | null;
  repLabel: string;
  targetPaceSecPerKm?: number | null;
  wind?: WindReading;
}) {
  const repPoints = useMemo(() => {
    if (selectedRepIndex == null) return [];
    const slices = sliceRepPoints(points, repRows);
    return slices[selectedRepIndex] ?? [];
  }, [points, repRows, selectedRepIndex]);

  const splits = useMemo(() => build100mSplits(repPoints, 100), [repPoints]);

  const summary = useMemo(() => computeSplitSummary(splits), [splits]);
  const drift = useMemo(() => computeDynamicsDrift(splits), [splits]);
  const hrDrift = useMemo(() => computeHrDrift(splits), [splits]);
  const fatigue = useMemo(() => computeFatigueScore(splits), [splits]);
  const bestSection = useMemo(() => computeBestSection(splits, 400), [splits]);
  const paceDistribution = useMemo(() => computePaceDistribution(splits, 5), [splits]);

  const hasSplits = splits.length > 0;
  const hasDynamicsData = splits.some((s) => s.avgCadence != null || s.avgGroundContactTimeMs != null || s.avgVerticalOscillationCm != null);
  const hasHrData = splits.some((s) => s.avgHr != null);

  // Defaults to seconds-per-100m — the natural unit for a split this short
  // (17.9s, 18.4s reads faster than a "/km" pace figure at a glance).
  // Toggling to Pace shows the same underlying numbers as a per-km rate
  // instead; nothing about the underlying calculation changes either way.
  const [unit, setUnit] = useState<SplitTimeUnit>("sec100");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Ruler className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">100m split breakdown</div>
                <DialogTitle>{repLabel}</DialogTitle>
              </div>
            </div>
            {hasSplits && (
              <div className="flex border rounded-md overflow-hidden text-xs mr-6">
                <button
                  type="button"
                  onClick={() => setUnit("sec100")}
                  className={`px-2.5 py-1 ${unit === "sec100" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  Per 100m
                </button>
                <button
                  type="button"
                  onClick={() => setUnit("pace")}
                  className={`px-2.5 py-1 border-l ${unit === "pace" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                >
                  Pace /km
                </button>
              </div>
            )}
          </div>
          <DialogDescription>
            Every 100m of this rep, broken out from the raw watch/GPS trace.
            {wind?.speedKmh != null && (
              <span className="inline-flex items-center gap-1 ml-1">
                <Wind className="h-3 w-3" />
                {Math.round(wind.speedKmh)} km/h
                {wind.directionDeg != null && ` from ${compassLabel(wind.directionDeg)}`} — see the wind icon on each
                split below for headwind/tailwind/crosswind on that stretch.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {!hasSplits ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No raw point trace covers this rep, so it can't be broken into 100m splits. This is usually a
            manually-logged rep (no FIT/GPX file uploaded) rather than a data issue.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary stats */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <StatBox label="Average" value={formatSplitTime(summary.avgPaceSecPerKm, unit)} />
              <StatBox label="Fastest" value={formatSplitTime(summary.fastestSecPerKm, unit)} />
              <StatBox label="Slowest" value={formatSplitTime(summary.slowestSecPerKm, unit)} />
              <StatBox
                label="Pacing range"
                value={
                  summary.pacingRangeSec != null
                    ? `${convertPerKmToUnit(summary.pacingRangeSec, unit).toFixed(1)}s`
                    : "—"
                }
              />
              <StatBox
                label="Coeff. of variation"
                value={summary.coefficientOfVariationPct != null ? `${summary.coefficientOfVariationPct.toFixed(1)}%` : "—"}
              />
              <StatBox
                label="Consistency"
                value={summary.consistencyScore != null ? `${summary.consistencyScore}/100` : "—"}
              />
            </div>

            {/* Colour-coded split grid */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Split-by-split {unit === "pace" ? "pace" : "time"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                  {splits.map((s) => {
                    const color = colorForSplit(s.paceSecPerKm, summary.avgPaceSecPerKm);
                    return (
                      <div
                        key={s.index}
                        className={`relative rounded-md border px-1 py-1.5 text-center text-xs font-medium tabular-nums ${SPLIT_COLOR_CLASSES[color]}`}
                        title={`Split ${s.index} — ${Math.round(s.distanceM)}m split, ${Math.round(s.cumulativeDistanceM)}m into rep${s.isPartial ? " (partial)" : ""}`}
                      >
                        <span className="absolute top-0.5 left-1 text-[9px] font-normal opacity-60 leading-none">
                          {s.index}
                        </span>
                        {formatSplitTime(s.paceSecPerKm, unit)}
                        {s.isPartial && <span className="ml-0.5 text-[9px] opacity-70">*</span>}
                        {wind && (
                          <div className="mt-0.5 flex justify-center">
                            <WindBadge split={s} wind={wind} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Small number in each cell matches its label on the route shape map below.
                </p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/40 inline-block" /> On pace
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/40 inline-block" /> Slightly off
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-500/40 inline-block" /> Significant deviation
                  </span>
                  {splits.some((s) => s.isPartial) && <span>* partial split (short of 100m)</span>}
                  {wind?.speedKmh != null && (
                    <>
                      <span className="flex items-center gap-1 text-red-500">
                        <ArrowUp className="h-3 w-3" style={{ transform: "rotate(180deg)" }} /> Headwind
                      </span>
                      <span className="flex items-center gap-1 text-emerald-500">
                        <ArrowUp className="h-3 w-3" /> Tailwind
                      </span>
                      <span className="flex items-center gap-1 text-amber-500">
                        <ArrowUp className="h-3 w-3" style={{ transform: "rotate(90deg)" }} /> Crosswind
                      </span>
                      <span className="w-full text-[10px]">
                        Arrow shows wind relative to each split's own running direction, not true north — hover a
                        split for its actual heading and wind-from compass direction.
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* High-res trace */}
            <RepTraceChart repPoints={repPoints} />

            {/* Route shape */}
            <RepRouteShapeCard splits={splits} wind={wind} />

            {/* Pace graph */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  {unit === "pace" ? "Pace" : "Time"} through the rep
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PaceThroughRepChart splits={splits} unit={unit} />
              </CardContent>
            </Card>

            {/* HR drift + Running dynamics drift */}
            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <HeartPulse className="h-4 w-4 text-muted-foreground" />
                    Heart rate drift
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {hasHrData && hrDrift ? (
                    <div className="flex items-center justify-around text-center">
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Beginning</div>
                        <div className="text-xl font-semibold tabular-nums">{hrDrift.beginningHr}</div>
                      </div>
                      <div className="text-muted-foreground">→</div>
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">End</div>
                        <div className="text-xl font-semibold tabular-nums">{hrDrift.endHr}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Change</div>
                        <div
                          className={`text-xl font-semibold tabular-nums ${(hrDrift.deltaBpm ?? 0) > 0 ? "text-red-500" : "text-emerald-500"}`}
                        >
                          {(hrDrift.deltaBpm ?? 0) > 0 ? "+" : ""}
                          {hrDrift.deltaBpm} bpm
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-2">No HR data for this rep.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    Fatigue read
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {fatigue ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">First 200m → Last 200m</span>
                        <Badge variant="outline" className={FATIGUE_TONE[fatigue.level].className}>
                          {FATIGUE_TONE[fatigue.level].label}
                        </Badge>
                      </div>
                      {fatigue.first200.cadence != null && fatigue.last200.cadence != null && (
                        <div className="text-xs text-muted-foreground">
                          Cadence {fatigue.first200.cadence} → {fatigue.last200.cadence} spm
                        </div>
                      )}
                      {fatigue.first200.groundContactTimeMs != null && fatigue.last200.groundContactTimeMs != null && (
                        <div className="text-xs text-muted-foreground">
                          Ground contact {fatigue.first200.groundContactTimeMs} → {fatigue.last200.groundContactTimeMs} ms
                        </div>
                      )}
                      {fatigue.first200.strideLengthM != null && fatigue.last200.strideLengthM != null && (
                        <div className="text-xs text-muted-foreground">
                          Stride {fatigue.first200.strideLengthM.toFixed(2)} → {fatigue.last200.strideLengthM.toFixed(2)} m
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-2">
                      Rep is under 400m — too short for a meaningful first-vs-last read.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Running dynamics drift through the rep */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Running dynamics through the rep</CardTitle>
              </CardHeader>
              <CardContent>
                {hasDynamicsData ? (
                  <div>
                    <DriftRow {...drift.cadence} precision={0} />
                    <DriftRow {...drift.strideLength} precision={2} />
                    <DriftRow {...drift.groundContactTime} precision={0} />
                    <DriftRow {...drift.verticalOscillation} precision={1} />
                    <div className="pt-2 text-[11px] text-muted-foreground">
                      No power data — this session has no footpod/power-meter reading to track.
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-2">
                    No cadence, ground contact, or vertical oscillation data recorded for this rep.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Best section + Pace distribution */}
            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Trophy className="h-4 w-4 text-muted-foreground" />
                    Best 400m
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {bestSection ? (
                    <div className="space-y-1 text-sm">
                      <div className="text-xl font-semibold tabular-nums">{formatSplitTime(bestSection.paceSecPerKm, unit)}</div>
                      <div className="text-muted-foreground">
                        {Math.round(bestSection.startDistanceM)}–{Math.round(bestSection.endDistanceM)}m into the rep
                      </div>
                      {bestSection.formScore != null && (
                        <div className="text-muted-foreground">Form score: {bestSection.formScore}/100</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-2">
                      Rep is under 400m — too short to score a best window.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Time spent by {unit === "pace" ? "pace" : "split time"}</CardTitle>
                </CardHeader>
                <CardContent>
                  {paceDistribution.length ? (
                    <div className="space-y-1.5">
                      {paceDistribution.map((band) => (
                        <div key={band.label} className="flex items-center gap-2 text-xs">
                          <div className="w-20 shrink-0 text-muted-foreground tabular-nums">{formatSplitTime(band.loSecPerKm, unit)}</div>
                          <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full"
                              style={{ width: `${Math.min(100, band.pctOfTime)}%` }}
                            />
                          </div>
                          <div className="w-10 text-right tabular-nums">{band.pctOfTime}%</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-2">Not enough data.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {targetPaceSecPerKm != null && (
              <div className="text-xs text-muted-foreground">
                Step target pace: {paceFmt(targetPaceSecPerKm)} · colour coding above compares each split to this
                rep's own average, not the target.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
