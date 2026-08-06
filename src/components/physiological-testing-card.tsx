import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
import { paceFmt, secToClock, clockToSec } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FlaskConical, Zap, Trash2, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

// One row per athlete+metric — adding a new measurement replaces whatever
// was previously recorded for that metric (per Chris's call), rather than
// keeping both side by side. "Current" value is simply that one row; the
// history list below will normally match the current-values grid 1:1,
// since there's nothing left to differentiate once older entries are
// replaced rather than retained.
// See supabase/migrations/20260718000001_performance_profile_phase1.sql
// for the schema + RLS (coach-only write for now, per Chris's call).

export const METRIC_OPTIONS: { value: string; label: string; unit: string }[] = [
  { value: "resting_hr", label: "Resting HR", unit: "bpm" },
  { value: "max_hr", label: "Maximum HR", unit: "bpm" },
  { value: "threshold_hr", label: "Threshold HR", unit: "bpm" },
  { value: "threshold_pace", label: "Threshold pace", unit: "sec/km" },
  { value: "threshold_power", label: "Threshold power", unit: "W" },
  { value: "vo2max", label: "VO2max", unit: "ml/kg/min" },
  { value: "critical_speed", label: "Critical speed", unit: "m/s" },
  { value: "critical_power", label: "Critical power", unit: "W" },
  { value: "lactate_threshold", label: "Lactate threshold", unit: "mmol/L" },
  { value: "running_economy", label: "Running economy", unit: "ml/kg/km" },
  { value: "anaerobic_speed_reserve", label: "Anaerobic speed reserve", unit: "m/s" },
  { value: "hr_recovery", label: "HR recovery", unit: "bpm/min" },
  { value: "hrv", label: "HRV", unit: "ms" },
];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "laboratory", label: "Laboratory test" },
  { value: "coach_entered", label: "Coach entered" },
  { value: "athlete_entered", label: "Athlete entered" },
  { value: "garmin", label: "Garmin" },
  { value: "coros", label: "COROS" },
  { value: "polar", label: "Polar" },
  { value: "apple_health", label: "Apple Health" },
  { value: "other_device", label: "Other device" },
  { value: "platform_calculated", label: "Platform calculated" },
  { value: "platform_estimated", label: "Platform estimated" },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "measured", label: "Measured" },
  { value: "device_derived", label: "Device-derived" },
  { value: "estimated", label: "Estimated" },
  { value: "coach_entered", label: "Coach-entered" },
];

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200",
  moderate: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-rose-100 text-rose-700 border-rose-200",
};

const TYPE_STYLES: Record<string, string> = {
  measured: "bg-sky-100 text-sky-700 border-sky-200",
  device_derived: "bg-violet-100 text-violet-700 border-violet-200",
  estimated: "bg-muted text-muted-foreground border-border",
  coach_entered: "bg-orange-100 text-orange-700 border-orange-200",
};

function metricLabel(metric: string) {
  return METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric;
}
function sourceLabel(source: string) {
  return SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? source;
}
function typeLabel(t: string) {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

// Threshold pace is stored as raw sec/km (so it stays comparable as a
// number), but is never shown as raw seconds anywhere else in the app —
// the Zones page always renders it through paceFmt (mm:ss /km). This
// keeps that same convention here instead of leaking "185.766 sec/km" to
// a coach. Every other metric just rounds to 1 decimal (whole numbers
// like HR stay whole) rather than trailing raw floating-point digits from
// formulas like VDOT.
function formatMeasurementValue(metric: string, value: number, unit: string | null): string {
  if (metric === "threshold_pace") return paceFmt(value);
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

// Rounds a raw numeric value the same way formatMeasurementValue displays
// it, for pre-filling the Add Measurement form so what a coach sees typed
// in the box matches what they saw on the tile they clicked "Log this
// value" from — pace metrics round to the nearest whole second (mm:ss
// only has second-level resolution anyway), everything else to 1 decimal.
function roundForEntry(metric: string, value: number): number {
  if (metric === "threshold_pace") return Math.round(value);
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

type TrendDirection = "up" | "down" | "flat";

// Deliberately neutral (slate, not green/red) — whether "up" is good
// depends on the metric (resting HR down is good, VO2max up is good,
// threshold pace down is good), and this card doesn't have that
// per-metric judgment table yet. Just reports direction + magnitude,
// leaves "is that good" to the coach reading it.
function computeTrend(row: TestRow): { direction: TrendDirection; previousLabel: string } | null {
  if (row.previous_value == null) return null;
  const prev = Number(row.previous_value);
  if (prev === 0 || Number.isNaN(prev)) return null;
  const pctChange = ((row.value - prev) / Math.abs(prev)) * 100;
  const direction: TrendDirection = Math.abs(pctChange) < 0.5 ? "flat" : pctChange > 0 ? "up" : "down";
  const previousLabel = `${formatMeasurementValue(row.metric, prev, row.unit)}${
    row.previous_test_date ? ` \u00b7 ${row.previous_test_date}` : ""
  }`;
  return { direction, previousLabel };
}

function TrendIcon({ direction }: { direction: TrendDirection }) {
  if (direction === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />;
  if (direction === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

// Same labels the Zones page's own Method dropdown uses
// (zone-boundaries-card.tsx's METHOD_LABEL) — kept in sync manually since
// this is a read-only display copy, not a shared import, to avoid coupling
// this card to that one's internals.
const ZONE_METHOD_LABEL: Record<string, string> = {
  max_hr_pct: "90% of HR max",
  best_effort_3k_plus: "Best effort ≥3K (12mo)",
  vdot: "VDOT (Daniels)",
};

type PrefillTest = {
  metric: string;
  value: string;
  source: string;
  measurementType: string;
  method: string;
};

type TestRow = {
  id: string;
  metric: string;
  value: number;
  unit: string | null;
  test_date: string;
  source: string;
  measurement_type: string;
  method: string | null;
  confidence: string;
  notes: string | null;
  previous_value: number | null;
  previous_test_date: string | null;
};

export function PhysiologicalTestingCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<PrefillTest | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const { data: tests, isLoading } = useQuery({
    queryKey: ["physio-tests", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_physiological_tests" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("test_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TestRow[];
    },
  });

  // Latest row per metric — this is the "current value" the spec calls for,
  // computed client-side from the already-fetched, already-sorted list
  // rather than a second query.
  const latestByMetric = useMemo(() => {
    const map = new Map<string, TestRow>();
    for (const row of tests ?? []) {
      if (!map.has(row.metric)) map.set(row.metric, row);
    }
    return map;
  }, [tests]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["physio-tests", athleteId] });
  }

  function openAdd(pre?: PrefillTest) {
    setPrefill(pre ?? null);
    setDialogOpen(true);
  }

  async function deleteTest(id: string) {
    const { error } = await supabase.from("athlete_physiological_tests" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Measurement deleted");
    invalidate();
  }

  const historyRows = showAllHistory ? (tests ?? []) : (tests ?? []).slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[var(--accent-red)]" />
            Physiological testing
          </CardTitle>
          <CardDescription>
            Dated, sourced measurements — one current value per metric. Adding a new measurement replaces the old one.
          </CardDescription>
        </div>
        {isCoach && (
          <Button size="sm" variant="outline" onClick={() => openAdd()}>
            <Plus className="h-4 w-4 mr-1" />
            Add measurement
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <PlatformValuesSection athleteId={athleteId} isCoach={isCoach} onLog={openAdd} />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : latestByMetric.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            No measurements logged yet.{isCoach ? " Use \u201CAdd measurement\u201D to record the first one." : ""}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from(latestByMetric.values()).map((row) => {
              const trend = computeTrend(row);
              return (
              <div key={row.metric} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{metricLabel(row.metric)}</div>
                  {isCoach && (
                    <button
                      type="button"
                      onClick={() => deleteTest(row.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label={`Delete ${metricLabel(row.metric)} measurement`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="text-lg font-semibold tabular-nums">
                    {formatMeasurementValue(row.metric, row.value, row.unit)}
                  </div>
                  {trend && (
                    <span title={`Previous: ${trend.previousLabel}`}>
                      <TrendIcon direction={trend.direction} />
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge variant="outline" className={TYPE_STYLES[row.measurement_type] ?? ""}>
                    {typeLabel(row.measurement_type)}
                  </Badge>
                  <Badge variant="outline" className={CONFIDENCE_STYLES[row.confidence] ?? ""}>
                    {row.confidence} confidence
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {sourceLabel(row.source)} · {row.test_date}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {(tests ?? []).length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Testing history</div>
            <div className="space-y-1.5">
              {historyRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between text-sm border-b py-1.5 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground tabular-nums shrink-0">{row.test_date}</span>
                    <span className="font-medium truncate">{metricLabel(row.metric)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums">{formatMeasurementValue(row.metric, row.value, row.unit)}</span>
                    <Badge variant="outline" className={`text-[10px] ${CONFIDENCE_STYLES[row.confidence] ?? ""}`}>
                      {row.confidence}
                    </Badge>
                    {isCoach && (
                      <button
                        type="button"
                        onClick={() => deleteTest(row.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${metricLabel(row.metric)} measurement from ${row.test_date}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(tests ?? []).length > 8 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAllHistory((v) => !v)}>
                {showAllHistory ? "Show less" : `Show all ${(tests ?? []).length}`}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {isCoach && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AddTestDialog
            key={prefill ? `${prefill.metric}-${prefill.value}` : "blank"}
            athleteId={athleteId}
            initial={prefill}
            onSaved={() => {
              setDialogOpen(false);
              invalidate();
            }}
          />
        </Dialog>
      )}
    </Card>
  );
}

// Read-only values already computed elsewhere in the app (Zones page /
// athlete_zone_profiles) — shown here so a coach doesn't have to retype a
// number the platform already knows, with a one-click way to drop it into
// dated history instead of leaving it as a number that's only ever
// "current". Deliberately its own query rather than folded into the
// zone-boundaries-card component — same table, same query key
// (["zone-profile", athleteId]) as that card and the athlete's own zones
// view, so a change on either page invalidates and refreshes both without
// a duplicate fetch.
function PlatformValuesSection({
  athleteId,
  isCoach,
  onLog,
}: {
  athleteId: string;
  isCoach: boolean;
  onLog: (pre: PrefillTest) => void;
}) {
  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_zone_profiles").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data as any;
    },
  });

  if (!zoneProfile) return null;

  // Maps the Zones page's own Auto/Manual/Test distinction onto this
  // table's source + type vocabulary, so a value that was actually lab- or
  // field-tested on the Zones page doesn't get logged here as merely
  // "estimated" — same three-way distinction, just relabeled for this
  // table's schema.
  function sourceForThresholdType(thresholdSource: string | null | undefined): { source: string; type: string } {
    if (thresholdSource === "test") return { source: "laboratory", type: "measured" };
    if (thresholdSource === "manual") return { source: "coach_entered", type: "coach_entered" };
    return { source: "platform_calculated", type: "estimated" };
  }

  const rows: Array<{
    key: string;
    label: string;
    value: number | null | undefined;
    unit: string;
    metric: string;
    method: string;
    source: string;
    type: string;
  }> = [];

  if (zoneProfile.hr_max != null) {
    rows.push({
      key: "hr_max",
      label: "Max HR",
      value: zoneProfile.hr_max,
      unit: "bpm",
      metric: "max_hr",
      method: "",
      source: "coach_entered",
      type: "coach_entered",
    });
  }
  if (zoneProfile.hr_threshold != null) {
    const st = sourceForThresholdType(zoneProfile.hr_threshold_source);
    rows.push({
      key: "hr_threshold",
      label: "Threshold HR",
      value: zoneProfile.hr_threshold,
      unit: "bpm",
      metric: "threshold_hr",
      method: zoneProfile.hr_method ? ZONE_METHOD_LABEL[zoneProfile.hr_method] ?? zoneProfile.hr_method : "",
      ...st,
    });
  }
  if (zoneProfile.pace_threshold_sec_per_km != null) {
    const st = sourceForThresholdType(zoneProfile.pace_threshold_source);
    rows.push({
      key: "pace_threshold",
      label: "Threshold pace",
      value: zoneProfile.pace_threshold_sec_per_km,
      unit: "sec/km",
      metric: "threshold_pace",
      method: zoneProfile.pace_method ? ZONE_METHOD_LABEL[zoneProfile.pace_method] ?? zoneProfile.pace_method : "",
      ...st,
    });
  }
  if (zoneProfile.vdot != null) {
    rows.push({
      key: "vdot",
      label: "VDOT",
      value: zoneProfile.vdot,
      unit: "VDOT",
      metric: "vo2max",
      method: "VDOT (Daniels) \u2014 from best qualifying race",
      source: "platform_calculated",
      type: "estimated",
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed p-3 bg-muted/30">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
        <Zap className="h-3.5 w-3.5" />
        Already on the Zones page
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {rows.map((r) => (
          <div key={r.key} className="rounded border bg-background p-2.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{r.label}</div>
            <div className="text-base font-semibold tabular-nums">{formatMeasurementValue(r.metric, r.value, r.unit)}</div>
            {r.method && <div className="text-[10px] text-muted-foreground mt-0.5">{r.method}</div>}
            {isCoach && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 mt-1 text-xs"
                onClick={() =>
                  onLog({
                    metric: r.metric,
                    value: String(roundForEntry(r.metric, r.value)),
                    source: r.source,
                    measurementType: r.type,
                    method: r.method,
                  })
                }
              >
                Log this value
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddTestDialog({
  athleteId,
  onSaved,
  initial,
}: {
  athleteId: string;
  onSaved: () => void;
  initial?: PrefillTest | null;
}) {
  const [metric, setMetric] = useState(initial?.metric ?? "vo2max");
  const [value, setValue] = useState(initial?.value ?? "");
  const [testDate, setTestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(initial?.source ?? "coach_entered");
  const [measurementType, setMeasurementType] = useState(initial?.measurementType ?? "coach_entered");
  const [confidence, setConfidence] = useState("moderate");
  const [method, setMethod] = useState(initial?.method ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isPace = metric === "threshold_pace";

  // Threshold pace is entered as mm:ss, same as every pace field elsewhere
  // in the app (Zones page's EditablePace) — this draft holds the typed
  // text; `value` (the numeric sec/km that actually gets saved) only
  // updates once the text is a valid mm:ss on blur, same commit pattern as
  // EditablePace.
  const [paceDraft, setPaceDraft] = useState(() => (isPace && initial?.value ? secToClock(Number(initial.value)) : ""));

  // Only relevant if the coach changes the Metric dropdown mid-dialog to
  // Threshold pace — keeps the mm:ss field in sync with whatever numeric
  // value (if any) is already sitting in `value` at that point.
  useEffect(() => {
    if (metric === "threshold_pace") {
      setPaceDraft(value ? secToClock(Number(value)) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  function commitPaceDraft() {
    const sec = clockToSec(paceDraft);
    if (sec != null && sec > 0) {
      setValue(String(Math.round(sec)));
      setPaceDraft(secToClock(sec));
    } else {
      setPaceDraft(value ? secToClock(Number(value)) : "");
    }
  }

  const unit = METRIC_OPTIONS.find((m) => m.value === metric)?.unit ?? "";

  async function save() {
    let numericValue = Number(value);
    if (isPace) {
      const sec = clockToSec(paceDraft);
      if (sec == null || sec <= 0) {
        toast.error("Enter a pace as mm:ss");
        return;
      }
      numericValue = Math.round(sec);
    }
    if (!isPace && (!value || Number.isNaN(numericValue))) {
      toast.error("Enter a numeric value");
      return;
    }
    setSaving(true);
    // Overriding rather than appending, per Chris's call: a new measurement
    // for a metric replaces the previous one for this athlete rather than
    // sitting alongside it. This is a deliberate change from the original
    // "never overwrite" design (see the comment at the top of this file) —
    // there's now exactly one row per athlete+metric, so "history" below
    // reduces to "current values" over time. No unique DB constraint
    // backs this (the table still allows multiple rows per metric), so
    // it's enforced here: delete any existing row(s) for this metric, then
    // insert the new one.
    //
    // Before deleting, grab whatever's currently on record so it can ride
    // along on the new row as previous_value/previous_test_date — gives
    // the Trend indicator one real step of history without turning this
    // back into a full audit log.
    const { data: existingRows, error: existingError } = await supabase
      .from("athlete_physiological_tests" as any)
      .select("value, test_date")
      .eq("athlete_id", athleteId)
      .eq("metric", metric)
      .limit(1);
    if (existingError) {
      setSaving(false);
      toast.error(existingError.message);
      return;
    }
    const existing = (existingRows ?? [])[0] as { value: number; test_date: string } | undefined;

    const { error: deleteError } = await supabase
      .from("athlete_physiological_tests" as any)
      .delete()
      .eq("athlete_id", athleteId)
      .eq("metric", metric);
    if (deleteError) {
      setSaving(false);
      toast.error(deleteError.message);
      return;
    }
    const { error } = await supabase.from("athlete_physiological_tests" as any).insert({
      athlete_id: athleteId,
      metric,
      value: numericValue,
      unit,
      test_date: testDate,
      source,
      measurement_type: measurementType,
      confidence,
      method: method.trim() || null,
      notes: notes.trim() || null,
      previous_value: existing?.value ?? null,
      previous_test_date: existing?.test_date ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Measurement saved");
    onSaved();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initial ? "Log platform value" : "Add measurement"}</DialogTitle>
        <DialogDescription>
          {initial
            ? "Pulled from the Zones page — review the date and confidence, then save it into this athlete's history."
            : "Saving replaces any existing measurement for this metric \u2014 each metric keeps just its most current value."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRIC_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Value {isPace ? "(mm:ss per km)" : `(${unit || "no unit"})`}</Label>
            {isPace ? (
              <Input
                type="text"
                inputMode="numeric"
                placeholder="mm:ss"
                value={paceDraft}
                onChange={(e) => setPaceDraft(e.target.value)}
                onBlur={commitPaceDraft}
              />
            ) : (
              <Input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Test date</Label>
            <Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={measurementType} onValueChange={setMeasurementType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Confidence</Label>
            <Select value={confidence} onValueChange={setConfidence}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs">Method (optional)</Label>
          <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. treadmill ramp test, 5K time-trial estimate" />
        </div>

        <div>
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <DialogFooter>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save measurement"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
