import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { ChevronLeft, Timer, Star, ChevronDown, Trophy, Sparkles } from "lucide-react";
import { clockToSec, secToClock, paceFmt } from "@/lib/format";
import { REFERENCE_DISTANCES } from "@/lib/race-predict";
import {
  predictAtDistance,
  sanitizePbs,
  PROFILE_META,
  PRIMARY_EVENTS,
  CONFIDENCE_META,
  type AthleteProfile as ManualProfileKey,
  type DistancePrediction,
  type PbPoint,
} from "@/lib/performance-predictor";
import {
  buildAthleteProfile,
  predictFromProfile,
  TIER_META,
  type PbRecord,
  type AthleteProfile as EngineProfile,
} from "@/lib/performance-profile-engine";

export const Route = createFileRoute("/_authenticated/app/calculators/pacepredictor")({
  component: PerformancePredictorPage,
});

const PROFILE_ORDER: ManualProfileKey[] = ["speed_specialist", "middle_distance", "balanced", "distance", "road_marathon"];
const SHAPE_LABELS = ["Sprint Bias", "Speed Bias", "Balanced", "Aerobic Bias", "Endurance Bias"];

// Unifies the two prediction sources (the profile engine, and the
// recent-race+declared-profile fallback for athletes without enough PB
// history to fit a curve) into one shape the table/rows below don't
// need to know the origin of.
type UnifiedPrediction = {
  label: string;
  km: number;
  timeSec: number;
  lowSec: number;
  highSec: number;
  paceSecPerKm: number;
  tier: 1 | 2 | 3 | 4 | 5;
  isPb: boolean;
  clampNote?: string | null;
  confidencePct?: number;
};

function ConfidenceStars({ tier }: { tier: 1 | 2 | 3 | 4 | 5 }) {
  const label = TIER_META[tier]?.label ?? CONFIDENCE_META[tier]?.label;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${label} confidence`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3 w-3 ${n <= tier ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

function PerformancePredictorPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: roster } = useQuery({
    queryKey: ["perf-predictor-roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name, profile_image_url").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athletes(id, name, profile_image_url)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const [athleteId, setAthleteId] = useState<string>(myAthlete?.id ?? "");
  useEffect(() => {
    if (!athleteId && !isCoach && myAthlete?.id) setAthleteId(myAthlete.id);
  }, [isCoach, myAthlete, athleteId]);

  // Every distance this athlete has an official PB at — is_pb is the
  // app's own already-computed, always-current best-per-distance flag,
  // not a separate calculation here. This is the whole body of
  // evidence Stage 1 analyses, not a single recent result.
  const { data: pbRows } = useQuery({
    queryKey: ["perf-predictor-pbs", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("distance_m, time_seconds, performance_date, context")
        .eq("athlete_id", athleteId)
        .eq("is_pb", true)
        .not("time_seconds", "is", null)
        .order("distance_m");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rawPbs: PbPoint[] = useMemo(
    () => (pbRows ?? []).map((r) => ({ distanceKm: Number(r.distance_m) / 1000, timeSec: Number(r.time_seconds) })),
    [pbRows],
  );
  const pbs: PbPoint[] = useMemo(() => sanitizePbs(rawPbs), [rawPbs]);
  const excludedPbCount = rawPbs.length - pbs.length;

  const pbRecords: PbRecord[] = useMemo(
    () =>
      (pbRows ?? []).map((r) => ({
        distanceKm: Number(r.distance_m) / 1000,
        timeSec: Number(r.time_seconds),
        dateISO: r.performance_date ?? null,
        isRace: r.context === "race",
      })),
    [pbRows],
  );

  // Stages 1-3: build the athlete's profile from the whole PB set. Only
  // meaningful with 2+ distinct-distance PBs (a curve needs two points
  // minimum) — below that, `profile.curve` is null and the page falls
  // back to the recent-race + declared-profile system further down,
  // clearly labeled as a fallback rather than silently swapped in.
  const profile: EngineProfile | null = useMemo(() => (athleteId ? buildAthleteProfile(pbRecords) : null), [pbRecords, athleteId]);
  const usingEngine = !!profile?.curve;

  const DISTANCE_OPTIONS = [
    { value: "1500", label: "1500m", km: 1.5 },
    { value: "mile", label: "1 Mile", km: 1.60934 },
    { value: "3k", label: "3K", km: 3 },
    { value: "5k", label: "5K", km: 5 },
    { value: "8k", label: "8K", km: 8 },
    { value: "10k", label: "10K", km: 10 },
    { value: "15k", label: "15K", km: 15 },
    { value: "10mile", label: "10 Mile", km: 16.0934 },
    { value: "half", label: "Half Marathon", km: 21.0975 },
    { value: "marathon", label: "Marathon", km: 42.195 },
    { value: "custom", label: "Custom distance", km: null },
  ] as const;

  const [distanceKey, setDistanceKey] = useState<string>("5k");
  const [customKm, setCustomKm] = useState<string>("10");
  const [timeInput, setTimeInput] = useState<string>("22:00");
  const [primaryEventKm, setPrimaryEventKm] = useState<number>(1.5);
  const [manualProfile, setManualProfile] = useState<ManualProfileKey>("balanced");
  const [weeklyVolume, setWeeklyVolume] = useState<string>("");
  const [trainingAge, setTrainingAge] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

  const distanceKm = useMemo(() => {
    const opt = DISTANCE_OPTIONS.find((d) => d.value === distanceKey);
    if (opt?.km != null) return opt.km;
    const custom = Number(customKm);
    return Number.isFinite(custom) && custom > 0 ? custom : null;
  }, [distanceKey, customKm]);

  const timeSec = clockToSec(timeInput);

  // Primary path: predict from the built profile's fitted curve.
  const enginePredictions: UnifiedPrediction[] | null = useMemo(() => {
    if (!usingEngine || !profile) return null;
    return REFERENCE_DISTANCES.map((ref) => predictFromProfile(profile, ref.label, ref.km))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => ({ ...p, clampNote: null }));
  }, [usingEngine, profile]);

  // Fallback path: the recent-race + declared-profile system, used
  // only when there isn't enough PB history to fit a real curve yet.
  const fallbackPredictions: UnifiedPrediction[] | null = useMemo(() => {
    if (usingEngine || !distanceKm || !timeSec || timeSec <= 0) return null;
    const input = {
      recentDistanceKm: distanceKm,
      recentTimeSec: timeSec,
      primaryEventKm,
      profile: manualProfile,
      weeklyVolumeKm: weeklyVolume.trim() ? Number(weeklyVolume) : null,
      trainingAgeYears: trainingAge.trim() ? Number(trainingAge) : null,
      pbs,
    };
    return REFERENCE_DISTANCES.map((ref) => predictAtDistance(input, ref.label, ref.km)).filter((p): p is DistancePrediction => p != null);
  }, [usingEngine, distanceKm, timeSec, primaryEventKm, manualProfile, weeklyVolume, trainingAge, pbs]);

  const predictions = enginePredictions ?? fallbackPredictions;
  const shown = predictions?.filter((p) => p.tier >= 3) ?? [];
  const collapsed = predictions?.filter((p) => p.tier < 3) ?? [];

  const trainingPaces = useMemo(() => {
    if (!predictions) return null;
    const at = (km: number) => predictions.find((p) => Math.abs(p.km - km) < 0.01)?.paceSecPerKm ?? null;
    const thresholdPace = at(16.0934) ?? at(15);
    const marathonPace = at(42.195);
    const vo2Pace = at(5);
    const repPace = at(1.60934);
    if (!thresholdPace) return null;
    const rows: { name: string; low: number; high: number }[] = [{ name: "Easy", low: thresholdPace * 1.18, high: thresholdPace * 1.3 }];
    if (marathonPace) rows.push({ name: "Marathon", low: marathonPace * 0.99, high: marathonPace * 1.02 });
    rows.push({ name: "Threshold / Tempo", low: thresholdPace * 0.98, high: thresholdPace * 1.03 });
    if (vo2Pace) rows.push({ name: "Interval (VO2 max)", low: vo2Pace * 0.97, high: vo2Pace * 1.02 });
    if (repPace) rows.push({ name: "Repetition", low: repPace * 0.98, high: repPace * 1.03 });
    return rows;
  }, [predictions]);

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link to="/app/calculators" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" /> Calculators
          </Link>
          <div className="flex items-center justify-between gap-3 mt-1 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
                <Timer className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
                <h1 className="text-2xl font-bold leading-tight">Performance Predictor</h1>
              </div>
            </div>
            {isCoach &&
              (roster && roster.length > 0 ? (
                <CoachAthletePicker roster={roster} myAthlete={myAthlete} value={athleteId} onChange={setAthleteId} />
              ) : (
                <span className="text-xs text-muted-foreground">{roster == null ? "Loading athletes…" : "No athletes on your roster yet"}</span>
              ))}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Analyses the athlete's whole body of PB evidence — weighted by recency and reliability, checked for
            internal consistency — and predicts from the resulting shape, not from one race read through a
            guessed specialty.
          </p>
        </div>

        {athleteId && profile && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> Athlete profile
              </CardTitle>
              <CardDescription>
                {usingEngine
                  ? `Derived from ${profile.weighted.length} PB${profile.weighted.length === 1 ? "" : "s"} — not a declared specialty.`
                  : "Not enough distinct-distance PBs yet to fit a profile curve (need at least 2) — predictions below fall back to the recent race and declared profile."}
              </CardDescription>
            </CardHeader>
            {usingEngine && (
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-semibold">{profile.shape.label}</span>
                    <span className="text-xs text-muted-foreground">Profile shape</span>
                  </div>
                  <div className="space-y-1">
                    {SHAPE_LABELS.map((label, i) => (
                      <div key={label} className="flex items-center gap-2 text-xs">
                        <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent-red)]"
                            style={{ width: `${(profile.shape.bars[i] ?? 0) * 10}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Speed Score</div>
                    <div className="font-semibold">{profile.speedScore != null ? profile.speedScore.toFixed(1) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">VDOT-equivalent, 800m–1500m PBs</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Aerobic Score</div>
                    <div className="font-semibold">{profile.aerobicScore != null ? profile.aerobicScore.toFixed(1) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">VDOT-equivalent, 5K–Half PBs</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Speed Endurance</div>
                    <div className="font-semibold">
                      {profile.speedEnduranceDecay != null ? (profile.speedEnduranceDecay < -0.3 ? "Fades quickly" : profile.speedEnduranceDecay > 0.3 ? "Holds well" : "Typical") : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">How pace decays, 800m→3000m</div>
                  </div>
                  <div className="rounded border px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Aerobic Durability</div>
                    <div className="font-semibold">
                      {profile.aerobicDurabilityDecay != null ? (profile.aerobicDurabilityDecay < -0.3 ? "Fades quickly" : profile.aerobicDurabilityDecay > 0.3 ? "Holds well" : "Typical") : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">How pace decays, 5K→Half</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Curve fit quality: {Math.round(profile.overallConsistency * 100)}%
                  {profile.weighted.some((p) => p.consistencyWeight < 1) && (
                    <span>
                      {" "}
                      — {profile.weighted.filter((p) => p.consistencyWeight < 1).length} PB
                      {profile.weighted.filter((p) => p.consistencyWeight < 1).length === 1 ? "" : "s"} sit further from
                      the rest of the evidence than expected and are carrying reduced influence, not excluded.
                    </span>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent race result</CardTitle>
            <CardDescription>
              {usingEngine
                ? "Not used right now — this athlete's profile is being predicted from their PB curve instead. Still here for reference, or in case the curve can't be built for a specific distance."
                : "Used as the prediction anchor until there's enough PB history to fit a profile curve."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance</Label>
              <Select value={distanceKey} onValueChange={setDistanceKey}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISTANCE_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {distanceKey === "custom" && (
                <Input type="number" min={0.1} step={0.1} className="mt-2" value={customKm} onChange={(e) => setCustomKm(e.target.value)} placeholder="Distance in km" />
              )}
            </div>
            <div>
              <Label className="text-xs">Time (mm:ss or h:mm:ss)</Label>
              <Input className="mt-1" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} placeholder="22:00" />
            </div>
          </CardContent>
        </Card>

        {!usingEngine && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Athlete profile (fallback)</CardTitle>
              <CardDescription>Used only until this athlete has 2+ PBs at different distances to derive a real profile from.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Primary event</Label>
                  <Select value={String(primaryEventKm)} onValueChange={(v) => setPrimaryEventKm(Number(v))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIMARY_EVENTS.map((e) => (
                        <SelectItem key={e.label} value={String(e.km)}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Weekly running volume (optional, km)</Label>
                  <Input type="number" min={0} className="mt-1" value={weeklyVolume} onChange={(e) => setWeeklyVolume(e.target.value)} placeholder="e.g. 60" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Athlete profile</Label>
                <div className="grid sm:grid-cols-2 gap-2 mt-1">
                  {PROFILE_ORDER.map((p) => {
                    const meta = PROFILE_META[p];
                    const selected = manualProfile === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setManualProfile(p)}
                        className={`text-left rounded-md border p-2.5 text-xs transition-colors hover:border-primary/50 ${selected ? "border-[var(--accent-red)] bg-accent/30" : ""}`}
                      >
                        <div className="font-semibold">{meta.label}</div>
                        <div className="text-muted-foreground mt-0.5">{meta.blurb}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sm:w-1/2">
                <Label className="text-xs">Training age (optional, years)</Label>
                <Input type="number" min={0} step={0.5} value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} placeholder="e.g. 4" />
              </div>
            </CardContent>
          </Card>
        )}

        {!predictions ? (
          <p className="text-sm text-muted-foreground">
            {usingEngine ? "Building predictions from this athlete's profile…" : "Enter a valid distance and time above to see predictions."}
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Predicted performances</CardTitle>
                <CardDescription>
                  {usingEngine
                    ? "Predicted from this athlete's fitted PB curve — strongest where real evidence sits close by, less reliable further from it."
                    : "Predictions are strongest around your primary event. Longer- and shorter-distance predictions become less reliable unless supported by specific training."}
                  {athleteId && pbs.length > 0 && !usingEngine && (
                    <span className="flex items-center gap-1.5 mt-1.5 text-emerald-600">
                      <Trophy className="h-3.5 w-3.5" /> Grounded against {pbs.length} real PB{pbs.length === 1 ? "" : "s"} for this athlete.
                    </span>
                  )}
                  {excludedPbCount > 0 && (
                    <span className="block mt-1 text-amber-600">
                      {excludedPbCount} PB{excludedPbCount === 1 ? "" : "s"} excluded as {excludedPbCount === 1 ? "an outlier" : "outliers"} — pace far outside the rest of this athlete's results, likely a data entry issue worth checking.
                    </span>
                  )}
                  {athleteId && pbs.length === 0 && (
                    <span className="block mt-1.5 text-muted-foreground">No PBs on file for this athlete yet — predictions are based on the recent race and profile only.</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {shown.map((p) => (
                    <PredictionRow key={p.label} p={p} />
                  ))}
                </div>
                {collapsed.length > 0 && (
                  <div className="border-t">
                    {!showAll ? (
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="h-3.5 w-3.5" /> Show {collapsed.length} lower-confidence prediction{collapsed.length === 1 ? "" : "s"}
                      </button>
                    ) : (
                      <div className="divide-y">
                        {collapsed.map((p) => (
                          <PredictionRow key={p.label} p={p} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {trainingPaces && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Training paces</CardTitle>
                  <CardDescription>Built from the same predictions above, not a separate lookup table.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {trainingPaces.map((z) => (
                      <div key={z.name} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="font-medium">{z.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {paceFmt(z.low)} – {paceFmt(z.high)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-muted-foreground">
              {usingEngine
                ? "Confidence combines how much relevant PB evidence exists nearby (40%), how recent it is (30%), how internally consistent the athlete's overall curve is (20%), and distance from the target (10%) — not just distance from a declared specialty. A PB within ~3% of a target distance is shown directly rather than estimated."
                : "Predictions combine the standard Riegel formula with an exponent shaped by the declared athlete profile — a speed-biased profile fades faster over distance than a flat formula assumes, an endurance-biased one holds pace better, in both directions (projecting up AND down in distance). Weekly volume only nudges Half Marathon/Marathon-length predictions, where aerobic durability actually matters most."}{" "}
              None of this replaces real training-specific evidence at an unfamiliar distance — a range and a confidence rating, not a guarantee.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function PredictionRow({ p }: { p: UnifiedPrediction }) {
  const meta = TIER_META[p.tier] ?? CONFIDENCE_META[p.tier];
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{p.label}</span>
          {p.isPb && (
            <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">
              <Trophy className="h-2.5 w-2.5 mr-1" /> Your PB
            </Badge>
          )}
          {p.tier <= 2 && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Lower confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {p.isPb ? (
            <span className="text-[11px] text-muted-foreground">Actual result — not a projection</span>
          ) : (
            <>
              <ConfidenceStars tier={p.tier} />
              <span className="text-[11px] text-muted-foreground">
                {meta.label}
                {p.confidencePct != null ? ` · ${p.confidencePct}%` : ""}
              </span>
            </>
          )}
        </div>
        {p.clampNote && <div className="text-[10px] text-amber-600 mt-0.5">{p.clampNote}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className="tabular-nums font-semibold">{secToClock(p.timeSec)}</div>
        <div className="tabular-nums text-xs text-muted-foreground">{paceFmt(p.paceSecPerKm)}</div>
        {!p.isPb && (
          <div className="tabular-nums text-[11px] text-muted-foreground">
            {secToClock(p.lowSec)}–{secToClock(p.highSec)}
          </div>
        )}
      </div>
    </div>
  );
}
