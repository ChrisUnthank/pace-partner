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

import { useMemo, useState, type ReactNode } from "react";
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
import { Ruler, TrendingUp, HeartPulse, Gauge, Trophy, BarChart3, Wind, ArrowUp, Map as MapIcon, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { paceFmt, secToClock } from "@/lib/format";
import {
  sliceRepPoints,
  calibrateDistanceToTarget,
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
  computeBearingDeg,
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

// Wind uses a DIFFERENT colour family than pace deviation (blue/purple/
// orange, not green/amber/red) — using the same red/amber/green for two
// completely different metrics (how fast vs. which way the wind was
// blowing) made the split grid and the route map read as if they were
// showing the same thing when they weren't.
const WIND_BADGE_CLASSES: Record<RelativeWind, string> = {
  headwind: "text-orange-500 border-orange-500/40",
  tailwind: "text-sky-500 border-sky-500/40",
  crosswind: "text-purple-500 border-purple-500/40",
  calm: "text-muted-foreground border-border",
  unknown: "text-muted-foreground border-border",
};

// Compact per-split wind indicator — an arrow rotated relative to THIS
// split's own travel bearing (see windArrowRotationDeg in src/lib/wind.ts):
// pointing up/forward = tailwind, down/back at the runner = headwind,
// sideways = crosswind. Coloured blue/purple/orange — see the note above
// WIND_BADGE_CLASSES for why that's a different palette than pace.
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

// A small (i) icon that expands a popover with explanation prose — used
// throughout this dialog to move "how this works" / "why this design
// choice" text out of the way by default, since a coach scanning a rep
// mid-session mostly wants the numbers and the legend, not paragraphs of
// reasoning every time. Deliberately NOT used for legends (the coloured
// swatches, the wind arrow key, Start/Finish) — those stay always visible
// since they're needed to read the chart at a glance, not background on
// how it was built.
function InfoNote({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground shrink-0"
          aria-label="More info"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-relaxed text-muted-foreground space-y-2 w-72" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

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
type RoutePathPoint = { lat: number; lng: number; distanceM: number };

// Math.min(...arr)/Math.max(...arr) spread every array element as a
// function argument — fine for a handful of points, but a real crash risk
// ("Maximum call stack size exceeded") for a long rep with a lot of GPS
// samples (some engines cap function arguments well under 100k). A plain
// loop has no such limit regardless of array size.
function safeMinMax(arr: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}


// Cumulative arc-length (in local metres) along an ordered list of local
// x/y points — used to walk a fraction of the way along a shape by real
// distance travelled, not by point index (point spacing isn't even).
function buildArcLength(pts: ProjectedPoint[]): { cumDist: number[]; totalLength: number } {
  const cumDist = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cumDist.push(cumDist[i - 1] + d);
  }
  return { cumDist, totalLength: cumDist[cumDist.length - 1] ?? 0 };
}

// Samples a point at a given fraction (0-1) of the way along a shape's
// own arc length, interpolating between whichever two of its points
// bracket that fraction.
function sampleAtFraction(pts: ProjectedPoint[], cumDist: number[], totalLength: number, fraction: number): ProjectedPoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1 || totalLength <= 0) return pts[0];
  const targetDist = Math.max(0, Math.min(1, fraction)) * totalLength;
  let i = 1;
  while (i < cumDist.length && cumDist[i] < targetDist) i++;
  if (i >= cumDist.length) return pts[pts.length - 1];
  const d0 = cumDist[i - 1];
  const d1 = cumDist[i];
  const segFrac = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
  const p0 = pts[i - 1];
  const p1 = pts[i];
  return { x: p0.x + (p1.x - p0.x) * segFrac, y: p0.y + (p1.y - p0.y) * segFrac };
}

// Local equirectangular projection with LAP-TEMPLATE ALIGNMENT — accurate
// enough for a single rep and, critically, preserves TRUE SHAPE:
// longitude is scaled by cos(latitude) before treating both axes as
// equivalent "metres", so a track oval renders as an oval and a straight
// road stays straight.
//
// This is deliberately a SCHEMATIC, not a literal GPS trace: real GPS
// noise means lap 2 of the same physical loop is never pixel-identical to
// lap 1 (different tangent lines through bends, jitter, drift), which
// made repeated laps look like slightly different, messy shapes instead
// of clean parallel rings — and made "no overlap" and "no gap" fights
// with each other, since real per-lap shape differences don't line up
// cleanly at any fixed offset.
//
// Instead: the FIRST lap's own shape becomes a fixed TEMPLATE. Every
// point on every lap (including the first) is repositioned to sit at the
// same PROPORTIONAL DISTANCE along that one template shape that it
// actually covered in its own lap (e.g. "40% of the way through this
// lap" always lands at the same spot on the template, lap after lap),
// then laps 2+ are pushed radially outward from the template's own
// centre so they don't sit on top of it. The drawn line's length no
// longer has to represent literal recorded distance — it's a consistent,
// repeatable visual position, not a ruler.
function projectRoutePoints(
  splits: Split[],
): {
  project: (p: { lat: number; lng: number }) => ProjectedPoint;
  projectLabel: (p: { lat: number; lng: number }) => ProjectedPoint;
  size: number;
  maxLoopIndex: number;
  strokeWidth: number;
} | null {
  const flatPoints: RoutePathPoint[] = splits.flatMap((s) => s.path);
  if (flatPoints.length < 2) return null;

  const lats = flatPoints.map((p) => p.lat);
  const lngs = flatPoints.map((p) => p.lng);
  const latRange = safeMinMax(lats);
  const lngRange = safeMinMax(lngs);
  const centerLat = (latRange.min + latRange.max) / 2;
  const centerLng = (lngRange.min + lngRange.max) / 2;

  const METERS_PER_DEG_LAT = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);

  const baseXY: ProjectedPoint[] = flatPoints.map((p) => ({
    x: (p.lng - centerLng) * metersPerDegLng,
    y: (p.lat - centerLat) * METERS_PER_DEG_LAT,
  }));

  // Loop detection: track distance from the very first point. "Leaving"
  // requires getting more than LEAVE_THRESHOLD_M away; a lap only counts
  // once the athlete has genuinely left, come back within
  // RETURN_THRESHOLD_M, AND actually covered at least MIN_LAP_DISTANCE_M
  // of real recorded distance since the lap started. That last check
  // matters more than it looks: on a tight/eccentric bend, a point can
  // swing spatially close to the origin well before the lap is actually
  // complete (the origin sits ON the path, and a sharp bend's own
  // curvature can bring nearby-but-not-yet-there points within the return
  // threshold early) — without a minimum real distance travelled, that
  // fired a false "lap complete" partway around the first lap, well
  // before the athlete had actually finished it. Also records the real
  // recorded distance (distanceM) at the moment each lap begins, so "how
  // far into THIS lap is this point" can be computed per point.
  const LEAVE_THRESHOLD_M = 20;
  const RETURN_THRESHOLD_M = 12;
  const MIN_LAP_DISTANCE_M = 150;
  const origin = baseXY[0];
  const distFromOrigin = baseXY.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y));

  // The FIRST point that dips under RETURN_THRESHOLD_M isn't necessarily
  // the real lap finish: on a tight or eccentric bend, the path can swing
  // spatially close to the origin well before the lap is actually
  // complete (the origin sits ON the path, and a sharp bend's own
  // curvature brings nearby-but-not-there-yet points within the
  // threshold early). Firing on the first dip registered a "lap
  // complete" a third of the way around a bend, before the athlete had
  // actually finished it. Fixed with two passes: pass 1 finds each
  // contiguous stretch of points within the return threshold and picks
  // the point with the SMALLEST distance from origin within that whole
  // stretch — the genuine closest approach — as the real lap boundary,
  // discarding any stretch that hasn't covered at least
  // MIN_LAP_DISTANCE_M of real recorded distance since the lap started
  // (guards a short backtrack near the start line from counting as a
  // "lap"). Pass 2 assigns every point's lap index and lap-start distance
  // based on which boundary it falls after.
  const boundaryIndices: number[] = [];
  {
    let hasLeft = false;
    let lastBoundaryDistanceM = flatPoints[0].distanceM;
    let i = 0;
    while (i < baseXY.length) {
      if (!hasLeft && distFromOrigin[i] > LEAVE_THRESHOLD_M) {
        hasLeft = true;
      }
      if (hasLeft && distFromOrigin[i] < RETURN_THRESHOLD_M) {
        let zoneEnd = i;
        while (zoneEnd + 1 < baseXY.length && distFromOrigin[zoneEnd + 1] < RETURN_THRESHOLD_M * 1.5) {
          zoneEnd++;
        }
        let minIdx = i;
        for (let k = i; k <= zoneEnd; k++) {
          if (distFromOrigin[k] < distFromOrigin[minIdx]) minIdx = k;
        }
        const traveledSinceLapStart = flatPoints[minIdx].distanceM - lastBoundaryDistanceM;
        if (traveledSinceLapStart >= MIN_LAP_DISTANCE_M) {
          boundaryIndices.push(minIdx);
          lastBoundaryDistanceM = flatPoints[minIdx].distanceM;
          hasLeft = false;
        }
        i = zoneEnd + 1;
        continue;
      }
      i++;
    }

    // A boundary detected right at (or almost at) the very end of the
    // data isn't a transition INTO another lap — there's no further lap
    // to offset, it's just where the rep's own recording happened to
    // stop, which can legitimately be close to the origin again if the
    // rep's total distance happens to be a near-exact multiple of the
    // loop length (e.g. a rep that's almost exactly 2 full laps, not
    // 2.5). Counting it would overstate "how many laps" in the caption
    // below and misassign the very last few points to a phantom next lap
    // with nothing in it.
    const TRAILING_BOUNDARY_GUARD_M = LEAVE_THRESHOLD_M;
    while (
      boundaryIndices.length > 0 &&
      flatPoints[flatPoints.length - 1].distanceM - flatPoints[boundaryIndices[boundaryIndices.length - 1]].distanceM <
        TRAILING_BOUNDARY_GUARD_M
    ) {
      boundaryIndices.pop();
    }
  }

  const loopIndexByPoint: number[] = [];
  const lapStartDistanceByPoint: number[] = [];
  {
    let boundaryCursor = 0;
    let currentLoopIndex = 0;
    let currentLapStartDistanceM = flatPoints[0].distanceM;
    for (let i = 0; i < flatPoints.length; i++) {
      while (boundaryCursor < boundaryIndices.length && i > boundaryIndices[boundaryCursor]) {
        currentLoopIndex++;
        currentLapStartDistanceM = flatPoints[boundaryIndices[boundaryCursor]].distanceM;
        boundaryCursor++;
      }
      loopIndexByPoint.push(currentLoopIndex);
      lapStartDistanceByPoint.push(currentLapStartDistanceM);
    }
  }
  const maxLoopIndex = boundaryIndices.length;

  // The template shape = the first lap's own points, in order. Should
  // never be empty (loopIndexByPoint[0] is always 0, so the very first
  // point always qualifies) — but bailing out explicitly here means a
  // violated assumption fails loudly (caught by the try/catch in
  // RepRouteShapeCard) rather than silently dividing by zero into NaN
  // coordinates a few lines below, which wouldn't throw at all and would
  // just render nothing with no error to diagnose.
  const templateXY = baseXY.filter((_, i) => loopIndexByPoint[i] === 0);
  if (templateXY.length === 0) {
    throw new Error("projectRoutePoints: no points resolved to the first lap — this shouldn't be possible");
  }
  const templatePoints = flatPoints.filter((_, i) => loopIndexByPoint[i] === 0);
  const firstLapTotalDistanceM =
    templatePoints.length > 1 ? templatePoints[templatePoints.length - 1].distanceM - templatePoints[0].distanceM : 0;
  const { cumDist, totalLength } = buildArcLength(templateXY);

  const cx = templateXY.reduce((a, p) => a + p.x, 0) / templateXY.length;
  const cy = templateXY.reduce((a, p) => a + p.y, 0) / templateXY.length;
  const templateRadii = templateXY.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const avgFirstLapRadius = templateRadii.length ? templateRadii.reduce((a, b) => a + b, 0) / templateRadii.length : 10;

  // Stroke width and ring gap both derived from the TEMPLATE's own
  // geometry (fixed, regardless of lap count) rather than the final map
  // size — keeps line thickness and lap spacing constant and small no
  // matter how many laps a rep covers, instead of both compounding
  // together as more laps get added.
  const strokeWidth = Math.max(1.5, avgFirstLapRadius * 0.03);
  const ringGap = strokeWidth * 1.4;

  // Every point (on every lap) is repositioned onto the TEMPLATE shape by
  // its own proportional progress through its lap, then pushed outward if
  // it's on lap 2+.
  const adjustedXY: ProjectedPoint[] = flatPoints.map((p, i) => {
    const distanceIntoLap = p.distanceM - lapStartDistanceByPoint[i];
    const fraction = firstLapTotalDistanceM > 0 ? distanceIntoLap / firstLapTotalDistanceM : 0;
    const templatePos = sampleAtFraction(templateXY, cumDist, totalLength, fraction);

    const li = loopIndexByPoint[i];
    if (li === 0) return templatePos;

    const dx = templatePos.x - cx;
    const dy = templatePos.y - cy;
    const r = Math.hypot(dx, dy);
    if (r < 0.5) return templatePos; // avoid blowing up a point essentially on the centre
    const scale = (r + li * ringGap) / r;
    return { x: cx + dx * scale, y: cy + dy * scale };
  });

  const lookup = new Map<RoutePathPoint, { pos: ProjectedPoint; loopIndex: number; fraction: number }>();
  flatPoints.forEach((p, i) => {
    const distanceIntoLap = p.distanceM - lapStartDistanceByPoint[i];
    const fraction = firstLapTotalDistanceM > 0 ? distanceIntoLap / firstLapTotalDistanceM : 0;
    lookup.set(p, { pos: adjustedXY[i], loopIndex: loopIndexByPoint[i], fraction });
  });

  const xs = adjustedXY.map((p) => p.x);
  const ys = adjustedXY.map((p) => p.y);
  const xRange = safeMinMax(xs);
  const yRange = safeMinMax(ys);
  const boundsCenterX = (xRange.min + xRange.max) / 2;
  const boundsCenterY = (yRange.min + yRange.max) / 2;
  const spanX = xRange.max - xRange.min;
  const spanY = yRange.max - yRange.min;
  const span = Math.max(spanX, spanY, 10);

  const PADDING_FRAC = 0.08;
  const size = span * (1 + PADDING_FRAC * 2);
  const half = size / 2;

  function toScreen(adj: ProjectedPoint): ProjectedPoint {
    return { x: adj.x - boundsCenterX + half, y: -(adj.y - boundsCenterY) + half }; // flip Y: north = up
  }

  function project(p: { lat: number; lng: number }): ProjectedPoint {
    const rec = lookup.get(p as RoutePathPoint);
    const adj = rec?.pos ?? {
      x: (p.lng - centerLng) * metersPerDegLng,
      y: (p.lat - centerLat) * METERS_PER_DEG_LAT,
    };
    return toScreen(adj);
  }

  // Two different splits from two different laps can land at almost the
  // exact same FRACTION of their own lap (e.g. split 4 finishing lap 1
  // and split 8 finishing lap 2) — which, by design, puts them at nearly
  // the same position on the template, just different radii. With laps
  // drawn as tight adjacent strands (a deliberately small ring gap — see
  // ringGap above), a label sized big enough to read comfortably is WIDER
  // than the gap between two rings, so same-position labels from adjacent
  // laps collided directly.
  //
  // Fix: nudge each lap's labels a little FURTHER ALONG the template (a
  // small extra fraction of the lap, scaled by loop index) using the
  // exact same sampleAtFraction + ring-offset math every other point on
  // that lap already uses — not a new geometric operation like rotating
  // around a global centre. That distinction matters: a real track isn't
  // a perfect circle (straights have very different local curvature than
  // bends), and rotating a point near the end of a straight around a
  // distant centre by even a modest angle swung it substantially off the
  // actual shape — confirmed as the cause of labels floating away from
  // the line entirely on a real session. Sampling further along the SAME
  // parametrised curve can only ever land back on that curve.
  const LABEL_STAGGER_FRACTION = 0.05;

  function projectLabel(p: { lat: number; lng: number }): ProjectedPoint {
    const rec = lookup.get(p as RoutePathPoint);
    if (!rec) return project(p);
    const { loopIndex: li, fraction } = rec;
    if (li === 0) return toScreen(rec.pos); // first lap's labels stay exactly on the line — nothing to stagger against yet

    const staggeredFraction = fraction + li * LABEL_STAGGER_FRACTION;
    const templatePos = sampleAtFraction(templateXY, cumDist, totalLength, staggeredFraction);
    const dx = templatePos.x - cx;
    const dy = templatePos.y - cy;
    const r = Math.hypot(dx, dy);
    const offsetPos = r < 0.5 ? templatePos : { x: cx + (dx / r) * (r + li * ringGap), y: cy + (dy / r) * (r + li * ringGap) };
    return toScreen(offsetPos);
  }

  return { project, projectLabel, size, maxLoopIndex, strokeWidth };
}

// Midpoint of a split's own path — used to place its number label roughly
// centred on its stretch of the route, rather than at its start (which
// would visually crowd against the previous split's end on a tight bend).
function pathMidpoint(path: RoutePathPoint[]): RoutePathPoint | null {
  if (!path.length) return null;
  return path[Math.floor(path.length / 2)];
}

// ---------------------------------------------------------------------
// Continuous wind-gradient colouring for the route line.
//
// The map used to colour each split as ONE flat colour, using a single
// bearing averaged across that split's whole ~100m chord. On a tight
// track bend, that average bearing lands somewhere between the bend's
// entry and exit heading — which usually falls in the 90°-wide
// "crosswind" bucket regardless of what the entry/exit angles actually
// were, systematically under-counting genuine headwind/tailwind splits
// and over-colouring everything amber. It also meant a split couldn't
// show a real fade even when the athlete's heading clearly rotated
// through multiple wind angles within that single 100m.
//
// Fix: classify wind at every small point-to-point segment across the
// WHOLE rep (not per split), using each segment's own real recorded
// heading, and render it as a continuous colour ribbon — hundreds of tiny
// coloured segments rather than ten flat-coloured chords. A bend now
// genuinely fades sky-blue → purple → orange as the heading actually
// rotates through it, and a straight stays a clean solid colour because
// its heading barely changes point to point. Blue/purple/orange rather
// than green/amber/red — see the note above WIND_BADGE_CLASSES for why
// pace and wind deliberately use different colour families.
// ---------------------------------------------------------------------

type GradientSegment = { p1: RoutePathPoint; p2: RoutePathPoint; color: string };

const WIND_GRADIENT_TAILWIND: [number, number, number] = [14, 165, 233]; // sky-500
const WIND_GRADIENT_CROSSWIND: [number, number, number] = [168, 85, 247]; // purple-500
const WIND_GRADIENT_HEADWIND: [number, number, number] = [249, 115, 22]; // orange-500
const WIND_GRADIENT_GRAY = "#9ca3af";

function windGradientColor(effectiveComponentKmh: number | null, windSpeedKmh: number): string {
  if (effectiveComponentKmh == null) return WIND_GRADIENT_GRAY;
  // t: -1 = full tailwind, 0 = pure crosswind, +1 = full headwind.
  const t = Math.max(-1, Math.min(1, effectiveComponentKmh / windSpeedKmh));
  const [c1, c2, frac] =
    t >= 0
      ? ([WIND_GRADIENT_CROSSWIND, WIND_GRADIENT_HEADWIND, t] as const)
      : ([WIND_GRADIENT_TAILWIND, WIND_GRADIENT_CROSSWIND, t + 1] as const);
  const rgb = c1.map((v, i) => Math.round(v + (c2[i] - v) * frac));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function computeWindGradientSegments(splits: Split[], wind: WindReading): GradientSegment[] {
  const flatPoints: RoutePathPoint[] = splits.flatMap((s) => s.path);
  if (flatPoints.length < 2 || wind.speedKmh == null) return [];
  // classifyRelativeWind(0, wind) === "calm" is exactly the same speed
  // check the discrete split-grid badges use (see src/lib/wind.ts) —
  // reusing it here keeps "calm" consistent between the grid and the map
  // without duplicating the threshold value.
  if (classifyRelativeWind(0, wind) === "calm") return [];

  // Consecutive raw GPS samples very often share the EXACT SAME lat/lng —
  // a common artifact where the GPS chip itself updates less often than
  // the logging interval, and split boundaries additionally duplicate a
  // point on purpose (the same fix is both one split's last point and the
  // next split's first). computeBearingDeg returns null for an
  // identical-position pair, and with immediately-adjacent points this
  // was nulling out enough segments that the whole line fell back to
  // solid gray. Instead, for each point, look AHEAD (capped at a handful
  // of points, using the already-recorded distanceM rather than
  // recomputing distance) to the nearest LATER point that's moved at
  // least a small genuine distance, and use THAT pair for the bearing —
  // the drawn line segment itself still connects strictly consecutive
  // points, only the colour-driving bearing estimate uses the lookahead.
  const MIN_BEARING_BASELINE_M = 3;
  const MAX_LOOKAHEAD_POINTS = 10;

  function bearingFrom(i: number): number | null {
    let j = i + 1;
    let scanned = 0;
    while (
      j < flatPoints.length - 1 &&
      flatPoints[j].distanceM - flatPoints[i].distanceM < MIN_BEARING_BASELINE_M &&
      scanned < MAX_LOOKAHEAD_POINTS
    ) {
      j++;
      scanned++;
    }
    return computeBearingDeg(flatPoints[i].lat, flatPoints[i].lng, flatPoints[j].lat, flatPoints[j].lng);
  }

  const rawComponents: (number | null)[] = [];
  for (let i = 0; i < flatPoints.length - 1; i++) {
    const bearing = bearingFrom(i);
    rawComponents.push(effectiveWindComponentKmh(bearing, wind));
  }

  // Light ±1 smoothing so the colour genuinely fades across a bend
  // instead of flickering from point-to-point GPS noise (a very short
  // baseline between two consecutive fixes is a noisy bearing estimate).
  const smoothed = rawComponents.map((v, i) => {
    const window = [rawComponents[i - 1], v, rawComponents[i + 1]].filter((x): x is number => typeof x === "number");
    return window.length ? window.reduce((a, b) => a + b, 0) / window.length : null;
  });

  return rawComponents.map((_, i) => ({
    p1: flatPoints[i],
    p2: flatPoints[i + 1],
    color: windGradientColor(smoothed[i], wind.speedKmh as number),
  }));
}

function RepRouteShapeCard({ splits, wind }: { splits: Split[]; wind?: WindReading }) {
  // This geometry code is new and has only been tested against synthetic
  // data — real GPS traces are messier than anything a hand-built test
  // case covers. try/catch here means an edge case this hasn't seen yet
  // shows "couldn't render the route shape" for just this one card
  // instead of throwing during render and blanking the whole dialog (or
  // worse, the whole page, if nothing further up the tree catches it).
  // The actual error is still logged to the console for diagnosis.
  const projection = useMemo(() => {
    try {
      return projectRoutePoints(splits);
    } catch (err) {
      console.error("RepRouteShapeCard: projectRoutePoints threw", err);
      return null;
    }
  }, [splits]);
  const hasWind = wind?.speedKmh != null;
  const hasDirection = wind?.directionDeg != null;
  // Calm is a genuinely different state from "no reading at all" — same
  // threshold classifyRelativeWind(0, wind) already uses for the
  // discrete split-grid badges, reused here so the map's legend and the
  // grid never disagree about what counts as calm.
  const isCalm = hasWind && wind ? classifyRelativeWind(0, wind) === "calm" : false;
  // Wind SPEED alone isn't enough to classify headwind/tailwind/crosswind
  // — direction is required too. Without this check, a session with a
  // speed reading but no direction (e.g. an older fetch made before
  // direction started being captured) silently produced an all-grey line
  // with no indication why: computeWindGradientSegments doesn't
  // early-return just because direction is missing, so it still "found"
  // segments to draw, just every one of them coloured grey (no bearing
  // component computable without a direction to compare against).
  const canClassifyWind = hasWind && hasDirection && !isCalm;
  const gradientSegments = useMemo(() => {
    if (!wind || !canClassifyWind) return [];
    try {
      return computeWindGradientSegments(splits, wind);
    } catch (err) {
      console.error("RepRouteShapeCard: computeWindGradientSegments threw", err);
      return [];
    }
  }, [splits, wind, canClassifyWind]);

  // Rep-elapsed time AT THE END of each split — a running total across
  // the whole rep, not each split's own duration — for the mini
  // split-reference column below.
  const cumulativeTimesS = useMemo(() => {
    let acc = 0;
    return splits.map((s) => {
      acc += s.durationS;
      return acc;
    });
  }, [splits]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MapIcon className="h-4 w-4 text-muted-foreground" />
          Route shape
          <InfoNote>
            <p>
              Numbers match the split-by-split grid and the mini reference row below the map — find a number there
              to see where that 100m was actually run. Colour fades continuously with the athlete's actual heading,
              so a bend shades gradually between headwind/crosswind/tailwind rather than one flat colour.
            </p>
            {hasDirection && (
              <p>
                Compass arrow points the way the wind is blowing TOWARD, not where it's coming from — if it points
                roughly the same way you were running, that's a tailwind; roughly opposite, a headwind.
              </p>
            )}
            {projection && projection.maxLoopIndex > 0 && (
              <p>
                This rep covered the same loop {projection.maxLoopIndex + 1} times. Each lap is redrawn onto the
                first lap's own shape (same relative position every lap) and offset outward as a thin adjacent
                strand — this is a schematic, not a literal GPS trace, so the line's length doesn't need to match
                recorded distance exactly.
              </p>
            )}
          </InfoNote>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!projection ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            Couldn't draw a route shape for this rep — either there's no GPS trace to work with (a treadmill/indoor
            session, or a manually-logged rep with no file upload), or something about this rep's data didn't render
            cleanly. The rest of this rep's analysis above is unaffected.
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-xs mx-auto aspect-square">
                <svg viewBox={`0 0 ${projection.size} ${projection.size}`} className="w-full h-full">
                  {gradientSegments.length > 0 ? (
                    // Continuous wind-gradient ribbon — see the block
                    // comment above computeWindGradientSegments. Drawn as
                    // many small solid-colour segments rather than a
                    // single flat-coloured line per split, so bends
                    // genuinely fade between headwind/crosswind/tailwind
                    // colours instead of averaging to one misleading tone.
                    gradientSegments.map((seg, i) => {
                      const a = projection.project(seg.p1);
                      const b = projection.project(seg.p2);
                      return (
                        <line
                          key={i}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={seg.color}
                          strokeWidth={projection.strokeWidth}
                          strokeLinecap="round"
                        />
                      );
                    })
                  ) : (
                    // No wind reading for this session — draw the plain
                    // route shape as one continuous neutral-coloured line
                    // instead of per-split segments (still no gaps).
                    (() => {
                      const flat = splits.flatMap((s) => s.path);
                      const pointsAttr = flat.map((p) => {
                        const { x, y } = projection.project(p);
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      }).join(" ");
                      return (
                        <polyline
                          points={pointsAttr}
                          fill="none"
                          stroke={WIND_GRADIENT_GRAY}
                          strokeWidth={projection.strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })()
                  )}
                  {/* Numbered split labels — matches the same index shown
                      on each cell in the "Split-by-split time" grid above
                      and in the mini reference column beside this map, so
                      a specific 100m can be located here from either. A
                      small background disc keeps the number legible over
                      the coloured line and over any earlier lap the path
                      crosses again. */}
                  {splits.map((s) => {
                    const mid = pathMidpoint(s.path);
                    if (!mid) return null;
                    const { x, y } = projection.projectLabel(mid);
                    const r = projection.strokeWidth * 2.8;
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
                    const r = projection.strokeWidth * 1.8;
                    return <circle cx={x} cy={y} r={r} fill="#3b82f6" />;
                  })()}
                  {(() => {
                    const lastWithPath = [...splits].reverse().find((s) => s.path.length > 0);
                    const lastPoint = lastWithPath?.path[lastWithPath.path.length - 1];
                    if (!lastPoint) return null;
                    const { x, y } = projection.project(lastPoint);
                    const r = projection.strokeWidth * 1.8;
                    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill="currentColor" className="text-foreground" />;
                  })()}
                </svg>
                {/* Compass badge — the projection above is always drawn
                    true-north-up (see projectRoutePoints), so this never
                    needs to rotate; it's a static confirmation of that
                    orientation for the viewer. When wind direction is
                    known, the centre arrow rotates to show which way the
                    wind is actually blowing TOWARD, not where it's coming
                    from — for a runner, "does this arrow point roughly
                    the same way I'm running" is a much faster read of
                    headwind vs. tailwind than the standard meteorological
                    "wind FROM" convention would give. This one IS a live
                    indicator, unlike the N/S/E/W ring around it. */}
                <div className="absolute top-3 right-3 w-14 h-14 rounded-full border border-border bg-background/90 flex items-center justify-center shadow-sm">
                  <span className="absolute top-0.5 text-[11px] font-semibold text-foreground leading-none">N</span>
                  <span className="absolute bottom-0.5 text-[11px] text-muted-foreground leading-none">S</span>
                  <span className="absolute left-1 text-[11px] text-muted-foreground leading-none">W</span>
                  <span className="absolute right-1 text-[11px] text-muted-foreground leading-none">E</span>
                  {hasDirection ? (
                    <ArrowUp
                      className="h-5 w-5 text-sky-500"
                      style={{ transform: `rotate(${(wind!.directionDeg! + 180) % 360}deg)` }}
                      {...{ title: `Wind blowing toward ${compassLabel((wind!.directionDeg! + 180) % 360)} (from ${compassLabel(wind!.directionDeg)}) — arrow points the way the wind is pushing, not where it's coming from.` }}
                    />
                  ) : (
                    <div className="w-px h-5 bg-foreground/30" />
                  )}
                </div>
            </div>

            {/* Mini split-reference row — a compact horizontal version of
                the split-by-split grid, first split on the left / last on
                the right, so a specific split's time and cumulative rep
                elapsed time can be read right under the map without
                scrolling back up to the main grid. */}
            <div className="flex gap-1 overflow-x-auto brand-scrollbar pb-1 mt-2">
              {splits.map((s, i) => (
                <div
                  key={s.index}
                  className="w-[52px] shrink-0 rounded border border-border bg-muted/30 px-1 py-0.5 text-center leading-tight"
                  title={`Split ${s.index} · ${Math.round(s.distanceM)}m · ${(s.paceSecPerKm != null ? s.paceSecPerKm / 10 : 0).toFixed(1)}s/100m · ${secToClock(cumulativeTimesS[i])} into rep`}
                >
                  <div className="text-[9px] font-semibold">{s.index}</div>
                  <div className="text-[8px] text-muted-foreground">{Math.round(s.distanceM)}m</div>
                  <div className="text-[9px] font-medium tabular-nums">
                    {s.paceSecPerKm != null ? (s.paceSecPerKm / 10).toFixed(1) : "—"}
                  </div>
                  <div className="text-[8px] text-muted-foreground tabular-nums">{secToClock(cumulativeTimesS[i])}</div>
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
              {canClassifyWind ? (
                <div className="flex items-center gap-2 w-full max-w-xs">
                  <span>Tailwind</span>
                  <div
                    className="flex-1 h-2 rounded-full"
                    style={{ background: "linear-gradient(to right, #0ea5e9, #a855f7, #f97316)" }}
                  />
                  <span>Headwind</span>
                </div>
              ) : hasWind && isCalm ? (
                <span>Wind was calm for this session (under 6 km/h) — not enough to meaningfully affect pace, path shown uncoloured.</span>
              ) : hasWind && !hasDirection ? (
                <span>Wind speed is known for this session but not direction — can't classify headwind/tailwind without it, path shown uncoloured.</span>
              ) : (
                <span>No wind reading for this session — path shown uncoloured.</span>
              )}
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Start
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 bg-foreground inline-block" /> Finish
                </span>
              </div>
            </div>
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
            Rep Analysis
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
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  points: RepPointLike[];
  repRows: RepRowLike[];
  selectedRepIndex: number | null;
  repLabel: string;
  targetPaceSecPerKm?: number | null;
  wind?: WindReading;
  onNavigate?: (direction: -1 | 1) => void;
}) {
  const { repPoints, wasDistanceCalibrated } = useMemo(() => {
    if (selectedRepIndex == null) return { repPoints: [] as RepPointLike[], wasDistanceCalibrated: false };
    const slices = sliceRepPoints(points, repRows);
    const rawRepPoints = slices[selectedRepIndex] ?? [];
    // GPS distance on a track is a known weak point (satellite multipath
    // on bends inflates the watch's own cumulative distance, sometimes
    // enough to shift the 100m split count by a full split — the classic
    // symptom is a 1200m rep coming out as 13 splits). Elapsed TIME has no
    // equivalent failure mode, so it's left untouched; only distance gets
    // rescaled, anchored to repRows[selectedRepIndex].distanceM — the same
    // already-corrected rep distance shown everywhere else in the app for
    // this rep (see the "* adjusted" distance in the Session segments
    // table). See calibrateDistanceToTarget in rep-split-analysis.ts for
    // the full reasoning on why rescaling (not trimming) is the right
    // correction for this specific failure mode.
    const targetDistanceM = repRows[selectedRepIndex]?.distanceM ?? null;
    const calibrated = calibrateDistanceToTarget(rawRepPoints, targetDistanceM);
    // calibrateDistanceToTarget returns the exact same array reference
    // when no rescaling was needed — a cheap, correct way to detect
    // whether calibration actually changed anything, for the UI
    // disclosure below. Never state a correction happened when it didn't.
    const didCalibrate = rawRepPoints.length > 0 && calibrated !== rawRepPoints;

    // Diagnostic only — if the split count still looks wrong after this,
    // the number that matters is targetDistanceM here: calibration can
    // only ever be as good as repRows[selectedRepIndex].distanceM itself.
    // If THAT number is also GPS-inflated (e.g. this rep's step wasn't a
    // distance target, or the app's own rep-level correction didn't fire
    // for it), calibrating against it won't fix anything — it needs a
    // trustworthy target to correct toward in the first place.
    if (rawRepPoints.length > 1) {
      const sorted = [...rawRepPoints].sort((a, b) => Number(a.elapsed_s ?? 0) - Number(b.elapsed_s ?? 0));
      const rawSpan = Number(sorted[sorted.length - 1].distance_m ?? 0) - Number(sorted[0].distance_m ?? 0);
      console.log("RepSplitAnalysisDialog: distance calibration check", {
        repIndex: selectedRepIndex,
        rawGpsDistanceM: Number(rawSpan.toFixed(1)),
        targetDistanceM,
        calibrationApplied: didCalibrate,
      });
    }

    return { repPoints: calibrated, wasDistanceCalibrated: didCalibrate };
  }, [points, repRows, selectedRepIndex]);

  const splits = useMemo(() => build100mSplits(repPoints, 100), [repPoints]);

  const summary = useMemo(() => computeSplitSummary(splits), [splits]);
  // What each split's colour is measured against. Prefer the coach's own
  // target pace for this rep when one exists — "on pace" should mean
  // "close to what was actually planned," not just "close to whatever
  // pace this rep happened to average," which can quietly hide a rep that
  // was uniformly too fast or too slow (every split agreeing with each
  // other doesn't mean they agreed with the plan). Falls back to the
  // rep's own average only when there's no target to compare against —
  // still useful for an unstructured or untargeted rep, just a different,
  // weaker claim, and the legend text below says which one is in use.
  const referencePaceSecPerKm = targetPaceSecPerKm ?? summary.avgPaceSecPerKm;
  const referenceIsTarget = targetPaceSecPerKm != null;
  // Rep's own average HR — the reference point for HR-mode colouring, the
  // same role summary.avgPaceSecPerKm plays for pace (there's no coach-set
  // "target HR" for a rep the way there's a target pace, so this always
  // falls back to the rep's own average).
  const avgHrAcrossSplits = useMemo(() => {
    const vals = splits.map((s) => s.avgHr).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [splits]);
  // Split-by-split grid content toggle — Pace (default) shows the same
  // per-100m value as the unit toggle below; Time shows rep-elapsed time
  // at the END of that split (a running total, matching what the route
  // map's mini reference boxes already show below); HR shows that split's
  // own average heart rate. The wind arrow badge stays visible in every
  // mode — it answers a different question (which way was the wind) than
  // whichever value is currently on display.
  // Declared here (above splitColors) because that memo reads it.
  const [gridMode, setGridMode] = useState<"pace" | "time" | "hr">("pace");
  // The %-deviation threshold in colorForSplit can legitimately produce
  // ZERO green splits for a coarse-grained metric like HR: each split's
  // avgHr is rounded to a whole bpm, but the reference (the average of
  // those rounded values) is usually a fractional number, and ±0.5% of a
  // typical HR is under 1 bpm — tighter than the rounding itself. That
  // means "no split happened to land within a bpm of the average" is
  // common even though there's always SOME split that's closest. This
  // finds that closest split (for whichever mode's own reference value)
  // and guarantees it reads green, so "closest to average" is never
  // silently invisible. Applied to every mode, not just HR — pace can hit
  // the same edge case with a target pace that sits a bit off from what
  // was actually run.
  const splitColors = useMemo(() => {
    const getValue = (s: Split): number | null => (gridMode === "hr" ? s.avgHr : s.paceSecPerKm);
    const referenceValue = gridMode === "hr" ? avgHrAcrossSplits : referencePaceSecPerKm;
    const colors = splits.map((s) => colorForSplit(getValue(s), referenceValue));

    if (referenceValue != null) {
      let bestIdx = -1;
      let bestDeviation = Infinity;
      splits.forEach((s, i) => {
        const v = getValue(s);
        if (v == null) return;
        const deviation = Math.abs(v - referenceValue);
        if (deviation < bestDeviation) {
          bestDeviation = deviation;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) colors[bestIdx] = "green";
    }

    return colors;
  }, [splits, gridMode, avgHrAcrossSplits, referencePaceSecPerKm]);
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
  const cumulativeTimesS = useMemo(() => {
    let acc = 0;
    return splits.map((s) => {
      acc += s.durationS;
      return acc;
    });
  }, [splits]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden brand-scrollbar">
        {/* overflow-x-hidden is deliberate, not decorative: with only
            overflow-y-auto set, the CSS spec computes overflow-x to auto as
            well (a non-'visible' value on one axis forces 'visible' on the
            other to compute to 'auto'). That's exactly what let one
            unwrappable child (see the wind description below) grow the
            WHOLE dialog a horizontal scrollbar instead of just wrapping or
            clipping. This doesn't fix a specific bug — it prevents this
            entire failure shape from being possible again, regardless of
            what future content gets added inside. */}
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* min-w-0 here is the actual fix for the "resize hasn't
                happened" report. flex-wrap on the OUTER row above only
                lets this whole left group drop to its own line versus the
                Per-100m/Pace toggle on the right — it does nothing to let
                THIS group's own contents (nav buttons + icon + title)
                shrink below their natural size, because flex items default
                to min-width:auto (their content's intrinsic width) unless
                explicitly told otherwise. Without min-w-0 here, a long rep
                label could keep forcing this row wider than the dialog
                regardless of anything at the outer level. */}
            <div className="flex items-center gap-2.5 min-w-0">
              {onNavigate && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate(-1)}
                    disabled={selectedRepIndex == null || selectedRepIndex <= 0}
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Previous rep"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate(1)}
                    disabled={selectedRepIndex == null || selectedRepIndex >= repRows.length - 1}
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Next rep"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Ruler className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">100m split breakdown</div>
                <DialogTitle className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
                  <span className="break-words">{repLabel}</span>
                  {selectedRepIndex != null && repRows[selectedRepIndex]?.distanceM != null && (
                    <span className="text-sm font-normal text-muted-foreground shrink-0">
                      · {Math.round(repRows[selectedRepIndex].distanceM)}m
                    </span>
                  )}
                </DialogTitle>
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
              <>
                {" "}
                {/* Only the short "icon + Xkm/h from Y" segment is a flex
                    row — it's always short enough to never wrap badly. The
                    long explanatory clause after it is deliberately OUTSIDE
                    the flex container and flows as normal text, so it wraps
                    like any other sentence instead of forcing one
                    unbreakable line that used to push the whole dialog into
                    horizontal scroll (inline-flex defaults to nowrap, and
                    previously wrapped the entire sentence, icon included). */}
                <span className="inline-flex items-center gap-1 align-text-bottom">
                  <Wind className="h-3 w-3" />
                  {Math.round(wind.speedKmh)} km/h
                  {wind.directionDeg != null && ` from ${compassLabel(wind.directionDeg)}`}
                </span>
                {" "}— see the wind icon on each split below for headwind/tailwind/crosswind on that stretch.
              </>
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
            {wasDistanceCalibrated && (
              <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-md px-2.5 py-1.5">
                GPS distance for this rep was rescaled to match its recorded total — a common GPS-on-track issue
                (satellite signal on bends can inflate distance) that otherwise throws off where 100m splits fall.
                Elapsed time is untouched; only distance was corrected.
              </div>
            )}
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

            {/* Rep Analysis (was "High-res trace") */}
            <RepTraceChart repPoints={repPoints} />

            {/* Colour-coded split grid */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    Split-by-split (100m)
                    <InfoNote>
                      {gridMode === "time" && (
                        <p>
                          Top: this split's own time per 100m. Below: rep-elapsed time at the end of this split (a
                          running total, e.g. "0:58" for where the third 100m finished).
                        </p>
                      )}
                      {gridMode === "hr" && <p>Average heart rate across each 100m.</p>}
                      <p>Small number in each cell matches its label on the route shape map below.</p>
                      {wind?.speedKmh != null && (
                        <p>
                          Wind arrow shows relative to each split's own running direction, not true north — hover a
                          split for its actual heading and wind-from compass direction.
                        </p>
                      )}
                      <p>
                        "Above"/"below" isn't automatically good or bad — it's just direction. Below-average HR
                        early in a rep and above-average HR late in it are both completely normal; for pace it
                        depends on what this rep was for.{" "}
                        {referenceIsTarget
                          ? `Pace is measured against this rep's own target pace (${paceFmt(targetPaceSecPerKm)}/km).`
                          : "No target pace set for this rep — pace is measured against this rep's own average instead."}
                      </p>
                    </InfoNote>
                  </CardTitle>
                  <div className="flex border rounded-md overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setGridMode("pace")}
                      className={`px-2 py-0.5 ${gridMode === "pace" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                    >
                      Pace
                    </button>
                    <button
                      type="button"
                      onClick={() => setGridMode("time")}
                      className={`px-2 py-0.5 border-l ${gridMode === "time" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                    >
                      Time
                    </button>
                    {hasHrData && (
                      <button
                        type="button"
                        onClick={() => setGridMode("hr")}
                        className={`px-2 py-0.5 border-l ${gridMode === "hr" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                      >
                        HR
                      </button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                  {splits.map((s, i) => {
                    const color = splitColors[i];
                    return (
                      <div
                        key={s.index}
                        className={`relative rounded-md border px-1 py-1.5 text-center text-xs font-medium tabular-nums ${SPLIT_COLOR_CLASSES[color]}`}
                        title={`Split ${s.index} — ${Math.round(s.distanceM)}m split, ${Math.round(s.cumulativeDistanceM)}m into rep${s.isPartial ? " (partial)" : ""}`}
                      >
                        <span className="absolute top-0.5 left-1 text-[9px] font-normal opacity-60 leading-none">
                          {s.index}
                        </span>
                        {gridMode === "time" ? (
                          <>
                            {formatSplitTime(s.paceSecPerKm, "sec100")}
                            <div className="text-[9px] font-normal opacity-70 leading-none mt-0.5">
                              {secToClock(cumulativeTimesS[i])}
                            </div>
                          </>
                        ) : gridMode === "hr" ? (
                          s.avgHr != null ? `${Math.round(s.avgHr)}` : "—"
                        ) : (
                          formatSplitTime(s.paceSecPerKm, "pace")
                        )}
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
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/40 inline-block" />
                    Near average
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/40 inline-block" />
                    Below average
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-red-500/40 inline-block" />
                    Above average
                  </span>
                  {splits.some((s) => s.isPartial) && <span>* partial split (short of 100m)</span>}
                  {wind?.speedKmh != null && (
                    <>
                      <span className="flex items-center gap-1 text-orange-500">
                        <ArrowUp className="h-3 w-3" style={{ transform: "rotate(180deg)" }} /> Headwind
                      </span>
                      <span className="flex items-center gap-1 text-sky-500">
                        <ArrowUp className="h-3 w-3" /> Tailwind
                      </span>
                      <span className="flex items-center gap-1 text-purple-500">
                        <ArrowUp className="h-3 w-3" style={{ transform: "rotate(90deg)" }} /> Crosswind
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

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
                    Best 400m+
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {bestSection ? (
                    <div className="space-y-1 text-sm">
                      {/* Total elapsed time for the window is the primary
                          number — unambiguous regardless of unit
                          preference, unlike showing pace alone here (see
                          note below). Pace is still shown, just clearly
                          labelled as a rate rather than bare "Xs", which
                          previously read as "this whole window took Xs
                          total" — physically impossible for anything
                          resembling a real 400m pace and confirmed
                          confusing in practice. */}
                      <div className="text-xl font-semibold tabular-nums">{secToClock(bestSection.timeS)}</div>
                      <div className="text-muted-foreground">
                        {formatSplitTime(bestSection.paceSecPerKm, unit)}
                        {unit === "sec100" ? "/100m pace" : " pace"} over{" "}
                        {Math.round(bestSection.endDistanceM - bestSection.startDistanceM)}m
                      </div>
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
