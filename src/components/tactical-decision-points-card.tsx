import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { GitBranch, Plus, Trash2 } from "lucide-react";

// Phase 10 — Tactical Decision Points. distance_m is always distance
// FROM THE START (consistent with splits/race_distance_m elsewhere in
// this feature) — the "X to go" framing coaches often think in ("move
// with 600m to go") is shown as a computed convenience, not a second
// stored value that could drift from distance_m.

type DecisionPoint = {
  id: string;
  distance_m: number;
  trigger_text: string;
  action_text: string;
  notes: string | null;
  created_by: string | null;
};

export function TacticalDecisionPointsCard({
  planId,
  raceDistanceM,
  canEdit,
}: {
  planId: string;
  raceDistanceM: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: points, isLoading } = useQuery({
    queryKey: ["decision-points", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_tactics_decision_points" as any)
        .select("*")
        .eq("plan_id", planId)
        .order("distance_m", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DecisionPoint[];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["decision-points", planId] });
  }

  async function removePoint(id: string) {
    const { error } = await supabase.from("race_tactics_decision_points" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidate();
  }

  const sorted = points ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-[var(--accent-red)]" />
            Tactical Decision Points
          </CardTitle>
          <CardDescription>If/then triggers for during the race — where, what to watch for, what to do.</CardDescription>
        </div>
        {canEdit && !showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add decision point
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <AddDecisionPointForm
            planId={planId}
            raceDistanceM={raceDistanceM}
            onSaved={() => {
              setShowForm(false);
              invalidate();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decision points yet.{canEdit ? " e.g. \u201CMove with 600m to go if position is worse than 5th.\u201D" : ""}
          </p>
        ) : (
          <>
            <RaceTimeline points={sorted} raceDistanceM={raceDistanceM} />
            <div className="space-y-2">
              {sorted.map((p) => {
                const toGo = raceDistanceM - p.distance_m;
                return (
                  <div key={p.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium tabular-nums">
                        {p.distance_m}m{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({toGo > 0 ? `${toGo}m to go` : "finish"})
                        </span>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => removePoint(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="text-sm mt-1.5">
                      <span className="text-muted-foreground">If: </span>
                      {p.trigger_text}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Then: </span>
                      {p.action_text}
                    </div>
                    {p.notes && <p className="text-xs text-muted-foreground mt-1">{p.notes}</p>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RaceTimeline({ points, raceDistanceM }: { points: DecisionPoint[]; raceDistanceM: number }) {
  return (
    <div className="pt-2 pb-8 px-1">
      <div className="relative h-1.5 rounded-full bg-muted">
        {points.map((p) => {
          const pct = Math.min(100, Math.max(0, (p.distance_m / raceDistanceM) * 100));
          return (
            <div
              key={p.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
              style={{ left: `${pct}%` }}
            >
              <div className="w-3 h-3 rounded-full bg-[var(--accent-red)] border-2 border-background shadow" />
              <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                {p.distance_m}m
              </div>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover border rounded px-2 py-1 text-[11px] whitespace-nowrap shadow-lg z-10 max-w-[220px] whitespace-normal">
                <span className="text-muted-foreground">If </span>
                {p.trigger_text}
                <span className="text-muted-foreground"> → </span>
                {p.action_text}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Start</span>
        <span>Finish ({raceDistanceM}m)</span>
      </div>
    </div>
  );
}

function AddDecisionPointForm({
  planId,
  raceDistanceM,
  onSaved,
  onCancel,
}: {
  planId: string;
  raceDistanceM: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [distance, setDistance] = useState("");
  const [trigger, setTrigger] = useState("");
  const [action, setAction] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const distanceNum = Number(distance);
  const toGo = distance && Number.isFinite(distanceNum) ? raceDistanceM - distanceNum : null;

  async function save() {
    if (!distance || !Number.isFinite(distanceNum) || distanceNum < 0 || distanceNum > raceDistanceM) {
      toast.error(`Enter a distance between 0 and ${raceDistanceM}m`);
      return;
    }
    if (!trigger.trim() || !action.trim()) {
      toast.error("Enter both a trigger and a planned action");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("race_tactics_decision_points" as any).insert({
      plan_id: planId,
      distance_m: Math.round(distanceNum),
      trigger_text: trigger.trim(),
      action_text: action.trim(),
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Decision point added");
    onSaved();
  }

  return (
    <div className="rounded-md border p-3 space-y-3 bg-card/40">
      <div>
        <Label className="text-xs">Distance (meters from start)</Label>
        <Input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder={`0–${raceDistanceM}`} />
        {toGo != null && toGo >= 0 && <p className="text-xs text-muted-foreground mt-1">= {toGo}m to go</p>}
      </div>
      <div>
        <Label className="text-xs">Trigger (the "if")</Label>
        <Textarea value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="e.g. position is worse than 5th" rows={2} />
      </div>
      <div>
        <Label className="text-xs">Planned action (the "then")</Label>
        <Textarea value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. move up on the outside" rows={2} />
      </div>
      <div>
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save decision point"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
