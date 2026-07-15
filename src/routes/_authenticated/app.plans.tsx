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
import { assignPlanToAthlete, cancelAthletePlan } from "@/lib/plan.functions";

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
    default:
      return "Generic base";
  }
}

function PlansPage() {
  const [daysFilter, setDaysFilter] = useState<string>("all");
  const [distanceFilter, setDistanceFilter] = useState<string>("all");
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

  const filtered = (templates ?? []).filter((t) => {
    if (daysFilter !== "all" && String(t.days_per_week) !== daysFilter) return false;
    if (distanceFilter !== "all" && (t.distance_focus ?? "generic") !== distanceFilter) return false;
    return true;
  });

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
        </div>

        <ActivePlans />

        <Card>
          <CardHeader>
            <CardTitle>Plan templates</CardTitle>
            <CardDescription>Filter by weekly frequency or race focus, then assign to an athlete.</CardDescription>
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
                        </div>
                        {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
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
