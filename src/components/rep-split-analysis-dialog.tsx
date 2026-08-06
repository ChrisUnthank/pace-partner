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

import { useMemo } from "react";
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
import { Ruler, TrendingUp, HeartPulse, Gauge, Trophy, BarChart3 } from "lucide-react";
import { secToClock, paceFmt } from "@/lib/format";
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

const SPLIT_COLOR_CLASSES: Record<string, string> = {
  green: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  yellow: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40",
  red: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40",
  none: "bg-muted text-muted-foreground border-border",
};

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

function PaceThroughRepChart({ splits }: { splits: Split[] }) {
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
            tickFormatter={(v) => paceFmt(v)}
            width={64}
            domain={["dataMin - 5", "dataMax + 5"]}
          />
          <Tooltip
            formatter={(value: any) => [paceFmt(Number(value)), "Pace"]}
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

export function RepSplitAnalysisDialog({
  open,
  onOpenChange,
  points,
  repRows,
  selectedRepIndex,
  repLabel,
  targetPaceSecPerKm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  points: RepPointLike[];
  repRows: RepRowLike[];
  selectedRepIndex: number | null;
  repLabel: string;
  targetPaceSecPerKm?: number | null;
}) {
  const splits = useMemo(() => {
    if (selectedRepIndex == null) return [];
    const slices = sliceRepPoints(points, repRows);
    const repPoints = slices[selectedRepIndex] ?? [];
    return build100mSplits(repPoints, 100);
  }, [points, repRows, selectedRepIndex]);

  const summary = useMemo(() => computeSplitSummary(splits), [splits]);
  const drift = useMemo(() => computeDynamicsDrift(splits), [splits]);
  const hrDrift = useMemo(() => computeHrDrift(splits), [splits]);
  const fatigue = useMemo(() => computeFatigueScore(splits), [splits]);
  const bestSection = useMemo(() => computeBestSection(splits, 400), [splits]);
  const paceDistribution = useMemo(() => computePaceDistribution(splits, 5), [splits]);

  const hasSplits = splits.length > 0;
  const hasDynamicsData = splits.some((s) => s.avgCadence != null || s.avgGroundContactTimeMs != null || s.avgVerticalOscillationCm != null);
  const hasHrData = splits.some((s) => s.avgHr != null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Ruler className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">100m split breakdown</div>
              <DialogTitle>{repLabel}</DialogTitle>
            </div>
          </div>
          <DialogDescription>
            Every 100m of this rep, broken out from the raw watch/GPS trace.
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
              <StatBox label="Average" value={paceFmt(summary.avgPaceSecPerKm)} />
              <StatBox label="Fastest" value={paceFmt(summary.fastestSecPerKm)} />
              <StatBox label="Slowest" value={paceFmt(summary.slowestSecPerKm)} />
              <StatBox
                label="Pacing range"
                value={summary.pacingRangeSec != null ? `${summary.pacingRangeSec.toFixed(1)}s` : "—"}
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
                  Split-by-split pace
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                  {splits.map((s) => {
                    const color = colorForSplit(s.paceSecPerKm, summary.avgPaceSecPerKm);
                    return (
                      <div
                        key={s.index}
                        className={`rounded-md border px-1 py-1.5 text-center text-xs font-medium tabular-nums ${SPLIT_COLOR_CLASSES[color]}`}
                        title={`${Math.round(s.distanceM)}m split, ${Math.round(s.cumulativeDistanceM)}m into rep${s.isPartial ? " (partial)" : ""}`}
                      >
                        {s.paceSecPerKm != null ? secToClock(s.paceSecPerKm) : "—"}
                        {s.isPartial && <span className="ml-0.5 text-[9px] opacity-70">*</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
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
                </div>
              </CardContent>
            </Card>

            {/* Pace graph */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Pace through the rep
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PaceThroughRepChart splits={splits} />
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
                      <div className="text-xl font-semibold tabular-nums">{paceFmt(bestSection.paceSecPerKm)}</div>
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
                  <CardTitle className="text-sm">Time spent by pace</CardTitle>
                </CardHeader>
                <CardContent>
                  {paceDistribution.length ? (
                    <div className="space-y-1.5">
                      {paceDistribution.map((band) => (
                        <div key={band.label} className="flex items-center gap-2 text-xs">
                          <div className="w-20 shrink-0 text-muted-foreground tabular-nums">{paceFmt(band.loSecPerKm)}</div>
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
