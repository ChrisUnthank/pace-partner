import { createFileRoute } from "@tanstack/react-router";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarRange, ChevronDown, ChevronUp } from "lucide-react";
import { metersFmt } from "@/lib/format";
import { assignPlanToAthlete, cancelAthletePlan } from "@/lib/plan.functions";
import { useAuthUser } from "@/lib/use-auth";

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
// column. To show a useful "km/week" figure for browsing, distance is
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

function PlansPage() {
  const { user } = useAuthUser();
  const [view, setView] = useState<"browse" | "builder">("browse");
  const [builderTemplateId, setBuilderTemplateId] = useState<string | null>(null);
  const [daysFilter, setDaysFilter] = useState<string>("all");
  const [distanceFilter, setDistanceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [volumeFilter, setVolumeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<PlanTemplate | null>(null);

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

  // Fetched once for every template up front (not just the expanded one) —
  // needed to estimate each template's weekly volume for the list/filter,
  // not just the preview.
  const { data: allTemplateSessions } = useQuery({
    queryKey: ["all-plan-template-sessions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plan_template_sessions")
        .select("plan_template_id, week_number, effort_type, steps");
      return (data ?? []) as any[];
    },
  });

  const weeklyVolumeByTemplate = new Map<string, number>();
  for (const t of templates ?? []) {
    const sessions = (allTemplateSessions ?? []).filter((s) => s.plan_template_id === t.id);
    weeklyVolumeByTemplate.set(t.id, estimateAvgWeeklyDistanceM(sessions));
  }

  const filtered = (templates ?? []).filter((t) => {
    if (daysFilter !== "all" && String(t.days_per_week) !== daysFilter) return false;
    if (distanceFilter !== "all" && (t.distance_focus ?? "generic") !== distanceFilter) return false;
    if (levelFilter !== "all" && t.level !== levelFilter) return false;
    if (volumeFilter !== "all") {
      const km = (weeklyVolumeByTemplate.get(t.id) ?? 0) / 1000;
      if (volumeFilter === "70to90" && (km < 70 || km >= 90)) return false;
      if (volumeFilter === "90to110" && (km < 90 || km >= 110)) return false;
      if (volumeFilter === "110to130" && (km < 110 || km >= 130)) return false;
      if (volumeFilter === "130to150" && (km < 130 || km >= 150)) return false;
      if (volumeFilter === "150plus" && km < 150) return false;
    }
    return true;
  });

  if (view === "builder") {
    return (
      <AppShell>
        <div className="space-y-6 max-w-5xl">
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
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarRange className="h-6 w-6 text-[var(--accent-red)]" /> Training Plans
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Base templates you can assign straight to an athlete — generates real, editable sessions on their calendar.
            </p>
          </div>
          <Button
            onClick={() => {
              setBuilderTemplateId(null);
              setView("builder");
            }}
          >
            + Build your own
          </Button>
        </div>

        <ActivePlans />

        <Card>
          <CardHeader>
            <CardTitle>Plan templates</CardTitle>
            <CardDescription>
              Filter by weekly frequency, race focus, level, or estimated weekly volume, then assign to an athlete.
              Weekly volume is estimated from typical pace per session type — a browsing guide, not a per-athlete prediction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div>
                <Label className="text-xs">Days per week</Label>
                <Select value={daysFilter} onValueChange={setDaysFilter}>
                  <SelectTrigger className="w-40 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    {[3, 4, 5, 6, 7].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} days/week
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Focus</Label>
                <Select value={distanceFilter} onValueChange={setDistanceFilter}>
                  <SelectTrigger className="w-48 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
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
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger className="w-40 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Weekly volume</Label>
                <Select value={volumeFilter} onValueChange={setVolumeFilter}>
                  <SelectTrigger className="w-48 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any</SelectItem>
                    <SelectItem value="70to90">70–90 km/wk</SelectItem>
                    <SelectItem value="90to110">90–110 km/wk</SelectItem>
                    <SelectItem value="110to130">110–130 km/wk</SelectItem>
                    <SelectItem value="130to150">130–150 km/wk</SelectItem>
                    <SelectItem value="150plus">150+ km/wk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No templates match those filters.</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((t) => (
                  <div key={t.id} className="rounded-md border">
                    <div className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{t.name}</span>
                          <Badge variant="outline">{t.days_per_week} days/wk</Badge>
                          <Badge variant="outline">{t.duration_weeks} wks</Badge>
                          <Badge variant="secondary">{distanceFocusLabel(t.distance_focus)}</Badge>
                          {t.level && <Badge variant="outline" className="capitalize">{t.level}</Badge>}
                          {(weeklyVolumeByTemplate.get(t.id) ?? 0) > 0 && (
                            <Badge variant="outline">~{metersFmt(weeklyVolumeByTemplate.get(t.id) ?? 0)}/wk avg</Badge>
                          )}
                          {!t.is_system && (
                            <Badge className="bg-[var(--accent-red)]/10 text-[var(--accent-red)] border-[var(--accent-red)]/20">
                              Yours
                            </Badge>
                          )}
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

                    {expandedId === t.id && <TemplatePreview templateId={t.id} />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {assignTarget && (
          <AssignPlanDialog template={assignTarget} onClose={() => setAssignTarget(null)} />
        )}
      </div>
    </AppShell>
  );
}

function TemplatePreview({ templateId }: { templateId: string }) {
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
  const [athleteId, setAthleteId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [goalId, setGoalId] = useState<string>("none");
  const [assigning, setAssigning] = useState(false);

  const { data: roster } = useQuery({
    queryKey: ["roster-for-plan-assign"],
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes").select("athlete_id, athletes(id, name)");
      return (data ?? []) as any[];
    },
  });

  const { data: athleteGoals } = useQuery({
    queryKey: ["athlete-goals-for-assign", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_goals")
        .select("id, title, goal_type, race_date")
        .eq("athlete_id", athleteId)
        .eq("status", "active");
      return data ?? [];
    },
  });

  async function assign() {
    if (!athleteId) {
      toast.error("Choose an athlete");
      return;
    }
    if (!startDate) {
      toast.error("Choose a start date");
      return;
    }

    setAssigning(true);
    try {
      const result = await assignPlanToAthlete({
        data: {
          athleteId,
          planTemplateId: template.id,
          startDate,
          goalId: goalId === "none" ? null : goalId,
        },
      });
      toast.success(`Plan assigned — ${result.sessionsCreated} sessions created`);
      qc.invalidateQueries({ queryKey: ["active-athlete-plans"] });
      qc.invalidateQueries({ queryKey: ["athlete-sessions-7d"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to assign plan");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign "{template.name}"</DialogTitle>
          <DialogDescription>
            Creates {template.duration_weeks} weeks of real sessions on the athlete's calendar, starting the Monday you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Athlete</Label>
            <Select value={athleteId} onValueChange={setAthleteId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose an athlete" />
              </SelectTrigger>
              <SelectContent>
                {(roster ?? []).map((r: any) => (
                  <SelectItem key={r.athlete_id} value={r.athlete_id}>
                    {r.athletes?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Start date (Monday of week 1)</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          {athleteId && (
            <div>
              <Label className="text-xs">Link to a goal (optional)</Label>
              <Select value={goalId} onValueChange={setGoalId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked goal</SelectItem>
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={assign} disabled={assigning}>
            {assigning ? "Assigning..." : "Assign plan"}
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
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        ← Back to templates
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{savedId ? "Edit template" : "New template"}</CardTitle>
          <CardDescription>
            {savedId
              ? "Update the basics any time — changes apply to future assignments, not plans already assigned."
              : "Save the basics first, then build out each week below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My 5-Day 10K Build" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <textarea
              className="w-full min-h-16 rounded-md border bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this for, and who's it a good fit for?"
            />
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Days per week</Label>
              <Select value={String(daysPerWeek)} onValueChange={(v) => setDaysPerWeek(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6, 7].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Duration (weeks)</Label>
              <Input type="number" min={1} value={durationWeeks} onChange={(e) => setDurationWeeks(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Focus</Label>
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
          <div className="flex gap-2">
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

type ManualStep = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  target_kind: "distance" | "time";
  value: number; // meters for distance, minutes for time (converted on save)
  reps: number;
  recovery_between_reps_seconds?: number;
  recovery_between_reps_mode?: string;
};

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
    setManualSteps((s) => [...s, { kind: "work", target_kind: "time", value: 20, reps: 1 }]);
  }

  function updateStep(i: number, patch: Partial<ManualStep>) {
    setManualSteps((s) => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));
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
                  From my library
                </Button>
              </div>

              {mode === "library" ? (
                <div>
                  <Label className="text-xs">Session template</Label>
                  <Select value={libraryTemplateId} onValueChange={setLibraryTemplateId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Choose from your Templates library" />
                    </SelectTrigger>
                    <SelectContent>
                      {(libraryTemplates ?? []).map((lt: any) => (
                        <SelectItem key={lt.id} value={lt.id}>
                          {lt.title}
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
                    Resolved fresh at assignment time — editing this library template later updates any plan built from it since.
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
                            value={s.value}
                            onChange={(e) => updateStep(i, { value: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Reps</Label>
                          <Input type="number" min={1} value={s.reps} onChange={(e) => updateStep(i, { reps: Number(e.target.value) })} />
                        </div>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeStep(i)}>
                          Remove
                        </Button>
                      </div>
                      {s.reps > 1 && (
                        <div>
                          <Label className="text-[10px]">Recovery between reps (seconds)</Label>
                          <Input
                            type="number"
                            value={s.recovery_between_reps_seconds ?? ""}
                            onChange={(e) => updateStep(i, { recovery_between_reps_seconds: Number(e.target.value) })}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={addStep}>
                    + Add step
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {existing ? (
            <Button variant="ghost" className="text-destructive" onClick={removeDay}>
              Clear day
            </Button>
          ) : (
            <span />
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

function ActivePlans() {
  const qc = useQueryClient();

  const { data: plans } = useQuery({
    queryKey: ["active-athlete-plans"],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_plans")
        .select("*, athletes(name)")
        .eq("status", "active")
        .order("start_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  async function cancel(planId: string) {
    const deleteFuture = window.confirm(
      "Also remove this plan's future, not-yet-completed sessions from the calendar? (Cancel to just stop tracking it, keeping all its sessions.)",
    );
    try {
      await cancelAthletePlan({ data: { athletePlanId: planId, deleteFutureSessions: deleteFuture } });
      toast.success("Plan cancelled");
      qc.invalidateQueries({ queryKey: ["active-athlete-plans"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to cancel");
    }
  }

  if (!plans || plans.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active plans</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {plans.map((p) => {
            const weeksElapsed = Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000)) + 1;
            const currentWeek = Math.min(Math.max(weeksElapsed, 1), p.duration_weeks);

            return (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <span className="font-medium">{p.athletes?.name}</span>
                  <span className="text-muted-foreground"> · {p.name}</span>
                  <span className="text-muted-foreground"> · Week {currentWeek} of {p.duration_weeks}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => cancel(p.id)}>
                  Cancel
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
