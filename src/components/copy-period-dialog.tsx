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
import { cn } from "@/lib/utils";
import { commitCopyDrafts } from "@/lib/calendar-copy.functions";
import {
  COPY_BUCKETS,
  COPY_BUCKET_LABELS,
  emptyProgressionRules,
  offsetDaysBetween,
  buildCopyDraft,
  bucketForSession,
  estimateTotalDistanceM,
  estimateSessionDistanceM,
  estimateDraftDistanceM,
  summarizeDraftSteps,
  applyVolumeNudgeKm,
  applyPaceNudgeSecPerKm,
  applyRepDelta,
  applyRecoveryDelta,
  type ProgressionRules,
  type DraftSession,
  type DraftStep,
  type CopyBucket,
  type WeekOverride,
} from "@/lib/calendar-copy";
import { secToClock, clockToSec } from "@/lib/format";
import {
  computeVolumeTargetDeltas,
  kmDeltasToProgressionRules,
  REP_BUCKETS,
  type DistributionStrategy,
} from "@/lib/volume-target";

// Whole-batch progression presets — one click sets every bucket's Volume %
// to the same value (intensity untouched), same underlying action as the
// existing "quick set target total" control, just a fixed % instead of one
// computed from a typed target. Manual per-bucket inputs below stay
// available for fine-tuning after a preset is applied.
const VOLUME_PATTERN_PRESETS: { label: string; pct: number }[] = [
  { label: "Cutback −20%", pct: -20 },
  { label: "Flat 0%", pct: 0 },
  { label: "Build +5%", pct: 5 },
  { label: "Build +10%", pct: 10 },
  { label: "Build +15%", pct: 15 },
];

// Increment size for the per-bucket +/- steppers next to each manual input.
const VOLUME_STEP = 5;
const INTENSITY_STEP = 2;

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
  variant = "period",
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialSourceStart?: string;
  initialSourceEnd?: string;
  initialAthleteId?: string;
  // "period" = original Copy Period Forward (one source, fanned across a
  // chosen scope). "history" = Copy Athlete History — same engine, but
  // framed around giving each athlete their own recent training back as
  // their own starting point, defaults to Whole roster, and offers an
  // "Exact copy" shortcut that skips the review step entirely.
  variant?: "period" | "history";
  // Fired after a real commit (both the review-flow path and history's
  // one-click "Exact copy" path, since both funnel through commit()) —
  // lets the Plans landing page offer "Send this program now?" without
  // this dialog knowing anything about Deliver Program itself.
  onSuccess?: (scope: { athleteIds: string[]; rangeStart: string; rangeEnd: string }) => void;
}) {
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const [stepUi, setStepUi] = useState<"setup" | "review">("setup");
  const [scopeMode, setScopeMode] = useState<"athlete" | "group" | "roster">(
    variant === "history" ? "roster" : "athlete",
  );
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | undefined>(initialAthleteId);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined);
  // Only meaningful for variant "history" — "exact" skips progression and
  // the review step entirely (straight copy, one click, same shape as the
  // Calendar page's existing "straight copy" shortcut). "edit" is the
  // original Setup(progression) -> Review -> Commit flow.
  const [copyMode, setCopyMode] = useState<"exact" | "edit">("exact");

  const [sourceStart, setSourceStart] = useState(initialSourceStart ?? "");
  const [sourceEnd, setSourceEnd] = useState(initialSourceEnd ?? "");
  const [targetStart, setTargetStart] = useState("");

  const [rules, setRules] = useState<ProgressionRules>(emptyProgressionRules());
  const [quickTargetKm, setQuickTargetKm] = useState<string>("");
  // Week-specific overrides — for peaking/tapering a specific week or two
  // within a multi-week copy without hand-editing every session of that
  // week in Review. Week numbers are relative to the source range's own
  // start (week 1 = the week sourceStart falls in).
  const [weekOverrides, setWeekOverrides] = useState<WeekOverride[]>([]);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [overrideFromWeek, setOverrideFromWeek] = useState(1);
  const [overrideToWeek, setOverrideToWeek] = useState(1);
  const [overridePct, setOverridePct] = useState(-20);

  // Volume Target — aggregate weekly-volume progression, distributed
  // across buckets by strategy rather than a flat % everywhere. Produces
  // suggested per-bucket deltas (editable) which merge into `rules` /
  // apply as rep deltas at preview time; doesn't touch the existing
  // %-based quick-nudge knobs above at all.
  const [volumeTargetKm, setVolumeTargetKm] = useState<string>("");
  const [distributionStrategy, setDistributionStrategy] = useState<DistributionStrategy>("proportional");
  const [longRunCapMode, setLongRunCapMode] = useState<"none" | "km" | "time">("none");
  const [longRunCapKmInput, setLongRunCapKmInput] = useState<string>("");
  const [longRunCapTimeInput, setLongRunCapTimeInput] = useState<string>(""); // "h:mm"
  const [suggestedKmDelta, setSuggestedKmDelta] = useState<Partial<Record<CopyBucket, number>>>({});
  const [suggestedRepDelta, setSuggestedRepDelta] = useState<Partial<Record<CopyBucket, number>>>({});
  const [volumeTargetCapped, setVolumeTargetCapped] = useState(false);
  const [volumeTargetComputed, setVolumeTargetComputed] = useState(false);
  // Rep deltas can't be expressed as a %, so they're carried separately
  // and applied to the built drafts (via applyRepDelta, same function the
  // Review-screen Quick Adjustments panel already uses) right after
  // Preview builds them — not merged into `rules`.
  const [pendingRepDeltas, setPendingRepDeltas] = useState<Partial<Record<CopyBucket, number>>>({});
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [reviewAthleteFilter, setReviewAthleteFilter] = useState<string>("all");
  // Optional coach preference — no schema field exists for AM/PM on an
  // individual session (only the separate squad Training Schedule has
  // that), so this just appends "(AM)"/"(PM)" onto the generated title
  // rather than requiring a migration for what's a genuinely optional,
  // occasional call.
  const [timeOfDayPref, setTimeOfDayPref] = useState<"none" | "am" | "pm">("none");
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

  const scopeAthleteIds =
    scopeMode === "athlete"
      ? selectedAthleteId
        ? [selectedAthleteId]
        : []
      : scopeMode === "roster"
        ? (roster ?? []).map((a: any) => a.id)
        : groupMemberIds ?? [];

  const athleteNameById = new Map((roster ?? []).map((a: any) => [a.id, a.name as string]));

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

  // Session count per bucket for the currently selected range/scope — the
  // whole reason "Apply to all buckets" can look confusing without this:
  // a bucket with zero sessions in range still shows whatever % you typed,
  // but that number has nothing to actually scale, so it's a harmless
  // no-op rather than a mistake. Surfacing the count makes that visible
  // instead of leaving it to guesswork.
  const bucketCounts: Record<string, number> = {};
  for (const b of COPY_BUCKETS) bucketCounts[b] = 0;
  for (const s of sourceData?.sessions ?? []) {
    const b = bucketForSession(s);
    if (b) bucketCounts[b] = (bucketCounts[b] ?? 0) + 1;
  }

  // Per-bucket km + estimated km/rep (for threshold/vo2's rep-delta
  // conversion) — feeds the Volume Target section below. Computed from
  // the same source sessions bucketCounts already uses, just broken out
  // by bucket instead of summed.
  const currentKmByBucket: Partial<Record<CopyBucket, number>> = {};
  const kmPerRepByBucket: Partial<Record<CopyBucket, number>> = {};
  for (const b of COPY_BUCKETS) {
    const sessionsInBucket = (sourceData?.sessions ?? []).filter((s: any) => bucketForSession(s) === b);
    const totalM = sessionsInBucket.reduce(
      (sum: number, s: any) => sum + estimateSessionDistanceM(s, sourceData?.stepsBySession.get(s.id) ?? []),
      0,
    );
    currentKmByBucket[b] = totalM / 1000;
    if (REP_BUCKETS.includes(b)) {
      let totalReps = 0;
      for (const s of sessionsInBucket) {
        for (const st of sourceData?.stepsBySession.get(s.id) ?? []) {
          if (st.kind === "work" || st.kind === "strides") totalReps += Number(st.reps ?? 1);
        }
      }
      if (totalReps > 0) kmPerRepByBucket[b] = totalM / 1000 / totalReps;
    }
  }

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

  function applyPatternToAllBuckets(pct: number) {
    setRules((r) => {
      const next: ProgressionRules = { ...r };
      for (const b of COPY_BUCKETS) {
        next[b] = { ...(next[b] ?? { volumePct: 0, intensityPct: 0 }), volumePct: pct };
      }
      return next;
    });
    toast.success(`Applied ${pct > 0 ? "+" : ""}${pct}% volume to every bucket`);
  }

  function updateRule(bucket: (typeof COPY_BUCKETS)[number], patch: Partial<{ volumePct: number; intensityPct: number }>) {
    setRules((r) => ({ ...r, [bucket]: { ...(r[bucket] ?? { volumePct: 0, intensityPct: 0 }), ...patch } }));
  }

  function stepRule(bucket: (typeof COPY_BUCKETS)[number], field: "volumePct" | "intensityPct", delta: number) {
    setRules((r) => {
      const current = r[bucket]?.[field] ?? 0;
      return { ...r, [bucket]: { ...(r[bucket] ?? { volumePct: 0, intensityPct: 0 }), [field]: current + delta } };
    });
  }

  function computeSuggestedVolumeTarget() {
    const targetKm = Number(volumeTargetKm);
    if (!targetKm) {
      toast.error("Enter a target weekly total first");
      return;
    }

    let capKm: number | null = null;
    if (longRunCapMode === "km" && longRunCapKmInput) {
      capKm = Number(longRunCapKmInput);
    } else if (longRunCapMode === "time" && longRunCapTimeInput) {
      // "long" bucket's own assumed pace (5:30/km) — same approximation
      // already used for the browsing-only weekly-volume estimate
      // elsewhere in this app; a rough cap conversion, not a precise one.
      // longRunCapTimeInput is "H:MM" (hours:minutes), not a pace string,
      // so this is parsed directly rather than reusing clockToSec (which
      // is mm:ss for pace).
      const [hStr, mStr] = longRunCapTimeInput.split(":");
      const totalSeconds = (Number(hStr) || 0) * 3600 + (Number(mStr) || 0) * 60;
      capKm = totalSeconds / 330;
    }

    const result = computeVolumeTargetDeltas({
      currentKmByBucket,
      targetKm,
      strategy: distributionStrategy,
      longRunCapKm: capKm,
      kmPerRepByBucket,
    });

    setSuggestedKmDelta(result.kmDeltaByBucket);
    setSuggestedRepDelta(result.repDeltaByBucket);
    setVolumeTargetCapped(result.longRunCapped);
    setVolumeTargetComputed(true);
  }

  function applyVolumeTargetToProgression() {
    setRules((r) => kmDeltasToProgressionRules(suggestedKmDelta, currentKmByBucket, r));
    setPendingRepDeltas((prev) => ({ ...prev, ...suggestedRepDelta }));
    toast.success("Volume target applied — Volume % below updated, rep counts will apply to the review batch");
  }

  function addWeekOverride() {
    if (overrideToWeek < overrideFromWeek) {
      toast.error("End week must be on or after the start week");
      return;
    }
    setWeekOverrides((prev) => [
      ...prev,
      { id: `wo-${Date.now()}`, fromWeek: overrideFromWeek, toWeek: overrideToWeek, volumePct: overridePct },
    ]);
    setShowAddOverride(false);
  }

  function removeWeekOverride(id: string) {
    setWeekOverrides((prev) => prev.filter((o) => o.id !== id));
  }

  async function generatePreview() {
    if (scopeAthleteIds.length === 0) {
      toast.error(
        scopeMode === "athlete" ? "Choose an athlete" : scopeMode === "roster" ? "No athletes on your roster yet" : "Choose a group with athletes assigned",
      );
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
      // Exact copy (history variant only) forces zero progression regardless
      // of whatever's left in `rules` state, so a stray non-zero value from
      // a prior "Edit before applying" pass can never sneak into a one-click
      // exact copy.
      const effectiveRules = variant === "history" && copyMode === "exact" ? emptyProgressionRules() : rules;
      let built = sourceSessions
        .map((s: any) => buildCopyDraft(s, stepsBySession.get(s.id) ?? [], offsetDays, effectiveRules, sourceStart, weekOverrides))
        .map((d) => (timeOfDayPref === "none" ? d : { ...d, title: `${d.title} (${timeOfDayPref.toUpperCase()})` }));

      // Volume Target's rep-based buckets (threshold/vo2) apply here,
      // after the draft list exists — same applyRepDelta the Review
      // screen's own Quick Adjustments panel uses, just driven by the
      // computed deltas instead of a manual chip click.
      if (variant !== "history" || copyMode !== "exact") {
        for (const bucket of Object.keys(pendingRepDeltas) as CopyBucket[]) {
          const delta = pendingRepDeltas[bucket];
          if (delta) built = applyRepDelta(built, bucket, delta);
        }
      }

      if (variant === "history" && copyMode === "exact") {
        // Skip the review screen entirely — same one-click shape as the
        // Calendar page's existing "straight copy" shortcut, just reusable
        // here across a whole roster instead of one week/month view.
        await commit(built);
      } else {
        setDrafts(built);
        setReviewAthleteFilter("all");
        setStepUi("review");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to build preview");
    } finally {
      setGenerating(false);
    }
  }

  function removeDraft(tempId: string) {
    setDrafts((d) => d.filter((x) => x.tempId !== tempId));
  }

  function applyEdit(tempId: string, stepIndex: number, patch: Partial<DraftStep>) {
    setDrafts((all) =>
      all.map((d) => {
        if (d.tempId !== tempId) return d;
        const steps = d.steps.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s));
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

  async function commit(draftsOverride?: DraftSession[]) {
    const toCommit = draftsOverride ?? drafts;
    if (toCommit.length === 0) return;
    setCommitting(true);
    try {
      const payload = toCommit.map((d) => ({
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

      if (onSuccess && toCommit.length > 0) {
        const athleteIds = Array.from(new Set(toCommit.map((d) => d.athlete_id)));
        const dates = toCommit.map((d) => d.session_date).sort();
        onSuccess({ athleteIds, rangeStart: dates[0], rangeEnd: dates[dates.length - 1] });
      }

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

  // Review-screen batch quick-edits — deferred item from the Copy dialog
  // backlog. Each operates on the current drafts array, so it composes
  // with whatever progression + individual per-session edits are already
  // in place rather than rebuilding from the source.
  function handleVolumeNudge(deltaKm: number) {
    setDrafts((d) => applyVolumeNudgeKm(d, deltaKm));
    toast.success(`${deltaKm > 0 ? "+" : ""}${deltaKm}km applied across the batch`);
  }
  function handlePaceNudge(bucket: CopyBucket, deltaSecPerKm: number) {
    const count = drafts.filter((d) => d.bucket === bucket).length;
    setDrafts((d) => applyPaceNudgeSecPerKm(d, bucket, deltaSecPerKm));
    toast.success(`${COPY_BUCKET_LABELS[bucket]} pace adjusted on ${count} session${count === 1 ? "" : "s"}`);
  }
  function handleRepDelta(bucket: CopyBucket, delta: number) {
    const count = drafts.filter((d) => d.bucket === bucket).length;
    setDrafts((d) => applyRepDelta(d, bucket, delta));
    toast.success(
      `${delta > 0 ? "+" : ""}${delta} rep applied to ${count} ${COPY_BUCKET_LABELS[bucket]} session${count === 1 ? "" : "s"}`,
    );
  }
  function handleRecoveryDelta(deltaSeconds: number) {
    setDrafts((d) => applyRecoveryDelta(d, deltaSeconds));
    toast.success(`Recovery adjusted ${deltaSeconds > 0 ? "+" : ""}${deltaSeconds}s across the batch`);
  }

  const flaggedCount = drafts.filter((d) => d.needsReview).length;
  const presentBuckets = new Set(drafts.map((d) => d.bucket).filter(Boolean) as CopyBucket[]);

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{variant === "history" ? "Copy athlete history" : "Copy period forward"}</DialogTitle>
          <DialogDescription>
            {stepUi === "setup"
              ? variant === "history"
                ? "Give each athlete their own recent training back as their own starting point — pick a source range, then copy it exactly or tune it first."
                : "Copy a week or month of sessions into a later date range, with optional progression."
              : "Review every session before it's created — edit, swap, or remove any of them individually."}
          </DialogDescription>
        </DialogHeader>

        {stepUi === "setup" ? (
          <div className="space-y-4">
            {variant === "history" && (
              <div>
                <Label className="text-xs">How should this go?</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    variant={copyMode === "exact" ? "default" : "outline"}
                    onClick={() => setCopyMode("exact")}
                  >
                    Exact copy
                  </Button>
                  <Button size="sm" variant={copyMode === "edit" ? "default" : "outline"} onClick={() => setCopyMode("edit")}>
                    Edit before applying
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {copyMode === "exact"
                    ? "One click — copies each athlete's own sessions forward exactly as-is, no review step."
                    : "Set optional volume/intensity progression, then review every session before anything is created."}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant={scopeMode === "athlete" ? "default" : "outline"} onClick={() => setScopeMode("athlete")}>
                Single athlete
              </Button>
              <Button size="sm" variant={scopeMode === "group" ? "default" : "outline"} onClick={() => setScopeMode("group")}>
                Training group
              </Button>
              <Button size="sm" variant={scopeMode === "roster" ? "default" : "outline"} onClick={() => setScopeMode("roster")}>
                Whole roster
              </Button>
            </div>

            {scopeMode === "roster" && (
              <p className="text-xs text-muted-foreground">
                {(roster ?? []).length} athlete{(roster ?? []).length === 1 ? "" : "s"} on your roster.
              </p>
            )}

            {scopeMode === "athlete" ? (
              <div>
                <Label className="text-xs">Athlete</Label>
                <div className="mt-1">
                  <CoachAthletePicker roster={roster ?? []} value={selectedAthleteId} onChange={setSelectedAthleteId} />
                </div>
              </div>
            ) : scopeMode === "group" ? (
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
            ) : null}

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

            <div>
              <Label className="text-xs">Time of day (optional)</Label>
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant={timeOfDayPref === "none" ? "default" : "outline"} onClick={() => setTimeOfDayPref("none")}>
                  No preference
                </Button>
                <Button size="sm" variant={timeOfDayPref === "am" ? "default" : "outline"} onClick={() => setTimeOfDayPref("am")}>
                  AM
                </Button>
                <Button size="sm" variant={timeOfDayPref === "pm" ? "default" : "outline"} onClick={() => setTimeOfDayPref("pm")}>
                  PM
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Left as "No preference" by default — most planned sessions are fine for the athlete to fit in
                whenever suits them. Only set this if you specifically want these sessions done in the morning or
                evening.
              </p>
            </div>

            {!(variant === "history" && copyMode === "exact") && sourceStart && sourceEnd && scopeAthleteIds.length > 0 && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                <Label className="text-xs">
                  Quick set: target weekly/monthly total{" "}
                  <span className="text-muted-foreground font-normal">
                    (
                    {currentTotalKm > 0
                      ? scopeAthleteIds.length > 1
                        ? `combined current across ${scopeAthleteIds.length} athletes: ${currentTotalKm.toFixed(1)} km`
                        : `current: ${currentTotalKm.toFixed(1)} km`
                      : "—"}
                    )
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
                  {scopeAthleteIds.length > 1 &&
                    " With multiple athletes selected, the target you type is a combined figure — the same resulting % is applied to each athlete's own volume, not split evenly between them."}
                </p>
              </div>
            )}

            {!(variant === "history" && copyMode === "exact") && (
            <div className="rounded-md border p-3 space-y-2.5">
              <Label className="text-xs">Volume target (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Set a weekly total and a distribution strategy — computes suggested per-bucket deltas (km for
                continuous buckets, reps for threshold/VO2) which you can fine-tune before applying. For minor
                same-shape nudges instead, use the Quick nudge %/bucket controls below.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Target weekly total (km)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder={currentTotalKm > 0 ? `current: ${currentTotalKm.toFixed(1)}` : "e.g. 100"}
                    value={volumeTargetKm}
                    onChange={(e) => setVolumeTargetKm(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Distribution strategy</Label>
                  <Select value={distributionStrategy} onValueChange={(v: any) => setDistributionStrategy(v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="proportional">Proportional (spread by current share)</SelectItem>
                      <SelectItem value="long_priority">Long run priority</SelectItem>
                      <SelectItem value="easy_priority">Easy priority</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-[10px]">Long run cap (optional)</Label>
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant={longRunCapMode === "none" ? "default" : "outline"} onClick={() => setLongRunCapMode("none")}>
                    No cap
                  </Button>
                  <Button size="sm" variant={longRunCapMode === "km" ? "default" : "outline"} onClick={() => setLongRunCapMode("km")}>
                    Distance
                  </Button>
                  <Button size="sm" variant={longRunCapMode === "time" ? "default" : "outline"} onClick={() => setLongRunCapMode("time")}>
                    Time
                  </Button>
                </div>
                {longRunCapMode === "km" && (
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 32 km"
                    className="mt-2"
                    value={longRunCapKmInput}
                    onChange={(e) => setLongRunCapKmInput(e.target.value)}
                  />
                )}
                {longRunCapMode === "time" && (
                  <Input
                    placeholder="h:mm, e.g. 2:00"
                    className="mt-2"
                    value={longRunCapTimeInput}
                    onChange={(e) => setLongRunCapTimeInput(e.target.value)}
                  />
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Once the long run hits this cap, the rest of the increase redirects to the other buckets instead
                  of pushing the long run further.
                </p>
              </div>

              <Button size="sm" variant="outline" onClick={computeSuggestedVolumeTarget}>
                Compute suggested deltas
              </Button>

              {volumeTargetComputed && (
                <div className="rounded border p-2.5 space-y-1.5 bg-muted/20">
                  {volumeTargetCapped && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      Long run cap reached — the remainder redirected to other buckets.
                    </p>
                  )}
                  {COPY_BUCKETS.filter((b) => b !== "race" && (suggestedKmDelta[b] != null || suggestedRepDelta[b] != null)).map(
                    (b) => (
                      <div key={b} className="grid grid-cols-3 gap-2 items-center text-sm">
                        <span className="text-xs text-muted-foreground">{COPY_BUCKET_LABELS[b]}</span>
                        {suggestedRepDelta[b] != null ? (
                          <Input
                            type="number"
                            className="col-span-2"
                            value={suggestedRepDelta[b]}
                            onChange={(e) =>
                              setSuggestedRepDelta((prev) => ({ ...prev, [b]: Number(e.target.value) }))
                            }
                          />
                        ) : (
                          <Input
                            type="number"
                            step="0.1"
                            className="col-span-2"
                            value={suggestedKmDelta[b]?.toFixed(1) ?? 0}
                            onChange={(e) => setSuggestedKmDelta((prev) => ({ ...prev, [b]: Number(e.target.value) }))}
                          />
                        )}
                      </div>
                    ),
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {"Continuous buckets show a km delta, threshold/VO2 show a rep-count delta. Edit any value, then apply."}
                  </p>
                  <Button size="sm" onClick={applyVolumeTargetToProgression}>
                    Apply to progression
                  </Button>
                </div>
              )}
            </div>
            )}

            {!(variant === "history" && copyMode === "exact") && (
            <div>
              <Label className="text-xs">Quick nudge — %/bucket (optional, leave at 0 for an exact copy)</Label>

              <div className="flex flex-wrap gap-2 mt-1.5">
                {VOLUME_PATTERN_PRESETS.map((p) => (
                  <Button key={p.label} size="sm" variant="outline" onClick={() => applyPatternToAllBuckets(p.pct)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sets every bucket's Volume % to the same value in one click — still yours to fine-tune per bucket
                below (e.g. keep easy days flat, put a build into the long run only).
              </p>

              <div className="grid grid-cols-3 gap-2 mt-2.5 mb-1 px-0.5">
                <span />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Volume %</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Intensity %</span>
              </div>
              <div className="space-y-2">
                {COPY_BUCKETS.map((b) => {
                  const count = bucketCounts[b] ?? 0;
                  return (
                    <div key={b} className={cn("grid grid-cols-3 gap-2 items-center", count === 0 && "opacity-50")}>
                      <span className="text-xs text-muted-foreground">
                        {COPY_BUCKET_LABELS[b]}
                        <span className="ml-1">
                          {count > 0 ? `(${count} session${count === 1 ? "" : "s"})` : "(none in range)"}
                        </span>
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 shrink-0"
                          disabled={count === 0}
                          onClick={() => stepRule(b, "volumePct", -VOLUME_STEP)}
                        >
                          −
                        </Button>
                        <Input
                          type="number"
                          aria-label={`${COPY_BUCKET_LABELS[b]} volume percent`}
                          disabled={count === 0}
                          value={rules[b]?.volumePct ?? 0}
                          onChange={(e) => updateRule(b, { volumePct: Number(e.target.value) })}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 shrink-0"
                          disabled={count === 0}
                          onClick={() => stepRule(b, "volumePct", VOLUME_STEP)}
                        >
                          +
                        </Button>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 shrink-0"
                          disabled={count === 0}
                          onClick={() => stepRule(b, "intensityPct", -INTENSITY_STEP)}
                        >
                          −
                        </Button>
                        <Input
                          type="number"
                          aria-label={`${COPY_BUCKET_LABELS[b]} intensity percent`}
                          disabled={count === 0}
                          value={rules[b]?.intensityPct ?? 0}
                          onChange={(e) => updateRule(b, { intensityPct: Number(e.target.value) })}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 shrink-0"
                          disabled={count === 0}
                          onClick={() => stepRule(b, "intensityPct", INTENSITY_STEP)}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Volume scales work-step distance/time. Intensity tightens pace or threshold-% targets. Zone/RPE targets
                can't be scaled numerically — flagged for you to adjust by hand in the review step instead.
              </p>

              <div className="mt-3 pt-3 border-t">
                <Label className="text-xs">Week-specific overrides (optional)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  For peaking or tapering just part of this copy — e.g. weeks 3–4 of a 4-week copy at −30%,
                  regardless of the volume set above. Week 1 is whichever week your "Copy from" date falls in.
                </p>

                {weekOverrides.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {weekOverrides.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                        <span>
                          Week{o.fromWeek === o.toWeek ? ` ${o.fromWeek}` : `s ${o.fromWeek}–${o.toWeek}`}:{" "}
                          <span className="font-medium">
                            {o.volumePct > 0 ? "+" : ""}
                            {o.volumePct}%
                          </span>
                        </span>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeWeekOverride(o.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddOverride ? (
                  <div className="mt-2 rounded-md border p-3 space-y-2 bg-muted/20">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">From week</Label>
                        <Input
                          type="number"
                          min={1}
                          value={overrideFromWeek}
                          onChange={(e) => setOverrideFromWeek(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">To week</Label>
                        <Input
                          type="number"
                          min={1}
                          value={overrideToWeek}
                          onChange={(e) => setOverrideToWeek(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {VOLUME_PATTERN_PRESETS.map((p) => (
                        <Button
                          key={p.label}
                          size="sm"
                          variant={overridePct === p.pct ? "default" : "outline"}
                          onClick={() => setOverridePct(p.pct)}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setShowAddOverride(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={addWeekOverride}>
                        Add override
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowAddOverride(true)}>
                    + Add week override
                  </Button>
                )}
              </div>
            </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {flaggedCount > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-2">
                {flaggedCount} session{flaggedCount > 1 ? "s use" : " uses"} a Zone/RPE target and couldn't be
                auto-adjusted for intensity — review those manually below.
              </div>
            )}

            {drafts.length > 0 && (
              <div className="rounded-md border p-3 space-y-2.5 bg-muted/20">
                <Label className="text-xs">Quick adjustments</Label>
                <p className="text-xs text-muted-foreground -mt-1.5">
                  Nudge this whole batch on top of whatever progression or individual edits are already here.
                </p>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Total volume
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[-10, -5, 5, 10, 15, 20].map((km) => (
                      <Button key={km} size="sm" variant="outline" onClick={() => handleVolumeNudge(km)}>
                        {km > 0 ? `+${km}` : km}km
                      </Button>
                    ))}
                  </div>
                </div>

                {presentBuckets.has("easy") && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      Easy pace
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => handlePaceNudge("easy", -10)}>
                        Faster 10s
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handlePaceNudge("easy", -5)}>
                        Faster 5s
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handlePaceNudge("easy", 5)}>
                        Slower 5s
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handlePaceNudge("easy", 10)}>
                        Slower 10s
                      </Button>
                    </div>
                  </div>
                )}

                {presentBuckets.has("threshold") && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      Threshold reps
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => handleRepDelta("threshold", -1)}>
                        −1 rep
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleRepDelta("threshold", 1)}>
                        +1 rep
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Recovery (between reps &amp; sets)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => handleRecoveryDelta(-15)}>
                      −15s
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleRecoveryDelta(15)}>
                      +15s
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {scopeAthleteIds.length > 1 && (
              <div>
                <Label className="text-xs">Filter by athlete</Label>
                <Select value={reviewAthleteFilter} onValueChange={setReviewAthleteFilter}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All athletes ({drafts.length})</SelectItem>
                    {scopeAthleteIds.map((id) => {
                      const count = drafts.filter((d) => d.athlete_id === id).length;
                      return (
                        <SelectItem key={id} value={id}>
                          {athleteNameById.get(id) ?? "Athlete"} ({count})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              {drafts
                .filter((d) => reviewAthleteFilter === "all" || d.athlete_id === reviewAthleteFilter)
                .map((d) => {
                const distM = estimateDraftDistanceM(d);
                return (
                  <div key={d.tempId} className="rounded border p-2 text-sm flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium truncate">{d.title}</span>
                        {scopeAthleteIds.length > 1 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {athleteNameById.get(d.athlete_id) ?? "Athlete"}
                          </Badge>
                        )}
                        {d.bucket && (
                          <Badge variant="outline" className="text-[10px]">
                            {COPY_BUCKET_LABELS[d.bucket]}
                          </Badge>
                        )}
                        {d.needsReview && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">Review target</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.session_date}
                        {distM > 0 && ` · ~${(distM / 1000).toFixed(1)}km`}
                      </div>
                      <div className="text-xs mt-0.5">{summarizeDraftSteps(d.steps)}</div>
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
                );
              })}
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
              <Button onClick={generatePreview} disabled={generating || committing}>
                {variant === "history" && copyMode === "exact"
                  ? generating || committing
                    ? "Copying..."
                    : "Copy now"
                  : generating
                    ? "Building preview..."
                    : "Preview & edit"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStepUi("setup")}>
                Back
              </Button>
              <Button onClick={() => commit()} disabled={committing || drafts.length === 0}>
                {committing ? "Copying..." : `Copy ${drafts.length} session${drafts.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {editingDraft && (
        <Dialog open onOpenChange={(o) => !o && setEditingDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit "{editingDraft.title}"</DialogTitle>
              <DialogDescription>Adjust this one session's amount, target, reps, or recovery before it's created.</DialogDescription>
            </DialogHeader>
            <EditDraftForm
              draft={editingDraft}
              onApply={(stepIndex, patch) => {
                applyEdit(editingDraft.tempId, stepIndex, patch);
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
    </>
  );
}

export function EditDraftForm({
  draft,
  onApply,
  onClose,
}: {
  draft: DraftSession;
  onApply: (stepIndex: number, patch: Partial<DraftStep>) => void;
  onClose: () => void;
}) {
  const stepIndex = draft.steps.findIndex((s) => s.kind === "work" || s.kind === "strides");
  const workStep = stepIndex >= 0 ? draft.steps[stepIndex] : undefined;

  const [reps, setReps] = useState(workStep?.reps ?? 1);
  const [recoverySeconds, setRecoverySeconds] = useState<number | "">(workStep?.recovery_between_reps_seconds ?? "");
  const [amount, setAmount] = useState<number | "">(
    workStep?.target_kind === "time"
      ? workStep?.target_time_seconds != null
        ? Math.round(workStep.target_time_seconds / 60)
        : ""
      : workStep?.target_distance_m ?? "",
  );
  const [pace, setPace] = useState(workStep?.target_pace_sec_per_km != null ? secToClock(workStep.target_pace_sec_per_km) : "");
  const [thrPacePct, setThrPacePct] = useState<number | "">(workStep?.target_threshold_pace_pct ?? "");
  const [thrHrPct, setThrHrPct] = useState<number | "">(workStep?.target_threshold_hr_pct ?? "");
  const [zone, setZone] = useState(workStep?.target_zone ?? "");
  const [rpe, setRpe] = useState<number | "">(workStep?.target_rpe ?? "");

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

  function apply() {
    if (!workStep) return;
    const patch: Partial<DraftStep> = {
      reps,
      recovery_between_reps_seconds: recoverySeconds === "" ? null : recoverySeconds,
      target_distance_m: workStep.target_kind === "distance" ? (amount === "" ? null : Number(amount)) : workStep.target_distance_m,
      target_time_seconds: workStep.target_kind === "time" ? (amount === "" ? null : Number(amount) * 60) : workStep.target_time_seconds,
    };
    if (workStep.target_mode === "pace") patch.target_pace_sec_per_km = pace ? clockToSec(pace) : null;
    if (workStep.target_mode === "threshold_pace_pct") patch.target_threshold_pace_pct = thrPacePct === "" ? null : Number(thrPacePct);
    if (workStep.target_mode === "threshold_hr_pct") patch.target_threshold_hr_pct = thrHrPct === "" ? null : Number(thrHrPct);
    if (workStep.target_mode === "zone") patch.target_zone = zone || null;
    if (workStep.target_mode === "rpe") patch.target_rpe = rpe === "" ? null : Number(rpe);
    onApply(stepIndex, patch);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{workStep.target_kind === "time" ? "Minutes" : "Meters"}</Label>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} />
        </div>
        <div>
          <Label className="text-xs">Reps</Label>
          <Input type="number" min={1} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
        </div>
      </div>

      {workStep.target_mode === "pace" && (
        <div>
          <Label className="text-xs">Pace (mm:ss/km)</Label>
          <Input value={pace} onChange={(e) => setPace(e.target.value)} placeholder="4:00" />
        </div>
      )}
      {workStep.target_mode === "threshold_pace_pct" && (
        <div>
          <Label className="text-xs">% of threshold pace</Label>
          <Input type="number" value={thrPacePct} onChange={(e) => setThrPacePct(e.target.value ? Number(e.target.value) : "")} />
        </div>
      )}
      {workStep.target_mode === "threshold_hr_pct" && (
        <div>
          <Label className="text-xs">% of threshold HR</Label>
          <Input type="number" value={thrHrPct} onChange={(e) => setThrHrPct(e.target.value ? Number(e.target.value) : "")} />
        </div>
      )}
      {workStep.target_mode === "zone" && (
        <div>
          <Label className="text-xs">Zone</Label>
          <Select value={zone} onValueChange={setZone}>
            <SelectTrigger>
              <SelectValue placeholder="Choose zone" />
            </SelectTrigger>
            <SelectContent>
              {["z1", "z2", "z3", "z4", "z5"].map((z) => (
                <SelectItem key={z} value={z}>
                  {z.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {workStep.target_mode === "rpe" && (
        <div>
          <Label className="text-xs">RPE (1–10)</Label>
          <Input type="number" min={1} max={10} value={rpe} onChange={(e) => setRpe(e.target.value ? Number(e.target.value) : "")} />
        </div>
      )}

      {reps > 1 && (
        <div>
          <Label className="text-xs">Recovery between reps (sec)</Label>
          <Input
            type="number"
            min={0}
            value={recoverySeconds}
            onChange={(e) => setRecoverySeconds(e.target.value ? Number(e.target.value) : "")}
          />
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={apply}>Apply</Button>
      </DialogFooter>
    </div>
  );
}
