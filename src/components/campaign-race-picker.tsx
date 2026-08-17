import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, CalendarRange, Check } from "lucide-react";
import type { CampaignTarget, TargetPriority } from "@/lib/campaign-generator";

// ----------------------------------------------------------------------------
// Adding races from what the app already knows.
//
// Campaign races were typed in by hand, duplicating races that exist as goals
// or in the squad race schedule. Three copies of one date is three places to
// change when it moves, and two of them get forgotten.
//
// Picked races keep their source id, so the campaign knows the goal or
// calendar entry it came from. Typing one in stays possible — a race pencilled
// in before it exists anywhere else is a normal thing to want.
//
// PRIORITY IS INFERRED, NOT ASSUMED. A goal marked primary becomes a peak; a
// goal with an explicit priority is mapped from it; everything else arrives as
// a training race, which is the safe default — under-taper is recoverable in a
// way that a season built around the wrong peak is not.
// ----------------------------------------------------------------------------

function goalToPriority(g: any): TargetPriority {
  if (g.is_primary) return "peak";
  const p = String(g.priority ?? "").toLowerCase();
  if (p.includes("a") || p === "1" || p === "high") return "key";
  if (p.includes("b") || p === "2" || p === "medium") return "tune_up";
  return "training";
}

export function AddRacesDialog({
  open,
  onOpenChange,
  athleteId,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  athleteId: string;
  /** Already on the campaign, so they can be shown as added rather than offered twice. */
  existing: CampaignTarget[];
  onAdd: (targets: CampaignTarget[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: goals } = useQuery({
    queryKey: ["campaign-pick-goals", athleteId],
    enabled: open && !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_goals")
        .select("id, title, race_date, target_date, distance_m, is_primary, priority, status")
        .eq("athlete_id", athleteId)
        .order("race_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: schedule } = useQuery({
    queryKey: ["campaign-pick-schedule"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_schedule_entries")
        .select("id, name, event_date, location, race_type")
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const existingDates = useMemo(() => new Set(existing.map((t) => t.raceDate)), [existing]);

  // A goal without a date can't sit on a timeline, so it isn't offered —
  // showing it and then rejecting it would be worse than leaving it out.
  const goalRows = useMemo(
    () =>
      (goals ?? [])
        .map((g) => ({ ...g, date: g.race_date ?? g.target_date }))
        .filter((g) => !!g.date && g.status !== "abandoned"),
    [goals],
  );

  const scheduleRows = useMemo(() => (schedule ?? []).filter((r) => !!r.event_date), [schedule]);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function add() {
    const out: CampaignTarget[] = [];
    for (const g of goalRows) {
      if (!picked.has(`goal:${g.id}`)) continue;
      out.push({
        raceDate: g.date,
        name: g.title ?? "Goal race",
        priority: goalToPriority(g),
        athleteGoalId: g.id,
      } as CampaignTarget);
    }
    for (const r of scheduleRows) {
      if (!picked.has(`entry:${r.id}`)) continue;
      out.push({
        raceDate: r.event_date,
        name: r.name ?? "Race",
        priority: "training",
        raceScheduleEntryId: r.id,
      } as CampaignTarget);
    }
    if (out.length === 0) {
      onOpenChange(false);
      return;
    }
    onAdd(out);
    setPicked(new Set());
    onOpenChange(false);
  }

  const Row = ({
    id,
    date,
    name,
    sub,
    hint,
  }: {
    id: string;
    date: string;
    name: string;
    sub?: string;
    hint?: string;
  }) => {
    const already = existingDates.has(date);
    const on = picked.has(id);
    return (
      <button
        type="button"
        disabled={already}
        onClick={() => toggle(id)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors ${
          already
            ? "opacity-50 cursor-default"
            : on
              ? "border-[var(--accent-red)] bg-[var(--accent-red)]/5"
              : "hover:bg-accent/50"
        }`}
      >
        <span className="w-4 shrink-0">{on && <Check className="h-4 w-4 text-[var(--accent-red)]" />}</span>
        <span className="text-xs tabular-nums w-24 shrink-0">{date}</span>
        <span className="text-sm flex-1 min-w-0 truncate">{name}</span>
        {sub && <span className="text-[11px] text-muted-foreground truncate">{sub}</span>}
        {already ? (
          <Badge variant="secondary" className="text-[10px]">
            already added
          </Badge>
        ) : hint ? (
          <Badge variant="outline" className="text-[10px]">
            {hint}
          </Badge>
        ) : null}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto brand-scrollbar">
        <DialogHeader>
          <DialogTitle>Add races</DialogTitle>
          <DialogDescription>
            From this athlete's goals and the squad race schedule. Picked races stay linked to their source, so the
            campaign knows where the date came from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" /> Goals
            </div>
            {goalRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No dated goals for this athlete. A goal needs a race or target date before it can sit on a timeline.
              </p>
            ) : (
              <div className="space-y-1.5">
                {goalRows.map((g) => (
                  <Row
                    key={g.id}
                    id={`goal:${g.id}`}
                    date={g.date}
                    name={g.title ?? "Goal race"}
                    sub={g.distance_m ? `${Math.round(g.distance_m)}m` : undefined}
                    hint={goalToPriority(g) === "peak" ? "peak" : goalToPriority(g)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" /> Race schedule
            </div>
            {scheduleRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing dated in the race schedule yet.</p>
            ) : (
              <div className="space-y-1.5">
                {scheduleRows.map((r) => (
                  <Row
                    key={r.id}
                    id={`entry:${r.id}`}
                    date={r.event_date}
                    name={r.name ?? "Race"}
                    sub={r.location ?? undefined}
                    hint="training"
                  />
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Everything arrives as a training race unless a goal says otherwise — set the ones that matter to Key or
            Peak afterwards. Under-tapering for a race is recoverable; a season built around the wrong peak is not.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={picked.size === 0}>
            Add {picked.size > 0 ? `${picked.size} race${picked.size === 1 ? "" : "s"}` : "races"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
