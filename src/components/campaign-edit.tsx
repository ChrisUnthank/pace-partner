import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Flag, Lock } from "lucide-react";
import { CampaignTimeline, PRIORITY_STYLE } from "@/components/campaign-timeline";
import { generateCampaign, type CampaignTarget, type TargetPriority, isValidIsoDate } from "@/lib/campaign-generator";
import { AddRacesPanel } from "@/components/campaign-race-picker";

// ----------------------------------------------------------------------------
// Editing a saved campaign.
//
// Everything except the weeks themselves: name, status, races, and the
// settings that decide the shape. Changing any of those means the structure
// has to be laid out again.
//
// THE REGENERATION PROBLEM
//
// campaign_weeks.block_id is ON DELETE CASCADE, so replacing the blocks
// deletes every week with them. A coach who has spent an hour setting loads
// would lose all of it because they moved a race by three days.
//
// So the weeks a human has touched are read out FIRST, keyed by their start
// date, and written back after the new structure lands. Keyed by DATE rather
// than week number because week numbers shift when the campaign's start moves,
// and an edit belongs to a week in the calendar, not to an ordinal.
//
// A week that no longer exists after regeneration — the campaign got shorter,
// or the start moved past it — is reported rather than silently dropped.
// ----------------------------------------------------------------------------

export function EditCampaignDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: any;
  onSaved: () => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [status, setStatus] = useState<string>(campaign?.status ?? "draft");
  const [startsOn, setStartsOn] = useState(campaign?.starts_on ?? "");
  const [resetWeeks, setResetWeeks] = useState(campaign?.reset_weeks ?? 2);
  const [loadWeeks, setLoadWeeks] = useState(campaign?.load_weeks ?? 3);
  const [deloadWeeks, setDeloadWeeks] = useState(campaign?.deload_weeks ?? 1);
  const [deloadsEnabled, setDeloadsEnabled] = useState(campaign?.deloads_enabled ?? true);
  const [taperDays, setTaperDays] = useState(campaign?.taper_days ?? 14);
  const [keyTaperDays, setKeyTaperDays] = useState(campaign?.key_taper_days ?? 7);
  const [taperFloorPct, setTaperFloorPct] = useState(campaign?.taper_floor_pct ?? 55);
  const [taperShape, setTaperShape] = useState(campaign?.taper_shape ?? "linear");
  const [baseProgression, setBaseProgression] = useState(campaign?.base_progression ?? "progressive");
  const [buildProgression, setBuildProgression] = useState(campaign?.build_progression ?? "progressive");
  const [baseQuality, setBaseQuality] = useState(Number(campaign?.base_quality_per_week ?? 0.5));
  const [buildQuality, setBuildQuality] = useState(Number(campaign?.build_quality_per_week ?? 2));
  const [raceWeekReduction, setRaceWeekReduction] = useState(campaign?.race_week_reduction_pct ?? 15);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed whenever a different campaign is opened, or the same one is
  // reopened after a save — otherwise the dialog shows stale values and looks
  // like the previous edit didn't take.
  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name ?? "");
    setStatus(campaign.status ?? "draft");
    setStartsOn(campaign.starts_on ?? "");
    setResetWeeks(campaign.reset_weeks ?? 2);
    setLoadWeeks(campaign.load_weeks ?? 3);
    setDeloadWeeks(campaign.deload_weeks ?? 1);
    setDeloadsEnabled(campaign.deloads_enabled ?? true);
    setTaperDays(campaign.taper_days ?? 14);
    setKeyTaperDays(campaign.key_taper_days ?? 7);
    setTaperFloorPct(campaign.taper_floor_pct ?? 55);
    setTaperShape(campaign.taper_shape ?? "linear");
    setBaseProgression(campaign.base_progression ?? "progressive");
    setBuildProgression(campaign.build_progression ?? "progressive");
    setBaseQuality(Number(campaign.base_quality_per_week ?? 0.5));
    setBuildQuality(Number(campaign.build_quality_per_week ?? 2));
    setRaceWeekReduction(campaign.race_week_reduction_pct ?? 15);
    setTargets(
      [...(campaign.campaign_targets ?? [])]
        .sort((a: any, b: any) => String(a.race_date).localeCompare(String(b.race_date)))
        .map((t: any) => ({
          raceDate: t.race_date,
          name: t.name ?? "",
          priority: t.priority as TargetPriority,
          athleteGoalId: t.athlete_goal_id ?? null,
          raceScheduleEntryId: t.race_schedule_entry_id ?? null,
        })),
    );
  }, [campaign?.id, campaign?.updated_at]);

  const preview = useMemo(
    () =>
      generateCampaign({
        startsOn,
        loadWeeks,
        deloadWeeks,
        deloadsEnabled,
        taperWeeks: Math.ceil(taperDays / 7),
        keyTaperWeeks: Math.ceil(keyTaperDays / 7),
        taperDays,
        keyTaperDays,
        taperFloorPct,
        taperShape,
        baseProgression,
        buildProgression,
        baseQualityPerWeek: baseQuality,
        buildQualityPerWeek: buildQuality,
        resetWeeks,
        postPeakRecoveryWeeks: 1,
        transitionWeeks: 0,
        targets,
        loads: { raceWeekReduction },
      }),
    [
      startsOn, loadWeeks, deloadWeeks, deloadsEnabled, taperDays, keyTaperDays, taperFloorPct,
      taperShape, baseProgression, buildProgression, baseQuality, buildQuality, resetWeeks,
      targets, raceWeekReduction,
    ],
  );

  const lockedWeeks = useMemo(
    () => (campaign?.campaign_weeks ?? []).filter((w: any) => w.is_locked),
    [campaign],
  );

  // Which edited weeks the new structure still has a home for. A week whose
  // date falls outside the regenerated span is about to be lost, and the coach
  // should know the number before pressing save, not after.
  const previewDates = useMemo(() => new Set(preview.weeks.map((w) => w.weekStart)), [preview]);
  const orphanedLocks = lockedWeeks.filter((w: any) => !previewDates.has(w.week_start));

  async function save() {
    if (!name.trim()) return toast.error("Give the campaign a name.");
    if (targets.some((t) => !isValidIsoDate(t.raceDate)))
      return toast.error("One of the races has an incomplete date.");
    if (targets.length === 0) return toast.error("A campaign needs at least one race.");
    if (preview.weeks.length === 0) return toast.error(preview.notes[0] ?? "Nothing to save.");

    setSaving(true);
    try {
      // 1. Preserve every hand-edited week, keyed by date.
      const preserved = new Map<string, any>();
      for (const w of lockedWeeks) {
        preserved.set(w.week_start, {
          load_pct: w.load_pct,
          is_deload: w.is_deload,
          quality_sessions: w.quality_sessions,
          notes: w.notes,
        });
      }

      const { error: cErr } = await (supabase as any)
        .from("campaigns")
        .update({
          name: name.trim(),
          status,
          starts_on: preview.weeks[0].weekStart,
          ends_on: preview.weeks[preview.weeks.length - 1].weekStart,
          load_weeks: loadWeeks,
          deload_weeks: deloadWeeks,
          deloads_enabled: deloadsEnabled,
          taper_weeks: Math.ceil(taperDays / 7),
          key_taper_weeks: Math.ceil(keyTaperDays / 7),
          taper_days: taperDays,
          key_taper_days: keyTaperDays,
          taper_floor_pct: taperFloorPct,
          taper_shape: taperShape,
          base_progression: baseProgression,
          build_progression: buildProgression,
          base_quality_per_week: baseQuality,
          build_quality_per_week: buildQuality,
          reset_weeks: resetWeeks,
          race_week_reduction_pct: raceWeekReduction,
        })
        .eq("id", campaign.id);
      if (cErr) throw cErr;

      // 2. Targets replaced wholesale — they're a small set and diffing them
      //    would be more code than it saves.
      await (supabase as any).from("campaign_targets").delete().eq("campaign_id", campaign.id);
      const { error: tErr } = await (supabase as any).from("campaign_targets").insert(
        targets.map((t) => ({
          campaign_id: campaign.id,
          race_date: t.raceDate,
          name: t.name || null,
          priority: t.priority,
          athlete_goal_id: t.athleteGoalId ?? null,
          race_schedule_entry_id: t.raceScheduleEntryId ?? null,
        })),
      );
      if (tErr) throw tErr;

      // 3. Blocks replaced. This CASCADES to weeks — which is why step 1
      //    happened first.
      await (supabase as any).from("campaign_blocks").delete().eq("campaign_id", campaign.id);
      const { data: savedBlocks, error: bErr } = await (supabase as any)
        .from("campaign_blocks")
        .insert(
          preview.blocks.map((b) => ({
            campaign_id: campaign.id,
            block_order: b.blockOrder,
            phase: b.phase,
            label: b.label,
            starts_on: b.startsOn,
            ends_on: b.endsOn,
          })),
        )
        .select();
      if (bErr) throw bErr;

      // Any weeks the cascade missed (a block-less week from an older save).
      await (supabase as any).from("campaign_weeks").delete().eq("campaign_id", campaign.id);

      const blockFor = (weekStart: string) =>
        (savedBlocks ?? []).find((b: any) => b.starts_on <= weekStart && b.ends_on >= weekStart)?.id ?? null;

      // 4. Weeks written back, with preserved values winning over generated
      //    ones and is_locked set so the next regeneration protects them too.
      const { error: wErr } = await (supabase as any).from("campaign_weeks").insert(
        preview.weeks.map((w) => {
          const keep = preserved.get(w.weekStart);
          return {
            campaign_id: campaign.id,
            block_id: blockFor(w.weekStart),
            week_number: w.weekNumber,
            week_start: w.weekStart,
            load_pct: keep ? keep.load_pct : w.loadPct,
            is_deload: keep ? keep.is_deload : w.isDeload,
            quality_sessions: keep ? keep.quality_sessions : w.qualitySessions,
            notes: keep ? keep.notes : null,
            is_locked: !!keep,
          };
        }),
      );
      if (wErr) throw wErr;

      const kept = preview.weeks.filter((w) => preserved.has(w.weekStart)).length;
      toast.success(
        kept > 0
          ? `Campaign updated — ${kept} edited week${kept === 1 ? "" : "s"} kept as ${kept === 1 ? "it was" : "they were"}.`
          : "Campaign updated",
      );
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the campaign.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[1400px] sm:max-w-[1400px] max-h-[92vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>
            Change the races or the rhythm and the season is laid out again. Weeks you have edited by hand are kept
            exactly as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Starts</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="abandoned">Abandoned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Races</Label>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> From goals / schedule
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTargets((t) => [...t, { raceDate: startsOn, name: "", priority: "training" }])}
                >
                  Type one in
                </Button>
              </div>
            </div>
            {/* Inline, inside the Races section — the draft stays put. */}
            <AddRacesPanel
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              athleteId={campaign?.athlete_id}
              existing={targets}
              onAdd={(added) =>
                setTargets((t) => [...t, ...added].sort((a, b) => a.raceDate.localeCompare(b.raceDate)))
              }
            />

            <div className="space-y-2">
              {targets.map((t, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="date"
                    className="w-[150px]"
                    value={t.raceDate}
                    onChange={(e) =>
                      setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, raceDate: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="flex-1 min-w-[140px]"
                    placeholder="Race name"
                    value={t.name ?? ""}
                    onChange={(e) =>
                      setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <Select
                    value={t.priority}
                    onValueChange={(v) =>
                      setTargets((arr) => arr.map((x, k) => (k === i ? { ...x, priority: v as TargetPriority } : x)))
                    }
                  >
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["peak", "key", "tune_up", "training"] as TargetPriority[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full inline-block" style={{ background: PRIORITY_STYLE[p].fill }} />
                            {PRIORITY_STYLE[p].label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => setTargets((arr) => arr.filter((_, k) => k !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Num label="Down weeks" value={resetWeeks} set={setResetWeeks} min={0} max={8} />
            <Num label="Load weeks" value={loadWeeks} set={setLoadWeeks} min={1} max={6} />
            <Num label="Deload weeks" value={deloadWeeks} set={setDeloadWeeks} min={0} max={2} />
            <Num label="Peak taper (days)" value={taperDays} set={setTaperDays} min={3} max={35} />
            <Num label="Key taper (days)" value={keyTaperDays} set={setKeyTaperDays} min={2} max={21} />
            <Num label="Race wk −%" value={raceWeekReduction} set={setRaceWeekReduction} min={0} max={50} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-[11px]">Race week load %</Label>
              <Input
                type="number" min={30} max={95} value={taperFloorPct}
                onChange={(e) => setTaperFloorPct(Math.max(30, Math.min(95, Number(e.target.value) || 55)))}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-[11px]">Taper shape</Label>
              <Select value={taperShape} onValueChange={setTaperShape}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Even</SelectItem>
                  <SelectItem value="gentle">Gentle — drops late</SelectItem>
                  <SelectItem value="steep">Steep — sheds early</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Base load</Label>
              <Select value={baseProgression} onValueChange={setBaseProgression}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="progressive">Climbs</SelectItem>
                  <SelectItem value="flat">Flat</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Build load</Label>
              <Select value={buildProgression} onValueChange={setBuildProgression}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="progressive">Climbs</SelectItem>
                  <SelectItem value="flat">Flat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {preview.weeks.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="text-xs font-medium mb-2">
                {preview.weeks.length} weeks · {preview.blocks.length} blocks
                {lockedWeeks.length > 0 && ` · ${lockedWeeks.length} edited week${lockedWeeks.length === 1 ? "" : "s"} kept`}
              </div>
              <CampaignTimeline
                weeks={preview.weeks}
                blocks={preview.blocks}
                baselineKm={campaign?.baseline_weekly_km != null ? Number(campaign.baseline_weekly_km) : null}
              />
            </div>
          )}

          {orphanedLocks.length > 0 && (
            <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
              <Lock className="h-3 w-3 shrink-0 mt-0.5" />
              {orphanedLocks.length} edited week{orphanedLocks.length === 1 ? "" : "s"} fall outside the new dates and
              will be lost ({orphanedLocks.map((w: any) => w.week_start).join(", ")}). Adjust the start date or the
              races if you want to keep {orphanedLocks.length === 1 ? "it" : "them"}.
            </p>
          )}

          {preview.notes.map((n, i) => (
            <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Flag className="h-3 w-3 shrink-0 mt-0.5" /> {n}
            </p>
          ))}
        </div>



        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || preview.weeks.length === 0}>
            {saving ? "Saving…" : "Save campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Num({
  label,
  value,
  set,
  min,
  max,
}: {
  label: string;
  value: number;
  set: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="h-8"
      />
    </div>
  );
}
