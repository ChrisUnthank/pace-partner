import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { AthleteSubnav } from "@/components/athlete-subnav";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Gauge, Check, X, Save, Scale, Trash2 } from "lucide-react";
import { secToClock, clockToSec, paceFmt } from "@/lib/format";
import {
  METHOD_META,
  deriveZonesFromPaceThreshold,
  deriveZonesFromHrThreshold,
  paceFromVdot,
  paceFromRecentRace,
  paceFromCriticalSpeedTest,
  paceFromMas,
  hrFromKarvonen,
  hrFromPctMaxHr,
  type ZoneMethod,
  type ZoneRow,
} from "@/lib/zone-calculator";

export const Route = createFileRoute("/_authenticated/app/calculators/zonecalculator")({
  validateSearch: z.object({ athleteId: z.string().optional() }),
  component: ZoneCalculatorPage,
});

type ComputedResult = {
  basis: "pace" | "hr";
  thresholdPace: number | null;
  thresholdHr: number | null;
  zones: ZoneRow[];
} | null;

type CompareEntry = { id: string; method: ZoneMethod; result: NonNullable<ComputedResult> };

const METHOD_ORDER: ZoneMethod[] = [
  "daniels_vdot",
  "recent_race",
  "threshold_pace",
  "critical_speed",
  "mas",
  "karvonen",
  "threshold_hr",
  "pct_max_hr",
];

function ZoneCalculatorPage() {
  const search = Route.useSearch();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");
  const qc = useQueryClient();

  const { data: roster } = useQuery({
    queryKey: ["zone-calc-roster", user?.id, isManager],
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

  const [athleteId, setAthleteId] = useState<string>(search.athleteId ?? myAthlete?.id ?? "");
  useEffect(() => {
    if (!athleteId && !isCoach && myAthlete?.id) setAthleteId(myAthlete.id);
  }, [isCoach, myAthlete, athleteId]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<ZoneMethod | null>(null);

  // ---- Flat input state — each method only ever reads the handful of
  // fields relevant to it, so one shared bucket is simpler than eight
  // separate per-method sub-states. ----
  const [vdotInput, setVdotInput] = useState("50");
  const [raceDistanceKm, setRaceDistanceKm] = useState("5");
  const [raceTimeInput, setRaceTimeInput] = useState("20:00");
  const [thresholdPaceInput, setThresholdPaceInput] = useState("4:00");
  const [csD1, setCsD1] = useState("1.2");
  const [csT1, setCsT1] = useState("4:00");
  const [csD2, setCsD2] = useState("3");
  const [csT2, setCsT2] = useState("11:00");
  const [masInput, setMasInput] = useState("18");
  const [restingHrInput, setRestingHrInput] = useState("50");
  const [maxHrInput, setMaxHrInput] = useState("190");
  const [thresholdHrInput, setThresholdHrInput] = useState("165");

  const localResult: ComputedResult = useMemo(() => {
    if (!method) return null;
    const basis = METHOD_META[method].basis;
    if (basis === "pace") {
      let pace: number | null = null;
      if (method === "daniels_vdot") pace = paceFromVdot(Number(vdotInput));
      else if (method === "recent_race") pace = paceFromRecentRace(Number(raceDistanceKm), clockToSec(raceTimeInput) ?? 0);
      else if (method === "threshold_pace") pace = clockToSec(thresholdPaceInput);
      else if (method === "critical_speed")
        pace = paceFromCriticalSpeedTest(Number(csD1), clockToSec(csT1) ?? 0, Number(csD2), clockToSec(csT2) ?? 0);
      else if (method === "mas") pace = paceFromMas(Number(masInput));
      if (pace == null || !Number.isFinite(pace) || pace <= 0) return null;
      return { basis, thresholdPace: pace, thresholdHr: null, zones: deriveZonesFromPaceThreshold(pace) };
    } else {
      let hr: number | null = null;
      if (method === "karvonen") hr = hrFromKarvonen(Number(restingHrInput), Number(maxHrInput));
      else if (method === "threshold_hr") hr = Math.round(Number(thresholdHrInput));
      else if (method === "pct_max_hr") hr = hrFromPctMaxHr(Number(maxHrInput));
      if (hr == null || !Number.isFinite(hr) || hr <= 0) return null;
      return { basis, thresholdPace: null, thresholdHr: hr, zones: deriveZonesFromHrThreshold(hr) };
    }
  }, [
    method,
    vdotInput,
    raceDistanceKm,
    raceTimeInput,
    thresholdPaceInput,
    csD1,
    csT1,
    csD2,
    csT2,
    masInput,
    restingHrInput,
    maxHrInput,
    thresholdHrInput,
  ]);

  // Daniels VDOT specifically has a real, already-in-production database
  // function for VDOT -> threshold pace (vdot_threshold_pace_sec_per_km) —
  // the exact same one Zone Boundaries' own "VDOT (Daniels)" auto-method
  // already uses. Calling it here (rather than the local Daniels & Gilbert
  // reimplementation above) means this method's anchor matches the app's
  // real number exactly, not a close approximation of it.
  const vdotNum = Number(vdotInput);
  const { data: rpcVdotPace } = useQuery({
    queryKey: ["zone-calc-vdot-pace", vdotNum],
    enabled: method === "daniels_vdot" && Number.isFinite(vdotNum) && vdotNum > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vdot_threshold_pace_sec_per_km", { _vdot: vdotNum });
      if (error) throw error;
      return data as number;
    },
  });

  // Every other method's anchor still comes from localResult — only the
  // VDOT path swaps in the real server value once it's back, instant
  // client-side estimate visible in the meantime rather than a blank
  // state during the round trip.
  const anchorResult: ComputedResult = useMemo(() => {
    if (!localResult || method !== "daniels_vdot" || rpcVdotPace == null) return localResult;
    return { ...localResult, thresholdPace: rpcVdotPace, zones: deriveZonesFromPaceThreshold(rpcVdotPace) };
  }, [localResult, method, rpcVdotPace]);

  // The real, authoritative zone boundaries for whatever anchor is
  // currently active — same zones_from_pace_threshold / zones_from_hr_threshold
  // functions Zone Boundaries itself is built on, not this calculator's
  // own approximation of them. Falls back to the local band model
  // (still shown in anchorResult) while this is loading or if it errors,
  // so the preview is never blank, just briefly less exact.
  const { data: rpcZoneCutoffs } = useQuery({
    queryKey: ["zone-calc-real-zones", anchorResult?.basis, anchorResult?.thresholdPace, anchorResult?.thresholdHr],
    enabled: !!anchorResult,
    queryFn: async () => {
      if (!anchorResult) return null;
      const { data, error } =
        anchorResult.basis === "pace"
          ? await supabase.rpc("zones_from_pace_threshold", { _threshold_sec_per_km: anchorResult.thresholdPace! })
          : await supabase.rpc("zones_from_hr_threshold", { _hr_threshold: anchorResult.thresholdHr! });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Record<string, number> | null;
    },
  });

  const result: ComputedResult = useMemo(() => {
    if (!anchorResult) return null;
    if (!rpcZoneCutoffs) return anchorResult; // fallback: local approximation
    // z1_max..z6_max are cutoffs (one bound per zone), same convention
    // target-resolution.ts already uses for the athlete's real profile:
    // zone n's far bound is z_n_max, its near bound is z_(n-1)_max.
    const cutoff = (i: number) => rpcZoneCutoffs[`z${i}_max`] ?? null;
    const rows: ZoneRow[] = ZONE_ORDER.map((key, idx) => {
      const n = idx + 1;
      const name = METHOD_ZONE_NAMES[idx];
      if (anchorResult.basis === "pace") {
        const fast = cutoff(n) ?? (anchorResult.thresholdPace as number);
        const slow = n > 1 ? cutoff(n - 1) : null;
        return { key, name, low: fast, high: slow };
      }
      const hi = cutoff(n) ?? (anchorResult.thresholdHr as number);
      const lo = n > 1 ? (cutoff(n - 1) != null ? (cutoff(n - 1) as number) + 1 : null) : null;
      return { key, name, low: lo ?? 0, high: hi };
    });
    return { ...anchorResult, zones: rows };
  }, [anchorResult, rpcZoneCutoffs]);

  const [compareList, setCompareList] = useState<CompareEntry[]>([]);

  function addToCompare() {
    if (!method || !result) return;
    if (compareList.length >= 3) {
      toast.error("Comparison mode holds up to 3 methods — remove one first.");
      return;
    }
    if (compareList.some((c) => c.method === method)) {
      toast.error(`${METHOD_META[method].label} is already in the comparison.`);
      return;
    }
    setCompareList((list) => [...list, { id: crypto.randomUUID(), method, result }]);
  }

  // ---- Save ----
  const [saving, setSaving] = useState<"active" | "secondary" | null>(null);
  const [secondaryDialogOpen, setSecondaryDialogOpen] = useState(false);
  const [secondaryLabel, setSecondaryLabel] = useState("");

  const currentInputsSnapshot = () => {
    if (!method) return {};
    switch (method) {
      case "daniels_vdot":
        return { vdot: vdotInput };
      case "recent_race":
        return { distanceKm: raceDistanceKm, time: raceTimeInput };
      case "threshold_pace":
        return { thresholdPace: thresholdPaceInput };
      case "critical_speed":
        return { d1: csD1, t1: csT1, d2: csD2, t2: csT2 };
      case "mas":
        return { masKmh: masInput };
      case "karvonen":
        return { restingHr: restingHrInput, maxHr: maxHrInput };
      case "threshold_hr":
        return { thresholdHr: thresholdHrInput };
      case "pct_max_hr":
        return { maxHr: maxHrInput };
    }
  };

  async function saveActive() {
    if (!athleteId) {
      toast.error("Pick an athlete first.");
      return;
    }
    if (!method || !result) return;
    setSaving("active");
    const { error } =
      result.basis === "pace"
        ? await supabase.rpc("set_pace_threshold_manual", {
            _athlete_id: athleteId,
            _threshold_sec_per_km: result.thresholdPace,
            _source: "manual",
          })
        : await supabase.rpc("set_hr_threshold_manual", {
            _athlete_id: athleteId,
            _hr_threshold: result.thresholdHr,
            _source: "manual",
          });
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved as this athlete's active zones — see Zone Boundaries.");
    qc.invalidateQueries({ queryKey: ["zone-profile", athleteId] });
  }

  async function saveSecondary() {
    if (!athleteId || !method || !result) return;
    setSaving("secondary");
    const { error } = await supabase.from("athlete_zone_calculator_saves" as any).insert({
      athlete_id: athleteId,
      created_by: user?.id ?? null,
      label: secondaryLabel.trim() || `${METHOD_META[method].label} — ${new Date().toLocaleDateString()}`,
      method,
      basis: result.basis,
      threshold_pace_sec_per_km: result.thresholdPace,
      threshold_hr_bpm: result.thresholdHr,
      inputs: currentInputsSnapshot(),
    });
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved for reference — doesn't change this athlete's active zones.");
    setSecondaryDialogOpen(false);
    setSecondaryLabel("");
    qc.invalidateQueries({ queryKey: ["zone-calc-saves", athleteId] });
  }

  const { data: savedResults } = useQuery({
    queryKey: ["zone-calc-saves", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_zone_calculator_saves" as any)
        .select("id, label, method, basis, threshold_pace_sec_per_km, threshold_hr_bpm, created_at")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function deleteSaved(id: string) {
    const { error } = await supabase.from("athlete_zone_calculator_saves" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["zone-calc-saves", athleteId] });
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-4xl">
        <div>
          <Link to="/app/calculators" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" /> Calculators
          </Link>
          {isCoach && athleteId && (
            <div className="flex flex-wrap items-center gap-3 min-w-0 mt-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                <Link to="/app/athletes" className="hover:text-foreground">
                  Athletes
                </Link>
                <span className="text-border">/</span>
                <Link to="/app/athletes/$athleteId" params={{ athleteId }} className="hover:text-foreground">
                  {(roster ?? []).find((a: any) => a.id === athleteId)?.name ?? "Athlete"}
                </Link>
              </div>
              <AthleteSubnav athleteId={athleteId} active="zones" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 mt-1 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
                <Gauge className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
                <h1 className="text-2xl font-bold leading-tight">Zone Calculator</h1>
              </div>
            </div>
            {isCoach && (
              <CoachAthletePicker
                roster={roster ?? []}
                myAthlete={myAthlete}
                value={athleteId}
                onChange={setAthleteId}
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Work through a method, compare it against others, then save the one that fits — either as this
            athlete's active zones, or kept for reference without changing anything live.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs font-medium">
          {[
            { n: 1, label: "Method" },
            { n: 2, label: "Inputs" },
            { n: 3, label: "Zones" },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (s.n === 1 || method) && setStep(s.n as 1 | 2 | 3)}
                className={`h-6 w-6 rounded-full grid place-items-center ${
                  step === s.n ? "bg-[var(--accent-red)] text-white" : step > s.n ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {step > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
              </button>
              <span className={step === s.n ? "" : "text-muted-foreground"}>{s.label}</span>
              {i < 2 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* ---- Step 1: method ---- */}
        {step === 1 && (
          <div className="grid sm:grid-cols-2 gap-3">
            {METHOD_ORDER.map((m) => {
              const meta = METHOD_META[m];
              const selected = method === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMethod(m);
                    setStep(2);
                  }}
                  className={`text-left rounded-lg border p-4 transition-colors hover:border-primary/50 ${
                    selected ? "border-[var(--accent-red)] bg-accent/30" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{meta.label}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {meta.basis === "pace" ? "Pace" : "HR"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{meta.blurb}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5 italic">{meta.bestFor}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* ---- Step 2: inputs ---- */}
        {step === 2 && method && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{METHOD_META[method].label}</CardTitle>
              <CardDescription>{METHOD_META[method].blurb}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MethodInputs
                method={method}
                vdotInput={vdotInput}
                setVdotInput={setVdotInput}
                raceDistanceKm={raceDistanceKm}
                setRaceDistanceKm={setRaceDistanceKm}
                raceTimeInput={raceTimeInput}
                setRaceTimeInput={setRaceTimeInput}
                thresholdPaceInput={thresholdPaceInput}
                setThresholdPaceInput={setThresholdPaceInput}
                csD1={csD1}
                setCsD1={setCsD1}
                csT1={csT1}
                setCsT1={setCsT1}
                csD2={csD2}
                setCsD2={setCsD2}
                csT2={csT2}
                setCsT2={setCsT2}
                masInput={masInput}
                setMasInput={setMasInput}
                restingHrInput={restingHrInput}
                setRestingHrInput={setRestingHrInput}
                maxHrInput={maxHrInput}
                setMaxHrInput={setMaxHrInput}
                thresholdHrInput={thresholdHrInput}
                setThresholdHrInput={setThresholdHrInput}
              />

              {result && (
                <div className="rounded-md border bg-accent/20 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Anchor: </span>
                  <span className="font-semibold tabular-nums">
                    {result.basis === "pace" ? `${paceFmt(result.thresholdPace)} threshold pace` : `${result.thresholdHr} bpm threshold HR`}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Change method
                </Button>
                <Button size="sm" onClick={() => setStep(3)} disabled={!result}>
                  See zones <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- Step 3: zones + save + compare ---- */}
        {step === 3 && method && (
          <>
            {!result ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground text-center">
                  Enter valid inputs on the previous step to see calculated zones.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-base">Calculated zones — {METHOD_META[method].label}</CardTitle>
                    <CardDescription>
                      {result.basis === "pace" ? "Pace range" : "Heart rate range"} for each zone, from a{" "}
                      {result.basis === "pace" ? paceFmt(result.thresholdPace) : `${result.thresholdHr} bpm`} threshold.
                    </CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={addToCompare}>
                    <Scale className="h-3.5 w-3.5 mr-1" /> Add to comparison
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {result.zones.map((z) => (
                      <div key={z.key} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="font-medium">{z.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {result.basis === "pace"
                            ? `${paceFmt(z.low)} – ${z.high != null ? paceFmt(z.high) : "open"}`
                            : `${z.low}${z.high != null ? ` – ${z.high}` : "+"} bpm`}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {result && compareList.length < 3 && <CompareHowTo />}

            {result && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Save</CardTitle>
                  <CardDescription>
                    {athleteId
                      ? "Active Zones updates this athlete's real Zone Boundaries immediately — everything else on their profile that reads zones (Analytics, session classification) picks it up right away."
                      : "Pick an athlete above before saving."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={saveActive} disabled={!athleteId || saving === "active"}>
                    <Save className="h-4 w-4 mr-1" /> {saving === "active" ? "Saving…" : "Save as Active Zones"}
                  </Button>
                  <Button variant="outline" onClick={() => setSecondaryDialogOpen(true)} disabled={!athleteId}>
                    Save as Secondary Profile
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMethod(null);
                      setStep(1);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back to inputs
              </Button>
            </div>
          </>
        )}

        {/* ---- Comparison table ---- */}
        {compareList.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Compare methods</CardTitle>
                <CardDescription>Up to 3 side by side — differences beyond 5% of the row's own range are highlighted.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCompareList([])}>
                Clear
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <ComparisonTable entries={compareList} onRemove={(id) => setCompareList((l) => l.filter((e) => e.id !== id))} />
            </CardContent>
          </Card>
        )}

        {/* ---- Saved calculations (secondary profile saves) ---- */}
        {athleteId && (savedResults?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved calculations</CardTitle>
              <CardDescription>Kept for reference — none of these are this athlete's active zones unless also saved as Active Zones above.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {(savedResults ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {METHOD_META[s.method as ZoneMethod]?.label ?? s.method} ·{" "}
                        {s.basis === "pace" ? paceFmt(s.threshold_pace_sec_per_km) : `${s.threshold_hr_bpm} bpm`} ·{" "}
                        {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button type="button" onClick={() => deleteSaved(s.id)} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Delete saved calculation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Zone boundaries shown here come from the same database functions Zone Boundaries itself uses
          (<code className="text-[11px]">zones_from_pace_threshold</code> /{" "}
          <code className="text-[11px]">zones_from_hr_threshold</code>) — not a separate approximation — so what
          you see here is what you'll get after saving. Daniels VDOT also calls the app's own real VDOT→pace
          function. What's still this calculator's own estimate is each method's specific *anchor* derivation
          (Recent Race, Critical Speed, MAS, Karvonen, %MaxHR, or a directly-entered threshold) — those aren't
          existing auto-methods elsewhere in the app, so there's nothing to defer to for them.
        </p>
      </div>

      <Dialog open={secondaryDialogOpen} onOpenChange={setSecondaryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save for reference</DialogTitle>
            <DialogDescription>Doesn't change this athlete's active zones — just keeps this calculation for later.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={secondaryLabel}
              onChange={(e) => setSecondaryLabel(e.target.value)}
              placeholder={method ? `${METHOD_META[method].label} — ${new Date().toLocaleDateString()}` : ""}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSecondaryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSecondary} disabled={saving === "secondary"}>
              {saving === "secondary" ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// A literal walkthrough of this page's own buttons — not a generic
// description, the exact click path someone follows to add a second (or
// third) method into the comparison table below. Shown right after the
// calculated-zones card once a result exists, hidden once 3 methods are
// already in the comparison (the max) since there's nothing left to add.
const COMPARE_STEPS = [
  "Back to inputs",
  "Change method",
  "Pick a new method",
  "Enter its details",
  "See zones",
  "Add to comparison",
  "Repeat",
];

function CompareHowTo() {
  return (
    <Card className="bg-accent/20">
      <CardContent className="py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          To compare this against another method
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
          {COMPARE_STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1">
                <span className="h-4 w-4 shrink-0 rounded-full bg-[var(--accent-red)] text-white text-[10px] font-bold grid place-items-center">
                  {i + 1}
                </span>
                {label}
              </span>
              {i < COMPARE_STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Step 2 inputs — one component, switches on method internally so the
// parent stays a flat prop bucket rather than 8 near-identical siblings.
// Future methods only need a new case here, nothing else in the file
// changes shape — the method-select grid, the live-preview calc, the
// save flow, and comparison mode are all already method-agnostic.
// ---------------------------------------------------------------------
function MethodInputs(props: {
  method: ZoneMethod;
  vdotInput: string;
  setVdotInput: (v: string) => void;
  raceDistanceKm: string;
  setRaceDistanceKm: (v: string) => void;
  raceTimeInput: string;
  setRaceTimeInput: (v: string) => void;
  thresholdPaceInput: string;
  setThresholdPaceInput: (v: string) => void;
  csD1: string;
  setCsD1: (v: string) => void;
  csT1: string;
  setCsT1: (v: string) => void;
  csD2: string;
  setCsD2: (v: string) => void;
  csT2: string;
  setCsT2: (v: string) => void;
  masInput: string;
  setMasInput: (v: string) => void;
  restingHrInput: string;
  setRestingHrInput: (v: string) => void;
  maxHrInput: string;
  setMaxHrInput: (v: string) => void;
  thresholdHrInput: string;
  setThresholdHrInput: (v: string) => void;
}) {
  switch (props.method) {
    case "daniels_vdot":
      return (
        <div>
          <Label className="text-xs">VDOT</Label>
          <Input type="number" step="0.1" value={props.vdotInput} onChange={(e) => props.setVdotInput(e.target.value)} />
        </div>
      );
    case "recent_race":
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Distance (km)</Label>
            <Input type="number" step="0.01" value={props.raceDistanceKm} onChange={(e) => props.setRaceDistanceKm(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Finish time (mm:ss or h:mm:ss)</Label>
            <Input value={props.raceTimeInput} onChange={(e) => props.setRaceTimeInput(e.target.value)} placeholder="20:00" />
          </div>
        </div>
      );
    case "threshold_pace":
      return (
        <div>
          <Label className="text-xs">Threshold pace (mm:ss per km)</Label>
          <Input value={props.thresholdPaceInput} onChange={(e) => props.setThresholdPaceInput(e.target.value)} placeholder="4:00" />
        </div>
      );
    case "critical_speed":
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Two recent all-out efforts of clearly different lengths — e.g. a 3-4 minute effort and a 10-12 minute effort.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Trial 1 — distance (km)</Label>
              <Input type="number" step="0.01" value={props.csD1} onChange={(e) => props.setCsD1(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Trial 1 — time</Label>
              <Input value={props.csT1} onChange={(e) => props.setCsT1(e.target.value)} placeholder="4:00" />
            </div>
            <div>
              <Label className="text-xs">Trial 2 — distance (km)</Label>
              <Input type="number" step="0.01" value={props.csD2} onChange={(e) => props.setCsD2(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Trial 2 — time</Label>
              <Input value={props.csT2} onChange={(e) => props.setCsT2(e.target.value)} placeholder="11:00" />
            </div>
          </div>
        </div>
      );
    case "mas":
      return (
        <div>
          <Label className="text-xs">MAS speed (km/h)</Label>
          <Input type="number" step="0.1" value={props.masInput} onChange={(e) => props.setMasInput(e.target.value)} />
        </div>
      );
    case "karvonen":
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Resting HR (bpm)</Label>
            <Input type="number" value={props.restingHrInput} onChange={(e) => props.setRestingHrInput(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Max HR (bpm)</Label>
            <Input type="number" value={props.maxHrInput} onChange={(e) => props.setMaxHrInput(e.target.value)} />
          </div>
        </div>
      );
    case "threshold_hr":
      return (
        <div>
          <Label className="text-xs">Threshold heart rate (bpm)</Label>
          <Input type="number" value={props.thresholdHrInput} onChange={(e) => props.setThresholdHrInput(e.target.value)} />
        </div>
      );
    case "pct_max_hr":
      return (
        <div>
          <Label className="text-xs">Max HR (bpm)</Label>
          <Input type="number" value={props.maxHrInput} onChange={(e) => props.setMaxHrInput(e.target.value)} />
        </div>
      );
  }
}

// ---------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------
const ZONE_ORDER = ["recovery", "endurance", "tempo", "threshold", "vo2max", "anaerobic"];
const METHOD_ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO₂ Max", "Anaerobic"];

function ComparisonTable({ entries, onRemove }: { entries: CompareEntry[]; onRemove: (id: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground text-left border-b">
          <th className="py-2 px-4">Zone</th>
          {entries.map((e) => (
            <th key={e.id} className="py-2 px-4">
              <div className="flex items-center gap-1.5">
                {METHOD_META[e.method].label}
                <button type="button" onClick={() => onRemove(e.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove from comparison">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ZONE_ORDER.map((zoneKey) => {
          const cells = entries.map((e) => e.result.zones.find((z) => z.key === zoneKey) ?? null);
          // Highlights a row when methods disagree meaningfully — compares
          // each entry's low bound as a fraction of its own threshold, so
          // pace (smaller = faster) and HR (larger = harder) both compare
          // sensibly on the same 5%-spread rule.
          const lows = entries.map((e, i) => {
            const anchor = e.result.basis === "pace" ? e.result.thresholdPace : e.result.thresholdHr;
            const cell = cells[i];
            return anchor && cell ? cell.low / anchor : null;
          }).filter((n): n is number => n != null);
          const spread = lows.length > 1 ? Math.max(...lows) - Math.min(...lows) : 0;
          const disagreement = spread > 0.05;

          return (
            <tr key={zoneKey} className={`border-b last:border-b-0 ${disagreement ? "bg-amber-500/10" : ""}`}>
              <td className="py-2 px-4 font-medium">{entries[0]?.result.zones.find((z) => z.key === zoneKey)?.name ?? zoneKey}</td>
              {entries.map((e, i) => {
                const cell = cells[i];
                if (!cell) return <td key={e.id} className="py-2 px-4 text-muted-foreground">—</td>;
                return (
                  <td key={e.id} className="py-2 px-4 tabular-nums">
                    {e.result.basis === "pace"
                      ? `${paceFmt(cell.low)} – ${cell.high != null ? paceFmt(cell.high) : "open"}`
                      : `${cell.low}${cell.high != null ? ` – ${cell.high}` : "+"} bpm`}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
