import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, Flag, RotateCcw, Trash2 } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { EventTacticsCard } from "@/components/event-tactics-card";
import { TacticalDecisionPointsCard } from "@/components/tactical-decision-points-card";
import { clockToSec, secToClock, paceFmt } from "@/lib/format";
import {
  type SplitRow,
  type Strategy,
  generateStrategySplits,
  recalcAfterEdit,
  recalcFromEditedFlags,
  isOverGoalTime,
  averagePaceSecPerKm,
  averageSpeedKmh,
  STRATEGY_OPTIONS,
} from "@/lib/race-tactics-calc";

export const Route = createFileRoute("/_authenticated/app/race-tactics/$planId")({
  component: RaceTacticsDetail,
});

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "coach_review", label: "Coach Review" },
  { value: "approved", label: "Approved" },
  { value: "race_ready", label: "Race Ready" },
  { value: "completed", label: "Completed" },
];

function RaceTacticsDetail() {
  const { planId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();

  const { data: plan, isLoading } = useQuery({
    queryKey: ["race-tactics-plan", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_tactics_plans" as any)
        .select("*, athletes(id, name)")
        .eq("id", planId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const canEdit = isCoach || myAthlete?.id === plan?.athlete_id;

  // Local editable copy of the splits array — every edit recalculates
  // locally first (instant feedback), then persists to the DB. Re-synced
  // from the fetched plan whenever the plan itself changes underneath
  // (e.g. reloading the page).
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [savingSplits, setSavingSplits] = useState(false);
  useEffect(() => {
    if (plan?.splits) setSplits(plan.splits as SplitRow[]);
  }, [plan?.id, plan?.splits]);

  async function persistSplits(next: SplitRow[]) {
    setSplits(next);
    setSavingSplits(true);
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ splits: next as any, updated_at: new Date().toISOString() })
      .eq("id", planId);
    setSavingSplits(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  function editSplit(index: number, newTimeInput: string) {
    const sec = clockToSec(newTimeInput);
    if (sec == null || sec <= 0 || !plan) return;
    const next = recalcAfterEdit(splits, index, sec, Number(plan.goal_time_seconds));
    persistSplits(next);
  }

  function resetSplit(index: number) {
    if (!plan) return;
    const cleared = splits.map((s, i) => (i === index ? { ...s, is_edited: false } : s));
    const next = recalcFromEditedFlags(cleared, Number(plan.goal_time_seconds));
    persistSplits(next);
  }

  function resetAllSplits() {
    if (!plan) return;
    const next = generateStrategySplits(plan.race_distance_m, plan.split_increment_m, Number(plan.goal_time_seconds), plan.strategy as Strategy);
    persistSplits(next);
  }

  async function changeStrategy(strategy: Strategy) {
    if (!plan) return;
    const next = generateStrategySplits(plan.race_distance_m, plan.split_increment_m, Number(plan.goal_time_seconds), strategy);
    setSplits(next);
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ strategy, splits: next as any, updated_at: new Date().toISOString() })
      .eq("id", planId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Strategy set to ${STRATEGY_OPTIONS.find((o) => o.value === strategy)?.label}`);
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  async function updateStatus(status: string) {
    const { error } = await supabase.from("race_tactics_plans" as any).update({ status }).eq("id", planId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  async function deletePlan() {
    const { error } = await supabase.from("race_tactics_plans" as any).delete().eq("id", planId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Plan deleted");
    navigate({ to: "/app/race-tactics" });
  }

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (!plan) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Plan not found.</p>
      </AppShell>
    );
  }

  const goalTime = Number(plan.goal_time_seconds);
  const overBudget = isOverGoalTime(splits, goalTime);
  const avgPace = averagePaceSecPerKm(plan.race_distance_m, goalTime);
  const avgSpeed = averageSpeedKmh(plan.race_distance_m, goalTime);
  const conditions = plan.conditions as { temperature_c?: string; wind?: string; weather?: string; surface?: string } | null;

  return (
    <AppShell>
      <div className="space-y-4 max-w-3xl">
        <Button asChild variant="ghost" size="sm">
          <Link to="/app/race-tactics">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Race Tactics
          </Link>
        </Button>

        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flag className="h-5 w-5 text-[var(--accent-red)]" />
              {plan.event_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {plan.athletes?.name} · {plan.race_distance_m}m {plan.race_type} {plan.race_date ? `· ${plan.race_date}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Select value={plan.status} onValueChange={updateStatus}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{STATUS_OPTIONS.find((o) => o.value === plan.status)?.label ?? plan.status}</Badge>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Goal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Goal time</div>
                <div className="font-semibold tabular-nums">{secToClock(goalTime)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Average pace</div>
                <div className="font-semibold tabular-nums">{paceFmt(avgPace)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Average speed</div>
                <div className="font-semibold tabular-nums">{avgSpeed.toFixed(1)} km/h</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Current PB / Target PB</div>
                <div className="font-semibold tabular-nums">
                  {plan.current_pb_seconds ? secToClock(plan.current_pb_seconds) : "—"} /{" "}
                  {plan.target_pb_seconds ? secToClock(plan.target_pb_seconds) : "—"}
                </div>
              </div>
            </div>
            {conditions && (conditions.temperature_c || conditions.wind || conditions.weather || conditions.surface) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {conditions.temperature_c && <Badge variant="outline">{conditions.temperature_c}</Badge>}
                {conditions.wind && <Badge variant="outline">{conditions.wind}</Badge>}
                {conditions.weather && <Badge variant="outline">{conditions.weather}</Badge>}
                {conditions.surface && <Badge variant="outline">{conditions.surface}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Strategy</CardTitle>
            <CardDescription>Shapes how pace is distributed across the race, not just the total time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {canEdit ? (
              <Select value={plan.strategy} onValueChange={(v) => changeStrategy(v as Strategy)}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{STRATEGY_OPTIONS.find((o) => o.value === plan.strategy)?.label ?? plan.strategy}</Badge>
            )}
            <p className="text-xs text-muted-foreground">{STRATEGY_OPTIONS.find((o) => o.value === plan.strategy)?.description}</p>
            {canEdit && splits.some((s) => s.is_edited) && (
              <p className="text-xs text-amber-600">Changing strategy regenerates every split and discards your manual edits above.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pace plan</CardTitle>
            <CardDescription>Planned pace at each split against the flat goal pace — the shape is the strategy.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={splits.map((s) => ({
                    label: `${s.cumulative_distance_m}m`,
                    plannedPace: (s.segment_time_seconds / s.distance_m) * 1000,
                    goalPace: avgPace,
                  }))}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis reversed tickFormatter={(v) => secToClock(v)} tick={{ fontSize: 11 }} width={55} />
                  <Tooltip formatter={(value: number) => paceFmt(value)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="plannedPace" name="Planned pace" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="goalPace" name="Goal pace (flat)" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Splits</CardTitle>
              <CardDescription>
                Click a split time to edit it — the remaining splits recalculate automatically to keep the goal time
                exact.
              </CardDescription>
            </div>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={resetAllSplits}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset all to {STRATEGY_OPTIONS.find((o) => o.value === plan.strategy)?.label ?? "strategy"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {overBudget && (
              <div className="flex items-center gap-2 px-4 py-2 text-sm bg-rose-50 text-rose-700 border-b border-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Edited splits already add up to more than the goal time — remaining splits are floored at 0s until an
                edited split is loosened or reset.
              </div>
            )}
            <div className="divide-y">
              {splits.map((s, i) => (
                <SplitRowView
                  key={i}
                  split={s}
                  canEdit={!!canEdit}
                  onEdit={(t) => editSplit(i, t)}
                  onReset={() => resetSplit(i)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <EventTacticsCard
          planId={planId}
          raceDistanceM={plan.race_distance_m}
          raceType={plan.race_type}
          eventTactics={plan.event_tactics}
          canEdit={!!canEdit}
        />

        <TacticalDecisionPointsCard planId={planId} raceDistanceM={plan.race_distance_m} canEdit={!!canEdit} />

        {canEdit && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive">
                <Trash2 className="h-4 w-4 mr-1" />
                Delete plan
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this race plan?</AlertDialogTitle>
                <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deletePlan}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </AppShell>
  );
}

function SplitRowView({
  split,
  canEdit,
  onEdit,
  onReset,
}: {
  split: SplitRow;
  canEdit: boolean;
  onEdit: (timeInput: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(secToClock(split.segment_time_seconds));

  useEffect(() => {
    if (!editing) setDraft(secToClock(split.segment_time_seconds));
  }, [split.segment_time_seconds, editing]);

  function commit() {
    setEditing(false);
    if (draft !== secToClock(split.segment_time_seconds)) onEdit(draft);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium tabular-nums shrink-0">{split.cumulative_distance_m}m</span>
        <span className="text-xs text-muted-foreground shrink-0">({split.distance_m}m segment)</span>
        {split.is_edited && (
          <Badge variant="outline" className="text-[10px] bg-sky-100 text-sky-700 border-sky-200">
            Edited
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground tabular-nums">cum {secToClock(split.cumulative_time_seconds)}</span>
        {canEdit && editing ? (
          <Input
            autoFocus
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(secToClock(split.segment_time_seconds));
                setEditing(false);
              }
            }}
            className="w-20 h-7 text-sm tabular-nums text-right"
          />
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-foreground"
          >
            {secToClock(split.segment_time_seconds)}
          </button>
        ) : (
          <span className="tabular-nums">{secToClock(split.segment_time_seconds)}</span>
        )}
        {canEdit && split.is_edited && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onReset}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
