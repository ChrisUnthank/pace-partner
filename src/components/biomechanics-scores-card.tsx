import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Reads get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000012_biomechanics_level_tiers_and_ve.sql)
// — MEI, Vertical Efficiency, Rhythm Score, Biomechanical Score,
// Biomechanical Fatigue, and Overall Economy Rating. Scored against the
// athlete's own mechanics_level tier (recreational/competitive/elite —
// coach-set on the athletes table) blended with their recent history for
// that workout type. Biomechanical Fatigue is deliberately a SEPARATE
// score from session_fatigue.efficiency_score (already surfaced
// elsewhere as "Best efficiency score") — a biomechanics-specific
// fatigue read (GCT/VO/cadence drift), not a replacement for the
// existing pace/HR one.
//
// Vertical Oscillation is shown as a measured input (raw value), not a
// standalone 0-100 score — Vertical Efficiency (stride ÷ VO) is the
// actual performance metric, per direct feedback: penalizing raw VO in
// isolation unfairly dings naturally longer-strided (often faster)
// athletes, since longer stride normally comes with somewhat higher VO.
//
// "Overall" vs "Last session" — Overall averages every valid score
// across the fetched window (up to 40 sessions); Last session is just
// the most recent qualifying one. Both read from the same already-
// fetched rows, no extra round trip for the toggle.

type ScoreRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  workout_type: string | null;
  avg_vo_cm: number | null;
  vo_drift_cm: number | null;
  mei_score: number | null;
  vertical_efficiency_score: number | null;
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

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
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
              {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} vs. previous
            </div>
          )}
        </>
      )}
      {caveat && <div className="text-[10px] text-muted-foreground mt-2 leading-snug">{caveat}</div>}
    </div>
  );
}

function HeadlineScore({ score, delta, label }: { score: number | null; delta: number | null; label: string }) {
  const band = bandFor(score);
  if (score == null) {
    return (
      <div className="rounded-lg border bg-accent/30 p-5 text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Economy Rating</div>
        <div className="text-sm text-muted-foreground mt-2">
          Needs MEI, Biomechanical Score, and Biomechanical Fatigue all available
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-accent/30 p-5 text-center">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Economy Rating — {label}</div>
      <div className="font-display text-5xl font-extrabold tabular-nums mt-1">{Math.round(score)}</div>
      <div className={`text-sm font-medium ${band?.className}`}>{band?.label}</div>
      {delta != null && Math.abs(delta) >= 1 && (
        <div className={`text-xs mt-1 ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} vs. previous
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-2">Average of MEI, Biomechanical Score, and Biomechanical Fatigue.</div>
    </div>
  );
}

// "Vertical Oscillation: 7.8 cm (Excellent for threshold pace)" style
// panel — raw measured value with a qualitative read, plus VO Drift, per
// direct feedback that VO itself shouldn't be flattened into a single
// score.
function VerticalOscillationPanel({ voCm, driftCm, veScore }: { voCm: number | null; driftCm: number | null; veScore: number | null }) {
  if (voCm == null) return null;
  const veBand = bandFor(veScore);
  return (
    <div className="border rounded-lg p-4 sm:col-span-2 lg:col-span-4">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Vertical Oscillation</div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <div className="text-2xl font-bold tabular-nums">{voCm.toFixed(1)} cm</div>
          <div className="text-xs text-muted-foreground">Measured — not scored on its own</div>
        </div>
        <div>
          <div className={`text-2xl font-bold tabular-nums ${veBand?.className ?? ""}`}>
            {veScore != null ? `${Math.round(veScore)}/100` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">
            Vertical Efficiency{veBand ? ` — ${veBand.label}` : ""}: forward motion per unit of bounce
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums">
            {driftCm != null ? `${driftCm > 0 ? "+" : ""}${driftCm.toFixed(1)} cm` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">VO Drift — first-fifth vs. last-fifth of the session</div>
        </div>
      </div>
    </div>
  );
}

export function BiomechanicsScoresCard({ athleteId }: { athleteId: string }) {
  const [view, setView] = useState<"last" | "overall">("last");

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-biomechanics-scores", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 40,
      });
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
  });

  // Rows arrive newest-first.
  const latest = (rows ?? [])[0];
  const previous = (rows ?? [])[1];

  const overall = useMemo(() => {
    const all = rows ?? [];
    return {
      mei_score: average(all.map((r) => r.mei_score)),
      vertical_efficiency_score: average(all.map((r) => r.vertical_efficiency_score)),
      rhythm_score: average(all.map((r) => r.rhythm_score)),
      biomechanical_score: average(all.map((r) => r.biomechanical_score)),
      biomechanical_fatigue_score: average(all.map((r) => r.biomechanical_fatigue_score)),
      overall_economy_score: average(all.map((r) => r.overall_economy_score)),
      avg_vo_cm: average(all.map((r) => r.avg_vo_cm)),
      vo_drift_cm: average(all.map((r) => r.vo_drift_cm)),
    };
  }, [rows]);

  const active = view === "overall" ? overall : latest;
  const hasAny = view === "overall" ? (rows ?? []).length > 0 : !!latest;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-[var(--accent-red)]" />
              Efficiency Scores
            </CardTitle>
            <CardDescription>
              Scored against expected ranges for this workout type and athlete level, blended with recent history.
            </CardDescription>
          </div>
          <Select value={view} onValueChange={(v) => setView(v as "last" | "overall")}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last">Last session</SelectItem>
              <SelectItem value="overall">Overall</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
        ) : !hasAny || !active ? (
          <p className="text-sm text-muted-foreground">No completed running sessions with device data yet.</p>
        ) : (
          <div className="space-y-4">
            <HeadlineScore
              score={active.overall_economy_score}
              delta={view === "last" && previous ? (active.overall_economy_score ?? 0) - (previous.overall_economy_score ?? 0) : null}
              label={view === "overall" ? `Overall (last ${(rows ?? []).length} sessions)` : "Last Session"}
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ScoreTile
                label="Mechanical Efficiency (MEI)"
                score={active.mei_score}
                delta={view === "last" && previous ? (active.mei_score ?? 0) - (previous.mei_score ?? 0) : null}
                caveat="Ground contact time and Vertical Efficiency (stride relative to vertical oscillation)."
              />
              <ScoreTile
                label="Rhythm Score"
                score={active.rhythm_score}
                delta={view === "last" && previous ? (active.rhythm_score ?? 0) - (previous.rhythm_score ?? 0) : null}
                caveat="Cadence consistency. Only scored for continuous-effort sessions — interval sessions naturally vary cadence by design."
              />
              <ScoreTile
                label="Biomechanical Score"
                score={active.biomechanical_score}
                delta={view === "last" && previous ? (active.biomechanical_score ?? 0) - (previous.biomechanical_score ?? 0) : null}
                caveat="30% ground contact, 30% vertical efficiency, 20% stride length, 20% cadence."
              />
              <ScoreTile
                label="Biomechanical Fatigue"
                score={active.biomechanical_fatigue_score}
                delta={
                  view === "last" && previous
                    ? (active.biomechanical_fatigue_score ?? 0) - (previous.biomechanical_fatigue_score ?? 0)
                    : null
                }
                caveat="First-fifth vs. last-fifth GCT/VO/cadence drift. Continuous-effort sessions only — a separate read from the existing pace/HR-based efficiency score."
              />
              <VerticalOscillationPanel
                voCm={active.avg_vo_cm}
                driftCm={active.vo_drift_cm}
                veScore={active.vertical_efficiency_score}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
