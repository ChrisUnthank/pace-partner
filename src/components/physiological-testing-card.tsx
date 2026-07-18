import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FlaskConical } from "lucide-react";

// One row per measurement — "current" value for a metric is simply the
// most recent row, so a lab-tested VO2max and a watch-estimated VO2max
// both stay visible in history without ever overwriting one another.
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
  estimated: "bg-slate-100 text-slate-700 border-slate-200",
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
};

export function PhysiologicalTestingCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const [showForm, setShowForm] = useState(false);
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
            Dated, sourced measurements. Estimated and measured values are shown separately — never blended.
          </CardDescription>
        </div>
        {isCoach && (
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add measurement
              </Button>
            </DialogTrigger>
            <AddTestDialog
              athleteId={athleteId}
              onSaved={() => {
                setShowForm(false);
                invalidate();
              }}
            />
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : latestByMetric.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            No measurements logged yet.{isCoach ? " Use \u201CAdd measurement\u201D to record the first one." : ""}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from(latestByMetric.values()).map((row) => (
              <div key={row.metric} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{metricLabel(row.metric)}</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5">
                  {row.value}
                  <span className="text-xs font-normal text-muted-foreground ml-1">{row.unit}</span>
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
            ))}
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
                    <span className="tabular-nums">
                      {row.value} {row.unit}
                    </span>
                    <Badge variant="outline" className={`text-[10px] ${CONFIDENCE_STYLES[row.confidence] ?? ""}`}>
                      {row.confidence}
                    </Badge>
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
    </Card>
  );
}

function AddTestDialog({ athleteId, onSaved }: { athleteId: string; onSaved: () => void }) {
  const [metric, setMetric] = useState("vo2max");
  const [value, setValue] = useState("");
  const [testDate, setTestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState("coach_entered");
  const [measurementType, setMeasurementType] = useState("coach_entered");
  const [confidence, setConfidence] = useState("moderate");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const unit = METRIC_OPTIONS.find((m) => m.value === metric)?.unit ?? "";

  async function save() {
    const numericValue = Number(value);
    if (!value || Number.isNaN(numericValue)) {
      toast.error("Enter a numeric value");
      return;
    }
    setSaving(true);
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
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Measurement added");
    onSaved();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add measurement</DialogTitle>
        <DialogDescription>
          Every measurement is kept, never overwritten — this lets you compare a lab test against a watch estimate
          side by side instead of losing one to the other.
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
            <Label className="text-xs">Value ({unit || "no unit"})</Label>
            <Input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
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
