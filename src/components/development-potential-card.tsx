import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Target, Compass } from "lucide-react";
import { secToClock } from "@/lib/format";
import { predictTimeWithExponent, personalizedExponent, RIEGEL_EXPONENT } from "@/lib/race-predict";

// Development Priorities — ranked directly off the 5 scored Athlete DNA
// categories (lowest score = biggest opportunity), reusing whatever
// recompute_athlete_dna() already computed rather than a second scoring
// pass. No new table.
//
// Performance Potential — "Predicted PB" reuses the same Riegel math as
// app.compare.tsx (src/lib/race-predict.ts), calibrated to a real logged
// race pair when there's a wide enough distance spread to solve a
// personalized exponent, generic 1.06 otherwise — same rule that file
// already uses.
//
// "Potential Range" is the deliberately caveated piece: framed as a
// 12-24 month projection (never "ceiling" — that implies a lifetime
// maximum, which isn't a claim this data can support), always a range
// with a wide floor/ceiling rather than a single number, and the
// headroom % driving that range comes from the same age/training-age
// buckets already used for age_shift/ta_shift in recompute_physio_profile
// — younger and less-trained athletes get a wider band, more mature/
// highly-trained athletes get a narrower one. Visible to both coach and
// athlete per Chris's call — framed carefully so it reads as a rough
// planning range, not a promise.

const CATEGORY_META: Record<string, { label: string; guidance: string; baseConfidence: number }> = {
  endurance: {
    label: "Endurance",
    guidance: "Extend sustainable pace at and below threshold — a weekly long-run progression is the highest-leverage lever here.",
    baseConfidence: 85,
  },
  speed: {
    label: "Speed",
    guidance: "Add short hill sprints or strides 1-2x/week to lift top-end speed without heavy anaerobic cost.",
    baseConfidence: 80,
  },
  aerobic_capacity: {
    label: "Aerobic Capacity",
    guidance: "Build aerobic capacity with tempo and VO2-adjacent work; protect easy days so hard days can be hard.",
    baseConfidence: 65,
  },
  anaerobic_capacity: {
    label: "Anaerobic Capacity",
    guidance: "Structured VO2/rep work in blocks building toward key races — not a year-round stimulus.",
    baseConfidence: 85,
  },
  consistency: {
    label: "Consistency",
    guidance: "Increase week-to-week session completion rate before adding volume or intensity on top.",
    baseConfidence: 60,
  },
};

function bucketFromScore(score: number): "Low" | "Developing" | "Good" | "Excellent" | "Elite" {
  if (score < 20) return "Low";
  if (score < 40) return "Developing";
  if (score < 65) return "Good";
  if (score < 85) return "Excellent";
  return "Elite";
}

const PRIORITY_SHAPE: Record<string, { stars: number; weeks: number }> = {
  Low: { stars: 5, weeks: 18 },
  Developing: { stars: 4, weeks: 14 },
  Good: { stars: 3, weeks: 10 },
};

// Same reference distances as the Pace/Race Predictor calculator and
// session comparison tool — Riegel isn't valid down at sprint distances
// (near-maximal aerobic effort only), so nothing under 800m here.
const POTENTIAL_DISTANCES: Array<{ label: string; m: number }> = [
  { label: "800m", m: 800 },
  { label: "1500m", m: 1500 },
  { label: "3000m", m: 3000 },
  { label: "5000m", m: 5000 },
  { label: "10K", m: 10000 },
  { label: "Half Marathon", m: 21097 },
  { label: "Marathon", m: 42195 },
];

type PerfRow = {
  distance_m: number;
  time_seconds: number;
  context: string | null;
  performance_date: string;
};

// Same age/training-age buckets already used for age_shift/ta_shift in
// recompute_physio_profile — repurposed here as expected physiological
// headroom rather than an anaerobic-ratio correction. Capped 2-35%: no
// athlete gets told they'll run twice as fast, and there's always at
// least a little room acknowledged even for a mature, long-trained athlete.
function developmentHeadroomPct(ageYears: number | null, trainingAgeYears: number | null): number {
  const ageComponent =
    ageYears == null
      ? 6
      : ageYears < 16
        ? 22
        : ageYears < 20
          ? 16
          : ageYears < 24
            ? 10
            : ageYears < 30
              ? 6
              : ageYears < 40
                ? 3
                : 1;
  const taComponent =
    trainingAgeYears == null
      ? 4
      : trainingAgeYears < 1
        ? 13
        : trainingAgeYears < 3
          ? 8
          : trainingAgeYears < 6
            ? 4
            : trainingAgeYears < 10
              ? 2
              : 0;
  return Math.min(35, Math.max(2, ageComponent + taComponent));
}

export function DevelopmentPotentialCard({ athleteId }: { athleteId: string }) {
  const { data: athlete } = useQuery({
    queryKey: ["athlete", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("athletes").select("*").eq("id", athleteId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: dna } = useQuery({
    queryKey: ["dna-ratings", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athlete_dna_ratings" as any).select("*").eq("athlete_id", athleteId).maybeSingle();
      return data as any;
    },
  });

  // Same query key performance-curve-card.tsx uses — dedupes the fetch
  // when both cards are on screen together.
  const { data: performances } = useQuery({
    queryKey: ["performances-for-curve", athleteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, performance_date, distance_m, time_seconds, event_name, race_type, context")
        .eq("athlete_id", athleteId)
        .order("distance_m", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PerfRow[];
    },
  });

  const ageYears = useMemo(() => {
    if (!athlete?.dob) return null;
    return (Date.now() - new Date(athlete.dob).getTime()) / (365.25 * 86400000);
  }, [athlete?.dob]);

  const trainingAgeYears: number | null = athlete?.training_age_years ?? null;

  // ---- Development Priorities ----
  const priorities = useMemo(() => {
    if (!dna || dna.status !== "ok") return [];
    const scored: Array<{ key: string; score: number }> = [];
    for (const key of ["endurance", "speed", "aerobic_capacity", "anaerobic_capacity", "consistency"]) {
      const score = dna[`${key}_score`];
      if (score != null) scored.push({ key, score: Number(score) });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 3).map((s) => {
      const bucket = bucketFromScore(s.score);
      const shape = PRIORITY_SHAPE[bucket] ?? { stars: 3, weeks: 10 };
      const meta = CATEGORY_META[s.key];
      let confidence = meta.baseConfidence;
      if (s.key === "consistency") {
        confidence = (dna.consistency_sessions_planned ?? 0) >= 8 ? 80 : 60;
      }
      return { key: s.key, label: meta.label, guidance: meta.guidance, bucket, ...shape, confidence };
    });
  }, [dna]);

  // ---- Performance Potential ----
  const potentialRows = useMemo(() => {
    const rows = (performances ?? []).filter((p) => p.time_seconds > 0 && p.distance_m > 0);
    if (rows.length === 0) return [];

    // Best time per distance, for both "current PB" lookup and as
    // candidate source points to predict from.
    const bestByDistance = new Map<number, PerfRow>();
    for (const p of rows) {
      const existing = bestByDistance.get(p.distance_m);
      if (!existing || p.time_seconds < existing.time_seconds) bestByDistance.set(p.distance_m, p);
    }
    const sourcePoints = Array.from(bestByDistance.values());

    // Calibrate a personalized exponent from the two race-context PBs with
    // the widest distance spread, same rule app.compare.tsx uses — a
    // narrow spread (near-equal distances) can't reliably solve for a
    // meaningful exponent, so it falls back to the generic 1.06 instead.
    const races = rows.filter((p) => p.context === "race");
    let exponent = RIEGEL_EXPONENT;
    let calibrated = false;
    if (races.length >= 2) {
      const sorted = [...races].sort((a, b) => a.distance_m - b.distance_m);
      const shortest = sorted[0];
      const longest = sorted[sorted.length - 1];
      if (longest.distance_m / shortest.distance_m >= 1.3) {
        const k = personalizedExponent(shortest.time_seconds, shortest.distance_m, longest.time_seconds, longest.distance_m);
        if (k != null) {
          exponent = k;
          calibrated = true;
        }
      }
    }

    const headroomPct = developmentHeadroomPct(ageYears, trainingAgeYears);

    return POTENTIAL_DISTANCES.map((target) => {
      if (sourcePoints.length === 0) return null;
      // Nearest logged PB in log-distance space — predicting a marathon
      // off an 800m PB (or vice versa) is a much weaker extrapolation
      // than predicting off something closer, so prefer the closest one.
      const source = sourcePoints.reduce((best, p) =>
        Math.abs(Math.log(p.distance_m) - Math.log(target.m)) < Math.abs(Math.log(best.distance_m) - Math.log(target.m))
          ? p
          : best,
      );
      const predicted = predictTimeWithExponent(source.time_seconds, source.distance_m, target.m, exponent);
      const lower = predicted * (1 - headroomPct / 2 / 100);
      const upper = predicted * (1 - headroomPct / 100);
      const currentPb = bestByDistance.get(target.m)?.time_seconds ?? null;

      let confidence: "High" | "Moderate" | "Low" = "Low";
      if (calibrated && ageYears != null && trainingAgeYears != null) confidence = "High";
      else if (calibrated || (ageYears != null && trainingAgeYears != null)) confidence = "Moderate";

      return { label: target.label, currentPb, predicted, lower, upper, calibrated, confidence };
    }).filter((r): r is NonNullable<typeof r> => r != null);
  }, [performances, ageYears, trainingAgeYears]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4 text-[var(--accent-red)]" />
            Development Priorities
          </CardTitle>
          <CardDescription>
            The lowest-scoring Athlete DNA categories, ranked — recalculates automatically as ratings change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {priorities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Needs Athlete DNA ratings first — log PBs at two or more distances to generate them.
            </p>
          ) : (
            <div className="space-y-3">
              {priorities.map((p) => (
                <div key={p.key} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-medium text-sm">{p.label}</div>
                      <p className="text-sm text-muted-foreground mt-0.5">{p.guidance}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${i < p.stars ? "fill-[var(--accent-red)] text-[var(--accent-red)]" : "text-muted-foreground/30"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span>~{p.weeks} weeks</span>
                    <span>·</span>
                    <span>{p.confidence}% confidence</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-[var(--accent-red)]" />
            Performance Potential
          </CardTitle>
          <CardDescription>
            Predicted PB is today's projection from the current curve. Potential Range assumes continued, consistent
            training over the next 12-24 months — a planning range, not a guarantee and not a lifetime ceiling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {potentialRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Log at least one performance to generate projections.</p>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 text-[10px] uppercase tracking-wide text-muted-foreground px-2">
                <div>Distance</div>
                <div>Current PB</div>
                <div>Predicted PB</div>
                <div>Potential range (12-24mo)</div>
                <div>Confidence</div>
              </div>
              {potentialRows.map((r) => (
                <div
                  key={r.label}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center border rounded-md px-2 py-2 text-sm"
                >
                  <div className="font-medium">{r.label}</div>
                  <div className="tabular-nums text-right">{r.currentPb != null ? secToClock(r.currentPb) : "—"}</div>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="tabular-nums">{secToClock(r.predicted)}</span>
                    <Badge variant={r.calibrated ? "default" : "outline"} className="text-[9px] shrink-0">
                      {r.calibrated ? "Calibrated" : "Generic"}
                    </Badge>
                  </div>
                  <div className="tabular-nums text-right whitespace-nowrap">
                    {secToClock(r.upper)}–{secToClock(r.lower)}
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-[10px]">
                      {r.confidence}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
