import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Reads get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000019_biomechanics_hierarchy_rebuild.sql)
// — a genuine three-level hierarchy per direct design feedback:
//
// Level 1 (raw, never scored): avg_cadence, stride_length_m, avg_vo_cm,
//   avg_gct_ms, gct_balance_pct — just measurements, shown as-is below.
// Level 2 (derived, scored): MEI, Vertical Efficiency, Rhythm & Timing,
//   Mechanical Stability, Mechanical Fatigue.
// Level 3 (summary): Biomechanical Score = 40% MEI + 25% Stability +
//   20% Fatigue + 15% Rhythm — composed from the LEVEL 2 SCORES, not the
//   same raw sub-metrics MEI already consumes (the old version
//   double-counted GCT/VO/stride/cadence in two different composites —
//   this is the actual fix for that).
//
// MEI itself was also rebuilt: previously three independently-weighted
// sub-scores (GCT/VO/stride), which couldn't recognize that a longer
// stride can justify a slightly worse GCT. Now a single unified ratio
// (stride / (GCT * VO)) scored as one thing — verified against a direct
// counter-example before shipping (GCT 210/VO 8/stride 1.60 vs GCT
// 220/VO 8/stride 1.90 — the second profile now correctly scores
// higher, which the old formula couldn't guarantee).
//
// Overall Economy Rating = Biomechanical Score directly now, not a
// separate average of MEI + Biomechanical + Fatigue — that old formula
// double-counted MEI and Fatigue once directly and again via their
// share of Biomechanical Score. Both are still shown as separate tiles
// below since a coach may expect to see both, but they're currently the
// same number by design, not a bug — flagged explicitly in the UI
// rather than silently showing two identical numbers with no
// explanation.
//
// Mechanical Stability is genuinely new — GCT + VO consistency across
// the whole session, deliberately distinct from Rhythm & Timing
// (cadence + stride consistency, the "beat") and from Fatigue
// (directional drift start-to-end, not overall variability). This is
// my own definition, not something fully specified — worth treating as
// the most provisional of these scores until checked against real
// sessions.
//
// Label system: Excellent / Very Good / Developing / Session-Specific,
// replacing Excellent/Good/Fair/Needs work — per direct feedback that
// "Fair" or "Needs work" reads as a fixed ability judgment when a score
// might just reflect session context (a tall athlete, a threshold
// session, wind, a hill) rather than genuine inefficiency.

type ScoreRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  workout_type: string | null;
  avg_cadence: number | null;
  stride_length_m: number | null;
  avg_vo_cm: number | null;
  vo_drift_cm: number | null;
  avg_gct_ms: number | null;
  gct_balance_pct: number | null;
  mei_score: number | null;
  vertical_efficiency_score: number | null;
  rhythm_score: number | null;
  mechanical_stability_score: number | null;
  biomechanical_score: number | null;
  biomechanical_fatigue_score: number | null;
  overall_economy_score: number | null;
};

type Band = { label: string; className: string; emoji: string };

function bandFor(score: number | null): Band | null {
  if (score == null) return null;
  if (score >= 85) return { label: "Excellent", className: "text-emerald-600", emoji: "🟢" };
  if (score >= 70) return { label: "Very Good", className: "text-emerald-600", emoji: "🟢" };
  if (score >= 50) return { label: "Developing", className: "text-amber-600", emoji: "🟡" };
  return { label: "Session-Specific", className: "text-amber-600", emoji: "🟡" };
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
          <div className={`text-xs font-medium ${band?.className}`}>
            {band?.emoji} {band?.label}
          </div>
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
          Needs MEI, Stability, Fatigue, and Rhythm all available for the same session
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-accent/30 p-5 text-center">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Economy Rating — {label}</div>
      <div className="font-display text-5xl font-extrabold tabular-nums mt-1">{Math.round(score)}</div>
      <div className={`text-sm font-medium ${band?.className}`}>
        {band?.emoji} {band?.label}
      </div>
      {delta != null && Math.abs(delta) >= 1 && (
        <div className={`text-xs mt-1 ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))} vs. previous
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-2">
        Currently the same number as Biomechanical Score below, by design — see the note under Biomechanical Score.
      </div>
    </div>
  );
}

// Level 1 raw measurements — never scored, shown as plain numbers, per
// direct design feedback (Garmin-style: report Vertical Oscillation and
// Ground Contact Balance, don't force a score onto them).
function RawMeasurementsPanel({
  voCm,
  driftCm,
  veScore,
  gctMs,
  gctBalancePct,
}: {
  voCm: number | null;
  driftCm: number | null;
  veScore: number | null;
  gctMs: number | null;
  gctBalancePct: number | null;
}) {
  if (voCm == null && gctMs == null) return null;
  const veBand = bandFor(veScore);
  return (
    <div className="border rounded-lg p-4 sm:col-span-2 lg:col-span-3">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Raw Measurements (not scored)
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {gctMs != null && (
          <div>
            <div className="text-2xl font-bold tabular-nums">{Math.round(gctMs)} ms</div>
            <div className="text-xs text-muted-foreground">
              Ground Contact Time
              {gctBalancePct != null && (
                <>
                  {" · "}
                  {gctBalancePct > 50
                    ? `${(gctBalancePct - 50).toFixed(1)}% more time on right foot`
                    : gctBalancePct < 50
                      ? `${(50 - gctBalancePct).toFixed(1)}% more time on left foot`
                      : "perfectly balanced L/R"}
                </>
              )}
            </div>
          </div>
        )}
        {voCm != null && (
          <div>
            <div className="text-2xl font-bold tabular-nums">{voCm.toFixed(1)} cm</div>
            <div className="text-xs text-muted-foreground">
              Vertical Oscillation
              {driftCm != null && (
                <> · drift {driftCm > 0 ? "+" : ""}{driftCm.toFixed(1)} cm (first-fifth vs. last-fifth)</>
              )}
            </div>
          </div>
        )}
        <div>
          <div className={`text-2xl font-bold tabular-nums ${veBand?.className ?? ""}`}>
            {veScore != null ? `${Math.round(veScore)}/100` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">
            Vertical Efficiency{veBand ? ` — ${veBand.emoji} ${veBand.label}` : ""}: forward motion per unit of
            bounce, the actual scored version of VO above
          </div>
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
      mechanical_stability_score: average(all.map((r) => r.mechanical_stability_score)),
      biomechanical_score: average(all.map((r) => r.biomechanical_score)),
      biomechanical_fatigue_score: average(all.map((r) => r.biomechanical_fatigue_score)),
      overall_economy_score: average(all.map((r) => r.overall_economy_score)),
      avg_vo_cm: average(all.map((r) => r.avg_vo_cm)),
      vo_drift_cm: average(all.map((r) => r.vo_drift_cm)),
      avg_gct_ms: average(all.map((r) => r.avg_gct_ms)),
      gct_balance_pct: average(all.map((r) => r.gct_balance_pct)),
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <ScoreTile
                label="Mechanical Efficiency (MEI)"
                score={active.mei_score}
                delta={view === "last" && previous ? (active.mei_score ?? 0) - (previous.mei_score ?? 0) : null}
                caveat="Stride length relative to ground contact time AND vertical oscillation together, as one combined ratio — not three separately-weighted scores."
              />
              <ScoreTile
                label="Rhythm & Timing"
                score={active.rhythm_score}
                delta={view === "last" && previous ? (active.rhythm_score ?? 0) - (previous.rhythm_score ?? 0) : null}
                caveat="Cadence AND stride consistency together — the repeatability of the stride cycle. Continuous-effort sessions only."
              />
              <ScoreTile
                label="Mechanical Stability"
                score={active.mechanical_stability_score}
                delta={
                  view === "last" && previous
                    ? (active.mechanical_stability_score ?? 0) - (previous.mechanical_stability_score ?? 0)
                    : null
                }
                caveat="Ground contact time AND vertical oscillation consistency across the whole session. Continuous-effort sessions only — most provisional of these scores, worth checking against real sessions."
              />
              <ScoreTile
                label="Mechanical Fatigue"
                score={active.biomechanical_fatigue_score}
                delta={
                  view === "last" && previous
                    ? (active.biomechanical_fatigue_score ?? 0) - (previous.biomechanical_fatigue_score ?? 0)
                    : null
                }
                caveat="First-fifth vs. last-fifth GCT/VO/cadence drift. Continuous-effort sessions only — a separate read from the existing pace/HR-based efficiency score."
              />
              <ScoreTile
                label="Biomechanical Score"
                score={active.biomechanical_score}
                delta={view === "last" && previous ? (active.biomechanical_score ?? 0) - (previous.biomechanical_score ?? 0) : null}
                caveat="40% Mechanical Efficiency, 25% Stability, 20% Fatigue, 15% Rhythm — composed from the scores above, not the raw measurements. Currently identical to Overall Economy Rating above, by design."
              />
              <RawMeasurementsPanel
                voCm={active.avg_vo_cm}
                driftCm={active.vo_drift_cm}
                veScore={active.vertical_efficiency_score}
                gctMs={active.avg_gct_ms}
                gctBalancePct={active.gct_balance_pct}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
