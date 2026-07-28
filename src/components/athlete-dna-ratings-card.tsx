import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

// Phase 1 of the Athlete DNA redesign — 10 rating categories total, split
// deliberately: 5 are scored from real data (Endurance, Speed, Aerobic
// Capacity, Anaerobic Capacity, Consistency), 5 show "Insufficient data"
// on purpose rather than a fabricated number (Running Economy, Durability,
// Race Intelligence, Tactical Awareness, Mechanical Efficiency) — none of
// those have a real data source in the app yet. See
// migration_athlete_dna_ratings.sql for the scoring formulas.

const BUCKET_STYLES: Record<string, string> = {
  Low: "bg-rose-100 text-rose-700 border-rose-200",
  Developing: "bg-amber-100 text-amber-700 border-amber-200",
  Good: "bg-sky-100 text-sky-700 border-sky-200",
  Excellent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Elite: "bg-violet-100 text-violet-700 border-violet-200",
};

interface ScoredCategory {
  key: string;
  label: string;
  score: number | null;
  bucket: string | null;
}

interface PendingCategory {
  key: string;
  label: string;
}

const PENDING_CATEGORIES: PendingCategory[] = [
  { key: "running_economy", label: "Running Economy" },
  { key: "durability", label: "Durability" },
  { key: "race_intelligence", label: "Race Intelligence" },
  { key: "tactical_awareness", label: "Tactical Awareness" },
  { key: "mechanical_efficiency", label: "Mechanical Efficiency" },
];

export function AthleteDnaRatingsCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: dna, isLoading } = useQuery({
    queryKey: ["dna-ratings", athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("athlete_dna_ratings" as any)
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return data as any;
    },
  });

  const scoredCategories: ScoredCategory[] = useMemo(
    () => [
      { key: "endurance", label: "Endurance", score: dna?.endurance_score ?? null, bucket: dna?.endurance_bucket ?? null },
      { key: "speed", label: "Speed", score: dna?.speed_score ?? null, bucket: dna?.speed_bucket ?? null },
      {
        key: "aerobic_capacity",
        label: "Aerobic Capacity",
        score: dna?.aerobic_capacity_score ?? null,
        bucket: dna?.aerobic_capacity_bucket ?? null,
      },
      {
        key: "anaerobic_capacity",
        label: "Anaerobic Capacity",
        score: dna?.anaerobic_capacity_score ?? null,
        bucket: dna?.anaerobic_capacity_bucket ?? null,
      },
      {
        key: "consistency",
        label: "Consistency",
        score: dna?.consistency_score ?? null,
        bucket: dna?.consistency_bucket ?? null,
      },
    ],
    [dna],
  );

  const radarData = scoredCategories.map((c) => ({
    category: c.label,
    score: c.score ?? 0,
  }));

  const hasAnyScore = scoredCategories.some((c) => c.score != null);

  async function refresh() {
    setRefreshing(true);
    const { error } = await supabase.rpc("recompute_athlete_dna" as any, { _athlete_id: athleteId });
    setRefreshing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Athlete DNA recomputed");
    qc.invalidateQueries({ queryKey: ["dna-ratings", athleteId] });
  }

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-[var(--accent-red)]" />
            Athlete DNA Ratings
          </CardTitle>
          <CardDescription>
            5 categories scored from logged data below. The other 5 show as "Insufficient data" until the app has a
            real source for them — never a guessed number.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw className="h-4 w-4 mr-1" />
          {refreshing ? "…" : "Recompute"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {!dna || dna.status !== "ok" ? (
          <p className="text-sm text-muted-foreground">
            Log PBs at two or more distances (ideally 1500m and 5000m) to generate Athlete DNA ratings.
          </p>
        ) : (
          <>
            {hasAnyScore && (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="75%">
                    <PolarGrid />
                    <PolarAngleAxis dataKey="category" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      name="Score"
                      dataKey="score"
                      stroke="var(--accent-red)"
                      fill="var(--accent-red)"
                      fillOpacity={0.35}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {scoredCategories.map((c) => (
                <div key={c.key} className="border rounded-lg p-3 text-center space-y-1">
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                  {c.score != null ? (
                    <>
                      <div className="text-2xl font-bold tabular-nums">{Math.round(c.score)}</div>
                      <Badge variant="outline" className={BUCKET_STYLES[c.bucket ?? ""] ?? ""}>
                        {c.bucket}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-muted-foreground">—</div>
                      <Badge variant="outline" className="text-muted-foreground">
                        Not enough data
                      </Badge>
                    </>
                  )}
                </div>
              ))}

              {PENDING_CATEGORIES.map((c) => (
                <div key={c.key} className="border rounded-lg p-3 text-center space-y-1 opacity-60">
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
                  <Badge variant="outline" className="text-muted-foreground">
                    Insufficient data
                  </Badge>
                </div>
              ))}
            </div>

            {dna.consistency_sessions_planned != null && (
              <p className="text-xs text-muted-foreground">
                Consistency based on {dna.consistency_sessions_completed} of {dna.consistency_sessions_planned}{" "}
                training sessions completed over the last 8 weeks.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
