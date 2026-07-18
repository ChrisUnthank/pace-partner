import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ListTree } from "lucide-react";

// Phase 9 — Event-Specific Tactics. Which field set shows is decided from
// the plan's own race_distance_m/race_type — not a separate setting — so
// it can never drift out of sync with the race itself the way a
// manually-chosen "template" field could.

type FieldDef = { key: string; label: string; positionChips?: boolean };

const FIELDS_800: FieldDef[] = [
  { key: "first_100m", label: "First 100m" },
  { key: "first_200m", label: "First 200m" },
  { key: "split_400m", label: "400m split (target)" },
  { key: "position_400m", label: "Position at 400m", positionChips: true },
  { key: "position_600m", label: "600m position", positionChips: true },
  { key: "final_200m", label: "Final 200m" },
  { key: "kick_strategy", label: "Kick strategy" },
];

const FIELDS_1500: FieldDef[] = [
  { key: "first_300m", label: "First 300m" },
  { key: "first_400m", label: "First 400m" },
  { key: "position_800m", label: "800m position", positionChips: true },
  { key: "position_1200m", label: "1200m position", positionChips: true },
  { key: "bell_lap", label: "Bell lap" },
  { key: "final_300m", label: "Final 300m" },
  { key: "final_200m", label: "Final 200m" },
  { key: "final_100m", label: "Final 100m" },
];

const FIELDS_LONGER: FieldDef[] = [
  { key: "opening_pace", label: "Opening pace" },
  { key: "settling_pace", label: "Settling pace" },
  { key: "negative_split_plan", label: "Negative split plan" },
  { key: "hills", label: "Hills" },
  { key: "wind", label: "Wind" },
  { key: "fuel", label: "Fuel" },
  { key: "hydration", label: "Hydration" },
  { key: "final_km", label: "Final kilometre" },
];

const POSITION_CHIPS = ["Front", "Top 3", "Mid-pack", "Back of lead group", "Avoid getting boxed"];

type EventBucket = "800" | "1500" | "longer" | "none";

// Track-only for the two named short/middle templates; anything on the
// road or cross country, or a track distance the spec doesn't name yet
// (sprints under 600m, 1000m, etc.), either falls back to the generic
// "Longer Events" set (3000m+, or any road/XC distance) or has no
// template yet at all — matching "add additional event types later"
// rather than forcing an irrelevant field set onto an odd distance.
function eventBucket(raceDistanceM: number, raceType: string): EventBucket {
  if (raceType !== "track") return raceDistanceM >= 3000 ? "longer" : "none";
  if (raceDistanceM >= 600 && raceDistanceM <= 999) return "800";
  if (raceDistanceM >= 1200 && raceDistanceM <= 2000) return "1500";
  if (raceDistanceM >= 3000) return "longer";
  return "none";
}

function bucketMeta(bucket: EventBucket): { title: string; fields: FieldDef[] } | null {
  if (bucket === "800") return { title: "800m Tactics", fields: FIELDS_800 };
  if (bucket === "1500") return { title: "1500m Tactics", fields: FIELDS_1500 };
  if (bucket === "longer") return { title: "Longer Event Tactics", fields: FIELDS_LONGER };
  return null;
}

export function EventTacticsCard({
  planId,
  raceDistanceM,
  raceType,
  eventTactics,
  canEdit,
}: {
  planId: string;
  raceDistanceM: number;
  raceType: string;
  eventTactics: Record<string, string> | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const bucket = eventBucket(raceDistanceM, raceType);
  const meta = bucketMeta(bucket);

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(eventTactics ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(eventTactics ?? {});
  }, [eventTactics]);

  if (!meta) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event-Specific Tactics</CardTitle>
          <CardDescription>
            No dedicated tactics template yet for this distance/type — 800m, 1500m, and 3000m+ (or road/XC) events
            have one. The Splits and Strategy above still apply regardless.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function startEditing() {
    setValues(eventTactics ?? {});
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ event_tactics: values as any, updated_at: new Date().toISOString() })
      .eq("id", planId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event tactics updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  const hasAnyValue = meta.fields.some((f) => values[f.key]?.trim());

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTree className="h-4 w-4 text-[var(--accent-red)]" />
            {meta.title}
          </CardTitle>
          <CardDescription>Tactical plan specific to this event, alongside the pace splits above.</CardDescription>
        </div>
        {canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={startEditing}>
            {hasAnyValue ? "Edit" : "Add tactics"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          hasAnyValue ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {meta.fields
                .filter((f) => values[f.key]?.trim())
                .map((f) => (
                  <div key={f.key}>
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <p className="text-sm mt-0.5">{values[f.key]}</p>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No event tactics set yet.</p>
          )
        ) : (
          <div className="space-y-3">
            {meta.fields.map((f) => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                {f.positionChips && (
                  <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
                    {POSITION_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [f.key]: chip }))}
                        className="px-2 py-0.5 text-[11px] rounded border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
                <Textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  rows={2}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
