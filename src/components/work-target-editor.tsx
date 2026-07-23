import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clockToSec, secToClock } from "@/lib/format";
import { inferWorkoutTargetMode, type WorkoutTargetMode } from "@/lib/workout-target-modes";
import { setModePayload, normalizeWorkTargetForSave, validateWorkTarget } from "@/lib/work-target-normalize";
import { Target } from "lucide-react";
import { toast } from "sonner";

type TargetMode = WorkoutTargetMode;

/**
 * Set or fix a work/strides step's pace/HR/zone/RPE target and its
 * between-reps recovery, on a session that already exists — a template
 * apply, a plan assignment, or an earlier builder save that skipped it.
 * These paths don't run through the New Session builder's own save, so
 * this is the one place a coach can always reach afterward, regardless of
 * how the session landed on the calendar. Writes straight to `steps` via
 * the same normalize/validate logic the builder uses (@/lib/
 * work-target-normalize), so a step edited here behaves identically to
 * one entered live in the builder.
 *
 * Only shown for planned (not yet completed) sessions — once a session is
 * completed, the work block's job is displaying what actually happened,
 * not editing the prescription.
 */
export function WorkTargetEditor({
  step,
  onSaved,
}: {
  step: any;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mode, setMode] = useState<TargetMode>((step.target_mode ?? inferWorkoutTargetMode(step)) as TargetMode);
  const [pace, setPace] = useState<number | null>(step.target_pace_sec_per_km ?? null);
  const [thrPacePct, setThrPacePct] = useState<number | null>(step.target_threshold_pace_pct ?? null);
  const [thrHrPct, setThrHrPct] = useState<number | null>(step.target_threshold_hr_pct ?? null);
  const [zone, setZone] = useState<string | null>(step.target_zone ?? null);
  const [rpe, setRpe] = useState<number | null>(step.target_rpe ?? null);

  const [recMode, setRecMode] = useState<string>(step.recovery_between_reps_mode ?? "jog");
  const [recKind, setRecKind] = useState<"time" | "distance">(
    (step.recovery_between_reps_target_kind as any) ?? "time",
  );
  const [recSeconds, setRecSeconds] = useState<number | null>(step.recovery_between_reps_seconds ?? null);
  const [recDistanceM, setRecDistanceM] = useState<number | null>(step.recovery_between_reps_distance_m ?? null);

  function reopen() {
    // Reset from the latest step prop each time the dialog opens, so a
    // stale local draft from a previous open (before the parent's query
    // refetched) never shadows what's actually saved.
    setMode((step.target_mode ?? inferWorkoutTargetMode(step)) as TargetMode);
    setPace(step.target_pace_sec_per_km ?? null);
    setThrPacePct(step.target_threshold_pace_pct ?? null);
    setThrHrPct(step.target_threshold_hr_pct ?? null);
    setZone(step.target_zone ?? null);
    setRpe(step.target_rpe ?? null);
    setRecMode(step.recovery_between_reps_mode ?? "jog");
    setRecKind((step.recovery_between_reps_target_kind as any) ?? "time");
    setRecSeconds(step.recovery_between_reps_seconds ?? null);
    setRecDistanceM(step.recovery_between_reps_distance_m ?? null);
    setOpen(true);
  }

  function updateMode(next: TargetMode) {
    const cleared = setModePayload(next, {
      target_mode: next,
      target_pace_sec_per_km: pace,
      target_threshold_pace_pct: thrPacePct,
      target_threshold_hr_pct: thrHrPct,
      target_zone: zone,
      target_rpe: rpe,
    });
    setMode(next);
    setPace(cleared.target_pace_sec_per_km ?? null);
    setThrPacePct(cleared.target_threshold_pace_pct ?? null);
    setThrHrPct(cleared.target_threshold_hr_pct ?? null);
    setZone(cleared.target_zone ?? null);
    setRpe(cleared.target_rpe ?? null);
  }

  async function save() {
    const draft = {
      target_mode: mode,
      target_pace_sec_per_km: pace,
      target_threshold_pace_pct: thrPacePct,
      target_threshold_hr_pct: thrHrPct,
      target_zone: zone,
      target_rpe: rpe,
    };

    const err = validateWorkTarget(draft);
    if (err) {
      toast.error(err);
      return;
    }

    const cleaned = normalizeWorkTargetForSave(draft);
    const showsReps = (step.reps ?? 1) > 1;

    setSaving(true);
    const { error } = await supabase
      .from("steps")
      .update({
        target_mode: cleaned.target_mode,
        target_pace_sec_per_km: cleaned.target_pace_sec_per_km,
        target_threshold_pace_pct: cleaned.target_threshold_pace_pct,
        target_threshold_hr_pct: cleaned.target_threshold_hr_pct,
        target_zone: cleaned.target_zone,
        target_rpe: cleaned.target_rpe,
        recovery_between_reps_mode: showsReps ? (recMode as any) : step.recovery_between_reps_mode ?? null,
        recovery_between_reps_target_kind: showsReps ? recKind : step.recovery_between_reps_target_kind ?? "time",
        recovery_between_reps_seconds: showsReps && recKind === "time" ? recSeconds : null,
        recovery_between_reps_distance_m: showsReps && recKind === "distance" ? recDistanceM : null,
      } as any)
      .eq("id", step.id);

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Target saved");
    setOpen(false);
    onSaved();
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          reopen();
        }}
      >
        <Target className="h-3 w-3 mr-1" />
        {mode === "open" && step.target_mode == null ? "Set target" : "Edit target"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Workout target</DialogTitle>
            <DialogDescription>
              What pace, HR, zone, or effort this step should be run at — and the recovery between reps, if this
              block has more than one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Target mode and its value input sit side by side — mirrors
                the same layout fix applied in the New Session builder. */}
            <div className="grid grid-cols-2 gap-2 items-start">
              <div>
                <Label className="text-xs">Target mode</Label>
                <Select value={mode} onValueChange={(v) => updateMode(v as TargetMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pace">Pace</SelectItem>
                    <SelectItem value="threshold_pace_pct">Threshold pace percent</SelectItem>
                    <SelectItem value="threshold_hr_pct">Threshold HR percent</SelectItem>
                    <SelectItem value="zone">Zone</SelectItem>
                    <SelectItem value="rpe">RPE</SelectItem>
                    <SelectItem value="open">Open / no target</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "pace" && (
                <div>
                  <Label className="text-xs">Target pace mm:ss /km</Label>
                  <Input
                    placeholder="3:30"
                    defaultValue={pace ? secToClock(pace) : ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const secs = raw === "" ? null : clockToSec(raw);
                      setPace(secs != null && Number.isFinite(secs) && secs > 0 ? secs : null);
                    }}
                  />
                </div>
              )}

              {mode === "threshold_pace_pct" && (
                <div>
                  <Label className="text-xs">Threshold pace percent</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    placeholder="100"
                    value={thrPacePct ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setThrPacePct(v != null && Number.isFinite(v) ? v : null);
                    }}
                  />
                </div>
              )}

              {mode === "threshold_hr_pct" && (
                <div>
                  <Label className="text-xs">Threshold HR percent</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    placeholder="95"
                    value={thrHrPct ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setThrHrPct(v != null && Number.isFinite(v) ? v : null);
                    }}
                  />
                </div>
              )}

              {mode === "zone" && (
                <div>
                  <Label className="text-xs">Zone</Label>
                  <Select value={zone ?? ""} onValueChange={(v) => setZone(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a zone…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="z1">Zone 1</SelectItem>
                      <SelectItem value="z2">Zone 2</SelectItem>
                      <SelectItem value="z3">Zone 3</SelectItem>
                      <SelectItem value="z4">Zone 4</SelectItem>
                      <SelectItem value="z5">Zone 5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {mode === "rpe" && (
                <div>
                  <Label className="text-xs">RPE</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    placeholder="6"
                    value={rpe ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      setRpe(v != null && Number.isFinite(v) ? v : null);
                    }}
                  />
                </div>
              )}
            </div>

            {mode === "threshold_pace_pct" && (
              <p className="text-[11px] text-muted-foreground -mt-1">
                100 means threshold pace. 95 means slightly slower than threshold.
              </p>
            )}

            {mode === "open" && (
              <p className="text-[11px] text-muted-foreground">
                No fixed intensity target — useful for easy aerobic work or sessions guided by feel.
              </p>
            )}

            {(step.reps ?? 1) > 1 && (
              <div className="rounded-md border p-2 space-y-2">
                <div className="text-xs font-semibold">Recovery between reps</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <Select value={recMode} onValueChange={setRecMode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standing">Standing</SelectItem>
                        <SelectItem value="walk">Walk</SelectItem>
                        <SelectItem value="jog">Jog</SelectItem>
                        <SelectItem value="float">Float</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Target</Label>
                    <Select value={recKind} onValueChange={(v) => setRecKind(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="time">Time</SelectItem>
                        <SelectItem value="distance">Distance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {recKind === "time" ? (
                  <div>
                    <Label className="text-xs">Time (mm:ss)</Label>
                    <Input
                      placeholder="1:30"
                      defaultValue={recSeconds ? secToClock(recSeconds) : ""}
                      onChange={(e) => setRecSeconds(clockToSec(e.target.value))}
                    />
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Distance (m)</Label>
                    <Input
                      type="number"
                      placeholder="100"
                      value={recDistanceM ?? ""}
                      onChange={(e) => setRecDistanceM(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save target"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
