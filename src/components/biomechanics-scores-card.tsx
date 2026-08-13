import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Reads get_athlete_biomechanics_trend() (see
// supabase/migrations/20260801000020_overall_economy_redesign.sql) — a
// three-level hierarchy:
//
// Level 1 (raw, never scored): avg_cadence, stride_length_m, avg_vo_cm,
//   avg_gct_ms, gct_balance_pct — just measurements, shown as-is below.
// Level 2 (derived, scored): MEI, Vertical Efficiency, Rhythm & Timing,
//   Mechanical Stability, Mechanical Fatigue.
// Level 3 (summary): Biomechanical Score (movement quality — 35% MEI +
//   25% Stability + 20% Fatigue + 20% Rhythm) and Overall Economy
//   Rating (the big picture — 40% MEI + 25% Pace/HR Efficiency + 20%
//   Fatigue + 15% Stability). These are now GENUINELY DIFFERENT numbers
//   — Pace/HR Efficiency in, Rhythm out — reusing
//   session_fatigue.efficiency_score (the existing pace/HR-based
//   aerobic-sustainability read this app already computes) rather than
//   inventing a second one. An earlier version made these identical by
//   design, which read as confusing/redundant; this fixes that.
//
// MEI is a unified ratio (stride / (GCT * VO)), not three
// independently-weighted sub-scores — verified against a direct
// counter-example before shipping (a longer stride correctly justifies
// a slightly worse GCT, which independent sub-scores couldn't see).
//
// Mechanical Stability is a judgment call, not something fully
// specified anywhere I was given — GCT + VO consistency across the
// whole session, deliberately distinct from Rhythm & Timing (cadence +
// stride, the "beat") and Fatigue (directional drift, not overall
// variability). Worth treating as the most provisional score here.
//
// Label system: Excellent / Very Good / Developing / Session-Specific —
// a low score reads as "may reflect session context" rather than a
// fixed ability judgment.
//
// "Overall" now has its own time-window sub-filter (1/3/6 months) —
// averages the already-fetched rows client-side, filtered by
// session_date; no extra round trip per window change, since the fetch
// already pulls a generous pool (_limit raised to 200 specifically to
// give the 6-month window enough real data to average over).

type ScoreRow = {
  session_id: string;
  session_date: string;
  session_title: string | null;
  workout_type: string | null;
  dominant_zone: string | null;
  avg_cadence: number | null;
  stride_length_m: number | null;
  avg_vo_cm: number | null;
  vo_drift_cm: number | null;
  avg_gct_ms: number | null;
  gct_balance_pct: number | null;
  pace_hr_efficiency_score: number | null;
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

const WINDOW_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "1m", label: "Last month", days: 31 },
  { value: "3m", label: "Last 3 months", days: 92 },
  { value: "6m", label: "Last 6 months", days: 183 },
  { value: "all", label: "All fetched", days: null },
];

// Session-level zone bucketing.
//
// FIXED (was: dominant_zone from the RPC). The RPC returns dominant_zone
// as COALESCE(<zone holding the most SECONDS in session_zone_time>,
// <zone derived from intent>) — i.e. time-in-zone plurality across the
// WHOLE session. That is structurally broken for interval training, and
// the real data proves it rather than merely suggesting it:
//
//   Across Josh's last 120 days, 45 sessions have a hard training intent
//   (tempo / threshold / VO2 / anaerobic). ALL 45 bucketed as z1 or z2 by
//   time — 34 as z1, 11 as z2. Zero exceptions. Overall, 84 of 121
//   sessions disagreed with their own intent, and the whole 3-month
//   window produced only two populated buckets: z1 (86 sessions) and z2
//   (22). Z3-Z6 were empty by construction, which is exactly why every
//   one of those filters read as "no data".
//
// The cause is obvious in hindsight: a VO2 session is mostly warmup,
// recovery jogs and cooldown by elapsed time, so total time-in-zone
// always lands in the easy bands no matter how hard the reps were.
//
// So the zone now comes from the session's training INTENT (via
// workout_type, which the RPC already returns), which is what a coach
// actually means by "show me the VO2 sessions". Sessions whose type has
// no single fixed zone — race, time trial — deliberately return null and
// appear only under "All zones", rather than being forced into a bucket
// they don't belong in. dominant_zone is intentionally NOT used as a
// fallback: the evidence above shows it would mis-bucket rather than
// rescue.
//
// True point-level in-session zone splitting remains the eventual right
// answer and is still follow-up work — see CHANGELOG.
const WORKOUT_TYPE_ZONE: Record<string, string> = {
  recovery: "z1",
  easy: "z1",
  long_run: "z1",
  aerobic: "z2",
  tempo: "z3",
  threshold: "z4",
  vo2: "z5",
  anaerobic: "z6",
  speed: "z6",
  // race / time_trial deliberately absent — a 1500m race and a half
  // marathon are not the same zone, and there's nothing in this payload
  // that could tell them apart. Unmapped = "All zones" only.
};

function zoneForRow(r: ScoreRow): string | null {
  if (!r.workout_type) return null;
  return WORKOUT_TYPE_ZONE[r.workout_type] ?? null;
}

const ZONE_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "all", label: "All zones", color: "#94a3b8" },
  { value: "z1", label: "Z1 Recovery", color: "#34d399" },
  { value: "z2", label: "Z2 Easy/Aerobic", color: "#38bdf8" },
  { value: "z3", label: "Z3 Steady/Tempo", color: "#fbbf24" },
  { value: "z4", label: "Z4 Threshold", color: "#f97316" },
  { value: "z5", label: "Z5 VO2", color: "#ef4444" },
  { value: "z6", label: "Z6 Anaerobic/Max", color: "#9333ea" },
];


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
          Needs Mechanical Efficiency, Pace/HR Efficiency, Fatigue, and Stability all available
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
        40% Mechanical Efficiency, 25% Pace/HR Efficiency, 20% Fatigue, 15% Stability — the big picture, mechanics
        and aerobic sustainability together.
      </div>
    </div>
  );
}

// Level 1 raw measurements — never scored, shown as plain numbers.
// Vertical Ratio replaces raw Vertical Oscillation (cm) here — VO alone
// isn't comparable across athletes of different heights/stride lengths,
// which Vertical Ratio (VO as a % of stride length) corrects for. This is
// computed client-side from the two raw measurements the RPC already
// returns (avg_vo_cm, stride_length_m), not a new server-side figure —
// with VO in cm and stride length in meters, the unit conversion happens
// to cancel out: VR% = (VO_cm × 10 mm/cm) / (stride_m × 1000 mm/m) × 100
// = VO_cm / stride_m.
function RawMeasurementsPanel({
  voCm,
  strideLengthM,
  driftCm,
  veScore,
  gctMs,
  gctBalancePct,
}: {
  voCm: number | null;
  strideLengthM: number | null;
  driftCm: number | null;
  veScore: number | null;
  gctMs: number | null;
  gctBalancePct: number | null;
}) {
  if (voCm == null && gctMs == null) return null;
  const veBand = bandFor(veScore);
  const verticalRatioPct = voCm != null && strideLengthM != null && strideLengthM > 0 ? voCm / strideLengthM : null;
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
                  {Math.round(gctBalancePct)}/{Math.round(100 - gctBalancePct)} R/L
                </>
              )}
            </div>
          </div>
        )}
        {verticalRatioPct != null && (
          <div>
            <div className="text-2xl font-bold tabular-nums">{verticalRatioPct.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">
              Vertical Ratio (VO ÷ stride length)
              {driftCm != null && (
                <> · VO drift {driftCm > 0 ? "+" : ""}{driftCm.toFixed(1)} cm (first-fifth vs. last-fifth)</>
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
            bounce, the actual scored version of Vertical Ratio above
          </div>
        </div>
      </div>
    </div>
  );
}

export function BiomechanicsScoresCard({ athleteId }: { athleteId: string }) {
  const [view, setView] = useState<"last" | "overall">("last");
  const [window, setWindowRange] = useState("3m");
  const [zone, setZone] = useState("all");

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["athlete-biomechanics-scores", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_biomechanics_trend" as any, {
        _athlete_id: athleteId,
        _limit: 200,
        // Was omitted entirely (defaults to whole-session — warmup +
        // work + recovery + cooldown all blended together), which is
        // very likely why Vertical Efficiency and friends could read
        // artificially low: slow, bouncy warmup/cooldown jogging
        // dragging the average down. "work" excludes recovery jogs
        // too, not just warmup/cooldown — per direct confirmation, a
        // deliberate choice, not an oversight (recovery-jog mechanics
        // aren't "form" in the same sense work-effort mechanics are).
        // Unlike the Trend card below, this card has no segment picker
        // of its own — this is now its one fixed default rather than
        // something the person viewing it can change.
        _segment_type: "work",
      });
      if (error) throw error;
      return (data ?? []) as ScoreRow[];
    },
  });

  // Zone filter applies before everything else derives from `rows` — a
  // coach picking "Z5 VO2" wants the last VO2-zone session and the
  // VO2-zone overall average, not the last session overall further
  // filtered down after the fact.
  const zoneFilteredRows = useMemo(() => {
    if (zone === "all") return rows ?? [];
    return (rows ?? []).filter((r) => zoneForRow(r) === zone);
  }, [rows, zone]);

  // Session counts per zone, shown in the dropdown so an empty bucket is
  // visible before it's selected rather than after.
  const zoneCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const z = zoneForRow(r);
      if (z) m.set(z, (m.get(z) ?? 0) + 1);
    }
    m.set("all", (rows ?? []).length);
    return m;
  }, [rows]);

  // Rows arrive newest-first.
  const latest = zoneFilteredRows[0];
  const previous = zoneFilteredRows[1];

  const windowedRows = useMemo(() => {
    const opt = WINDOW_OPTIONS.find((o) => o.value === window);
    if (!opt || opt.days == null) return zoneFilteredRows;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opt.days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return zoneFilteredRows.filter((r) => r.session_date >= cutoffIso);
  }, [zoneFilteredRows, window]);

  const overall = useMemo(() => {
    const all = windowedRows;
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
      stride_length_m: average(all.map((r) => r.stride_length_m)),
      avg_gct_ms: average(all.map((r) => r.avg_gct_ms)),
      gct_balance_pct: average(all.map((r) => r.gct_balance_pct)),
    };
  }, [windowedRows]);

  const active = view === "overall" ? overall : latest;
  const hasAny = view === "overall" ? windowedRows.length > 0 : !!latest;

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
              Work-effort only — warmup, recovery jogs, and cooldown excluded. Scored against expected ranges for
              this workout type and athlete level, blended with recent history. Zone comes from the session's
              training intent, not its total time-in-zone.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full inline-block" style={{ background: o.color }} />
                      {o.label}
                      <span className="text-muted-foreground tabular-nums">({zoneCounts.get(o.value) ?? 0})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={view} onValueChange={(v) => setView(v as "last" | "overall")}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last">Last session</SelectItem>
                <SelectItem value="overall">Overall</SelectItem>
              </SelectContent>
            </Select>
            {view === "overall" && (
              <Select value={window} onValueChange={setWindowRange}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
          <p className="text-sm text-muted-foreground">
            {zone !== "all"
              ? `No work-effort sessions with device mechanics data classified as ${ZONE_OPTIONS.find((o) => o.value === zone)?.label ?? zone}${view === "overall" ? " in this window" : ""} yet. Races and time trials aren't assigned a zone — they appear under All zones only.`
              : view === "overall"
                ? "No completed running sessions with device data in this window yet."
                : "No completed running sessions with device data yet."}
          </p>
        ) : (
          <div className="space-y-4">
            <HeadlineScore
              score={active.overall_economy_score}
              delta={view === "last" && previous ? (active.overall_economy_score ?? 0) - (previous.overall_economy_score ?? 0) : null}
              label={
                view === "overall"
                  ? `${WINDOW_OPTIONS.find((o) => o.value === window)?.label} (${windowedRows.length} sessions)`
                  : zone !== "all"
                    ? `Last ${ZONE_OPTIONS.find((o) => o.value === zone)?.label ?? zone} Session`
                    : "Last Session"
              }
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
                caveat="Movement quality only: 35% Mechanical Efficiency, 25% Stability, 20% Fatigue, 20% Rhythm — composed from the scores here, not raw measurements. No pace/HR input — that's Overall Economy above."
              />
              <RawMeasurementsPanel
                voCm={active.avg_vo_cm}
                strideLengthM={active.stride_length_m}
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
