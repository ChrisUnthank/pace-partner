import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock, Unlock, Wand2 } from "lucide-react";
import { PHASE_STYLE } from "@/components/campaign-timeline";
import type { GeneratedWeek } from "@/lib/campaign-generator";

// ----------------------------------------------------------------------------
// Editing weeks.
//
// Two ways in, because coaches change loads at two different scales:
//
//   ONE WEEK   — nudge a single week that needs to be lighter or heavier.
//   A RANGE    — "three weeks at 100km, then three at 110." That is one
//                decision about six weeks, not six decisions, and making it
//                six separate edits would be tedious enough that nobody does
//                it and the generated numbers stand by default.
//
// KILOMETRES vs PERCENT
// load_pct stays the stored value: it survives the athlete's volume changing,
// where an absolute figure would silently become wrong. But if the campaign
// has a baseline, everything is shown and entered in km, because that is how
// the plan exists in the coach's head. The conversion is the app's job.
// ----------------------------------------------------------------------------

export function WeekEditDialog({
  open,
  onOpenChange,
  week,
  campaignId,
  baselineKm,
  allWeeks,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  week: GeneratedWeek | null;
  campaignId: string;
  baselineKm: number | null;
  allWeeks: GeneratedWeek[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"one" | "range">("one");
  const [loadPct, setLoadPct] = useState<number>(week?.loadPct ?? 100);
  const [rangeEnd, setRangeEnd] = useState<number>(week?.weekNumber ?? 1);
  const [isDeload, setIsDeload] = useState<boolean>(week?.isDeload ?? false);

  // Re-seed when a different week is opened. Without this the dialog keeps
  // the previous week's numbers, which reads as the app having lost the edit.
  // Re-seed when a different week is opened, via useEffect — NOT useMemo.
  // useMemo is for deriving a value and React is free to discard and recompute
  // it; using it to call setState is a side effect in the wrong place and can
  // fire at times that surprise you.
  useEffect(() => {
    if (!week) return;
    setLoadPct(week.loadPct);
    setIsDeload(week.isDeload);
    setRangeEnd(week.weekNumber);
    setMode("one");
  }, [week?.weekNumber, week?.loadPct, week?.isDeload]);

  if (!week) return null;

  const pctToKm = (pct: number) => (baselineKm ? Math.round((pct / 100) * baselineKm * 10) / 10 : null);
  const kmToPct = (km: number) => (baselineKm ? Math.round((km / baselineKm) * 100) : 100);

  const affected = allWeeks.filter(
    (w) => w.weekNumber >= week.weekNumber && w.weekNumber <= Math.max(week.weekNumber, rangeEnd),
  );
  const lockedInRange = affected.filter((w) => w.isLocked && w.weekNumber !== week.weekNumber);

  async function save() {
    setSaving(true);
    try {
      const targets = mode === "one" ? [week!] : affected;
      const { error } = await (supabase as any)
        .from("campaign_weeks")
        .update({ load_pct: loadPct, is_deload: isDeload })
        .eq("campaign_id", campaignId)
        .in(
          "week_number",
          targets.map((t) => t.weekNumber),
        );
      if (error) throw error;
      // is_locked is set by a database trigger on any manual edit, so it is
      // deliberately not sent here — one place decides what counts as an
      // edit, and it can't be bypassed by a call site that forgets.
      toast.success(targets.length === 1 ? "Week updated" : `${targets.length} weeks updated`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const style = PHASE_STYLE[week.phase];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm inline-block" style={{ background: style.fill }} />
            Week {week.weekNumber} · {style.label}
          </DialogTitle>
          <DialogDescription>
            {week.weekStart}
            {week.raceName ? ` · ${week.raceName}` : ""}
            {week.isLocked ? " · already edited" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
            {(["one", "range"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  mode === m ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {m === "one" ? "This week" : "This week onward"}
              </button>
            ))}
          </div>

          {mode === "range" && (
            <div>
              <Label className="text-xs">Apply through week</Label>
              <Input
                type="number"
                min={week.weekNumber}
                max={allWeeks.length}
                value={rangeEnd}
                onChange={(e) =>
                  setRangeEnd(Math.max(week.weekNumber, Math.min(allWeeks.length, Number(e.target.value) || week.weekNumber)))
                }
                className="h-8 w-28"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {affected.length} week{affected.length === 1 ? "" : "s"} — W{week.weekNumber} to W
                {Math.max(week.weekNumber, rangeEnd)}.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Load %</Label>
              <Input
                type="number"
                min={30}
                max={150}
                value={loadPct}
                onChange={(e) => setLoadPct(Math.max(30, Math.min(150, Number(e.target.value) || 100)))}
                className="h-8"
              />
            </div>
            {baselineKm ? (
              <div>
                <Label className="text-xs">Volume (km)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={pctToKm(loadPct) ?? 0}
                  onChange={(e) => setLoadPct(kmToPct(Number(e.target.value) || 0))}
                  className="h-8"
                />
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground self-end pb-2">
                Set a weekly baseline on the campaign to enter volume in km instead of percent.
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={isDeload} onChange={(e) => setIsDeload(e.target.checked)} />
            Mark as a deload week
          </label>

          {mode === "range" && lockedInRange.length > 0 && (
            <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
              <Lock className="h-3 w-3 shrink-0 mt-0.5" />
              {lockedInRange.length} week{lockedInRange.length === 1 ? " has" : "s have"} already been edited by hand (W
              {lockedInRange.map((w) => w.weekNumber).join(", W")}). This will overwrite {lockedInRange.length === 1 ? "it" : "them"}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : mode === "one" ? "Save week" : `Save ${affected.length} weeks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sets the campaign's weekly baseline — what load_pct = 100 means in km.
 *
 * Separate from the week editor because it's a property of the campaign, not
 * of any week, and changing it re-reads every week at once.
 */
export function BaselineDialog({
  open,
  onOpenChange,
  campaignId,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaignId: string;
  current: number | null;
  onSaved: () => void;
}) {
  const [km, setKm] = useState<string>(current != null ? String(current) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const value = km.trim() === "" ? null : Number(km);
      if (value != null && (!(value > 0) || value > 400)) {
        toast.error("Enter a weekly volume between 1 and 400 km, or leave it blank.");
        setSaving(false);
        return;
      }
      const { error } = await (supabase as any)
        .from("campaigns")
        .update({ baseline_weekly_km: value })
        .eq("id", campaignId);
      if (error) throw error;
      toast.success(value == null ? "Baseline cleared — showing percentages" : `Baseline set to ${value} km`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> Weekly baseline
          </DialogTitle>
          <DialogDescription>
            What a normal loading week looks like for this athlete. Every week's load is stored as a percentage of it,
            so this only changes how the numbers are shown and entered — nothing about the campaign's shape.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label className="text-xs">Normal week (km)</Label>
          <Input
            type="number"
            min={0}
            max={400}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder="e.g. 90"
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Leave blank to work in percentages instead. Changing it later re-reads every week at the new baseline; it
            does not alter any week's actual load.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { Unlock };
