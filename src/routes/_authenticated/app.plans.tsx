import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
import { CalendarRange, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { metersFmt, clockToSec, secToClock } from "@/lib/format";
import { assignPlanToAthlete, cancelAthletePlan } from "@/lib/plan.functions";
import { useAuthUser } from "@/lib/use-auth";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { inferWorkoutTargetMode, type WorkoutTargetMode } from "@/lib/workout-target-modes";
import { CopyPeriodDialog } from "@/components/copy-period-dialog";

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

const EFFORT_STYLES: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-700 border-emerald-200",
  long: "bg-sky-100 text-sky-700 border-sky-200",
  tempo: "bg-amber-100 text-amber-700 border-amber-200",
  threshold: "bg-orange-100 text-orange-700 border-orange-200",
  vo2: "bg-red-100 text-red-700 border-red-200",
  strides: "bg-teal-100 text-teal-700 border-teal-200",
  race: "bg-purple-100 text-purple-700 border-purple-200",
  cross_train: "bg-slate-100 text-slate-700 border-slate-200",
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

function PlansPage() {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [view, setView] = useState<"browse" | "builder">("browse");
  const [builderTemplateId, setBuilderTemplateId] = useState<string | null>(null);
  const [templateSource, setTemplateSource] = useState<"mine" | "system">("mine");
  const [daysFilter, setDaysFilter] = useState<string>("all");
  const [distanceFilter, setDistanceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [volumeFilter, setVolumeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<PlanTemplate | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [buildMenuOpen, setBuildMenuOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const templatesSectionRef = useRef<HTMLDivElement>(null);
  const [copyPeriodOpen, setCopyPeriodOpen] = useState(false);

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
      setView("builder");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to duplicate template");
    } finally {
      setDuplicatingId(null);
    }
  }

  if (view === "builder") {
    return (
      <AppShell>
        <div className="space-y-6 max-w-5xl">
          <BucketTabStrip items={COACHING_HUB_TABS} active="/app/plans" />
          <PlanBuilder
            templateId={builderTemplateId}
            onBack={() => {
              setView("browse");
              setBuilderTemplateId(null);
            }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/plans" />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <CalendarRange className="h-5 w-5" /> Training Plans
            </h1>
            <p className="text-sm text-muted-foreground">Browse plan templates, or build your own for your roster.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCopyPeriodOpen(true)}>
              Copy period forward
            </Button>
            <div className="relative">
              <Button onClick={() => setBuildMenuOpen((o) => !o)}>
                Build training <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
              {buildMenuOpen && (
                <>
                  {/* Click-outside layer — sits below the menu panel, above everything else */}
                  <div className="fixed inset-0 z-40" onClick={() => setBuildMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 w-72 rounded-md border bg-popover shadow-md z-50 p-1">
                    <button
                      className="w-full text-left rounded px-3 py-2 text-sm hover:bg-accent/50"
                      onClick={() => {
                        setBuildMenuOpen(false);
                        templatesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <div className="font-medium">Apply a template</div>
                      <div className="text-xs text-muted-foreground">
                        Browse My or System templates and assign to one athlete or a group.
                      </div>
                    </button>
                    <button
                      className="w-full text-left rounded px-3 py-2 text-sm hover:bg-accent/50"
                      onClick={() => {
                        setBuildMenuOpen(false);
                        setBuilderTemplateId(null);
                        setView("builder");
                      }}
                    >
                      <div className="font-medium">Build from scratch</div>
                      <div className="text-xs text-muted-foreground">
                        Open the manual Plan Builder to design a new template week by week.
                      </div>
                    </button>
                    <button
                      className="w-full text-left rounded px-3 py-2 text-sm hover:bg-accent/50"
                      onClick={() => {
                        setBuildMenuOpen(false);
                        setHistoryDialogOpen(true);
                      }}
                    >
                      <div className="font-medium">Copy athlete history</div>
                      <div className="text-xs text-muted-foreground">
                        Give each athlete their own recent training back as their own starting point.
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div ref={templatesSectionRef} className="flex gap-2">
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
          <AssignPlanDialog template={assignTarget} onClose={() => setAssignTarget(null)} />
        )}

        <CopyPeriodDialog open={copyPeriodOpen} onClose={() => setCopyPeriodOpen(false)} />
        <CopyPeriodDialog open={historyDialogOpen} onClose={() => setHistoryDialogOpen(false)} variant="history" />
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

function AssignPlanDialog({ template, onClose }: { template: PlanTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  // Bulk by default — a coach applying a template to a training group
  // shouldn't have to repeat this dialog once per athlete. Goal linking
  // only makes sense for a single athlete (a goal is one athlete's own
  // race target), so that field only shows when exactly one is checked.
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [goalId, setGoalId] = useState<string>("none");
  const [assigning, setAssigning] = useState(false);

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

  async function assign() {
    if (athleteIds.length === 0) {
      toast.error("Choose at least one athlete");
      return;
    }
    if (!startDate) {
      toast.error("Choose a start date");
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
      onClose();
    } else {
      toast.error(
        `Assigned to ${athleteIds.length - failedNames.length}/${athleteIds.length} athletes. Failed: ${failedNames.join(", ")}`,
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign "{template.name}"</DialogTitle>
          <DialogDescription>
            Generates real sessions on each selected athlete's calendar starting the week you pick.
          </DialogDescription>
        </DialogHeader>

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={assign} disabled={assigning}>
            {assigning ? "Assigning..." : athleteIds.length > 1 ? `Assign to ${athleteIds.length} athletes` : "Assign plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Plan Builder — create/edit a coach's own plan template. Template metadata
// saves immediately (so the week/day grid has a plan_template_id to attach
// to); each day in the grid is edited independently via DayEditorDialog,
// which can either link an existing entry from the Templates library
// (session_templates) or build a one-off step recipe by hand.
// ----------------------------------------------------------------------------

function PlanBuilder({ templateId, onBack }: { templateId: string | null; onBack: () => void }) {
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
          <CardHeader>
            <CardTitle>Weeks</CardTitle>
            <CardDescription>Click a day to add or edit its session. Leave a day empty for rest.</CardDescription>
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
          existing={sessionByDay.get(`${dayEditor.week}-${dayEditor.day}`) ?? null}
          onClose={() => setDayEditor(null)}
          onSaved={() => {
            setDayEditor(null);
            qc.invalidateQueries({ queryKey: ["plan-template-sessions-edit", savedId] });
            qc.invalidateQueries({ queryKey: ["all-plan-template-sessions"] });
          }}
        />
      )}
    </div>
  );
}

// Phase 4: manual step recipe now carries the same five target fields as
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
  existing,
  onClose,
  onSaved,
}: {
  planTemplateId: string;
  week: number;
  day: number;
  existing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [effortType, setEffortType] = useState(existing?.effort_type ?? "easy");
  const [mode, setMode] = useState<"library" | "manual">(existing?.session_template_id ? "library" : "manual");
  const [libraryTemplateId, setLibraryTemplateId] = useState<string>(existing?.session_template_id ?? "");
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

    const payload = {
      plan_template_id: planTemplateId,
      week_number: week,
      day_of_week: day,
      title: title.trim() || (effortType === "rest" ? "Rest" : effortType === "cross_train" ? "Cross-train" : title),
      effort_type: effortType,
      steps: mode === "library" ? null : steps,
      session_template_id: mode === "library" && libraryTemplateId ? libraryTemplateId : null,
    };

    const { error } = existing
      ? await supabase.from("plan_template_sessions").update(payload as any).eq("id", existing.id)
      : await supabase.from("plan_template_sessions").insert(payload as any);

    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

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
