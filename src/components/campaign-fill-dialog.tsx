import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Info, Layers, Loader2, RotateCcw } from "lucide-react";
import { previewPlanAssignment, assignPlanToAthlete, unfillCampaignWeeks } from "@/lib/plan.functions";
import {
  buildFillPlan,
  applyFillPlan,
  detectFillCollisions,
  applyCollisionPolicy,
  computeCampaignWriteBacks,
  buildFillRows,
  defaultAlignmentForPhase,
  DEFAULT_SHORTFALL,
  type FillAlignment,
  type FillShortfall,
  type CollisionPolicy,
  type FillTargetWeek,
  type RemappableDraft,
} from "@/lib/campaign-fill";
import { phaseStyle } from "@/components/campaign-timeline";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Filling a campaign block from a plan template.
//
// Two steps rather than one, for the same reason Copy Period Forward has a
// review step: this writes a block's worth of sessions in one action, and the
// mapping it uses (which template week landed where, at what load, over the
// top of what) is not obvious from the inputs. Showing it is cheaper than
// undoing it.
//
// This dialog deliberately does NOT edit individual sessions. app.plans.tsx's
// assign flow already does that, at length, and duplicating it here would be
// a second implementation of the same review UI. What this owns is the part
// that flow has no concept of: the mapping onto a season's weeks.
// ----------------------------------------------------------------------------

type Step = "setup" | "review";

export interface FillBlockTarget {
  campaignId: string;
  athleteId: string;
  blockLabel: string;
  phase: string;
  weeks: FillTargetWeek[];
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function FillBlockDialog({
  open,
  onOpenChange,
  target,
  onFilled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: FillBlockTarget | null;
  onFilled: () => void;
}) {
  const [step, setStep] = useState<Step>("setup");
  const [templateId, setTemplateId] = useState<string>("");
  const [alignment, setAlignment] = useState<FillAlignment>("head");
  const [shortfall, setShortfall] = useState<FillShortfall>(DEFAULT_SHORTFALL);
  const [applyCampaignLoad, setApplyCampaignLoad] = useState(true);
  const [loadEdits, setLoadEdits] = useState<Record<number, string>>({});
  const [collisionPolicy, setCollisionPolicy] = useState<CollisionPolicy>("skip");
  const [writeBack, setWriteBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rawDrafts, setRawDrafts] = useState<RemappableDraft[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  // Reset on open. A dialog that reopens holding the previous block's mapping
  // is the kind of thing nobody notices until it has written the wrong week.
  useEffect(() => {
    if (!open || !target) return;
    setStep("setup");
    setTemplateId("");
    setAlignment(defaultAlignmentForPhase(target.phase as any));
    setShortfall(DEFAULT_SHORTFALL);
    setApplyCampaignLoad(true);
    setLoadEdits({});
    setCollisionPolicy("skip");
    setWriteBack(true);
    setRawDrafts(null);
    setPreviewErr(null);
  }, [open, target?.campaignId, target?.blockLabel]);

  const { data: templates } = useQuery({
    queryKey: ["plan-templates-for-fill"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_templates")
        .select("id, name, duration_weeks, days_per_week, distance_focus, level, is_system")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const template = useMemo(
    () => (templates ?? []).find((t: any) => t.id === templateId) as any | undefined,
    [templates, templateId],
  );

  // Weeks with the coach's inline load edits folded in, so the mapping preview
  // and the eventual scaling both read from one place.
  const effectiveWeeks = useMemo<FillTargetWeek[]>(() => {
    if (!target) return [];
    return target.weeks.map((w) => {
      const edit = loadEdits[w.weekNumber];
      const parsed = edit === undefined || edit === "" ? NaN : Number(edit);
      return Number.isFinite(parsed) ? { ...w, loadPct: parsed } : w;
    });
  }, [target, loadEdits]);

  const plan = useMemo(
    () =>
      buildFillPlan({
        weeks: effectiveWeeks,
        templateDurationWeeks: Number(template?.duration_weeks ?? 0),
        alignment,
        shortfall,
        applyCampaignLoad,
      }),
    [effectiveWeeks, template?.duration_weeks, alignment, shortfall, applyCampaignLoad],
  );

  const writeBacks = useMemo(() => {
    if (!target) return [];
    const overridden = new Map<number, number>();
    for (const [k, v] of Object.entries(loadEdits)) {
      const n = Number(v);
      if (v !== "" && Number.isFinite(n)) overridden.set(Number(k), n);
    }
    // Compared against the campaign's STORED loads, not the edited ones.
    const stored = buildFillPlan({
      weeks: target.weeks,
      templateDurationWeeks: Number(template?.duration_weeks ?? 0),
      alignment,
      shortfall,
      applyCampaignLoad,
    });
    return computeCampaignWriteBacks(stored.slots, overridden);
  }, [target, loadEdits, template?.duration_weeks, alignment, shortfall, applyCampaignLoad]);

  // Sessions already sitting on the block's dates.
  const dateRange = useMemo(() => {
    if (!target || target.weeks.length === 0) return null;
    const sorted = [...target.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    const start = sorted[0].weekStart;
    const lastStart = sorted[sorted.length - 1].weekStart;
    const end = new Date(Date.parse(`${lastStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    return { start, end };
  }, [target]);

  const alreadyFilledWeekIds = useMemo(
    () => (target?.weeks ?? []).filter((w) => (w as any).fillTemplateName).map((w) => w.id!),
    [target],
  );

  // The plans whose sessions this fill is about to REPLACE.
  //
  // Without this, a refill flags every day as a collision — against the
  // outgoing fill's own sessions, which commit() deletes moments later. With
  // the default "skip" policy that would quietly refuse to write anything and
  // report success, which is the worst possible shape for this bug.
  const replacedPlanIds = useMemo(
    () =>
      new Set(
        (target?.weeks ?? [])
          .map((w) => (w as any).fillPlanId as string | null)
          .filter((id): id is string => !!id),
      ),
    [target],
  );

  const { data: existing } = useQuery({
    queryKey: [
      "campaign-fill-existing",
      target?.athleteId,
      dateRange?.start,
      dateRange?.end,
      [...replacedPlanIds].sort().join(","),
    ],
    enabled: open && !!target?.athleteId && !!dateRange,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, session_date, title, athlete_plan_sessions(athlete_plan_id)")
        .eq("athlete_id", target!.athleteId)
        .gte("session_date", dateRange!.start)
        .lte("session_date", dateRange!.end);
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const s of (data ?? []) as any[]) {
        const ownerPlanId = s.athlete_plan_sessions?.[0]?.athlete_plan_id as string | undefined;
        if (ownerPlanId && replacedPlanIds.has(ownerPlanId)) continue;
        const list = map.get(s.session_date) ?? [];
        list.push(s.title ?? "Untitled");
        map.set(s.session_date, list);
      }
      return map;
    },
  });

  const mapped = useMemo(() => {
    if (!rawDrafts || !plan.slots.length) return { drafts: [] as RemappableDraft[], flaggedCount: 0 };
    return applyFillPlan(rawDrafts, plan, plan.startDate);
  }, [rawDrafts, plan]);

  const collisions = useMemo(
    () => detectFillCollisions(mapped.drafts, existing ?? new Map()),
    [mapped.drafts, existing],
  );

  const finalDrafts = useMemo(
    () => applyCollisionPolicy(mapped.drafts, collisions, collisionPolicy),
    [mapped.drafts, collisions, collisionPolicy],
  );

  async function goToReview() {
    if (!target || !template) return;
    setBusy(true);
    setPreviewErr(null);
    try {
      // No progression rules on purpose. Overrides are keyed by TEMPLATE week,
      // and a repeat maps one template week onto several campaign weeks at
      // different loads — which a template-week-keyed override cannot express.
      // The raw template comes back unscaled and applyFillPlan scales once per
      // slot instead.
      const res: any = await previewPlanAssignment({
        data: { planTemplateId: templateId, startDate: plan.startDate },
      });
      setRawDrafts((res?.drafts ?? []) as RemappableDraft[]);
      setStep("review");
    } catch (e: any) {
      setPreviewErr(e?.message ?? "Could not read that template");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!target || !template || finalDrafts.length === 0) return;
    setBusy(true);
    try {
      // Weeks that ended up with nothing to create — because they were left
      // empty, or every one of their days was skipped as a collision — must
      // not be recorded as filled. A fill record with no sessions behind it
      // is the campaign asserting training that does not exist.
      const keptWeekNumbers = new Set(finalDrafts.map((d) => d.week_number));
      const keptSlots = plan.slots.filter((s) => keptWeekNumbers.has(s.campaignWeekNumber));

      if (alreadyFilledWeekIds.length > 0) {
        await unfillCampaignWeeks({ data: { campaignWeekIds: alreadyFilledWeekIds } });
      }

      const res: any = await assignPlanToAthlete({
        data: {
          athleteId: target.athleteId,
          planTemplateId: templateId,
          startDate: plan.startDate,
          drafts: finalDrafts as any,
          campaignId: target.campaignId,
          campaignFillRows: buildFillRows(keptSlots, "", templateId, template.name).map(
            ({ campaign_week_id, plan_template_id, template_name, template_week_number, is_repeat, load_pct_applied }) => ({
              campaign_week_id,
              plan_template_id,
              template_name,
              template_week_number,
              is_repeat,
              load_pct_applied,
            }),
          ),
          campaignWriteBacks: writeBack
            ? writeBacks.map((w) => ({ campaignWeekId: w.campaignWeekId, toLoadPct: w.toLoadPct }))
            : [],
        },
      });

      const warnings: string[] = res?.warnings ?? [];
      if (warnings.length > 0) {
        toast.warning(`${res.sessionsCreated} sessions created`, { description: warnings.join(" ") });
      } else {
        toast.success(
          `${target.blockLabel} filled — ${res.sessionsCreated} sessions across ${keptSlots.length} week${keptSlots.length === 1 ? "" : "s"}`,
        );
      }
      onOpenChange(false);
      onFilled();
    } catch (e: any) {
      toast.error(e?.message ?? "Fill failed");
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  const style = phaseStyle(target.phase);
  const filledSlots = plan.slots.filter((s) => s.templateWeekNumber != null).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: style.fill }} />
            Fill {target.blockLabel}
          </DialogTitle>
          <DialogDescription>
            {target.weeks.length} week{target.weeks.length === 1 ? "" : "s"},{" "}
            {fmtDate(target.weeks[0]?.weekStart ?? "")} → {fmtDate(target.weeks[target.weeks.length - 1]?.weekStart ?? "")}.
            The campaign sets the shape; a plan template supplies the sessions.
          </DialogDescription>
        </DialogHeader>

        {step === "setup" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Plan template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template…" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} — {t.duration_weeks} wk, {t.days_per_week} d/wk
                      {t.is_system ? " (system)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {template && (
              <>
                {/* Only shown when it can actually matter. A template that is
                    exactly the block's length has no mismatch to resolve, and
                    offering the controls anyway invites a coach to change
                    something that does nothing. */}
                {Number(template.duration_weeks) !== target.weeks.length && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Line the template up by its</Label>
                      <Select value={alignment} onValueChange={(v) => setAlignment(v as FillAlignment)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="head">Start — template week 1 on the block's first week</SelectItem>
                          <SelectItem value="tail">End — template's last week on the block's last week</SelectItem>
                        </SelectContent>
                      </Select>
                      {defaultAlignmentForPhase(target.phase as any) === "tail" && (
                        <p className="text-[11px] text-muted-foreground">
                          Defaulted to End because this is a {style.label.toLowerCase()} block — a taper's meaning is in
                          its final week, so aligning from the start would never reach the sharp end.
                        </p>
                      )}
                    </div>

                    {Number(template.duration_weeks) < target.weeks.length && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Weeks the template doesn't reach</Label>
                        <Select value={shortfall} onValueChange={(v) => setShortfall(v as FillShortfall)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="repeat">Repeat the template from the start</SelectItem>
                            <SelectItem value="leave_empty">Leave those weeks empty</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                  <Checkbox
                    checked={applyCampaignLoad}
                    onCheckedChange={(v) => setApplyCampaignLoad(!!v)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <span className="font-medium">Use the campaign's weekly loads</span>
                    <span className="block text-muted-foreground">
                      Each week's volume comes from the campaign, overriding any progression built into the template.
                      Turn this off to use the template's own authored volume and treat the campaign as shape only —
                      the timeline will then show figures the sessions don't match.
                    </span>
                  </span>
                </label>

                {/* The mapping, in full. This is the thing worth showing. */}
                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
                    <Layers className="h-3.5 w-3.5" />
                    How it lands
                    <span className="ml-auto font-normal text-muted-foreground">
                      {filledSlots} of {target.weeks.length} weeks filled
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto brand-scrollbar divide-y">
                    {plan.slots.map((s) => (
                      <div key={s.campaignWeekNumber} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="w-10 shrink-0 font-medium">W{s.campaignWeekNumber}</span>
                        <span className="w-16 shrink-0 text-muted-foreground">{fmtDate(s.weekStart)}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {s.templateWeekNumber == null ? (
                            <span className="text-muted-foreground italic">left empty</span>
                          ) : (
                            <>
                              template week {s.templateWeekNumber}
                              {s.isRepeat && (
                                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                                  repeat
                                </Badge>
                              )}
                            </>
                          )}
                        </span>
                        {s.isDeload && (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                            deload
                          </Badge>
                        )}
                        <Input
                          type="number"
                          value={loadEdits[s.campaignWeekNumber] ?? String(s.loadPct)}
                          onChange={(e) =>
                            setLoadEdits((p) => ({ ...p, [s.campaignWeekNumber]: e.target.value }))
                          }
                          disabled={!applyCampaignLoad}
                          className="h-6 w-16 shrink-0 text-xs"
                        />
                        <span className="w-3 shrink-0 text-muted-foreground">%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {plan.notes.map((n, i) => (
                  <p key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>{n}</span>
                  </p>
                ))}

                {alreadyFilledWeekIds.length > 0 && (
                  <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px]">
                    <RotateCcw className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      {alreadyFilledWeekIds.length} of these weeks {alreadyFilledWeekIds.length === 1 ? "is" : "are"}{" "}
                      already filled. Continuing replaces {alreadyFilledWeekIds.length === 1 ? "it" : "them"} — future
                      sessions from the old fill are removed first. Anything already completed, or dated before today,
                      is kept.
                    </span>
                  </p>
                )}

                {previewErr && (
                  <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-[11px]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>{previewErr}</span>
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2">
                <div className="text-lg font-bold">{finalDrafts.length}</div>
                <div className="text-[11px] text-muted-foreground">sessions</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-lg font-bold">{new Set(finalDrafts.map((d) => d.week_number)).size}</div>
                <div className="text-[11px] text-muted-foreground">weeks filled</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-lg font-bold">{collisions.length}</div>
                <div className="text-[11px] text-muted-foreground">days with a clash</div>
              </div>
            </div>

            {collisions.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                <p className="flex gap-2 text-xs font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {collisions.length} day{collisions.length === 1 ? "" : "s"} already have a session
                </p>
                <div className="max-h-32 overflow-y-auto brand-scrollbar space-y-1">
                  {collisions.map((c) => (
                    <div key={c.date} className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{fmtDate(c.date)}</span> — already there:{" "}
                      {c.existingTitles.join(", ")}; this fill adds: {c.incomingTitles.join(", ")}
                    </div>
                  ))}
                </div>
                <Select value={collisionPolicy} onValueChange={(v) => setCollisionPolicy(v as CollisionPolicy)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip those days — fill the rest of the week as normal</SelectItem>
                    <SelectItem value="proceed">Add anyway — both sessions stand (a double day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {writeBacks.length > 0 && (
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
                <Checkbox checked={writeBack} onCheckedChange={(v) => setWriteBack(!!v)} className="mt-0.5" />
                <span className="text-xs">
                  <span className="font-medium">
                    Update the campaign to match ({writeBacks.length} week{writeBacks.length === 1 ? "" : "s"})
                  </span>
                  <span className="block text-muted-foreground">
                    {writeBacks
                      .map((w) => `W${w.campaignWeekNumber} ${w.fromLoadPct}% → ${w.toLoadPct}%`)
                      .join(", ")}
                    . Leave this on and the timeline agrees with the sessions underneath it; turn it off and the
                    campaign keeps its original figures, which the actual-vs-planned overlay will read as missed
                    training rather than a changed plan. Changed weeks are locked against regeneration either way.
                  </span>
                </span>
              </label>
            )}

            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-xs font-medium">What will be created</div>
              <div className="max-h-64 overflow-y-auto brand-scrollbar divide-y">
                {finalDrafts.map((d) => (
                  <div key={d.tempId} className="flex items-center gap-2 px-3 py-1 text-xs">
                    <span className="w-10 shrink-0 text-muted-foreground">W{d.week_number}</span>
                    <span className="w-16 shrink-0 text-muted-foreground">{fmtDate(d.session_date)}</span>
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    {d.needsReview && (
                      <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                        check
                      </Badge>
                    )}
                  </div>
                ))}
                {finalDrafts.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    Nothing left to create — every day either clashed and was skipped, or the block was left empty.
                  </p>
                )}
              </div>
            </div>

            {mapped.flaggedCount > 0 && (
              <p className="flex gap-2 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>
                  {mapped.flaggedCount} session{mapped.flaggedCount === 1 ? "" : "s"} scaled to an awkward number and
                  {mapped.flaggedCount === 1 ? " is" : " are"} marked to check — worth opening after the fill.
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "review" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("setup")} disabled={busy}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button onClick={commit} disabled={busy || finalDrafts.length === 0}>
                {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Create {finalDrafts.length} session{finalDrafts.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={goToReview} disabled={busy || !template || filledSlots === 0}>
                {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Review
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation for clearing a block's fill. */
export function UnfillBlockDialog({
  open,
  onOpenChange,
  blockLabel,
  campaignWeekIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blockLabel: string;
  campaignWeekIds: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear {blockLabel}?</DialogTitle>
          <DialogDescription>
            Removes the sessions this block was filled with, and the campaign's record of the fill. Anything already
            completed, or dated before today, is kept — that's real training history regardless of which plan
            prescribed it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res: any = await unfillCampaignWeeks({ data: { campaignWeekIds } });
                toast.success(
                  `${res.sessionsDeleted} session${res.sessionsDeleted === 1 ? "" : "s"} removed` +
                    (res.keptCompleted > 0 ? `, ${res.keptCompleted} kept as completed or past` : ""),
                );
                onOpenChange(false);
                onDone();
              } catch (e: any) {
                toast.error(e?.message ?? "Could not clear this block");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Clear block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
