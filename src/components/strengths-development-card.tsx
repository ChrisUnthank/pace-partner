import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Compass, RefreshCw } from "lucide-react";

// Phase 4 — Strengths, Limiters & Athlete Profile. Only 4 of the 10
// categories get an auto-derived suggestion (Speed, Speed endurance,
// Aerobic capacity, Aerobic endurance) — all four come straight from the
// existing athlete_physio_profile numbers already shown elsewhere in the
// app (aerobic_pct/anaerobic_pct/speed_reserve_bucket). The remaining 6
// (Threshold, Finishing ability, Recovery, Race execution, Race
// positioning, Pacing consistency) have no robust data-derived signal
// available yet, so they're coach-set only — per spec, "do not use
// arbitrary numerical scores unless the methodology is robust."
//
// Nothing is ever written to the ratings table automatically. A
// suggestion is just computed and displayed client-side; it only becomes
// a real row once a coach clicks "Accept" or picks a value themselves.

type CategoryKey =
  | "speed"
  | "speed_endurance"
  | "aerobic_capacity"
  | "aerobic_endurance"
  | "threshold"
  | "finishing_ability"
  | "recovery"
  | "race_execution"
  | "race_positioning"
  | "pacing_consistency";

const CATEGORIES: { key: CategoryKey; label: string; autoDerivable: boolean }[] = [
  { key: "speed", label: "Speed", autoDerivable: true },
  { key: "speed_endurance", label: "Speed endurance", autoDerivable: true },
  { key: "aerobic_capacity", label: "Aerobic capacity", autoDerivable: true },
  { key: "aerobic_endurance", label: "Aerobic endurance", autoDerivable: true },
  { key: "threshold", label: "Threshold", autoDerivable: false },
  { key: "finishing_ability", label: "Finishing ability", autoDerivable: false },
  { key: "recovery", label: "Recovery", autoDerivable: false },
  { key: "race_execution", label: "Race execution", autoDerivable: false },
  { key: "race_positioning", label: "Race positioning", autoDerivable: false },
  { key: "pacing_consistency", label: "Pacing consistency", autoDerivable: false },
];

type Rating = "relative_strength" | "developing" | "development_opportunity" | "not_assessed";

const RATING_OPTIONS: { value: Rating; label: string }[] = [
  { value: "relative_strength", label: "Relative Strength" },
  { value: "developing", label: "Developing" },
  { value: "development_opportunity", label: "Development Opportunity" },
  { value: "not_assessed", label: "Not assessed" },
];

const RATING_STYLES: Record<Rating, string> = {
  relative_strength: "bg-emerald-100 text-emerald-700 border-emerald-200",
  developing: "bg-amber-100 text-amber-700 border-amber-200",
  development_opportunity: "bg-rose-100 text-rose-700 border-rose-200",
  not_assessed: "bg-slate-100 text-slate-500 border-slate-200",
};

function ratingLabel(r: string) {
  return RATING_OPTIONS.find((o) => o.value === r)?.label ?? r;
}

export function StrengthsDevelopmentCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");

  const { data: physio, isLoading: physioLoading } = useQuery({
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data as any;
    },
  });

  const { data: ratings } = useQuery({
    queryKey: ["strengths-ratings", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_strengths_ratings" as any)
        .select("*")
        .eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const ratingByCategory = new Map((ratings ?? []).map((r) => [r.category, r]));

  // Suggested values for the 4 auto-derivable categories, computed from
  // the same numbers PhysiologyCard already shows on the main athlete
  // page — never a second, disagreeing calculation.
  const suggestions = useMemo(() => {
    const map = new Map<CategoryKey, Rating>();
    if (!physio || physio.status !== "ok") return map;
    const aerobic = Number(physio.aerobic_pct ?? 0);
    const anaerobic = Number(physio.anaerobic_pct ?? 0);
    const srBucket = physio.speed_reserve_bucket as string | null;

    if (srBucket === "High") map.set("speed", "relative_strength");
    else if (srBucket === "Low") map.set("speed", "development_opportunity");
    else if (srBucket === "Moderate") map.set("speed", "developing");

    if (anaerobic >= 40) map.set("speed_endurance", "relative_strength");
    else if (anaerobic >= 25) map.set("speed_endurance", "developing");
    else map.set("speed_endurance", "development_opportunity");

    if (aerobic >= 65) {
      map.set("aerobic_capacity", "relative_strength");
      map.set("aerobic_endurance", "relative_strength");
    } else if (aerobic >= 45) {
      map.set("aerobic_capacity", "developing");
      map.set("aerobic_endurance", "developing");
    } else {
      map.set("aerobic_capacity", "development_opportunity");
      map.set("aerobic_endurance", "development_opportunity");
    }

    return map;
  }, [physio]);

  async function setRating(category: CategoryKey, rating: Rating, source: "auto_suggested" | "coach_set") {
    const { error } = await supabase.from("athlete_strengths_ratings" as any).upsert(
      { athlete_id: athleteId, category, rating, source } as any,
      { onConflict: "athlete_id,category" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["strengths-ratings", athleteId] });
  }

  return (
    <div className="space-y-4">
      <AthletePerformanceTypeCard athleteId={athleteId} physio={physio} isLoading={physioLoading} isCoach={isCoach} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4 text-[var(--accent-red)]" />
            Relative Strengths & Development Opportunities
          </CardTitle>
          <CardDescription>
            Relative to this athlete's own profile, not a fixed score. Speed / Speed endurance / Aerobic capacity /
            Aerobic endurance start with a data-derived suggestion; everything else is coach judgment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {CATEGORIES.map((cat) => {
            const existing = ratingByCategory.get(cat.key);
            const suggestion = cat.autoDerivable ? suggestions.get(cat.key) : undefined;
            const displayRating: Rating = existing?.rating ?? "not_assessed";
            const showSuggestion = !existing && suggestion && cat.autoDerivable;

            return (
              <div key={cat.key} className="flex items-center justify-between gap-3 border-b py-2 last:border-0 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{cat.label}</div>
                  {existing?.note && <div className="text-xs text-muted-foreground mt-0.5">{existing.note}</div>}
                  {existing?.source === "auto_suggested" && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">From physiological profile</div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {showSuggestion && (
                    <>
                      <Badge variant="outline" className={`${RATING_STYLES[suggestion]} text-xs`}>
                        Suggested: {ratingLabel(suggestion)}
                      </Badge>
                      {isCoach && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setRating(cat.key, suggestion, "auto_suggested")}
                        >
                          Accept
                        </Button>
                      )}
                    </>
                  )}

                  {isCoach ? (
                    <Select
                      value={displayRating}
                      onValueChange={(v) => setRating(cat.key, v as Rating, "coach_set")}
                    >
                      <SelectTrigger className={`h-7 w-[190px] text-xs ${RATING_STYLES[displayRating]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RATING_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    !showSuggestion && (
                      <Badge variant="outline" className={RATING_STYLES[displayRating]}>
                        {ratingLabel(displayRating)}
                      </Badge>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function AthletePerformanceTypeCard({
  athleteId,
  physio,
  isLoading,
  isCoach,
}: {
  athleteId: string;
  physio: any;
  isLoading: boolean;
  isCoach: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [overrideLabel, setOverrideLabel] = useState(physio?.archetype_override ?? "");
  const [overrideNote, setOverrideNote] = useState(physio?.archetype_override_note ?? "");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function startEditing() {
    setOverrideLabel(physio?.archetype_override ?? "");
    setOverrideNote(physio?.archetype_override_note ?? "");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("athlete_physio_profile")
      .update({
        archetype_override: overrideLabel.trim() || null,
        archetype_override_note: overrideNote.trim() || null,
      } as any)
      .eq("athlete_id", athleteId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Performance type updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["physio", athleteId] });
  }

  async function clearOverride() {
    setSaving(true);
    const { error } = await supabase
      .from("athlete_physio_profile")
      .update({ archetype_override: null, archetype_override_note: null } as any)
      .eq("athlete_id", athleteId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reverted to auto-computed type");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["physio", athleteId] });
  }

  async function refresh() {
    setRefreshing(true);
    const { error } = await supabase.rpc("recompute_physio_profile", { _athlete_id: athleteId });
    setRefreshing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["physio", athleteId] });
  }

  if (isLoading) return null;

  const insufficient = !physio || physio.status !== "ok";
  const hasOverride = !!physio?.archetype_override;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Athlete Performance Type</CardTitle>
          <CardDescription>
            Dynamic and recalculated as new PBs are logged — never a fixed identity. A coach can pin their own label
            below if they read the data differently.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {refreshing ? "…" : "Recompute"}
          </Button>
          {isCoach && !editing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              {hasOverride ? "Edit override" : "Set override"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insufficient ? (
          <p className="text-sm text-muted-foreground">{physio?.coaching_note ?? "No profile yet — log PBs at two or more distances."}</p>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Auto-computed</div>
            <div className="font-semibold">{physio.archetype}</div>
          </div>
        )}

        {hasOverride && !editing && (
          <div className="rounded-md border border-dashed p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Coach override (shown instead of the above)</div>
            <div className="font-semibold">{physio.archetype_override}</div>
            {physio.archetype_override_note && (
              <p className="text-sm text-muted-foreground mt-1">{physio.archetype_override_note}</p>
            )}
          </div>
        )}

        {editing && (
          <div className="space-y-2 border-t pt-3">
            <div>
              <Label className="text-xs">Override label</Label>
              <Input
                value={overrideLabel}
                onChange={(e) => setOverrideLabel(e.target.value)}
                placeholder="e.g. Aerobic Engine, Moderate Speed Reserve"
              />
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Input
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Why this reading differs from the auto-computed one"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save override"}
              </Button>
              {hasOverride && (
                <Button size="sm" variant="ghost" onClick={clearOverride} disabled={saving}>
                  Clear override
                </Button>
              )}
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
