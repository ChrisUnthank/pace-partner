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
import { PreviewWeekEditor } from "@/components/campaign-week-edit";
import {
  generateCampaign,
  deriveTaperFloor,
  isValidIsoDate,
  type CampaignTarget,
  type TargetPriority,
} from "@/lib/campaign-generator";
import {
  CampaignSettingsFields,
  campaignSettingsFromRow,
  campaignSettingsToRow,
  type CampaignSettings,
} from "@/components/campaign-settings-fields";
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
  const [endsOn, setEndsOn] = useState(campaign?.ends_on ?? "");
  // One object rather than eighteen useStates, shared with the create dialog
  // via CampaignSettingsFields. The previous shape held state for every
  // setting but rendered controls for only a third of them, so an edit wrote
  // defaults back over the taper archetype, quality density and overload
  // placement the coach had chosen at creation.
  const [settings, setSettings] = useState<CampaignSettings>(() => campaignSettingsFromRow(campaign));
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Baseline is editable here as well as on the campaign card. It's part of
  // describing the athlete, so it belongs with the rest of the settings — the
  // card keeps its own control for quick adjustment without opening this.
  const [baselineKm, setBaselineKm] = useState<string>(
    campaign?.baseline_weekly_km != null ? String(campaign.baseline_weekly_km) : "",
  );
  // Same override machinery as the create dialog: the preview is regenerated
  // from settings, so a database write would be overwritten on the next
  // keystroke. Held locally and saved with everything else.
  const [weekOverrides, setWeekOverrides] = useState<Map<number, { loadPct: number; isDeload: boolean; phase?: string | null }>>(new Map());
  const [editingPreviewWeek, setEditingPreviewWeek] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed whenever a different campaign is opened, or the same one is
  // reopened after a save — otherwise the dialog shows stale values and looks
  // like the previous edit didn't take.
  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name ?? "");
    setStatus(campaign.status ?? "draft");
    setStartsOn(campaign.starts_on ?? "");
    setEndsOn(campaign.ends_on ?? "");
    setSettings(campaignSettingsFromRow(campaign));
    setBaselineKm(campaign.baseline_weekly_km != null ? String(campaign.baseline_weekly_km) : "");
    setWeekOverrides(new Map());
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
        loadWeeks: settings.loadWeeks,
        deloadWeeks: settings.deloadWeeks,
        deloadsEnabled: settings.deloadsEnabled,
        taperWeeks: Math.ceil(settings.taperDays / 7),
        keyTaperWeeks: Math.ceil(settings.keyTaperDays / 7),
        taperDays: settings.taperDays,
        keyTaperDays: settings.keyTaperDays,
        taperFloorPct: settings.floorOverride
          ? settings.taperFloorPct
          : deriveTaperFloor(settings.taperRestDays, settings.taperSessionCut),
        taperShape: settings.taperShape,
        overloadWeeksBeforeRace: settings.overloadBefore,
        overloadBlockWeeks: settings.overloadLen,
        baseProgression: settings.baseProgression,
        buildProgression: settings.buildProgression,
        baseQualityPerWeek: settings.baseQuality,
        buildQualityPerWeek: settings.buildQuality,
        resetWeeks: settings.resetWeeks,
        postPeakRecoveryWeeks: 1,

        targets,
        endsOn: endsOn || null,
        transitionWeeks: settings.transitionWeeks,
        loads: { raceWeekReduction: settings.raceWeekReduction, deload: settings.deloadPct },
      }),
    [startsOn, settings, targets, endsOn],
  );

  const baselineNum = baselineKm.trim() === "" ? null : Number(baselineKm);

  const previewWeeks = useMemo(
    () =>
      preview.weeks.map((w) => {
        const o = weekOverrides.get(w.weekNumber);
        return o
          ? { ...w, loadPct: o.loadPct, isDeload: o.isDeload, phase: (o.phase ?? w.phase) as any, isLocked: true }
          : w;
      }),
    [preview.weeks, weekOverrides],
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

      // 1b. Preserve the fill records, also keyed by date.
      //
      // Saving this dialog deletes campaign_blocks, which CASCADES to
      // campaign_weeks, which CASCADES again to campaign_week_fills. So any
      // edit — even renaming the campaign — wiped every record of which weeks
      // had been filled, while leaving the sessions themselves sitting on the
      // calendar. The block list then read "Not filled" over a block full of
      // training: the campaign confidently contradicting its own sessions,
      // which is the state this project treats as worse than missing data.
      //
      // Keyed by week_start rather than week_number because a regeneration can
      // renumber weeks — inserting a down period shifts every number after it
      // while the dates, and the sessions sitting on them, stay put.
      const fillsByWeekStart = new Map<string, any>();
      {
        const weekIds = (campaign.campaign_weeks ?? []).map((w: any) => w.id);
        const startById = new Map<string, string>(
          (campaign.campaign_weeks ?? []).map((w: any) => [w.id, w.week_start]),
        );
        if (weekIds.length > 0) {
          const { data: existingFills } = await (supabase as any)
            .from("campaign_week_fills")
            .select("*")
            .in("campaign_week_id", weekIds);
          for (const f of existingFills ?? []) {
            const ws = startById.get(f.campaign_week_id);
            if (ws) fillsByWeekStart.set(ws, f);
          }
        }
      }

      const { error: cErr } = await (supabase as any)
        .from("campaigns")
        .update({
          name: name.trim(),
          status,
          starts_on: preview.weeks[0].weekStart,
          ends_on: preview.weeks[preview.weeks.length - 1].weekStart,
          // Every setting, from one mapper shared with the create dialog.
          // Listing them by hand here is what let taper_strategy,
          // taper_rest_days_added, taper_session_reduction, taper_neuromuscular
          // and overload_before_key be silently dropped on every edit.
          ...campaignSettingsToRow(settings),
          baseline_weekly_km: baselineNum,
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
        previewWeeks.map((w) => {
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
            // Locked if it was already a hand edit, or has just been changed
            // in this dialog.
            is_locked: !!keep || weekOverrides.has(w.weekNumber),
            phase_override: weekOverrides.get(w.weekNumber)?.phase ?? null,
          };
        }),
      );
      if (wErr) throw wErr;

      // 5. Fills restored onto whichever new week now holds the same date.
      //
      // Only where the date survived. A week that no longer exists in the new
      // structure has no fill to restore — but its SESSIONS are still on the
      // calendar, so the coach is told the number rather than left to discover
      // it. Re-read rather than reused from the insert above, because the new
      // week ids are what the fill rows have to point at.
      let fillsRestored = 0;
      let fillsLost = 0;
      if (fillsByWeekStart.size > 0) {
        const { data: newWeeks } = await (supabase as any)
          .from("campaign_weeks")
          .select("id, week_start")
          .eq("campaign_id", campaign.id);
        const idByStart = new Map<string, string>((newWeeks ?? []).map((w: any) => [w.week_start, w.id]));

        const rows: any[] = [];
        for (const [weekStart, f] of fillsByWeekStart) {
          const newId = idByStart.get(weekStart);
          if (!newId) {
            fillsLost++;
            continue;
          }
          rows.push({
            campaign_week_id: newId,
            athlete_plan_id: f.athlete_plan_id,
            plan_template_id: f.plan_template_id,
            template_name: f.template_name,
            template_week_number: f.template_week_number,
            is_repeat: f.is_repeat,
            load_pct_applied: f.load_pct_applied,
            filled_at: f.filled_at,
            filled_by: f.filled_by,
          });
        }
        if (rows.length > 0) {
          const { error: fErr } = await (supabase as any)
            .from("campaign_week_fills")
            .upsert(rows, { onConflict: "campaign_week_id" });
          // Not fatal: the campaign itself saved correctly and the sessions
          // are untouched. Losing the fill RECORD is a display problem, and
          // failing the whole save over it would be worse than reporting it.
          if (fErr) fillsLost += rows.length;
          else fillsRestored = rows.length;
        }
      }

      const kept = preview.weeks.filter((w) => preserved.has(w.weekStart)).length;
      toast.success(
        kept > 0
          ? `Campaign updated — ${kept} edited week${kept === 1 ? "" : "s"} kept as ${kept === 1 ? "it was" : "they were"}.`
          : "Campaign updated",
        fillsLost > 0
          ? {
              description: `${fillsLost} filled week${fillsLost === 1 ? "" : "s"} no longer ${fillsLost === 1 ? "has a" : "have"} matching date${fillsLost === 1 ? "" : "s"} in the new structure. Their sessions are still on the calendar — clear or refill those blocks to bring the two back into agreement.`,
            }
          : undefined,
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
          <div className="grid sm:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Starts</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ends (optional)</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Normal week (km)</Label>
              <Input
                type="number"
                min={0}
                max={400}
                value={baselineKm}
                onChange={(e) => setBaselineKm(e.target.value)}
                placeholder="e.g. 90"
              />
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

          <CampaignSettingsFields value={settings} onChange={setSettings} baselineKm={baselineNum} />

          {preview.weeks.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="text-xs font-medium mb-2">
                {preview.weeks.length} weeks · {preview.blocks.length} blocks
                {lockedWeeks.length > 0 && ` · ${lockedWeeks.length} edited week${lockedWeeks.length === 1 ? "" : "s"} kept`}
              </div>
              <CampaignTimeline
                weeks={previewWeeks}
                blocks={preview.blocks}
                baselineKm={baselineNum}
                onWeekClick={(w) => setEditingPreviewWeek(w)}
              />
              <PreviewWeekEditor
                week={editingPreviewWeek}
                baselineKm={baselineNum}
                totalWeeks={previewWeeks.length}
                onClose={() => setEditingPreviewWeek(null)}
                onApply={(from, through, loadPct, isDeload, phase) => {
                  setWeekOverrides((prev) => {
                    const next = new Map(prev);
                    for (let n = from; n <= through; n++) next.set(n, { loadPct, isDeload, phase });
                    return next;
                  });
                  setEditingPreviewWeek(null);
                }}
                onClear={(n) => {
                  setWeekOverrides((prev) => {
                    const next = new Map(prev);
                    next.delete(n);
                    return next;
                  });
                  setEditingPreviewWeek(null);
                }}
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
