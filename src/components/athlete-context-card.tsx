import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { secToClock, paceFmt } from "@/lib/format";
import { STRATEGY_OPTIONS, type Strategy } from "@/lib/race-tactics-calc";
import { Lightbulb, User } from "lucide-react";

// Phase 11 — Athlete Profile + Race Tactics Integration.
//
// Deliberately rule-based and fully transparent, not AI (that's Phase
// 12) — every signal that contributes to the suggested strategy is
// listed under "Why", nothing is hidden, and it never applies itself.
// The coach clicks Apply (which just calls the same changeStrategy the
// Strategy card already uses) or ignores it entirely.
//
// Reads from tables already built in earlier phases — no new schema:
// athlete_physio_profile (Phase 4/Zones), athlete_strengths_ratings
// (Phase 4), athlete_race_observations (Phase 6), performances (Phase 2),
// athlete_zone_profiles (existing Zones system).

const RELEVANT_STRENGTH_CATEGORIES = ["finishing_ability", "speed", "pacing_consistency", "race_execution", "race_positioning"];
const STRENGTH_LABELS: Record<string, string> = {
  finishing_ability: "Finishing ability",
  speed: "Speed",
  pacing_consistency: "Pacing consistency",
  race_execution: "Race execution",
  race_positioning: "Race positioning",
};
const RATING_LABELS: Record<string, string> = {
  relative_strength: "Relative Strength",
  developing: "Developing",
  development_opportunity: "Development Opportunity",
};
const RATING_STYLES: Record<string, string> = {
  relative_strength: "bg-emerald-100 text-emerald-700 border-emerald-200",
  developing: "bg-amber-100 text-amber-700 border-amber-200",
  development_opportunity: "bg-rose-100 text-rose-700 border-rose-200",
};

// Only strategies that are ever sensible to proactively recommend —
// Positive Split is a fade, never something the system should suggest
// (a coach can still pick it manually), and Custom isn't a shape at all.
type SuggestableStrategy = Extract<Strategy, "even_pace" | "negative_split" | "fast_start" | "controlled_start">;

type Evidence = { text: string; favors: SuggestableStrategy[] };

export function AthleteContextCard({
  athleteId,
  raceDistanceM,
  goalTimeSeconds,
  currentStrategy,
  canEdit,
  onApplyStrategy,
}: {
  athleteId: string;
  raceDistanceM: number;
  goalTimeSeconds: number;
  currentStrategy: string;
  canEdit: boolean;
  onApplyStrategy: (strategy: Strategy) => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  const { data: physio } = useQuery({
    queryKey: ["physio", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_physio_profile").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data as any;
    },
  });

  const { data: zoneProfile } = useQuery({
    queryKey: ["zone-profile", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_zone_profiles").select("*").eq("athlete_id", athleteId).maybeSingle();
      return data as any;
    },
  });

  const { data: strengths } = useQuery({
    queryKey: ["strengths-ratings", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athlete_strengths_ratings" as any).select("*").eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: raceObservations } = useQuery({
    queryKey: ["race-observations", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_race_observations" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: nearestPb } = useQuery({
    queryKey: ["race-tactics-nearest-pb", athleteId, raceDistanceM],
    enabled: raceDistanceM > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("distance_m, time_seconds, performance_date")
        .eq("athlete_id", athleteId)
        .not("time_seconds", "is", null)
        .order("time_seconds", { ascending: true });
      if (!data || data.length === 0) return null;
      return data.reduce((best, r) => {
        const d = Math.abs(Math.log(Number(r.distance_m) / raceDistanceM));
        const bd = Math.abs(Math.log(Number(best.distance_m) / raceDistanceM));
        return d < bd ? r : best;
      }, data[0]);
    },
  });

  const strengthsByCategory = new Map((strengths ?? []).map((s) => [s.category, s]));

  const { evidence, suggestion } = useMemo(() => {
    const ev: Evidence[] = [];

    for (const cat of RELEVANT_STRENGTH_CATEGORIES) {
      const rating = strengthsByCategory.get(cat)?.rating;
      if (!rating || rating === "not_assessed") continue;
      const label = STRENGTH_LABELS[cat];
      if (cat === "finishing_ability" || cat === "speed") {
        if (rating === "relative_strength") ev.push({ text: `${label} rated a relative strength`, favors: ["negative_split", "controlled_start"] });
        if (rating === "development_opportunity") ev.push({ text: `${label} rated a development opportunity`, favors: ["even_pace"] });
      }
      if (cat === "pacing_consistency" && rating === "development_opportunity") {
        ev.push({ text: `Pacing consistency rated a development opportunity`, favors: ["even_pace"] });
      }
      if (cat === "race_execution" && rating === "development_opportunity") {
        ev.push({ text: `Race execution rated a development opportunity`, favors: ["controlled_start", "even_pace"] });
      }
    }

    if (physio?.status === "ok") {
      if (physio.speed_reserve_bucket === "High") {
        ev.push({ text: "High speed reserve on the physiological profile", favors: ["negative_split", "controlled_start"] });
      } else if (physio.speed_reserve_bucket === "Low") {
        ev.push({ text: "Low speed reserve on the physiological profile — no big kick to hold back for", favors: ["even_pace"] });
      }
    }

    for (const obs of raceObservations ?? []) {
      const t: string = (obs.observation ?? "").toLowerCase();
      if (t.includes("controlled") && (t.includes("start") || t.includes("opening"))) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["controlled_start"] });
      }
      if (t.includes("struggles") && t.includes("aggressive") && t.includes("opening")) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["controlled_start", "even_pace"] });
      }
      if ((t.includes("strong final") || t.includes("strong finish") || t.includes("kick")) && !t.includes("unable")) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["negative_split"] });
      }
      if (t.includes("fades") || t.includes("unable to kick")) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["controlled_start", "even_pace"] });
      }
      if (t.includes("evenly paced")) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["even_pace"] });
      }
      if (t.includes("needs a fast start")) {
        ev.push({ text: `Race observation: "${obs.observation}"`, favors: ["fast_start"] });
      }
    }

    if (nearestPb && goalTimeSeconds > 0) {
      const predictedComparable = Number(nearestPb.time_seconds);
      const gapPct = (predictedComparable - goalTimeSeconds) / predictedComparable;
      if (Number(nearestPb.distance_m) === raceDistanceM && gapPct > 0.01) {
        ev.push({
          text: `Goal time is faster than this athlete's current PB at this exact distance by ${(gapPct * 100).toFixed(1)}%`,
          favors: ["controlled_start", "even_pace"],
        });
      }
    }

    const scores: Partial<Record<SuggestableStrategy, number>> = {};
    const reasonsByStrategy: Partial<Record<SuggestableStrategy, string[]>> = {};
    for (const e of ev) {
      for (const s of e.favors) {
        scores[s] = (scores[s] ?? 0) + 1;
        (reasonsByStrategy[s] ??= []).push(e.text);
      }
    }
    const entries = Object.entries(scores) as [SuggestableStrategy, number][];
    if (entries.length === 0) return { evidence: ev, suggestion: null };
    entries.sort((a, b) => b[1] - a[1]);
    const [topStrategy] = entries[0];
    return { evidence: ev, suggestion: { strategy: topStrategy, reasons: reasonsByStrategy[topStrategy] ?? [] } };
  }, [physio, strengths, raceObservations, nearestPb, raceDistanceM, goalTimeSeconds]);

  const assessedStrengths = RELEVANT_STRENGTH_CATEGORIES.map((cat) => strengthsByCategory.get(cat)).filter(
    (s) => s && s.rating !== "not_assessed",
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-[var(--accent-red)]" />
              From this athlete's profile
            </CardTitle>
            <CardDescription>Pulled live from Performance Profile — not copied, always current.</CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/athletes/$athleteId/performance-profile" params={{ athleteId }}>
              View full profile
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Nearest logged PB</div>
              <div className="font-semibold tabular-nums">
                {nearestPb ? `${secToClock(nearestPb.time_seconds)} (${nearestPb.distance_m}m)` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Threshold pace</div>
              <div className="font-semibold tabular-nums">
                {zoneProfile?.pace_threshold_sec_per_km ? paceFmt(zoneProfile.pace_threshold_sec_per_km) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Performance type</div>
              <div className="font-semibold">{physio?.archetype_override ?? physio?.archetype ?? "—"}</div>
            </div>
          </div>

          {assessedStrengths.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Relevant strengths & development areas</div>
              <div className="flex flex-wrap gap-1.5">
                {assessedStrengths.map((s: any) => (
                  <Badge key={s.category} variant="outline" className={RATING_STYLES[s.rating]}>
                    {STRENGTH_LABELS[s.category]}: {RATING_LABELS[s.rating]}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {(raceObservations ?? []).length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Recent race observations</div>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {(raceObservations ?? []).slice(0, 4).map((o: any) => (
                  <li key={o.id} className="text-muted-foreground">
                    <span className="text-foreground">{o.observation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!nearestPb && assessedStrengths.length === 0 && (raceObservations ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing on this athlete's profile yet — log a PB, rate some Strengths, or add a Race Profile observation
              to start getting context and suggestions here.
            </p>
          )}
        </CardContent>
      </Card>

      {!dismissed && suggestion && suggestion.strategy !== currentStrategy && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Suggested strategy: {STRATEGY_OPTIONS.find((o) => o.value === suggestion.strategy)?.label}
            </CardTitle>
            <CardDescription>A suggestion, not a decision — review the reasons and apply only if they hold up.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Why</div>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {suggestion.reasons.map((r, i) => (
                  <li key={i} className="text-muted-foreground">
                    <span className="text-foreground">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApplyStrategy(suggestion.strategy)}>
                  Apply this strategy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                  Dismiss
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
