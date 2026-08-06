import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, Target, Flag } from "lucide-react";
import { metersFmt, secToClock, clockToSec } from "@/lib/format";

type GoalType = "race" | "freeform";
type Priority = "A" | "B" | "C";
type Status = "active" | "achieved" | "missed" | "abandoned";
type RaceType = "track" | "road" | "cross_country";

type Goal = {
  id: string;
  athlete_id: string;
  goal_type: GoalType;
  title: string;
  notes: string | null;
  race_date: string | null;
  distance_m: number | null;
  race_type: RaceType | null;
  target_time_seconds: number | null;
  priority: Priority | null;
  target_date: string | null;
  is_primary: boolean;
  status: Status;
};

function raceTypeLabel(rt: string | null) {
  switch (rt) {
    case "track":
      return "Track";
    case "road":
      return "Road";
    case "cross_country":
      return "XC";
    default:
      return "";
  }
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function countdownLabel(dateStr: string | null): string | null {
  const days = daysUntil(dateStr);
  if (days == null) return null;
  if (days === 0) return "Today";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days < 14) return `${days}d away`;
  const weeks = Math.round(days / 7);
  return `${weeks}w away`;
}

const STATUS_STYLES: Record<Status, string> = {
  active: "bg-sky-100 text-sky-700 border-sky-200",
  achieved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  missed: "bg-amber-100 text-amber-700 border-amber-200",
  abandoned: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  A: "bg-red-100 text-red-700 border-red-200",
  B: "bg-orange-100 text-orange-700 border-orange-200",
  C: "bg-muted text-muted-foreground border-border",
};

export function GoalsCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const { data: goals } = useQuery({
    queryKey: ["athlete-goals", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_goals")
        .select("*")
        .eq("athlete_id", athleteId)
        .order("is_primary", { ascending: false })
        .order("race_date", { ascending: true, nullsFirst: false })
        .order("target_date", { ascending: true, nullsFirst: false });
      return (data ?? []) as Goal[];
    },
  });

  const allGoals = goals ?? [];
  const primaryGoal = allGoals.find((g) => g.is_primary && g.status === "active") ?? null;
  const otherActiveGoals = allGoals.filter((g) => g.id !== primaryGoal?.id && g.status === "active");
  const pastGoals = allGoals.filter((g) => g.status !== "active");

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["athlete-goals", athleteId] });
  }

  async function setStatus(goal: Goal, status: Status) {
    const { error } = await supabase.from("athlete_goals").update({ status, updated_at: new Date().toISOString() }).eq("id", goal.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === "achieved" ? "Marked achieved 🎉" : "Updated");
    invalidate();
  }

  async function makePrimary(goal: Goal) {
    // Clear any existing primary first — the partial unique index only
    // allows one active primary per athlete, so a straight two-row update
    // (old primary off, new primary on) avoids racing against it.
    const { error: clearErr } = await supabase
      .from("athlete_goals")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("athlete_id", athleteId)
      .eq("is_primary", true);
    if (clearErr) {
      toast.error(clearErr.message);
      return;
    }
    const { error } = await supabase
      .from("athlete_goals")
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq("id", goal.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Set as primary goal");
    invalidate();
  }

  async function remove(goal: Goal) {
    const { error } = await supabase.from("athlete_goals").delete().eq("id", goal.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Goal removed");
    invalidate();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--accent-red)]" /> Goals
          </CardTitle>
          <CardDescription>What this athlete's training is actually building toward.</CardDescription>
        </div>
        <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add goal"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {showForm && (
          <GoalForm
            athleteId={athleteId}
            onSaved={() => {
              setShowForm(false);
              invalidate();
            }}
          />
        )}

        {primaryGoal && (
          <div className="rounded-md border-2 border-[var(--accent-red)]/40 bg-[var(--accent-red)]/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-red)]">Primary goal</span>
              <GoalBadges goal={primaryGoal} />
            </div>
            <GoalBody goal={primaryGoal} large />
            <GoalActions
              goal={primaryGoal}
              onAchieve={() => setStatus(primaryGoal, "achieved")}
              onAbandon={() => setStatus(primaryGoal, "abandoned")}
              onRemove={() => remove(primaryGoal)}
            />
          </div>
        )}

        {otherActiveGoals.length > 0 && (
          <div className="space-y-2">
            {!primaryGoal && (
              <div className="text-xs text-muted-foreground">No primary goal set — pick one below to highlight it.</div>
            )}
            {otherActiveGoals.map((g) => (
              <div key={g.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <GoalBadges goal={g} />
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => makePrimary(g)}>
                    Make primary
                  </Button>
                </div>
                <GoalBody goal={g} />
                <GoalActions
                  goal={g}
                  onAchieve={() => setStatus(g, "achieved")}
                  onAbandon={() => setStatus(g, "abandoned")}
                  onRemove={() => remove(g)}
                />
              </div>
            ))}
          </div>
        )}

        {allGoals.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">No goals set yet — add a target race or a freeform goal to give training a direction.</p>
        )}

        {pastGoals.length > 0 && (
          <div>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowPast((v) => !v)}>
              {showPast ? "Hide" : "Show"} past goals ({pastGoals.length})
            </Button>
            {showPast && (
              <div className="space-y-2 mt-2">
                {pastGoals.map((g) => (
                  <div key={g.id} className="rounded-md border p-3 opacity-70">
                    <div className="flex items-center justify-between gap-2">
                      <GoalBadges goal={g} />
                      <Button variant="ghost" size="sm" onClick={() => remove(g)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <GoalBody goal={g} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalBadges({ goal }: { goal: Goal }) {
  const countdown = goal.goal_type === "race" ? countdownLabel(goal.race_date) : countdownLabel(goal.target_date);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {goal.goal_type === "race" && goal.priority && (
        <Badge className={PRIORITY_STYLES[goal.priority]}>{goal.priority}-Race</Badge>
      )}
      <Badge className={STATUS_STYLES[goal.status]}>{goal.status}</Badge>
      {countdown && (
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Flag className="h-3 w-3" /> {countdown}
        </span>
      )}
    </div>
  );
}

function GoalBody({ goal, large = false }: { goal: Goal; large?: boolean }) {
  return (
    <div className="mt-1.5">
      <div className={large ? "font-display text-xl font-extrabold" : "font-semibold text-sm"}>{goal.title}</div>

      {goal.goal_type === "race" ? (
        <div className="text-sm text-muted-foreground mt-0.5">
          {goal.distance_m ? metersFmt(goal.distance_m) : ""}
          {goal.race_type ? ` · ${raceTypeLabel(goal.race_type)}` : ""}
          {goal.race_date ? ` · ${goal.race_date}` : ""}
          {goal.target_time_seconds ? ` · Target ${secToClock(goal.target_time_seconds)}` : ""}
        </div>
      ) : (
        goal.target_date && <div className="text-sm text-muted-foreground mt-0.5">Target: {goal.target_date}</div>
      )}

      {goal.notes && <p className="text-sm mt-1.5 text-muted-foreground leading-relaxed">{goal.notes}</p>}
    </div>
  );
}

function GoalActions({
  goal,
  onAchieve,
  onAbandon,
  onRemove,
}: {
  goal: Goal;
  onAchieve: () => void;
  onAbandon: () => void;
  onRemove: () => void;
}) {
  if (goal.status !== "active") return null;

  return (
    <div className="flex gap-2 mt-3">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAchieve}>
        Mark achieved
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onAbandon}>
        Abandon
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground ml-auto" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function GoalForm({ athleteId, onSaved }: { athleteId: string; onSaved: () => void }) {
  const [goalType, setGoalType] = useState<GoalType>("race");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  // Race fields
  const [raceDate, setRaceDate] = useState("");
  const [distance, setDistance] = useState(5000);
  const [raceType, setRaceType] = useState<RaceType>("road");
  const [targetTime, setTargetTime] = useState("");
  const [priority, setPriority] = useState<Priority>("A");

  // Freeform fields
  const [targetDate, setTargetDate] = useState("");

  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) {
      toast.error("Give the goal a title");
      return;
    }

    if (goalType === "race" && !raceDate) {
      toast.error("Race date is required for a race goal");
      return;
    }

    const targetSeconds = targetTime.trim() ? clockToSec(targetTime) : null;

    setSaving(true);

    const payload: Record<string, unknown> = {
      athlete_id: athleteId,
      goal_type: goalType,
      title: title.trim(),
      notes: notes.trim() || null,
      is_primary: isPrimary,
      status: "active",
    };

    if (goalType === "race") {
      payload.race_date = raceDate;
      payload.distance_m = distance;
      payload.race_type = raceType;
      payload.target_time_seconds = targetSeconds;
      payload.priority = priority;
    } else {
      payload.target_date = targetDate || null;
    }

    // If this is being set as primary, clear any existing primary first —
    // same reasoning as makePrimary() above (partial unique index allows
    // only one active primary per athlete).
    if (isPrimary) {
      await supabase.from("athlete_goals").update({ is_primary: false }).eq("athlete_id", athleteId).eq("is_primary", true);
    }

    const { error } = await supabase.from("athlete_goals").insert(payload as any);

    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Goal added");
    onSaved();
  }

  return (
    <div className="rounded-md border p-4 space-y-3 bg-card/40">
      <div className="flex gap-2">
        <Button size="sm" variant={goalType === "race" ? "default" : "outline"} onClick={() => setGoalType("race")}>
          Race goal
        </Button>
        <Button size="sm" variant={goalType === "freeform" ? "default" : "outline"} onClick={() => setGoalType("freeform")}>
          Freeform goal
        </Button>
      </div>

      <div>
        <Label className="text-xs">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={goalType === "race" ? "e.g. City Half Marathon" : "e.g. Return from injury"}
        />
      </div>

      {goalType === "race" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Race date</Label>
            <Input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A — the goal race</SelectItem>
                <SelectItem value="B">B — tune-up race</SelectItem>
                <SelectItem value="C">C — low-stakes / training race</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Distance (m)</Label>
            <Input type="number" value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Race type</Label>
            <Select value={raceType} onValueChange={(v) => setRaceType(v as RaceType)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="track">Track</SelectItem>
                <SelectItem value="road">Road</SelectItem>
                <SelectItem value="cross_country">Cross country</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Target time (mm:ss, optional)</Label>
            <Input placeholder="18:30" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <Label className="text-xs">Target date (optional)</Label>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      )}

      <div>
        <Label className="text-xs">Notes</Label>
        <textarea
          className="w-full min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any context worth capturing — why this goal, what's driving it, constraints to plan around..."
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} className="rounded" />
        Set as primary goal — this is what the current training block is built around
      </label>

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save goal"}
      </Button>
    </div>
  );
}
