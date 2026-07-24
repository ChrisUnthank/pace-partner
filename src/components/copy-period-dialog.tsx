import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Repeat2 } from "lucide-react";
import { commitCopyDrafts } from "@/lib/calendar-copy.functions";
import {
  COPY_BUCKETS,
  COPY_BUCKET_LABELS,
  emptyProgressionRules,
  offsetDaysBetween,
  buildCopyDraft,
  estimateTotalDistanceM,
  type ProgressionRules,
  type DraftSession,
} from "@/lib/calendar-copy";

/**
 * Copy Week/Month Forward. Two-step flow inside one dialog:
 *   1. Setup — source range, athlete or whole group, progression % per
 *      session-type bucket.
 *   2. Review — every session about to be created, editable (reps/
 *      recovery on the fly, or swap the whole session for a different
 *      library template) or removable individually before commit.
 *
 * Deliberately no schema changes — a copy just creates ordinary
 * sessions + steps rows, same shape as everything else in the app
 * writes. Nothing here overwrites or skips an existing session on the
 * target date; new copies always land alongside whatever's already
 * there, per the coach's explicit call on that.
 */
export function CopyPeriodDialog({
  open,
  onClose,
  initialSourceStart,
  initialSourceEnd,
  initialAthleteId,
}: {
  open: boolean;
  onClose: () => void;
  initialSourceStart?: string;
  initialSourceEnd?: string;
  initialAthleteId?: string;
}) {
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const [stepUi, setStepUi] = useState<"setup" | "review">("setup");
  const [scopeMode, setScopeMode] = useState<"athlete" | "group">("athlete");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | undefined>(initialAthleteId);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined);

  const [sourceStart, setSourceStart] = useState(initialSourceStart ?? "");
  const [sourceEnd, setSourceEnd] = useState(initialSourceEnd ?? "");
  const [targetStart, setTargetStart] = useState("");

  const [rules, setRules] = useState<ProgressionRules>(emptyProgressionRules());
  const [quickTargetKm, setQuickTargetKm] = useState<string>("");
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [editingDraft, setEditingDraft] = useState<DraftSession | null>(null);
  const [swapDraft, setSwapDraft] = useState<DraftSession | null>(null);

  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);

  const { data: roster } = useQuery({
    queryKey: ["copy-dialog-roster"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athlete_id, athletes(id, name, profile_image_url)");
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  const { data: groups } = useQuery({
    queryKey: ["copy-dialog-groups", user?.id],
    enabled: open && !!user,
    queryFn: async () => {
      const { data } = await supabase.from("training_groups").select("*").eq("coach_user_id", user!.id).order("name");
      return data ?? [];
    },
  });

  const { data: groupMemberIds } = useQuery({
    queryKey: ["copy-dialog-group-members", selectedGroupId],
    enabled: !!selectedGroupId,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_group_members")
        .select("athlete_id")
        .eq("group_id", selectedGroupId!);
      return (data ?? []).map((r: any) => r.athlete_id as string);
    },
  });

  const scopeAthleteIds = scopeMode === "athlete" ? (selectedAthleteId ? [selectedAthleteId] : []) : groupMemberIds ?? [];

  // Fetched as soon as scope + range are set — feeds both the live
  // "current total" shown in the quick-set control and, unchanged,
  // whatever generatePreview() builds drafts from. One fetch, two uses,
  // rather than a separate round trip for each.
  const { data: sourceData } = useQuery({
    queryKey: ["copy-dialog-source", scopeAthleteIds.join(","), sourceStart, sourceEnd],
    enabled: open && scopeAthleteIds.length > 0 && !!sourceStart && !!sourceEnd,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select("*")
        .in("athlete_id", scopeAthleteIds)
        .gte("session_date", sourceStart)
        .lte("session_date", sourceEnd)
        .order("session_date");
      if (error) throw error;

      const stepsBySession = new Map<string, any[]>();
      const sessionIds = (sessions ?? []).map((s: any) => s.id);
      if (sessionIds.length > 0) {
        const { data: allSteps, error: stepsErr } = await supabase
          .from("steps")
          .select("*")
          .in("session_id", sessionIds)
          .order("step_order");
        if (stepsErr) throw stepsErr;
        for (const s of allSteps ?? []) {
          const list = stepsBySession.get(s.session_id) ?? [];
          list.push(s);
          stepsBySession.set(s.session_id, list);
        }
      }

      return { sessions: sessions ?? [], stepsBySession };
    },
  });

  const currentTotalM = sourceData ? estimateTotalDistanceM(sourceData.sessions, sourceData.stepsBySession) : 0;
  const currentTotalKm = currentTotalM / 1000;

  function applyQuickTarget() {
    const targetKm = Number(quickTargetKm);
    if (!targetKm || currentTotalM <= 0) {
      toast.error("Need a current total above zero to compute a percentage from");
      return;
    }
    const pct = Math.round(((targetKm * 1000) / currentTotalM - 1) * 1000) / 10;
    setRules((r) => {
      const next: ProgressionRules = { ...r };
      for (const b of COPY_BUCKETS) {
        next[b] = { ...(next[b] ?? { volumePct: 0, intensityPct: 0 }), volumePct: pct };
      }
      return next;
    });
    toast.success(`Applied ${pct > 0 ? "+" : ""}${pct}% volume to every bucket`);
  }

  const { data: libraryTemplates } = useQuery({
    queryKey: ["copy-dialog-templates"],
    enabled: !!swapDraft,
    queryFn: async () => {
      const { data } = await supabase.from("session_templates").select("*").order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  function updateRule(bucket: (typeof COPY_BUCKETS)[number], patch: Partial<{ volumePct: number; intensityPct: number }>) {
    setRules((r) => ({ ...r, [bucket]: { ...(r[bucket] ?? { volumePct: 0, intensityPct: 0 }), ...patch } }));
  }

  async function generatePreview() {
    if (scopeAthleteIds.length === 0) {
      toast.error(scopeMode === "athlete" ? "Choose an athlete" : "Choose a group with athletes assigned");
      return;
    }
    if (!sourceStart || !sourceEnd) {
      toast.error("Choose the date range to copy from");
      return;
    }
    if (!targetStart) {
      toast.error("Choose a start date to copy into");
      return;
    }
    if (!sourceData || sourceData.sessions.length === 0) {
      toast.error("No sessions found in that date range");
      return;
    }

    setGenerating(true);
    try {
      const { sessions: sourceSessions, stepsBySession } = sourceData;

      const offsetDays = offsetDaysBetween(sourceStart, targetStart);
      const built = sourceSessions.map((s: any) => buildCopyDraft(s, stepsBySession.get(s.id) ?? [], offsetDays, rules));

      setDrafts(built);
      setStepUi("review");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to build preview");
    } finally {
      setGenerating(false);
    }
  }

  function removeDraft(tempId: string) {
    setDrafts((d) => d.filter((x) => x.tempId !== tempId));
  }

  function applyEdit(tempId: string, patch: { reps?: number; recovery_between_reps_seconds?: number | null }) {
    setDrafts((all) =>
      all.map((d) => {
        if (d.tempId !== tempId) return d;
        const steps = d.steps.map((s) =>
          s.kind === "work"
            ? {
                ...s,
                reps: patch.reps ?? s.reps,
                recovery_between_reps_seconds:
                  patch.recovery_between_reps_seconds !== undefined
                    ? patch.recovery_between_reps_seconds
                    : s.recovery_between_reps_seconds,
              }
            : s,
        );
        return { ...d, steps };
      }),
    );
  }

  async function applySwap(tempId: string, templateId: string) {
    const { data: template } = await supabase.from("session_templates").select("*").eq("id", templateId).single();
    const { data: templateSteps } = await supabase
      .from("template_steps")
      .select("*")
      .eq("template_id", templateId)
      .order("step_order");

    if (!template) return;

    setDrafts((all) =>
      all.map((d) =>
        d.tempId === tempId
          ? {
              ...d,
              title: (template as any).title ?? d.title,
              intent: (template as any).intent ?? d.intent,
              structure: (template as any).structure ?? d.structure,
              needsReview: false,
              steps: (templateSteps ?? []).map((ts: any) => ({
                kind: ts.kind,
                reps: ts.reps ?? 1,
                set_count: ts.set_count ?? 1,
                target_kind: ts.target_kind ?? null,
                target_distance_m: ts.target_distance_m ?? null,
                target_time_seconds: ts.target_time_seconds ?? null,
                target_mode: ts.target_mode ?? null,
                target_pace_sec_per_km: ts.target_pace_sec_per_km ?? null,
                target_threshold_pace_pct: ts.target_threshold_pace_pct ?? null,
                target_threshold_hr_pct: ts.target_threshold_hr_pct ?? null,
                target_zone: ts.target_zone ?? null,
                target_rpe: ts.target_rpe ?? null,
                is_ladder: ts.is_ladder ?? false,
                counts_toward_distance: ts.counts_toward_distance ?? true,
                recovery_between_reps_seconds: ts.recovery_between_reps_seconds ?? null,
                recovery_between_reps_mode: ts.recovery_between_reps_mode ?? null,
                recovery_between_reps_target_kind: ts.recovery_between_reps_target_kind ?? null,
                recovery_between_sets_seconds: ts.recovery_between_sets_seconds ?? null,
                recovery_between_sets_mode: ts.recovery_between_sets_mode ?? null,
                recovery_mode: ts.recovery_mode ?? null,
                recovery_target_kind: ts.recovery_target_kind ?? null,
                recovery_target_seconds: ts.recovery_target_seconds ?? null,
                recovery_target_distance_m: ts.recovery_target_distance_m ?? null,
                notes: ts.notes ?? null,
              })),
            }
          : d,
      ),
    );
    setSwapDraft(null);
    toast.success("Session swapped");
  }

  async function commit() {
    if (drafts.length === 0) return;
    setCommitting(true);
    try {
      const payload = drafts.map((d) => ({
        athlete_id: d.athlete_id,
        session_date: d.session_date,
        title: d.title,
        day_type: d.day_type,
        intent: d.intent,
        structure: d.structure,
        is_long_run: d.is_long_run,
        steps: d.steps,
      }));
      const result = await commitCopyDrafts({ data: { drafts: payload } });
      toast.success(`${result.created} session${result.created === 1 ? "" : "s"} copied forward`);
      qc.invalidateQueries({ queryKey: ["calendar-sessions"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      handleClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to copy sessions");
    } finally {
      setCommitting(false);
    }
  }

  function handleClose() {
    setStepUi("setup");
    setDrafts([]);
    onClose();
  }

  const flaggedCount = drafts.filter((d) => d.needsReview).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy period forward</DialogTitle>
          <DialogDescription>
            {stepUi === "setup"
              ? "Copy a week or month of sessions into a later date range, with optional progression."
              : "Review every session before it's created — edit, swap, or remove any of them individually."}
          </DialogDescription>
        </DialogHeader>

        {stepUi === "setup" ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={scopeMode === "athlete" ? "default" : "outline"} onClick={() => setScopeMode("athlete")}>
                Single athlete
              </Button>
              <Button size="sm" variant={scopeMode === "group" ? "default" : "outline"} onClick={() => setScopeMode("group")}>
                Whole group
              </Button>
            </div>

            {scopeMode === "athlete" ? (
              <div>
                <Label className="text-xs">Athlete</Label>
                <div className="mt-1">
                  <CoachAthletePicker roster={roster ?? []} value={selectedAthleteId} onChange={setSelectedAthleteId} />
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-xs">Group</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {(groups ?? []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Copy from</Label>
                <Input type="date" value={sourceStart} onChange={(e) => setSourceStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Through</Label>
                <Input type="date" value={sourceEnd} onChange={(e) => setSourceEnd(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Copy into (new start date)</Label>
              <Input type="date" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} />
            </div>

            {sourceStart && sourceEnd && scopeAthleteIds.length > 0 && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                <Label className="text-xs">
                  Quick set: target weekly/monthly total{" "}
                  <span className="text-muted-foreground font-normal">
                    (current: {currentTotalKm > 0 ? `${currentTotalKm.toFixed(1)} km` : "—"})
                  </span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 100"
                    value={quickTargetKm}
                    onChange={(e) => setQuickTargetKm(e.target.value)}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground self-center">km</span>
                  <Button size="sm" variant="outline" onClick={applyQuickTarget} disabled={currentTotalM <= 0}>
                    Apply to all buckets
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Computes the % change from current to target and sets every bucket's Volume % below to match —
                  still yours to fine-tune per bucket afterward (e.g. keep easy days flat, put the increase into the
                  long run only).
                </p>
              </div>
            )}

            <div>
              <Label className="text-xs">Progression (optional — leave at 0 for an exact copy)</Label>
              <div className="mt-1.5 space-y-2">
                {COPY_BUCKETS.map((b) => (
                  <div key={b} className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-xs text-muted-foreground">{COPY_BUCKET_LABELS[b]}</span>
                    <div>
                      <Input
                        type="number"
                        placeholder="Volume %"
                        value={rules[b]?.volumePct ?? 0}
                        onChange={(e) => updateRule(b, { volumePct: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Input
                        type="number"
                        placeholder="Intensity %"
                        value={rules[b]?.intensityPct ?? 0}
                        onChange={(e) => updateRule(b, { intensityPct: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Volume scales work-step distance/time. Intensity tightens pace or threshold-% targets. Zone/RPE targets
                can't be scaled numerically — flagged for you to adjust by hand in the review step instead.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {flaggedCount > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-2">
                {flaggedCount} session{flaggedCount > 1 ? "s use" : " uses"} a Zone/RPE target and couldn't be
                auto-adjusted for intensity — review those manually below.
              </div>
            )}
            <div className="space-y-1.5">
              {drafts.map((d) => (
                <div key={d.tempId} className="rounded border p-2 text-sm flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate">{d.title}</span>
                      {d.bucket && (
                        <Badge variant="outline" className="text-[10px]">
                          {COPY_BUCKET_LABELS[d.bucket]}
                        </Badge>
                      )}
                      {d.needsReview && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">Review target</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{d.session_date}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditingDraft(d)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSwapDraft(d)}>
                      <Repeat2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeDraft(d.tempId)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {drafts.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Every session was removed from this batch — nothing left to copy.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {stepUi === "setup" ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={generatePreview} disabled={generating}>
                {generating ? "Building preview..." : "Preview"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStepUi("setup")}>
                Back
              </Button>
              <Button onClick={commit} disabled={committing || drafts.length === 0}>
                {committing ? "Copying..." : `Copy ${drafts.length} session${drafts.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {editingDraft && (
        <Dialog open onOpenChange={(o) => !o && setEditingDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit "{editingDraft.title}"</DialogTitle>
              <DialogDescription>Adjust this one session's reps or recovery before it's created.</DialogDescription>
            </DialogHeader>
            <EditDraftForm
              draft={editingDraft}
              onApply={(patch) => {
                applyEdit(editingDraft.tempId, patch);
                setEditingDraft(null);
              }}
              onClose={() => setEditingDraft(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      {swapDraft && (
        <Dialog open onOpenChange={(o) => !o && setSwapDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Swap "{swapDraft.title}"</DialogTitle>
              <DialogDescription>Replace this session with one from your Templates library.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(libraryTemplates ?? []).map((t: any) => (
                <button
                  key={t.id}
                  className="w-full text-left rounded border px-2.5 py-1.5 text-sm hover:bg-accent/40"
                  onClick={() => applySwap(swapDraft.tempId, t.id)}
                >
                  {t.title}
                </button>
              ))}
              {(libraryTemplates ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No saved templates in your library yet.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSwapDraft(null)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function EditDraftForm({
  draft,
  onApply,
  onClose,
}: {
  draft: DraftSession;
  onApply: (patch: { reps?: number; recovery_between_reps_seconds?: number | null }) => void;
  onClose: () => void;
}) {
  const workStep = draft.steps.find((s) => s.kind === "work");
  const [reps, setReps] = useState(workStep?.reps ?? 1);
  const [recoverySeconds, setRecoverySeconds] = useState<number | "">(workStep?.recovery_between_reps_seconds ?? "");

  if (!workStep) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">This session has no work step to adjust.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Reps</Label>
        <Input type="number" min={1} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
      </div>
      <div>
        <Label className="text-xs">Recovery between reps (sec)</Label>
        <Input
          type="number"
          min={0}
          value={recoverySeconds}
          onChange={(e) => setRecoverySeconds(e.target.value ? Number(e.target.value) : "")}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onApply({ reps, recovery_between_reps_seconds: recoverySeconds === "" ? null : recoverySeconds })
          }
        >
          Apply
        </Button>
      </DialogFooter>
    </div>
  );
}
