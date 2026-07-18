import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Flag, Plus, Trash2, User, UserCog, Database, Sparkles } from "lucide-react";

// Phase 6 — Race Profile. Only Coach and Athlete observations are
// writable right now — Data-derived (real race splits) and AI Suggestion
// (Phase 12) are supported in the schema/UI but have nothing to
// populate them yet, so they simply won't appear until those systems
// exist. See 20260718000004_race_profile_phase6.sql.

const QUICK_PHRASES = [
  "Strong final 200m",
  "Strong final 300m",
  "Good at changing pace",
  "Performs well from the front",
  "Performs well in tactical races",
  "Vulnerable when boxed in",
  "Strong in evenly paced races",
  "Struggles with aggressive opening pace",
];

type SourceType = "coach" | "athlete" | "data_derived" | "ai_suggestion";

const SOURCE_META: Record<SourceType, { label: string; style: string; icon: typeof User }> = {
  coach: { label: "Coach Observation", style: "bg-sky-100 text-sky-700 border-sky-200", icon: UserCog },
  athlete: { label: "Athlete Observation", style: "bg-violet-100 text-violet-700 border-violet-200", icon: User },
  data_derived: { label: "Data-derived", style: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Database },
  ai_suggestion: { label: "AI Suggestion", style: "bg-amber-100 text-amber-700 border-amber-200", icon: Sparkles },
};

type ObsRow = {
  id: string;
  observation: string;
  source_type: SourceType;
  performance_id: string | null;
  created_by: string | null;
  created_at: string;
};

export function RaceProfileCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const isSelf = myAthlete?.id === athleteId;
  const canAdd = isCoach || isSelf;
  const [showForm, setShowForm] = useState(false);

  const { data: observations, isLoading } = useQuery({
    queryKey: ["race-observations", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_race_observations" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ObsRow[];
    },
  });

  const { data: races } = useQuery({
    queryKey: ["races-for-observation-link", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, event_name, performance_date, distance_m")
        .eq("athlete_id", athleteId)
        .order("performance_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const raceById = new Map((races ?? []).map((r) => [r.id, r]));

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["race-observations", athleteId] });
  }

  async function removeObservation(id: string) {
    const { error } = await supabase.from("athlete_race_observations" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidate();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flag className="h-4 w-4 text-[var(--accent-red)]" />
              Race Profile
            </CardTitle>
            <CardDescription>
              Tactical observations that will inform the Race Tactics Planner. Every entry is tagged by where it came
              from — coach, athlete, data, or AI — never blended together.
            </CardDescription>
          </div>
          {canAdd && !showForm && (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add observation
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <AddObservationForm
              athleteId={athleteId}
              isCoach={isCoach}
              races={races ?? []}
              onSaved={() => {
                setShowForm(false);
                invalidate();
              }}
              onCancel={() => setShowForm(false)}
            />
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (observations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No observations yet.{canAdd ? " Use \u201CAdd observation\u201D, or start from a common pattern below." : ""}
            </p>
          ) : (
            <div className="space-y-2">
              {(observations ?? []).map((obs) => {
                const meta = SOURCE_META[obs.source_type] ?? SOURCE_META.coach;
                const Icon = meta.icon;
                const race = obs.performance_id ? raceById.get(obs.performance_id) : null;
                const canRemove = isCoach || obs.created_by != null;
                return (
                  <div key={obs.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={meta.style}>
                          <Icon className="h-3 w-3 mr-1" />
                          {meta.label}
                        </Badge>
                        {race && (
                          <span className="text-xs text-muted-foreground">
                            {race.event_name ?? `${race.distance_m}m`} · {race.performance_date}
                          </span>
                        )}
                      </div>
                      {canAdd && canRemove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 shrink-0"
                          onClick={() => removeObservation(obs.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed mt-2">{obs.observation}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{obs.created_at?.slice(0, 10)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AddObservationForm({
  athleteId,
  isCoach,
  races,
  onSaved,
  onCancel,
}: {
  athleteId: string;
  isCoach: boolean;
  races: Array<{ id: string; event_name: string | null; performance_date: string; distance_m: number }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  // A non-coach adding their own observation can only ever be tagged
  // 'athlete' — enforced again here in the DB via RLS's WITH CHECK, this
  // is just the UI reflecting that same constraint rather than offering a
  // choice that would just get rejected on save.
  const [sourceType, setSourceType] = useState<SourceType>(isCoach ? "coach" : "athlete");
  const [text, setText] = useState("");
  const [performanceId, setPerformanceId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) {
      toast.error("Enter an observation");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("athlete_race_observations" as any).insert({
      athlete_id: athleteId,
      observation: text.trim(),
      source_type: sourceType,
      performance_id: performanceId === "none" ? null : performanceId,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Observation added");
    setText("");
    onSaved();
  }

  return (
    <div className="rounded-md border p-3 space-y-3 bg-card/40">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => setText(phrase)}
            className="px-2.5 py-1 text-xs rounded-md border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            {phrase}
          </button>
        ))}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe the tactical pattern — click a phrase above to start, then edit as needed."
        rows={2}
      />

      <div className="grid sm:grid-cols-2 gap-3">
        {isCoach && (
          <div>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="coach">Coach Observation</SelectItem>
                <SelectItem value="athlete">Athlete Observation (on their behalf)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Select value={performanceId} onValueChange={setPerformanceId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Link to a race (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not tied to a specific race</SelectItem>
              {races.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {(r.event_name ?? `${r.distance_m}m`) + " · " + r.performance_date}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save observation"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
