import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge } from "lucide-react";

// Reads the five score columns on get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000009_biomechanics_relative_scoring.sql,
// 20260801000010_biomechanics_filters.sql) — MEI, Rhythm Score,
// Biomechanical Score, Biomechanical Fatigue, and Overall Economy
// Rating. Originally absolute fixed-scale (Garmin bands); rebuilt in
// Phase B to score against each session's workout-type expected range
// (mechanics_workout_templates) blended with this athlete's own recent
// history for that same workout type — a deliberate pivot away from the
// absolute approach, not relative-to-athlete like DNA/Strengths
// elsewhere in the app used to mean something different than this.
// Biomechanical Fatigue is deliberately a SEPARATE score from
// session_fatigue.efficiency_score (already surfaced elsewhere as "Best
// efficiency score") — a biomechanics-specific fatigue read (GCT/VO/
// cadence drift), not a replacement for the existing pace/HR one.
//
// Shows the most recent qualifying session's scores plus the delta
// against the previous one — a single trend arrow's worth of context,
// not a full trend chart (that's what the mini trend charts below
// already do for the raw inputs these scores are built from).

type ScoreRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  workout_type: string | null;
  mei_score: number | null;
  rhythm_score: number | null;
  biomechanical_score: number | null;
  biomechanical_fatigue_score: number | null;
  overall_economy_score: number | null;
};

type Band = { label: string; className: string };

function bandFor(score: number | null): Band | null {
  if (score == null) return null;
  if (score >= 85) return { label: "Excellent", className: "text-emerald-600" };
  if (score >= 70) return { label: "Good", className: "text-sky-600" };
  if (score >= 50) return { label: "Fair", className: "text-amber-600" };
  return { label: "Needs work", className: "text-rose-600" };
}

function ScoreTile({
  label,
  score,
  delta,
  caveat,
}: {
  label: string;
  score: number | null;
  delta: number | null;
  caveat?: string;
}) {
  const band = bandFor(score);
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      {score == null ? (
        <div className="text-sm text-muted-foreground mt-2">Not enough data yet</div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-display text-3xl font-extrabold tabular-nums">{Math.round(score)}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div className={`text-xs font-medium ${band?.className}`}>{band?.label}</div>
          {delta != null && Math.abs(delta) >= 1 && (
            <div className={`text-xs mt-1 ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} vs. previous session
            </div>
          )}
        </>
      )}
      {caveat && <div className="text-[10px] text-muted-foreground mt-2 leading-snug">{caveat}</div>}
    </div>
  );
}

function HeadlineScore({ score, delta }: { score: number | null; delta: number | null }) {
  const band = bandFor(score);
  if (score == null) {
    return (
      <div className="rounded-lg border bg-accent/30 p-5 text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Economy Rating</div>
        <div className="text-sm text-muted-foreground mt-2">
          Needs MEI, Biomechanical Score, and Biomechanical Fatigue all available for the same session
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-accent/30 p-5 text-center">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Economy Rating</div>
      <div className="font-display text-5xl font-extrabold tabular-nums mt-1">{Math.round(score)}</div>
      <div className={`text-sm font-medium ${band?.className}`}>{band?.label}</div>
      {delta != null && Math.abs(delta) >= 1 && (
        <div className={`text-xs mt-1 ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} vs. previous session
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-2">Average of MEI, Biomechanical Score, and Biomechanical Fatigue.</div>
    </div>
  );
}

export function BiomechanicsScoresCard({ athleteId }: { athleteId: string }) {
  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-biomechanics-scores", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
  });

  // Rows arrive newest-first.
  const latest = (rows ?? [])[0];
  const previous = (rows ?? [])[1];

  const hasAny = !!latest;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-[var(--accent-red)]" />
          Efficiency Scores
        </CardTitle>
        <CardDescription>
          Scored against expected ranges for this workout type, blended with this athlete's own recent history — most
          recent session with device data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load efficiency scores — {(error as any)?.message ?? "unknown error"}. If this mentions the
            function not existing, the <code className="text-xs">get_athlete_biomechanics_trend</code> migration
            hasn't been re-run in Supabase yet.
          </p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">No completed running sessions with device data yet.</p>
        ) : (
          <div className="space-y-4">
            <HeadlineScore
              score={latest.overall_economy_score}
              delta={previous ? (latest.overall_economy_score ?? 0) - (previous.overall_economy_score ?? 0) : null}
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ScoreTile
                label="Mechanical Efficiency (MEI)"
                score={latest.mei_score}
                delta={previous ? (latest.mei_score ?? 0) - (previous.mei_score ?? 0) : null}
                caveat="Stride length relative to ground contact time and vertical oscillation."
              />
              <ScoreTile
                label="Rhythm Score"
                score={latest.rhythm_score}
                delta={previous ? (latest.rhythm_score ?? 0) - (previous.rhythm_score ?? 0) : null}
                caveat="Cadence consistency. Only scored for continuous-effort sessions — interval sessions naturally vary cadence by design."
              />
              <ScoreTile
                label="Biomechanical Score"
                score={latest.biomechanical_score}
                delta={previous ? (latest.biomechanical_score ?? 0) - (previous.biomechanical_score ?? 0) : null}
                caveat="30% ground contact, 30% vertical oscillation, 20% stride length, 20% cadence."
              />
              <ScoreTile
                label="Biomechanical Fatigue"
                score={latest.biomechanical_fatigue_score}
                delta={
                  previous ? (latest.biomechanical_fatigue_score ?? 0) - (previous.biomechanical_fatigue_score ?? 0) : null
                }
                caveat="First-half vs. second-half GCT/VO/cadence drift. Continuous-effort sessions only — a separate read from the existing pace/HR-based efficiency score."
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
