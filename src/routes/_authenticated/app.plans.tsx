import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarRange, ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from "lucide-react";
import { metersFmt, clockToSec, secToClock } from "@/lib/format";
import { assignPlanToAthlete, cancelAthletePlan, previewPlanAssignment, type PlanAssignDraft } from "@/lib/plan.functions";
import { useAuthUser } from "@/lib/use-auth";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { inferWorkoutTargetMode, type WorkoutTargetMode } from "@/lib/workout-target-modes";
import {
  PROGRESSION_PATTERNS,
  computeProgressionPercents,
  buildProgressedWeekSessions,
  estimateTemplateSessionDistanceM,
  bucketForEffortType,
  type ProgressionPatternId,
} from "@/lib/plan-progression";
import { CopyPeriodDialog, EditDraftForm } from "@/components/copy-period-dialog";
import {
  COPY_BUCKETS,
  COPY_BUCKET_LABELS,
  emptyProgressionRules,
  summarizeDraftSteps,
  applyVolumeNudgeKm,
  applyPaceNudgeSecPerKm,
  applyRepDelta,
  applyRecoveryDelta,
  generateVolumeProgressionOverrides,
  applyRepProgression,
  applyRecoveryProgression,
  type ProgressionRules,
  type CopyBucket,
  type WeekOverride,
} from "@/lib/calendar-copy";
import {
  computeVolumeTargetDeltas,
  kmDeltasToProgressionRules,
  REP_BUCKETS,
  type DistributionStrategy,
} from "@/lib/volume-target";
import { DeliverProgramDialog } from "@/components/deliver-program-dialog";

export const Route = createFileRoute("/_authenticated/app/plans")({
  component: PlansPage,
});

type PlanTemplate = {
  id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  duration_weeks: number;
  distance_focus: string | null;
  level: string | null;
  is_system: boolean;
  created_by: string | null;
};

type TemplateSession = {
  id: string;
  week_number: number;
  day_of_week: number;
  title: string;
  effort_type: string;
  notes: string | null;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Whole-batch progression presets for the Assign dialog — same pattern
// (and same preset values) as Copy Period Forward's own quick-set chips,
// duplicated locally rather than shared since it's a five-item constant,
// not worth an extra shared-constants file for.
const VOLUME_PATTERN_PRESETS: { label: string; pct: number }[] = [
  { label: "Cutback −20%", pct: -20 },
  { label: "Flat 0%", pct: 0 },
  { label: "Build +5%", pct: 5 },
  { label: "Build +10%", pct: 10 },
  { label: "Build +15%", pct: 15 },
];
const VOLUME_STEP = 5;
const INTENSITY_STEP = 2;

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-700 border-emerald-200",
  long: "bg-sky-100 text-sky-700 border-sky-200",
  tempo: "bg-amber-100 text-amber-700 border-amber-200",
  threshold: "bg-orange-100 text-orange-700 border-orange-200",
  vo2: "bg-red-100 text-red-700 border-red-200",
  strides: "bg-teal-100 text-teal-700 border-teal-200",
  race: "bg-purple-100 text-purple-700 border-purple-200",
  cross_train: "bg-muted text-muted-foreground border-border",
  rest: "bg-muted text-muted-foreground border-border",
};

function distanceFocusLabel(v: string | null) {
  switch (v) {
    case "5k":
      return "5K";
    case "10k":
      return "10K";
    case "half_marathon":
      return "Half Marathon";
    case "marathon":
      return "Marathon";
    case "track_middle_distance":
      return "Track (800m–5000m)";
    default:
      return "Generic base";
  }
}

// Most template steps are time-based ("40 min easy"), not distance-based —
// same convention every manually-planned session in this app already uses,
// pace intent lives on the session/effort type rather than a per-step pace
// column.

// To show a useful "km/week" figure for browsing, distance is
// estimated from a representative pace per effort type. This is
// deliberately approximate (real pace varies a lot by athlete) — it's a
// browsing aid for comparing templates against each other, not a precise
// per-athlete prediction the way an assigned session's own targets are.
const ASSUMED_PACE_SEC_PER_KM: Record<string, number> = {
  easy: 330, // 5:30/km
  long: 330,
  tempo: 255, // 4:15/km
  threshold: 240, // 4:00/km
  vo2: 225, // 3:45/km
  strides: 200, // fast, but short enough that it barely moves the total
  race: 300,
  cross_train: 0,
  rest: 0,
};

type StepLike = {
  kind: string;
  reps?: number;
  target_kind: "distance" | "time";
  target_distance_m?: number | null;
  target_time_seconds?: number | null;
};

function estimateSessionDistanceM(effortType: string, steps: StepLike[] | null): number {
  if (!steps || steps.length === 0) return 0;
  const paceSecPerKm = ASSUMED_PACE_SEC_PER_KM[effortType] ?? 300;

  return steps.reduce((sum, s) => {
    // Bug fix: this had no kind filter at all, so recovery/warmup/cooldown
    // steps with their own explicit distance/time (e.g. a 90s jog between
    // reps) were being counted toward the session's estimated distance —
    // inflating the weekly-volume figure shown when browsing templates.
    // plan-progression.ts's copy of this same estimate already excludes
    // non-work/strides steps; this now matches it.
    if (s.kind !== "work" && s.kind !== "strides") return sum;
    const reps = Number(s.reps ?? 1);
    if (s.target_kind === "distance") {
      return sum + Number(s.target_distance_m ?? 0) * reps;
    }
    if (s.target_kind === "time" && paceSecPerKm > 0) {
      const seconds = Number(s.target_time_seconds ?? 0) * reps;
      return sum + (seconds / paceSecPerKm) * 1000;
    }
    return sum;
  }, 0);
}

// Average weekly distance across every week in the template (recovery/taper
// weeks included, so this reads as a genuine average rather than a
// best-case peak week).
function estimateAvgWeeklyDistanceM(sessions: { week_number: number; effort_type: string; steps: StepLike[] | null }[]): number {
  if (sessions.length === 0) return 0;

  const byWeek = new Map<number, number>();
  for (const s of sessions) {
    const m = estimateSessionDistanceM(s.effort_type, s.steps);
    byWeek.set(s.week_number, (byWeek.get(s.week_number) ?? 0) + m);
  }

  const weekTotals = Array.from(byWeek.values());
  return weekTotals.reduce((a, b) => a + b, 0) / weekTotals.length;
}

// Shown wherever a coach is looking at (or about to assign) a system
// template — these are general-purpose starting points written for a
// typical athlete at a given level/distance, not a plan built with any
// specific athlete's history, injuries, or current fitness in mind.
function SystemTemplateNotice({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-md border border-amber-300 bg-amber-50 text-amber-900 ${
        compact ? "text-xs p-2" : "text-sm p-3"
      }`}
    >
      <strong>Starting point, not a prescription.</strong> System templates are general guides, not built for any
      specific athlete. Review every session and adjust pace, volume, and structure for each athlete's individual
      needs, history, and current fitness before assigning.
    </div>
  );
}

/**
 * One row in the "Build training" list on the Plans landing screen.
 * Deliberately spells out both *what* an option does and *how it plays
 * out* (workflow line) so a coach can pick between five genuinely
 * different paths at a glance, rather than guessing from a title alone.
 */
function BuildOptionRow({
  title,
  description,
  steps,
  onSelect,
  disabled,
  badge,
}: {
  title: string;
  description: string;
  steps: string[];
  onSelect: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <Card className={disabled ? "opacity-60" : undefined}>
      <CardContent className="p-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{title}</span>
            {badge && (
              <Badge variant="outline" className="text-[10px]">
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 mt-1.5">
            {steps.map((step, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                <span className="text-xs text-muted-foreground">{step}</span>
              </span>
            ))}
          </div>
        </div>
        <Button size="sm" variant={disabled ? "outline" : "default"} disabled={disabled} onClick={onSelect} className="shrink-0">
          {disabled ? (
            "Coming soon"
          ) : (
            <>
              Select <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function PlansPage() {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<"landing" | "browse" | "builder">("landing");
  // Where "Back" from the Plan Builder should return to — landing when
  // entered directly from "Build from scratch", browse when entered by
  // editing/previewing a template from the library list.
  const [returnView, setReturnView] = useState<"landing" | "browse">("landing");
  const [builderTemplateId, setBuilderTemplateId] = useState<string | null>(null);
  const [templateSource, setTemplateSource] = useState<"mine" | "system">("mine");
  const [daysFilter, setDaysFilter] = useState<string>("all");
  const [distanceFilter, setDistanceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [volumeFilter, setVolumeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<PlanTemplate | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [copyPeriodOpen, setCopyPeriodOpen] = useState(false);
  const [deliverDialogOpen, setDeliverDialogOpen] = useState(false);

  // Prefill handed to DeliverProgramDialog when it's opened via the
  // post-build prompt (null when opened manually via "Send now"). deliverKey
  // is bumped on every open so the dialog fully remounts and picks up a
  // fresh prefill each time, rather than reusing whatever scope/range state
  // it was left in from a previous open.
  const [deliverInitial, setDeliverInitial] = useState<{ athleteIds: string[]; rangeStart: string; rangeEnd: string } | null>(
    null,
  );
  const [deliverKey, setDeliverKey] = useState(0);
  // "Send this program now?" confirmation shown right after Assign, Copy
  // Period Forward, or Copy Athlete History succeeds.
  const [sendPrompt, setSendPrompt] = useState<{ athleteIds: string[]; rangeStart: string; rangeEnd: string } | null>(
    null,
  );

  function openDeliverProgram(initial: { athleteIds: string[]; rangeStart: string; rangeEnd: string } | null) {
    setDeliverInitial(initial);
    setDeliverKey((k) => k + 1);
    setDeliverDialogOpen(true);
  }

  // Shared success handler for both Copy dialogs (Copy Period Forward and
  // Copy Athlete History — including its one-click "Exact copy" path, since
  // both funnel through the same commit()).
  function handleBuildSuccess(scope: { athleteIds: string[]; rangeStart: string; rangeEnd: string }) {
    if (scope.athleteIds.length === 0) return;
    setSendPrompt(scope);
  }

  const { data: templates } = useQuery({
    queryKey: ["plan-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plan_templates")
        .select("*")
        .order("days_per_week")
        .order("distance_focus", { nullsFirst: true });
      return (data ?? []) as PlanTemplate[];
    },
  });

  const { data: allTemplateSessions } = useQuery({
    queryKey: ["all-plan-template-sessions"],
    queryFn: async () => {
      const { data } = await supabase.from("plan_template_sessions").select("*");
      return (data ?? []) as any[];
    },
  });

  const weeklyVolumeByTemplate = new Map<string, number>();
  for (const t of templates ?? []) {
    const sessionsForTemplate = (allTemplateSessions ?? []).filter((s) => s.plan_template_id === t.id);
    weeklyVolumeByTemplate.set(t.id, estimateAvgWeeklyDistanceM(sessionsForTemplate as any));
  }

  const filteredTemplates = (templates ?? []).filter((t) => {
    if (templateSource === "mine" && t.is_system) return false;
    if (templateSource === "system" && !t.is_system) return false;
    if (daysFilter !== "all" && String(t.days_per_week) !== daysFilter) return false;
    if (distanceFilter !== "all" && (t.distance_focus ?? "generic") !== distanceFilter) return false;
    if (levelFilter !== "all" && (t.level ?? "intermediate") !== levelFilter) return false;
    if (volumeFilter !== "all") {
      const km = (weeklyVolumeByTemplate.get(t.id) ?? 0) / 1000;
      if (volumeFilter === "low" && km >= 40) return false;
      if (volumeFilter === "mid" && (km < 40 || km >= 80)) return false;
      if (volumeFilter === "high" && km < 80) return false;
    }
    return true;
  });

  // "Use as base": system templates can't be edited directly (they're
  // shared, not owned by any one coach), so this copies the template's
  // metadata and every week/day it has into a brand-new template owned by
  // the current coach — fully editable from that point on, same as
  // anything built from scratch. Drops straight into the builder for the
  // new copy afterward.
  async function duplicateTemplate(t: PlanTemplate) {
    setDuplicatingId(t.id);
    try {
      const { data: newTemplate, error: tErr } = await supabase
        .from("plan_templates")
        .insert({
          name: `${t.name} (My Copy)`,
          description: t.description,
          days_per_week: t.days_per_week,
          duration_weeks: t.duration_weeks,
          distance_focus: t.distance_focus,
          level: t.level,
          is_system: false,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (tErr || !newTemplate) throw tErr ?? new Error("Failed to duplicate template");

      const { data: sourceSessions, error: sErr } = await supabase
        .from("plan_template_sessions")
        .select("*")
        .eq("plan_template_id", t.id);
      if (sErr) throw sErr;

      if (sourceSessions && sourceSessions.length > 0) {
        const rows = sourceSessions.map((s: any) => ({
          plan_template_id: (newTemplate as any).id,
          week_number: s.week_number,
          day_of_week: s.day_of_week,
          title: s.title,
          effort_type: s.effort_type,
          steps: s.steps,
          session_template_id: s.session_template_id,
          notes: s.notes,
        }));
        const { error: insErr } = await supabase.from("plan_template_sessions").insert(rows as any);
        if (insErr) throw insErr;
      }

      toast.success("Copied — now yours to edit");
      qc.invalidateQueries({ queryKey: ["plan-templates"] });
      setTemplateSource("mine");
      setBuilderTemplateId((newTemplate as any).id);
      setReturnView("browse");
      setView("builder");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to duplicate template");
    } finally {
      setDuplicatingId(null);
    }
  }

  if (view === "builder") {
    return (
      <AppShell fullWidth>
        <div className="space-y-6 max-w-5xl">
          <BucketTabStrip items={COACHING_HUB_TABS} active="/app/plans" />
          <PlanBuilder
            templateId={builderTemplateId}
            onBack={() => {
              setView(returnView);
              setBuilderTemplateId(null);
            }}
            onAssignSuccess={handleBuildSuccess}
          />
        </div>

        <DeliverProgramDialog
          key={deliverKey}
          open={deliverDialogOpen}
          onClose={() => {
            setDeliverDialogOpen(false);
            setDeliverInitial(null);
          }}
          initialAthleteIds={deliverInitial?.athleteIds}
          initialRangeStart={deliverInitial?.rangeStart}
          initialRangeEnd={deliverInitial?.rangeEnd}
        />

        <Dialog open={!!sendPrompt} onOpenChange={(o) => !o && setSendPrompt(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Send this program now?</DialogTitle>
              <DialogDescription>
                {sendPrompt && (
                  <>
                    Notify {sendPrompt.athleteIds.length} athlete{sendPrompt.athleteIds.length === 1 ? "" : "s"} and/or
                    email their schedule, covering {sendPrompt.rangeStart} – {sendPrompt.rangeEnd}. You can still
                    change the scope, date range, or channels on the next screen.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendPrompt(null)}>
                Not now
              </Button>
              <Button
                onClick={() => {
                  if (sendPrompt) openDeliverProgram(sendPrompt);
                  setSendPrompt(null);
                }}
              >
                Send now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  if (view === "landing") {
    return (
      <AppShell fullWidth>
        <div className="space-y-4">
          <BucketTabStrip items={COACHING_HUB_TABS} active="/app/plans" />

          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <CalendarRange className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Coaching</div>
              <h1 className="text-2xl font-bold leading-tight">Training Plans</h1>
              <p className="text-sm text-muted-foreground">
                Get training onto your roster's calendars, or manage the templates and groups behind it.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Build training</h2>

              <BuildOptionRow
                title="Apply a template"
                description="Assign an existing plan template — from your library or the System collection — to one athlete or a whole group."
                steps={["Pick a template", "Choose who it's for", "Set progression (optional)", "Review & edit", "Save to calendar", "Notify/send to athlete"]}
                onSelect={() => setView("browse")}
              />
              <BuildOptionRow
                title="Build from scratch"
                description="Design a brand-new plan template week by week, using the same step builder as a regular session — including threshold-relative targets."
                steps={["Design weeks", "Save template", "Choose who it's for", "Review & edit", "Save to calendar", "Notify/send to athlete"]}
                onSelect={() => {
                  setReturnView("landing");
                  setBuilderTemplateId(null);
                  setView("builder");
                }}
              />
              <BuildOptionRow
                title="Copy athlete history"
                description="Give each athlete their own recent training back as their own starting point — not one template fanned out, each athlete's own actual history."
                steps={["Pick source range & scope", "Exact copy or edit", "Review & edit", "Save to calendar", "Notify/send to athlete"]}
                onSelect={() => setHistoryDialogOpen(true)}
              />
              <BuildOptionRow
                title="Copy period forward"
                description="Take one source week or month and apply it — with optional progression — across selected athletes."
                steps={["Pick source & target dates", "Set progression (optional)", "Review & edit", "Save to calendar", "Notify/send to athlete"]}
                onSelect={() => setCopyPeriodOpen(true)}
              />
              <BuildOptionRow
                title="Auto / Recommended"
                description="Let Strider suggest the next training block based on an athlete's recent compliance and load."
                steps={["Not built yet — held back until Copy Period Forward has real usage data to learn from"]}
                badge="Coming soon"
                disabled
                onSelect={() => {}}
              />
            </div>

            <div className="lg:col-span-1 space-y-3">
              <Card>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">Templates</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Browse, duplicate, and manage your template library (My &amp; System).
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setView("browse")}>
                    Open <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="font-semibold">Manage Training Groups &amp; Athletes</div>
                  <p className="text-xs text-muted-foreground">
                    Set up training groups and manage roster membership.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate({ to: "/app/training-schedule" })}
                  >
                    Open <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="font-semibold">Send program update</div>
                  <p className="text-xs text-muted-foreground">
                    Post to Noticeboard and/or email each athlete an Excel copy of their upcoming sessions — works
                    for athletes without the app too, once they have a contact email on file.
                  </p>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => openDeliverProgram(null)}>
                    Send now
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <CopyPeriodDialog open={copyPeriodOpen} onClose={() => setCopyPeriodOpen(false)} onSuccess={handleBuildSuccess} />
        <CopyPeriodDialog
          open={historyDialogOpen}
          onClose={() => setHistoryDialogOpen(false)}
          variant="history"
          onSuccess={handleBuildSuccess}
        />
        <DeliverProgramDialog
          key={deliverKey}
          open={deliverDialogOpen}
          onClose={() => {
            setDeliverDialogOpen(false);
            setDeliverInitial(null);
          }}
          initialAthleteIds={deliverInitial?.athleteIds}
          initialRangeStart={deliverInitial?.rangeStart}
          initialRangeEnd={deliverInitial?.rangeEnd}
        />

        <Dialog open={!!sendPrompt} onOpenChange={(o) => !o && setSendPrompt(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Send this program now?</DialogTitle>
              <DialogDescription>
                {sendPrompt && (
                  <>
                    Notify {sendPrompt.athleteIds.length} athlete{sendPrompt.athleteIds.length === 1 ? "" : "s"} and/or
                    email their schedule, covering {sendPrompt.rangeStart} – {sendPrompt.rangeEnd}. You can still
                    change the scope, date range, or channels on the next screen.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendPrompt(null)}>
                Not now
              </Button>
              <Button
                onClick={() => {
                  if (sendPrompt) openDeliverProgram(sendPrompt);
                  setSendPrompt(null);
                }}
              >
                Send now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-4">
        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/plans" />

        <div className="flex items-center justify-between">
          <div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
              onClick={() => setView("landing")}
            >
              ← Training Plans
            </button>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <CalendarRange className="h-5 w-5" /> Templates
            </h1>
            <p className="text-sm text-muted-foreground">Browse plan templates, or build your own for your roster.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={templateSource === "mine" ? "default" : "outline"}
            onClick={() => setTemplateSource("mine")}
          >
            My Templates
          </Button>
          <Button
            size="sm"
            variant={templateSource === "system" ? "default" : "outline"}
            onClick={() => setTemplateSource("system")}
          >
            System Templates
          </Button>
        </div>

        {templateSource === "system" && <SystemTemplateNotice />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Select value={daysFilter} onValueChange={setDaysFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Days/week" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any days/week</SelectItem>
                {[3, 4, 5, 6, 7].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} days/week
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={distanceFilter} onValueChange={setDistanceFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Distance focus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any distance</SelectItem>
                <SelectItem value="generic">Generic base</SelectItem>
                <SelectItem value="5k">5K</SelectItem>
                <SelectItem value="10k">10K</SelectItem>
                <SelectItem value="half_marathon">Half Marathon</SelectItem>
                <SelectItem value="marathon">Marathon</SelectItem>
                <SelectItem value="track_middle_distance">Track (800m–5000m)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any level</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
            <Select value={volumeFilter} onValueChange={setVolumeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Weekly volume" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any volume</SelectItem>
                <SelectItem value="low">Under 40km/wk</SelectItem>
                <SelectItem value="mid">40–80km/wk</SelectItem>
                <SelectItem value="high">80km+/wk</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {filteredTemplates.length} template{filteredTemplates.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6">No templates match these filters.</p>
            ) : (
              <div className="divide-y">
                {filteredTemplates.map((t) => (
                  <div key={t.id}>
                    <div className="flex items-start justify-between p-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{t.name}</span>
                          <Badge variant="outline">{t.days_per_week}d/wk</Badge>
                          <Badge variant="outline">{distanceFocusLabel(t.distance_focus)}</Badge>
                          <Badge variant="outline">{t.level ?? "intermediate"}</Badge>
                          {(weeklyVolumeByTemplate.get(t.id) ?? 0) > 0 && (
                            <Badge variant="outline">~{metersFmt(weeklyVolumeByTemplate.get(t.id) ?? 0)}/wk avg</Badge>
                          )}
                          {!t.is_system && (
                            <Badge className="bg-[var(--accent-red)]/10 text-[var(--accent-red)] border-[var(--accent-red)]/20">
                              Yours
                            </Badge>
                          )}
                          {t.is_system && <Badge variant="outline">System</Badge>}
                        </div>
                        {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!t.is_system && t.created_by === user?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setBuilderTemplateId(t.id);
                              setReturnView("browse");
                              setView("builder");
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        {t.is_system && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={duplicatingId === t.id}
                            onClick={() => duplicateTemplate(t)}
                          >
                            {duplicatingId === t.id ? "Copying..." : "Use as base"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                        >
                          {expandedId === t.id ? (
                            <>
                              Hide <ChevronUp className="h-4 w-4 ml-1" />
                            </>
                          ) : (
                            <>
                              Preview <ChevronDown className="h-4 w-4 ml-1" />
                            </>
                          )}
                        </Button>
                        <Button size="sm" onClick={() => setAssignTarget(t)}>
                          Assign
                        </Button>
                      </div>
                    </div>

                    {expandedId === t.id && (
                      <TemplatePreview
                        templateId={t.id}
                        isSystem={t.is_system}
                        canEdit={!t.is_system && t.created_by === user?.id}
                        onEdit={() => {
                          setBuilderTemplateId(t.id);
                          setReturnView("browse");
                          setView("builder");
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {assignTarget && (
          <AssignPlanDialog
            template={assignTarget}
            onClose={() => setAssignTarget(null)}
            onSuccess={handleBuildSuccess}
          />
        )}

        <CopyPeriodDialog open={copyPeriodOpen} onClose={() => setCopyPeriodOpen(false)} onSuccess={handleBuildSuccess} />
        <CopyPeriodDialog
          open={historyDialogOpen}
          onClose={() => setHistoryDialogOpen(false)}
          variant="history"
          onSuccess={handleBuildSuccess}
        />
        <DeliverProgramDialog
          key={deliverKey}
          open={deliverDialogOpen}
          onClose={() => {
            setDeliverDialogOpen(false);
            setDeliverInitial(null);
          }}
          initialAthleteIds={deliverInitial?.athleteIds}
          initialRangeStart={deliverInitial?.rangeStart}
          initialRangeEnd={deliverInitial?.rangeEnd}
        />

        <Dialog open={!!sendPrompt} onOpenChange={(o) => !o && setSendPrompt(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Send this program now?</DialogTitle>
              <DialogDescription>
                {sendPrompt && (
                  <>
                    Notify {sendPrompt.athleteIds.length} athlete{sendPrompt.athleteIds.length === 1 ? "" : "s"} and/or
                    email their schedule, covering {sendPrompt.rangeStart} – {sendPrompt.rangeEnd}. You can still
                    change the scope, date range, or channels on the next screen.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendPrompt(null)}>
                Not now
              </Button>
              <Button
                onClick={() => {
                  if (sendPrompt) openDeliverProgram(sendPrompt);
                  setSendPrompt(null);
                }}
              >
                Send now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function TemplatePreview({
  templateId,
  isSystem,
  canEdit,
  onEdit,
}: {
  templateId: string;
  isSystem?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const { data: sessions } = useQuery({
    queryKey: ["plan-template-sessions", templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from("plan_template_sessions")
        .select("*")
        .eq("plan_template_id", templateId)
        .order("week_number")
        .order("day_of_week");
      return (data ?? []) as TemplateSession[];
    },
  });

  const byWeek = new Map<number, TemplateSession[]>();
  for (const s of sessions ?? []) {
    if (!byWeek.has(s.week_number)) byWeek.set(s.week_number, []);
    byWeek.get(s.week_number)!.push(s);
  }

  return (
    <div className="border-t p-4 space-y-3 bg-muted/20">
      {isSystem && <SystemTemplateNotice compact />}
      {canEdit && (
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit this template
        </Button>
      )}
      {Array.from(byWeek.entries()).map(([week, days]) => (
        <div key={week} className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Week {week}</div>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <span
                key={d.id}
                title={d.title}
                className={`text-xs px-2 py-1 rounded border ${EFFORT_STYLES[d.effort_type] ?? "bg-muted"}`}
              >
                {DAY_LABELS[d.day_of_week - 1]} · {d.title}
              </span>
            ))}
          </div>
        </div>
      ))}
      {(!sessions || sessions.length === 0) && (
        <p className="text-xs text-muted-foreground">No sessions defined for this template yet.</p>
      )}
    </div>
  );
}

function AssignPlanDialog({
  template,
  onClose,
  onSuccess,
}: {
  template: PlanTemplate;
  onClose: () => void;
  onSuccess?: (scope: { athleteIds: string[]; rangeStart: string; rangeEnd: string }) => void;
}) {
  const qc = useQueryClient();

  const [stepUi, setStepUi] = useState<"setup" | "review">("setup");
  // Bulk by default — a coach applying a template to a training group
  // shouldn't have to repeat this dialog once per athlete. Goal linking
  // only makes sense for a single athlete (a goal is one athlete's own
  // race target), so that field only shows when exactly one is checked.
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [goalId, setGoalId] = useState<string>("none");
  const [rules, setRules] = useState<ProgressionRules>(emptyProgressionRules());
  // Week-specific overrides — for peaking/tapering just part of a
  // multi-week template at assign time, without editing the shared
  // template itself (which might be reused for other athletes who don't
  // need the same taper). Week numbers here are the template's own real
  // week_number, so no relative-week computation is needed the way Copy's
  // date-range-based overrides need.
  const [weekOverrides, setWeekOverrides] = useState<WeekOverride[]>([]);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [overrideFromWeek, setOverrideFromWeek] = useState(1);
  const [overrideToWeek, setOverrideToWeek] = useState(1);
  const [overridePct, setOverridePct] = useState(-20);

  // "What do you want this block to do?" — checkbox-driven axes, each
  // independent and composable (see calendar-copy.ts's checkbox-driven
  // progression builder section for the underlying week-by-week math).
  // Unlike the static per-bucket grid above (which is one flat value
  // applied to every week), these generate a genuine week-over-week trend.
  // When volume progression is off, week-specific overrides above still
  // work exactly as before — this is additive, not a replacement.
  const [enableVolumeProgression, setEnableVolumeProgression] = useState(false);
  const [volumeStartPct, setVolumeStartPct] = useState(0);
  const [volumeIncrementPct, setVolumeIncrementPct] = useState(5);
  // Distance-based alternative to typing raw percentages directly — a
  // coach thinking "build from 40km to 55km a week" shouldn't have to
  // convert that to a %/week themselves. Both modes ultimately drive the
  // exact same volumeStartPct/volumeIncrementPct → generateVolumeProgressionOverrides
  // pipeline; this is a UI-level conversion, not a second engine. Computed
  // live from whichever mode is active (see effectiveVolumeStartPct/
  // effectiveVolumeIncrementPct below) rather than stored as a second copy
  // of the percentages, so the two representations can never drift out of
  // sync with each other.
  const [volumeInputMode, setVolumeInputMode] = useState<"pct" | "distance">("pct");
  const [volumeStartKm, setVolumeStartKm] = useState<string>("");
  const [volumeEndKm, setVolumeEndKm] = useState<string>("");

  const [enableRepProgression, setEnableRepProgression] = useState(false);
  const [repProgressionBucket, setRepProgressionBucket] = useState<CopyBucket>(REP_BUCKETS[0]);
  const [repStepSize, setRepStepSize] = useState(1);
  const [repHoldWeeks, setRepHoldWeeks] = useState(2);

  const [enableRecoveryProgression, setEnableRecoveryProgression] = useState(false);
  const [recoveryDirection, setRecoveryDirection] = useState<"shorten" | "lengthen">("shorten");
  const [recoveryRatePct, setRecoveryRatePct] = useState(5);

  const [enableDeload, setEnableDeload] = useState(false);
  const [deloadEveryNWeeks, setDeloadEveryNWeeks] = useState(4);
  const [deloadCutbackPct, setDeloadCutbackPct] = useState(-20);

  const [previewing, setPreviewing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [drafts, setDrafts] = useState<PlanAssignDraft[]>([]);
  const [editingDraft, setEditingDraft] = useState<PlanAssignDraft | null>(null);

  // Volume Target — same aggregate weekly-total distribution as Copy's
  // own Volume Target section (see src/lib/volume-target.ts), computed
  // from this template's own sessions rather than a source date range.
  const [volumeTargetKm, setVolumeTargetKm] = useState<string>("");
  const [distributionStrategy, setDistributionStrategy] = useState<DistributionStrategy>("proportional");
  const [longRunCapMode, setLongRunCapMode] = useState<"none" | "km" | "time">("none");
  const [longRunCapKmInput, setLongRunCapKmInput] = useState<string>("");
  const [longRunCapTimeInput, setLongRunCapTimeInput] = useState<string>("");
  const [suggestedKmDelta, setSuggestedKmDelta] = useState<Partial<Record<CopyBucket, number>>>({});
  const [suggestedRepDelta, setSuggestedRepDelta] = useState<Partial<Record<CopyBucket, number>>>({});
  const [volumeTargetCapped, setVolumeTargetCapped] = useState(false);
  const [volumeTargetComputed, setVolumeTargetComputed] = useState(false);
  const [pendingRepDeltas, setPendingRepDeltas] = useState<Partial<Record<CopyBucket, number>>>({});

  const { data: templateSessionsForVolume } = useQuery({
    queryKey: ["template-sessions-for-volume-target", template.id],
    queryFn: async () => {
      const { data } = await supabase.from("plan_template_sessions").select("effort_type, steps").eq("plan_template_id", template.id);
      return (data ?? []) as any[];
    },
  });

  const currentKmByBucket: Partial<Record<CopyBucket, number>> = {};
  const kmPerRepByBucket: Partial<Record<CopyBucket, number>> = {};
  for (const b of COPY_BUCKETS) {
    const sessionsInBucket = (templateSessionsForVolume ?? []).filter((s: any) => bucketForEffortType(s.effort_type) === b);
    const totalM = sessionsInBucket.reduce(
      (sum: number, s: any) => sum + estimateTemplateSessionDistanceM(s.effort_type, s.steps ?? []),
      0,
    );
    currentKmByBucket[b] = totalM / 1000;
    if (REP_BUCKETS.includes(b)) {
      let totalReps = 0;
      for (const s of sessionsInBucket) {
        for (const st of s.steps ?? []) {
          if (st.kind === "work" || st.kind === "strides") totalReps += Number(st.reps ?? 1);
        }
      }
      if (totalReps > 0) kmPerRepByBucket[b] = totalM / 1000 / totalReps;
    }
  }

  // Template's own current average weekly volume — the baseline both the
  // existing Volume Target tool and the new distance-mode volume climb
  // convert against. 0 (rather than throwing) when a template has no
  // measurable distance yet, so distance mode can be cleanly disabled
  // below instead of dividing by zero.
  const baseWeeklyKm = Object.values(currentKmByBucket).reduce((a: number, b) => a + (b ?? 0), 0);

  // Converts whichever volume-climb input mode is active into the
  // startPct/incrementPct pair the underlying engine actually consumes —
  // computed here, not stored as separate state, so switching modes can
  // never leave the two representations out of sync with each other.
  // Distance mode spreads the gap from start to end evenly across every
  // week except the first (week 1 is the start value itself), matching
  // how "start %, +%/week" already behaves.
  const weeksForClimb = Math.max(1, template.duration_weeks - 1);
  const startKmNum = Number(volumeStartKm);
  const endKmNum = Number(volumeEndKm);
  const distanceModeReady = volumeInputMode === "distance" && baseWeeklyKm > 0 && volumeStartKm !== "" && volumeEndKm !== "";
  const effectiveVolumeStartPct =
    volumeInputMode === "distance"
      ? distanceModeReady
        ? ((startKmNum - baseWeeklyKm) / baseWeeklyKm) * 100
        : 0
      : volumeStartPct;
  const effectiveVolumeIncrementPct =
    volumeInputMode === "distance"
      ? distanceModeReady
        ? (((endKmNum - baseWeeklyKm) / baseWeeklyKm) * 100 - effectiveVolumeStartPct) / weeksForClimb
        : 0
      : volumeIncrementPct;

  const { data: roster } = useQuery({
    queryKey: ["roster-for-plan-assign"],
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athlete_id, athletes(id, name, profile_image_url)");
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  const singleAthleteId = athleteIds.length === 1 ? athleteIds[0] : undefined;

  const { data: athleteGoals } = useQuery({
    queryKey: ["athlete-goals-for-assign", singleAthleteId],
    enabled: !!singleAthleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_goals")
        .select("id, title, goal_type, race_date")
        .eq("athlete_id", singleAthleteId!)
        .eq("status", "active");
      return data ?? [];
    },
  });

  function toggleAthlete(id: string) {
    setAthleteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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

  function stepRule(bucket: CopyBucket, field: "volumePct" | "intensityPct", delta: number) {
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
      // "H:MM" duration, not a pace string — parsed directly rather than
      // via clockToSec (which is mm:ss for pace elsewhere in this app).
      const [hStr, mStr] = longRunCapTimeInput.split(":");
      const totalSeconds = (Number(hStr) || 0) * 3600 + (Number(mStr) || 0) * 60;
      capKm = totalSeconds / 330; // long bucket's own assumed pace (5:30/km), same approximation used elsewhere
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
    toast.success("Volume target applied — Volume % below updated, rep counts will apply after Preview");
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

  async function preview() {
    if (athleteIds.length === 0) {
      toast.error("Choose at least one athlete");
      return;
    }
    if (!startDate) {
      toast.error("Choose a start date");
      return;
    }
    if (enableVolumeProgression && volumeInputMode === "distance") {
      if (baseWeeklyKm <= 0) {
        toast.error("This template has no measurable distance yet — switch volume climb to \"By %\" instead");
        return;
      }
      if (!distanceModeReady) {
        toast.error("Enter both a start and end weekly distance for the volume climb");
        return;
      }
    }

    setPreviewing(true);
    try {
      // Auto-generated weekly climb (+ optional deload overlay) takes over
      // from the manual week-specific overrides list when either checkbox
      // is on — this is what actually makes "Build +X%" a real week-over-
      // week trend instead of the same flat bump on every week. With both
      // checkboxes off, behavior is unchanged from before: the manual
      // weekOverrides list (if any) still applies exactly as it always has.
      const deloadConfig = enableDeload ? { everyNWeeks: deloadEveryNWeeks, cutbackPct: deloadCutbackPct } : null;
      const effectiveWeekOverrides =
        enableVolumeProgression || enableDeload
          ? generateVolumeProgressionOverrides(
              enableVolumeProgression ? effectiveVolumeStartPct : 0,
              enableVolumeProgression ? effectiveVolumeIncrementPct : 0,
              template.duration_weeks,
              deloadConfig,
            )
          : weekOverrides;

      const result = await previewPlanAssignment({
        data: { planTemplateId: template.id, startDate, progressionRules: rules, weekOverrides: effectiveWeekOverrides },
      });
      let finalDrafts = result.drafts;
      for (const bucket of Object.keys(pendingRepDeltas) as CopyBucket[]) {
        const delta = pendingRepDeltas[bucket];
        if (delta) finalDrafts = applyRepDelta(finalDrafts, bucket, delta) as PlanAssignDraft[];
      }
      if (enableRepProgression) {
        finalDrafts = applyRepProgression(finalDrafts, repProgressionBucket, repStepSize, repHoldWeeks, deloadConfig) as PlanAssignDraft[];
      }
      if (enableRecoveryProgression) {
        finalDrafts = applyRecoveryProgression(finalDrafts, recoveryRatePct, recoveryDirection) as PlanAssignDraft[];
      }
      setDrafts(finalDrafts);
      setStepUi("review");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to build preview");
    } finally {
      setPreviewing(false);
    }
  }

  function removeDraft(tempId: string) {
    setDrafts((d) => d.filter((x) => x.tempId !== tempId));
  }

  function applyEdit(tempId: string, stepIndex: number, patch: any) {
    setDrafts((all) =>
      all.map((d) => {
        if (d.tempId !== tempId) return d;
        const steps = d.steps.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s));
        return { ...d, steps };
      }),
    );
  }

  const presentBuckets = new Set(drafts.map((d) => d.bucket).filter(Boolean) as CopyBucket[]);
  const flaggedCount = drafts.filter((d) => d.needsReview).length;

  async function assign() {
    if (drafts.length === 0) {
      toast.error("Nothing left to assign — every session was removed from this batch");
      return;
    }

    setAssigning(true);
    let totalSessions = 0;
    const failedNames: string[] = [];

    // Sequential, not parallel — same reasoning as assignPlanToAthlete's
    // own per-day loop: each athlete's assignment is independent, so a
    // failure partway through a bulk assign should still leave everyone
    // before it correctly assigned rather than an all-or-nothing rollback.
    for (const athleteId of athleteIds) {
      try {
        const result = await assignPlanToAthlete({
          data: {
            athleteId,
            planTemplateId: template.id,
            startDate,
            goalId: singleAthleteId && goalId !== "none" ? goalId : null,
            drafts,
          },
        });
        totalSessions += result.sessionsCreated;
      } catch (err: any) {
        const name = (roster ?? []).find((a: any) => a.id === athleteId)?.name ?? athleteId;
        failedNames.push(name);
      }
    }

    setAssigning(false);
    qc.invalidateQueries({ queryKey: ["athlete-plans"] });
    qc.invalidateQueries({ queryKey: ["calendar-sessions"] });

    if (failedNames.length === 0) {
      toast.success(
        `Plan assigned to ${athleteIds.length} athlete${athleteIds.length > 1 ? "s" : ""} — ${totalSessions} sessions created`,
      );
      onSuccess?.({
        athleteIds,
        rangeStart: startDate,
        rangeEnd: addDaysISO(startDate, template.duration_weeks * 7 - 1),
      });
      onClose();
    } else {
      toast.error(
        `Assigned to ${athleteIds.length - failedNames.length}/${athleteIds.length} athletes. Failed: ${failedNames.join(", ")}`,
      );
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign "{template.name}"</DialogTitle>
          <DialogDescription>
            {stepUi === "setup"
              ? "Generates real sessions on each selected athlete's calendar starting the week you pick."
              : "Review every session before it's created — edit or remove any of them individually."}
          </DialogDescription>
        </DialogHeader>

        {stepUi === "setup" ? (
          <div className="space-y-3">
            {template.is_system && <SystemTemplateNotice compact />}

            <div>
              <Label className="text-xs">
                Athletes {athleteIds.length > 0 && `(${athleteIds.length} selected)`}
              </Label>
              <div className="mt-1 max-h-56 overflow-y-auto rounded border divide-y">
                {(roster ?? []).map((a: any) => {
                  const checked = athleteIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-accent/40"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggleAthlete(a.id)}
                      />
                      <UserAvatar name={a.name} imageUrl={a.profile_image_url} size="sm" />
                      <span>{a.name}</span>
                    </label>
                  );
                })}
                {(!roster || roster.length === 0) && (
                  <p className="text-xs text-muted-foreground p-2">No athletes on your roster yet.</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs">Start date (Monday of week 1)</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            {singleAthleteId ? (
              <div>
                <Label className="text-xs">Link to a goal (optional)</Label>
                <Select value={goalId} onValueChange={setGoalId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No goal</SelectItem>
                    {(athleteGoals ?? []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title}
                        {g.race_date ? ` (${g.race_date})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(athleteGoals ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No active goals yet for this athlete.</p>
                )}
              </div>
            ) : (
              athleteIds.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Goal linking is only available when assigning to a single athlete.
                </p>
              )
            )}

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
                    placeholder={
                      Object.values(currentKmByBucket).some((v) => (v ?? 0) > 0)
                        ? `current: ${Object.values(currentKmByBucket).reduce((a: number, b) => a + (b ?? 0), 0).toFixed(1)}`
                        : "e.g. 100"
                    }
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
                            onChange={(e) => setSuggestedRepDelta((prev) => ({ ...prev, [b]: Number(e.target.value) }))}
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

            <div className="rounded-lg border p-3 space-y-3 bg-accent/20">
              <div>
                <Label className="text-xs font-semibold">What do you want this block to do?</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Pick any combination — each generates a real week-over-week trend across the assignment, not a flat
                  bump repeated on every week. Leave everything unchecked to use the static Volume %/Intensity %
                  grid below exactly as before.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={enableVolumeProgression} onChange={(e) => setEnableVolumeProgression(e.target.checked)} />
                  Increase volume over time
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={enableRepProgression} onChange={(e) => setEnableRepProgression(e.target.checked)} />
                  Increase rep count over time
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={enableRecoveryProgression} onChange={(e) => setEnableRecoveryProgression(e.target.checked)} />
                  Progress recovery duration
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={enableDeload} onChange={(e) => setEnableDeload(e.target.checked)} />
                  Include a recurring deload week
                </label>
              </div>

              {enableVolumeProgression && (
                <div className="pl-6 space-y-2 border-l-2 border-primary/30">
                  <p className="text-xs font-medium">Volume climb</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant={volumeInputMode === "pct" ? "default" : "outline"} onClick={() => setVolumeInputMode("pct")}>
                      By %
                    </Button>
                    <Button
                      size="sm"
                      variant={volumeInputMode === "distance" ? "default" : "outline"}
                      onClick={() => setVolumeInputMode("distance")}
                      disabled={baseWeeklyKm <= 0}
                      title={baseWeeklyKm <= 0 ? "This template has no measurable distance yet" : undefined}
                    >
                      By distance
                    </Button>
                  </div>

                  {volumeInputMode === "pct" ? (
                    <>
                      <div className="flex items-center gap-3">
                        <div>
                          <Label className="text-[11px] text-muted-foreground">Start %</Label>
                          <Input
                            type="number"
                            className="w-20 h-8"
                            value={volumeStartPct}
                            onChange={(e) => setVolumeStartPct(Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <Label className="text-[11px] text-muted-foreground">+%/week</Label>
                          <Input
                            type="number"
                            className="w-20 h-8"
                            value={volumeIncrementPct}
                            onChange={(e) => setVolumeIncrementPct(Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Week 1 at {volumeStartPct >= 0 ? "+" : ""}
                        {volumeStartPct}%, climbing by {volumeIncrementPct}% each week
                        {baseWeeklyKm > 0 && (
                          <>
                            {" "}
                            — roughly {((baseWeeklyKm * (1 + volumeStartPct / 100))).toFixed(1)}km in week 1, rising
                            to ~
                            {(baseWeeklyKm * (1 + (volumeStartPct + volumeIncrementPct * weeksForClimb) / 100)).toFixed(1)}km
                            by the last week
                          </>
                        )}
                        .
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div>
                          <Label className="text-[11px] text-muted-foreground">Start (km/week)</Label>
                          <Input
                            type="number"
                            className="w-24 h-8"
                            placeholder={baseWeeklyKm > 0 ? baseWeeklyKm.toFixed(1) : undefined}
                            value={volumeStartKm}
                            onChange={(e) => setVolumeStartKm(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[11px] text-muted-foreground">End (km/week)</Label>
                          <Input
                            type="number"
                            className="w-24 h-8"
                            value={volumeEndKm}
                            onChange={(e) => setVolumeEndKm(e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        This template's own base week averages ~{baseWeeklyKm.toFixed(1)}km. Spreads evenly from the
                        start figure to the end figure across all {template.duration_weeks} weeks
                        {distanceModeReady && (
                          <>
                            {" "}
                            — that works out to {effectiveVolumeStartPct >= 0 ? "+" : ""}
                            {effectiveVolumeStartPct.toFixed(1)}% in week 1, then{" "}
                            {effectiveVolumeIncrementPct >= 0 ? "+" : ""}
                            {effectiveVolumeIncrementPct.toFixed(1)}% more each week after that
                          </>
                        )}
                        .
                      </p>
                    </>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Applies uniformly across every bucket (the static grid below still sets each bucket's own
                    starting point, this sets the shared rate of climb). Replaces the manual week-specific overrides
                    below while this is checked.
                  </p>
                </div>
              )}

              {enableRepProgression && (
                <div className="pl-6 space-y-2 border-l-2 border-primary/30">
                  <p className="text-xs font-medium">Rep count step-up</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Bucket</Label>
                      <Select value={repProgressionBucket} onValueChange={(v) => setRepProgressionBucket(v as CopyBucket)}>
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REP_BUCKETS.map((b) => (
                            <SelectItem key={b} value={b}>
                              {COPY_BUCKET_LABELS[b]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">+reps per jump</Label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={repStepSize}
                        onChange={(e) => setRepStepSize(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Hold (weeks)</Label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={repHoldWeeks}
                        onChange={(e) => setRepHoldWeeks(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Holds each rep count for {repHoldWeeks} week{repHoldWeeks === 1 ? "" : "s"}, then jumps by{" "}
                    {repStepSize} rep{repStepSize === 1 ? "" : "s"} — starting from whatever this template's{" "}
                    {COPY_BUCKET_LABELS[repProgressionBucket]} sessions already prescribe. A deload week (if enabled)
                    holds at the current step rather than jumping that week.
                  </p>
                </div>
              )}

              {enableRecoveryProgression && (
                <div className="pl-6 space-y-2 border-l-2 border-primary/30">
                  <p className="text-xs font-medium">Recovery progression</p>
                  <div className="flex items-center gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Direction</Label>
                      <Select value={recoveryDirection} onValueChange={(v) => setRecoveryDirection(v as "shorten" | "lengthen")}>
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="shorten">Shorten over time</SelectItem>
                          <SelectItem value="lengthen">Lengthen over time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">%/week</Label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={recoveryRatePct}
                        onChange={(e) => setRecoveryRatePct(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Applies to recovery between reps and between sets, {recoveryRatePct}% per week, cumulative from
                    week 1. Standalone recovery/cooldown sessions are left untouched.
                  </p>
                </div>
              )}

              {enableDeload && (
                <div className="pl-6 space-y-2 border-l-2 border-primary/30">
                  <p className="text-xs font-medium">Recurring deload</p>
                  <div className="flex items-center gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Every N weeks</Label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={deloadEveryNWeeks}
                        onChange={(e) => setDeloadEveryNWeeks(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Cutback %</Label>
                      <Input
                        type="number"
                        className="w-20 h-8"
                        value={deloadCutbackPct}
                        onChange={(e) => setDeloadCutbackPct(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Every {deloadEveryNWeeks}
                    {deloadEveryNWeeks === 1 ? "st" : deloadEveryNWeeks === 2 ? "nd" : deloadEveryNWeeks === 3 ? "rd" : "th"} week,
                    volume drops to {deloadCutbackPct}% regardless of the climb above, and rep progression holds
                    rather than stepping up that week. Recovery progression (if enabled) isn't affected by deload
                    weeks.
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">
                Quick nudge — %/bucket (optional; adapts this template to this athlete/group, leave at 0 to assign
                it exactly as built)
              </Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {VOLUME_PATTERN_PRESETS.map((p) => (
                  <Button key={p.label} size="sm" variant="outline" onClick={() => applyPatternToAllBuckets(p.pct)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2.5 mb-1 px-0.5">
                <span />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Volume %</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Intensity %</span>
              </div>
              <div className="space-y-2">
                {COPY_BUCKETS.map((b) => (
                  <div key={b} className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-xs text-muted-foreground">{COPY_BUCKET_LABELS[b]}</span>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" className="px-2 shrink-0" onClick={() => stepRule(b, "volumePct", -VOLUME_STEP)}>
                        −
                      </Button>
                      <Input
                        type="number"
                        aria-label={`${COPY_BUCKET_LABELS[b]} volume percent`}
                        value={rules[b]?.volumePct ?? 0}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, [b]: { ...(r[b] ?? { volumePct: 0, intensityPct: 0 }), volumePct: Number(e.target.value) } }))
                        }
                      />
                      <Button size="sm" variant="outline" className="px-2 shrink-0" onClick={() => stepRule(b, "volumePct", VOLUME_STEP)}>
                        +
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" className="px-2 shrink-0" onClick={() => stepRule(b, "intensityPct", -INTENSITY_STEP)}>
                        −
                      </Button>
                      <Input
                        type="number"
                        aria-label={`${COPY_BUCKET_LABELS[b]} intensity percent`}
                        value={rules[b]?.intensityPct ?? 0}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, [b]: { ...(r[b] ?? { volumePct: 0, intensityPct: 0 }), intensityPct: Number(e.target.value) } }))
                        }
                      />
                      <Button size="sm" variant="outline" className="px-2 shrink-0" onClick={() => stepRule(b, "intensityPct", INTENSITY_STEP)}>
                        +
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Applied to every week of the template by default — use the week-specific overrides below to peak or
                taper just part of it for this assignment, without changing the shared template.
              </p>

              <div className="mt-3 pt-3 border-t">
                <Label className="text-xs">Week-specific overrides (optional)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  E.g. taper weeks 11–12 of a 12-week template at −30% for this athlete, regardless of the volume
                  set above. Week numbers are the template's own week numbers.
                  {enableVolumeProgression && (
                    <span className="text-amber-600">
                      {" "}
                      Not used while "Increase volume over time" above is checked — the generated weekly climb takes
                      over instead. Uncheck it to use these manual overrides again.
                    </span>
                  )}
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
                          max={template.duration_weeks}
                          value={overrideFromWeek}
                          onChange={(e) => setOverrideFromWeek(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">To week</Label>
                        <Input
                          type="number"
                          min={1}
                          max={template.duration_weeks}
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
                  Nudge this whole batch on top of the progression already set.
                </p>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Total volume</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[-10, -5, 5, 10, 15, 20].map((km) => (
                      <Button
                        key={km}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDrafts((d) => applyVolumeNudgeKm(d, km) as PlanAssignDraft[]);
                          toast.success(`${km > 0 ? "+" : ""}${km}km applied across the batch`);
                        }}
                      >
                        {km > 0 ? `+${km}` : km}km
                      </Button>
                    ))}
                  </div>
                </div>

                {presentBuckets.has("easy") && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Easy pace</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[-10, -5, 5, 10].map((d) => (
                        <Button
                          key={d}
                          size="sm"
                          variant="outline"
                          onClick={() => setDrafts((all) => applyPaceNudgeSecPerKm(all, "easy", d) as PlanAssignDraft[])}
                        >
                          {d < 0 ? `Faster ${Math.abs(d)}s` : `Slower ${d}s`}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {presentBuckets.has("threshold") && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Threshold reps</div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDrafts((all) => applyRepDelta(all, "threshold", -1) as PlanAssignDraft[])}>
                        −1 rep
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDrafts((all) => applyRepDelta(all, "threshold", 1) as PlanAssignDraft[])}>
                        +1 rep
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Recovery (between reps &amp; sets)</div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setDrafts((all) => applyRecoveryDelta(all, -15) as PlanAssignDraft[])}>
                      −15s
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDrafts((all) => applyRecoveryDelta(all, 15) as PlanAssignDraft[])}>
                      +15s
                    </Button>
                  </div>
                </div>
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
                    <div className="text-xs mt-0.5">{summarizeDraftSteps(d.steps)}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditingDraft(d)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeDraft(d.tempId)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {drafts.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Every session was removed from this batch — nothing left to assign.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {stepUi === "setup" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={preview} disabled={previewing}>
                {previewing ? "Building preview..." : "Preview & continue"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStepUi("setup")}>
                Back
              </Button>
              <Button onClick={assign} disabled={assigning || drafts.length === 0}>
                {assigning
                  ? "Assigning..."
                  : athleteIds.length > 1
                    ? `Assign ${drafts.length} sessions to ${athleteIds.length} athletes`
                    : `Assign ${drafts.length} sessions`}
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
              draft={editingDraft as any}
              onApply={(stepIndex, patch) => {
                applyEdit(editingDraft.tempId, stepIndex, patch);
                setEditingDraft(null);
              }}
              onClose={() => setEditingDraft(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Plan Builder — create/edit a coach's own plan template. Template metadata
// saves immediately (so the week/day grid has a plan_template_id to attach
// to); each day in the grid is edited independently via DayEditorDialog,
// which can either link an existing entry from the Templates library
// (session_templates) or build a one-off step recipe by hand.
// ----------------------------------------------------------------------------

function PlanBuilder({
  templateId,
  onBack,
  onAssignSuccess,
}: {
  templateId: string | null;
  onBack: () => void;
  onAssignSuccess?: (scope: { athleteIds: string[]; rangeStart: string; rangeEnd: string }) => void;
}) {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(templateId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [distanceFocus, setDistanceFocus] = useState<string>("generic");
  const [level, setLevel] = useState<string>("intermediate");
  const [saving, setSaving] = useState(false);
  const [dayEditor, setDayEditor] = useState<{ week: number; day: number } | null>(null);
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [assignAfterBuild, setAssignAfterBuild] = useState(false);

  const { data: existingTemplate } = useQuery({
    queryKey: ["plan-template-edit", templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await supabase.from("plan_templates").select("*").eq("id", templateId!).single();
      if (error) throw error;
      return data as PlanTemplate;
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["plan-template-sessions-edit", savedId],
    enabled: !!savedId,
    queryFn: async () => {
      const { data } = await supabase
        .from("plan_template_sessions")
        .select("*")
        .eq("plan_template_id", savedId!)
        .order("week_number")
        .order("day_of_week");
      return (data ?? []) as any[];
    },
  });

  // Populates the form once, the first time an existing template loads —
  // useState-as-ref rather than useEffect since this only ever needs to
  // fire a single time per mount of this component.
  const loadedRef = useState({ done: false })[0];
  if (existingTemplate && !loadedRef.done) {
    loadedRef.done = true;
    setName(existingTemplate.name);
    setDescription(existingTemplate.description ?? "");
    setDaysPerWeek(existingTemplate.days_per_week);
    setDurationWeeks(existingTemplate.duration_weeks);
    setDistanceFocus(existingTemplate.distance_focus ?? "generic");
    setLevel(existingTemplate.level ?? "intermediate");
    setSavedId(existingTemplate.id);
  }

  async function saveMeta() {
    if (!name.trim()) {
      toast.error("Give the template a name");
      return;
    }

    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      days_per_week: daysPerWeek,
      duration_weeks: durationWeeks,
      distance_focus: distanceFocus === "generic" ? null : distanceFocus,
      level,
      updated_at: new Date().toISOString(),
    };

    if (savedId) {
      const { error } = await supabase.from("plan_templates").update(payload as any).eq("id", savedId);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Template updated");
    } else {
      const { data, error } = await supabase
        .from("plan_templates")
        .insert({ ...payload, is_system: false, created_by: user?.id } as any)
        .select()
        .single();
      setSaving(false);
      if (error || !data) {
        toast.error(error?.message ?? "Failed to create template");
        return;
      }
      setSavedId((data as any).id);
      toast.success("Template created — now build out the weeks below");
    }

    qc.invalidateQueries({ queryKey: ["plan-templates"] });
  }

  async function deleteTemplate() {
    if (!savedId) return;
    if (!window.confirm("Delete this template? This won't affect any plans already assigned from it.")) return;

    const { error } = await supabase.from("plan_templates").delete().eq("id", savedId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Template deleted");
    qc.invalidateQueries({ queryKey: ["plan-templates"] });
    onBack();
  }

  const sessionByDay = new Map<string, any>();
  for (const s of sessions ?? []) {
    sessionByDay.set(`${s.week_number}-${s.day_of_week}`, s);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back to templates
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 12-Week Half Marathon" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Days per week</Label>
              <Select value={String(daysPerWeek)} onValueChange={(v) => setDaysPerWeek(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6, 7].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Duration (weeks)</Label>
              <Input type="number" min={1} value={durationWeeks} onChange={(e) => setDurationWeeks(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance focus</Label>
              <Select value={distanceFocus} onValueChange={setDistanceFocus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">Generic base</SelectItem>
                  <SelectItem value="5k">5K</SelectItem>
                  <SelectItem value="10k">10K</SelectItem>
                  <SelectItem value="half_marathon">Half Marathon</SelectItem>
                  <SelectItem value="marathon">Marathon</SelectItem>
                  <SelectItem value="track_middle_distance">Track (800m–5000m)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={saveMeta} disabled={saving}>
              {saving ? "Saving..." : savedId ? "Save changes" : "Create & continue"}
            </Button>
            {savedId && (
              <Button variant="ghost" className="text-destructive" onClick={deleteTemplate}>
                Delete template
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {savedId && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Weeks</CardTitle>
              <CardDescription>Click a day to add or edit its session. Leave a day empty for rest.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {durationWeeks > 1 && (
                <Button size="sm" variant="outline" onClick={() => setProgressionOpen(true)}>
                  Apply progression pattern
                </Button>
              )}
              {(sessions ?? []).length > 0 && (
                <Button size="sm" onClick={() => setAssignAfterBuild(true)}>
                  Assign to athletes
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: durationWeeks }, (_, i) => i + 1).map((week) => (
              <div key={week}>
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Week {week}</div>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAY_LABELS.map((label, i) => {
                    const day = i + 1;
                    const existing = sessionByDay.get(`${week}-${day}`);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setDayEditor({ week, day })}
                        className={`text-left rounded border px-2 py-1.5 text-xs hover:opacity-80 transition-opacity min-h-14 ${
                          existing ? (EFFORT_STYLES[existing.effort_type] ?? "bg-muted") : "bg-muted/30 border-dashed"
                        }`}
                      >
                        <div className="font-semibold">{label}</div>
                        {existing ? (
                          <div className="truncate">{existing.title}</div>
                        ) : (
                          <div className="text-muted-foreground">+ add</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {dayEditor && savedId && (
        <DayEditorDialog
          planTemplateId={savedId}
          week={dayEditor.week}
          day={dayEditor.day}
          durationWeeks={durationWeeks}
          allSessions={sessions ?? []}
          existing={sessionByDay.get(`${dayEditor.week}-${dayEditor.day}`) ?? null}
          onClose={() => setDayEditor(null)}
          onSaved={() => {
            setDayEditor(null);
            qc.invalidateQueries({ queryKey: ["plan-template-sessions-edit", savedId] });
            qc.invalidateQueries({ queryKey: ["all-plan-template-sessions"] });
          }}
        />
      )}

      {progressionOpen && savedId && (
        <ApplyProgressionDialog
          planTemplateId={savedId}
          durationWeeks={durationWeeks}
          allSessions={sessions ?? []}
          onClose={() => setProgressionOpen(false)}
          onApplied={() => {
            setProgressionOpen(false);
            qc.invalidateQueries({ queryKey: ["plan-template-sessions-edit", savedId] });
            qc.invalidateQueries({ queryKey: ["all-plan-template-sessions"] });
          }}
        />
      )}

      {assignAfterBuild && savedId && (
        <AssignPlanDialog
          template={{
            id: savedId,
            name,
            description: description.trim() || null,
            days_per_week: daysPerWeek,
            duration_weeks: durationWeeks,
            distance_focus: distanceFocus === "generic" ? null : distanceFocus,
            level,
            is_system: false,
            created_by: user?.id ?? null,
          }}
          onClose={() => setAssignAfterBuild(false)}
          onSuccess={(scope) => {
            setAssignAfterBuild(false);
            onAssignSuccess?.(scope);
          }}
        />
      )}
    </div>
  );
}

/**
 * Generates a range of target weeks from one already-built base week,
 * scaling volume by a named pattern (see plan-progression.ts). Existing
 * sessions on the target days within the target range are overwritten —
 * same convention as DayEditorDialog's "Apply to other days" (independent
 * generated copies, not linked; editing one afterward never affects the
 * others) — since this is fundamentally that same action one level up
 * (a whole week, with scaling, instead of one day, flat).
 */
function ApplyProgressionDialog({
  planTemplateId,
  durationWeeks,
  allSessions,
  onClose,
  onApplied,
}: {
  planTemplateId: string;
  durationWeeks: number;
  allSessions: any[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const weeksWithSessions = Array.from(new Set(allSessions.map((s) => s.week_number as number))).sort((a, b) => a - b);
  const defaultBase = weeksWithSessions[0] ?? 1;

  const [baseWeek, setBaseWeek] = useState(defaultBase);
  const [targetFrom, setTargetFrom] = useState(Math.min(defaultBase + 1, durationWeeks));
  const [targetTo, setTargetTo] = useState(durationWeeks);
  const [patternId, setPatternId] = useState<ProgressionPatternId>("build_5");
  const [applying, setApplying] = useState(false);

  const baseWeekSessions = allSessions.filter((s) => s.week_number === baseWeek);
  const baseWeekEstKm =
    baseWeekSessions.reduce((sum, s) => sum + estimateTemplateSessionDistanceM(s.effort_type, s.steps ?? []), 0) / 1000;

  // Target range, defensively excluding the base week itself in case the
  // range typed in overlaps it.
  const targetWeeks =
    targetFrom && targetTo && targetTo >= targetFrom
      ? Array.from({ length: targetTo - targetFrom + 1 }, (_, i) => targetFrom + i).filter((w) => w !== baseWeek)
      : [];

  const percents = computeProgressionPercents(patternId, targetWeeks.length);
  const activePattern = PROGRESSION_PATTERNS.find((p) => p.id === patternId)!;

  async function apply() {
    if (baseWeekSessions.length === 0) {
      toast.error("Base week has no sessions to build a pattern from");
      return;
    }
    if (targetWeeks.length === 0) {
      toast.error("Choose a target week range after the base week");
      return;
    }

    setApplying(true);
    try {
      const baseDays = baseWeekSessions.map((s) => s.day_of_week);

      // Clear whatever's already on the target days within the target
      // weeks first, so regenerating never leaves duplicate/orphaned rows
      // behind — same "will be overwritten" contract shown in the preview.
      const { error: delErr } = await supabase
        .from("plan_template_sessions")
        .delete()
        .eq("plan_template_id", planTemplateId)
        .in("week_number", targetWeeks)
        .in("day_of_week", baseDays);
      if (delErr) throw delErr;

      const baseForBuild = baseWeekSessions.map((s) => ({
        day_of_week: s.day_of_week,
        title: s.title,
        effort_type: s.effort_type,
        steps: s.steps ?? [],
        notes: s.notes ?? null,
      }));

      const rows = targetWeeks.flatMap((w, i) =>
        buildProgressedWeekSessions(baseForBuild, w, percents[i]).map((r) => ({
          ...r,
          plan_template_id: planTemplateId,
        })),
      );

      const { error: insErr } = await supabase.from("plan_template_sessions").insert(rows as any);
      if (insErr) throw insErr;

      toast.success(
        `${rows.length} session${rows.length === 1 ? "" : "s"} generated across ${targetWeeks.length} week${targetWeeks.length === 1 ? "" : "s"}`,
      );
      onApplied();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to apply progression pattern");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply progression pattern</DialogTitle>
          <DialogDescription>
            Generate a range of weeks from one already-built week, scaling volume by a pattern — fills out the rest
            of the template in one step instead of building every week by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Base week</Label>
              <Input
                type="number"
                min={1}
                max={durationWeeks}
                value={baseWeek}
                onChange={(e) => setBaseWeek(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {baseWeekSessions.length > 0
                  ? `${baseWeekSessions.length} session${baseWeekSessions.length === 1 ? "" : "s"}, ~${baseWeekEstKm.toFixed(1)}km`
                  : "No sessions in this week yet"}
              </p>
            </div>
            <div>
              <Label className="text-xs">Generate from week</Label>
              <Input
                type="number"
                min={1}
                max={durationWeeks}
                value={targetFrom}
                onChange={(e) => setTargetFrom(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Through week</Label>
              <Input
                type="number"
                min={1}
                max={durationWeeks}
                value={targetTo}
                onChange={(e) => setTargetTo(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Pattern</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {PROGRESSION_PATTERNS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={patternId === p.id ? "default" : "outline"}
                  onClick={() => setPatternId(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{activePattern.description}</p>
          </div>

          {targetWeeks.length > 0 && baseWeekSessions.length > 0 && (
            <div>
              <Label className="text-xs">Preview</Label>
              <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto">
                {targetWeeks.map((w, i) => {
                  const pct = percents[i];
                  const estKm = baseWeekEstKm * (1 + pct / 100);
                  const existingCount = allSessions.filter((s) => s.week_number === w).length;
                  return (
                    <div key={w} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                      <span className="font-medium">Week {w}</span>
                      <span className="text-muted-foreground">
                        {pct > 0 ? "+" : ""}
                        {pct}% · ~{estKm.toFixed(1)}km
                      </span>
                      {existingCount > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200">
                          {existingCount} existing — will be overwritten
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={applying || baseWeekSessions.length === 0 || targetWeeks.length === 0}>
            {applying ? "Generating..." : `Generate ${targetWeeks.length} week${targetWeeks.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// `steps`/`template_steps`, set via the same target-mode selector pattern
// used in the session builder and the WorkTargetEditor. `value`/`reps` keep
// their existing meaning (meters or minutes, converted on save) — only the
// target payload is new.
type ManualStep = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  target_kind: "distance" | "time";
  value: number; // meters for distance, minutes for time (converted on save)
  reps: number;
  target_mode?: WorkoutTargetMode;
  target_pace_sec_per_km?: number | null;
  target_threshold_pace_pct?: number | null;
  target_threshold_hr_pct?: number | null;
  target_zone?: string | null;
  target_rpe?: number | null;
  recovery_between_reps_seconds?: number;
  recovery_between_reps_mode?: string;
};

const ZONE_OPTIONS = ["z1", "z2", "z3", "z4", "z5"];

function DayEditorDialog({
  planTemplateId,
  week,
  day,
  durationWeeks,
  allSessions,
  existing,
  onClose,
  onSaved,
}: {
  planTemplateId: string;
  week: number;
  day: number;
  durationWeeks: number;
  allSessions: any[];
  existing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [effortType, setEffortType] = useState(existing?.effort_type ?? "easy");
  const [mode, setMode] = useState<"library" | "manual">(existing?.session_template_id ? "library" : "manual");
  const [libraryTemplateId, setLibraryTemplateId] = useState<string>(existing?.session_template_id ?? "");
  // Time of day — no schema field exists for this (only the separate squad
  // Training Schedule has AM/PM), so like the Copy dialogs this just
  // appends "(AM)"/"(PM)" onto the title rather than needing a migration.
  const [timeOfDay, setTimeOfDay] = useState<"none" | "am" | "pm">("none");
  // "Apply to other days" — independent copies, not linked: once saved,
  // each copy is its own row and editing one never affects the others.
  const [showApplyToOtherDays, setShowApplyToOtherDays] = useState(false);
  const [otherDayTargets, setOtherDayTargets] = useState<Set<string>>(new Set());
  const [manualSteps, setManualSteps] = useState<ManualStep[]>(() => {
    if (!existing?.steps) return [];
    return (existing.steps as any[]).map((s) => ({
      kind: s.kind,
      target_kind: s.target_kind,
      value: s.target_kind === "time" ? Math.round((s.target_time_seconds ?? 0) / 60) : (s.target_distance_m ?? 0),
      reps: s.reps ?? 1,
      target_mode: (s.target_mode ?? inferWorkoutTargetMode(s)) as WorkoutTargetMode,
      target_pace_sec_per_km: s.target_pace_sec_per_km ?? null,
      target_threshold_pace_pct: s.target_threshold_pace_pct ?? null,
      target_threshold_hr_pct: s.target_threshold_hr_pct ?? null,
      target_zone: s.target_zone ?? null,
      target_rpe: s.target_rpe ?? null,
      recovery_between_reps_seconds: s.recovery_between_reps_seconds ?? undefined,
      recovery_between_reps_mode: s.recovery_between_reps_mode ?? undefined,
    }));
  });
  const [saving, setSaving] = useState(false);

  const { data: libraryTemplates } = useQuery({
    queryKey: ["session-templates-for-plan-builder"],
    enabled: mode === "library",
    queryFn: async () => {
      const { data } = await supabase.from("session_templates").select("*").order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  function addStep() {
    setManualSteps((s) => [...s, { kind: "work", target_kind: "time", value: 20, reps: 1, target_mode: "open" }]);
  }
  function updateStep(i: number, patch: Partial<ManualStep>) {
    setManualSteps((s) => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));
  }

  // Switching target mode clears the other modes' payload fields so a step
  // never saves with more than one target set at once — same
  // payload-exclusivity rule the DB's CHECK constraint enforces, kept
  // consistent here so a save never trips it.
  function setStepTargetMode(i: number, newMode: WorkoutTargetMode) {
    updateStep(i, {
      target_mode: newMode,
      target_pace_sec_per_km: newMode === "pace" ? manualSteps[i].target_pace_sec_per_km : null,
      target_threshold_pace_pct: newMode === "threshold_pace_pct" ? manualSteps[i].target_threshold_pace_pct : null,
      target_threshold_hr_pct: newMode === "threshold_hr_pct" ? manualSteps[i].target_threshold_hr_pct : null,
      target_zone: newMode === "zone" ? manualSteps[i].target_zone : null,
      target_rpe: newMode === "rpe" ? manualSteps[i].target_rpe : null,
    });
  }

  function removeStep(i: number) {
    setManualSteps((s) => s.filter((_, idx) => idx !== i));
  }

  // Quick title presets, keyed off the effort type already picked — "Run"
  // for anything continuous, "Session" for anything reps-based, matching
  // the same taxonomy the Copy dialogs and Deliver Program export use.
  // Just fills the field; still yours to edit or replace afterward.
  const EFFORT_TITLE_LABEL: Record<string, string> = {
    easy: "Easy",
    long: "Long",
    tempo: "Tempo",
    threshold: "Threshold",
    vo2: "VO2",
    strides: "Strides",
    race: "Race",
  };
  const titleWord = EFFORT_TITLE_LABEL[effortType] ?? "Training";

  function stripTimeOfDaySuffix(t: string): string {
    return t.replace(/\s*\((AM|PM)\)\s*$/i, "").trim();
  }

  // Existing sessions on other days, keyed "week-day" — lets "apply to
  // other days" know whether a target already has content (update) or is
  // empty (insert), same add-or-edit semantics as clicking a day directly.
  const allSessionByDay = new Map((allSessions ?? []).map((s: any) => [`${s.week_number}-${s.day_of_week}`, s]));

  function toggleOtherDayTarget(key: string) {
    setOtherDayTargets((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllSameWeekday() {
    setOtherDayTargets((s) => {
      const next = new Set(s);
      for (let w = 1; w <= durationWeeks; w++) {
        if (w === week) continue;
        next.add(`${w}-${day}`);
      }
      return next;
    });
  }

  async function save() {
    if (effortType !== "rest" && effortType !== "cross_train" && !title.trim()) {
      toast.error("Give the session a title");
      return;
    }
    if (mode === "library" && !libraryTemplateId && effortType !== "rest" && effortType !== "cross_train") {
      toast.error("Choose a template from your library, or switch to manual steps");
      return;
    }

    setSaving(true);

    const steps =
      mode === "manual" && manualSteps.length > 0
        ? manualSteps.map((s) => ({
            kind: s.kind,
            reps: s.reps,
            target_kind: s.target_kind,
            target_distance_m: s.target_kind === "distance" ? s.value : null,
            target_time_seconds: s.target_kind === "time" ? s.value * 60 : null,
            target_mode: s.target_mode && s.target_mode !== "open" ? s.target_mode : null,
            target_pace_sec_per_km: s.target_pace_sec_per_km ?? null,
            target_threshold_pace_pct: s.target_threshold_pace_pct ?? null,
            target_threshold_hr_pct: s.target_threshold_hr_pct ?? null,
            target_zone: s.target_zone ?? null,
            target_rpe: s.target_rpe ?? null,
            recovery_between_reps_seconds: s.recovery_between_reps_seconds ?? null,
            recovery_between_reps_target_kind: s.recovery_between_reps_seconds ? "time" : null,
            recovery_between_reps_mode: s.recovery_between_reps_mode ?? null,
            counts_toward_distance: true,
          }))
        : null;

    const baseTitle = title.trim() || (effortType === "rest" ? "Rest" : effortType === "cross_train" ? "Cross-train" : title);
    const strippedTitle = stripTimeOfDaySuffix(baseTitle);
    const finalTitle = timeOfDay === "none" ? strippedTitle : `${strippedTitle} (${timeOfDay.toUpperCase()})`;

    const payload = {
      plan_template_id: planTemplateId,
      week_number: week,
      day_of_week: day,
      title: finalTitle,
      effort_type: effortType,
      steps: mode === "library" ? null : steps,
      session_template_id: mode === "library" && libraryTemplateId ? libraryTemplateId : null,
    };

    const { error } = existing
      ? await supabase.from("plan_template_sessions").update(payload as any).eq("id", existing.id)
      : await supabase.from("plan_template_sessions").insert(payload as any);

    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }

    // Apply to other days — independent copies. Each target gets the same
    // title/effort_type/steps written just now; editing any one of them
    // afterward never touches the others (no link is stored anywhere).
    if (otherDayTargets.size > 0) {
      let applyFailures = 0;
      for (const key of Array.from(otherDayTargets)) {
        const [wStr, dStr] = key.split("-");
        const targetPayload = {
          plan_template_id: planTemplateId,
          week_number: Number(wStr),
          day_of_week: Number(dStr),
          title: finalTitle,
          effort_type: effortType,
          steps: mode === "library" ? null : steps,
          session_template_id: mode === "library" && libraryTemplateId ? libraryTemplateId : null,
        };
        const targetExisting = allSessionByDay.get(key);
        const { error: applyErr } = targetExisting
          ? await supabase.from("plan_template_sessions").update(targetPayload as any).eq("id", targetExisting.id)
          : await supabase.from("plan_template_sessions").insert(targetPayload as any);
        if (applyErr) applyFailures++;
      }
      if (applyFailures > 0) {
        toast.error(`Saved, but ${applyFailures} of ${otherDayTargets.size} other-day copies failed`);
      }
    }

    setSaving(false);

    toast.success("Day saved");
    onSaved();
  }

  async function removeDay() {
    if (!existing) return;
    const { error } = await supabase.from("plan_template_sessions").delete().eq("id", existing.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Day cleared");
    onSaved();
  }

  const needsDetail = effortType !== "rest" && effortType !== "cross_train";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {DAY_LABELS[day - 1]}, Week {week}
          </DialogTitle>
          <DialogDescription>What should this day look like?</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Effort type</Label>
            <Select value={effortType} onValueChange={setEffortType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="long">Long run</SelectItem>
                <SelectItem value="tempo">Tempo</SelectItem>
                <SelectItem value="threshold">Threshold</SelectItem>
                <SelectItem value="vo2">VO2 / speed</SelectItem>
                <SelectItem value="strides">Strides</SelectItem>
                <SelectItem value="race">Race</SelectItem>
                <SelectItem value="cross_train">Cross-train</SelectItem>
                <SelectItem value="rest">Rest</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsDetail && (
            <>
              <div>
                <Label className="text-xs">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Threshold intervals" />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setTitle(`${titleWord} Run`)}>
                    {titleWord} Run
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setTitle(`${titleWord} Session`)}>
                    {titleWord} Session
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs">Time of day (optional)</Label>
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant={timeOfDay === "none" ? "default" : "outline"} onClick={() => setTimeOfDay("none")}>
                    No preference
                  </Button>
                  <Button size="sm" variant={timeOfDay === "am" ? "default" : "outline"} onClick={() => setTimeOfDay("am")}>
                    AM
                  </Button>
                  <Button size="sm" variant={timeOfDay === "pm" ? "default" : "outline"} onClick={() => setTimeOfDay("pm")}>
                    PM
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")}>
                  Manual steps
                </Button>
                <Button size="sm" variant={mode === "library" ? "default" : "outline"} onClick={() => setMode("library")}>
                  Link a library template
                </Button>
              </div>

              {mode === "library" ? (
                <div>
                  <Label className="text-xs">Template</Label>
                  <Select value={libraryTemplateId} onValueChange={setLibraryTemplateId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {(libraryTemplates ?? []).map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(libraryTemplates ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No saved templates yet — build one on the Templates page first, or use manual steps here.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Resolved fresh at assignment time — editing this library template later updates any plan built from it
                    since.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs">Steps</Label>
                  {manualSteps.map((s, i) => (
                    <div key={i} className="rounded border p-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={s.kind} onValueChange={(v) => updateStep(i, { kind: v as ManualStep["kind"] })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="warmup">Warmup</SelectItem>
                            <SelectItem value="work">Work</SelectItem>
                            <SelectItem value="recovery">Recovery</SelectItem>
                            <SelectItem value="cooldown">Cooldown</SelectItem>
                            <SelectItem value="strides">Strides</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={s.target_kind}
                          onValueChange={(v) => updateStep(i, { target_kind: v as ManualStep["target_kind"] })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="time">Time</SelectItem>
                            <SelectItem value="distance">Distance</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <Label className="text-[10px]">{s.target_kind === "time" ? "Minutes" : "Meters"}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={s.value}
                            onChange={(e) => updateStep(i, { value: Number(e.target.value) })}
                          />
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(s.target_kind === "time" ? [10, 20, 30, 40, 60] : [400, 800, 1000, 1600, 5000]).map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => updateStep(i, { value: preset })}
                                className="text-[10px] rounded border px-1.5 py-0.5 hover:bg-accent/40 text-muted-foreground"
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px]">Reps</Label>
                          <Input
                            type="number"
                            min={1}
                            value={s.reps}
                            onChange={(e) => updateStep(i, { reps: Number(e.target.value) })}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => removeStep(i)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Target mode + its value field side by side, matching the same
                          layout polish applied to the session builder and Targets
                          editor — only shown for work/strides steps, since warmup/
                          recovery/cooldown steps are never targeted. */}
                      {(s.kind === "work" || s.kind === "strides") && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Target mode</Label>
                            <Select
                              value={s.target_mode ?? "open"}
                              onValueChange={(v) => setStepTargetMode(i, v as WorkoutTargetMode)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Open (no target)</SelectItem>
                                <SelectItem value="pace">Pace</SelectItem>
                                <SelectItem value="threshold_pace_pct">% threshold pace</SelectItem>
                                <SelectItem value="threshold_hr_pct">% threshold HR</SelectItem>
                                <SelectItem value="zone">Zone</SelectItem>
                                <SelectItem value="rpe">RPE</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            {s.target_mode === "pace" && (
                              <>
                                <Label className="text-[10px]">Pace (/km)</Label>
                                <Input
                                  placeholder="mm:ss"
                                  value={s.target_pace_sec_per_km != null ? secToClock(s.target_pace_sec_per_km) : ""}
                                  onChange={(e) =>
                                    updateStep(i, { target_pace_sec_per_km: e.target.value ? clockToSec(e.target.value) : null })
                                  }
                                />
                              </>
                            )}
                            {s.target_mode === "threshold_pace_pct" && (
                              <>
                                <Label className="text-[10px]">% of threshold pace</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={200}
                                  value={s.target_threshold_pace_pct ?? ""}
                                  onChange={(e) =>
                                    updateStep(i, {
                                      target_threshold_pace_pct: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                />
                              </>
                            )}
                            {s.target_mode === "threshold_hr_pct" && (
                              <>
                                <Label className="text-[10px]">% of threshold HR</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={200}
                                  value={s.target_threshold_hr_pct ?? ""}
                                  onChange={(e) =>
                                    updateStep(i, {
                                      target_threshold_hr_pct: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                />
                              </>
                            )}
                            {s.target_mode === "zone" && (
                              <>
                                <Label className="text-[10px]">Zone</Label>
                                <Select
                                  value={s.target_zone ?? ""}
                                  onValueChange={(v) => updateStep(i, { target_zone: v })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Choose zone" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ZONE_OPTIONS.map((z) => (
                                      <SelectItem key={z} value={z}>
                                        {z.toUpperCase()}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </>
                            )}
                            {s.target_mode === "rpe" && (
                              <>
                                <Label className="text-[10px]">RPE (1–10)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={s.target_rpe ?? ""}
                                  onChange={(e) =>
                                    updateStep(i, { target_rpe: e.target.value ? Number(e.target.value) : null })
                                  }
                                />
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {s.kind === "work" && s.reps > 1 && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Recovery between reps (sec)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={s.recovery_between_reps_seconds ?? ""}
                              onChange={(e) =>
                                updateStep(i, {
                                  recovery_between_reps_seconds: e.target.value ? Number(e.target.value) : undefined,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Recovery mode</Label>
                            <Select
                              value={s.recovery_between_reps_mode ?? "jog"}
                              onValueChange={(v) => updateStep(i, { recovery_between_reps_mode: v })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="jog">Jog</SelectItem>
                                <SelectItem value="walk">Walk</SelectItem>
                                <SelectItem value="stand">Stand</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={addStep}>
                    <Plus className="h-4 w-4 mr-1" /> Add step
                  </Button>
                </div>
              )}

              {durationWeeks > 1 && (
                <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={showApplyToOtherDays}
                      onChange={(e) => setShowApplyToOtherDays(e.target.checked)}
                    />
                    Also apply this day to other days
                  </label>

                  {showApplyToOtherDays && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={selectAllSameWeekday}>
                          Select every {DAY_LABELS[day - 1]}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOtherDayTargets(new Set())}>
                          Clear
                        </Button>
                        {otherDayTargets.size > 0 && (
                          <span className="text-xs text-muted-foreground">{otherDayTargets.size} selected</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Independent copies — each one is saved as its own day. Editing any of them afterward, including
                        this one, never affects the others.
                      </p>
                      <div className="max-h-48 overflow-y-auto space-y-1 border rounded p-2">
                        {Array.from({ length: durationWeeks }, (_, i) => i + 1).map((w) => (
                          <div key={w} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-9 shrink-0">Wk {w}</span>
                            <div className="grid grid-cols-7 gap-1 flex-1">
                              {DAY_LABELS.map((lbl, di) => {
                                const d = di + 1;
                                const key = `${w}-${d}`;
                                const isCurrent = w === week && d === day;
                                const checked = otherDayTargets.has(key);
                                const hasExisting = allSessionByDay.has(key);
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    disabled={isCurrent}
                                    onClick={() => toggleOtherDayTarget(key)}
                                    title={
                                      isCurrent
                                        ? "This is the day you're editing"
                                        : `${lbl}, Week ${w}${hasExisting ? " — has a session already, will be overwritten" : ""}`
                                    }
                                    className={`text-[10px] rounded border py-1 transition-colors ${
                                      isCurrent
                                        ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                                        : checked
                                          ? "bg-[var(--accent-red)] text-white border-[var(--accent-red)]"
                                          : hasExisting
                                            ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
                                            : "hover:bg-accent/40"
                                    }`}
                                  >
                                    {lbl[0]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {existing && (
            <Button variant="ghost" className="text-destructive" onClick={removeDay}>
              Clear day
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save day"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
