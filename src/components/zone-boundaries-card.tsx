import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { secToClock, clockToSec, paceFmt, metersFmt } from "@/lib/format";
import { bulkRecomputeSessionClassification } from "@/lib/session-files.functions";
import { RefreshCw, Loader2, Calculator } from "lucide-react";
import { Link } from "@tanstack/react-router";

// ----------------------------------------------------------------------------
// Small inline-edit primitives. Hoisted to module scope (not defined inside
// ZoneBoundariesCard) — components declared inside another component's body
// get recreated every render, which would remount these and drop focus/mid-
// edit state on every parent re-render (e.g. from the query refetch after a
// save).
// ----------------------------------------------------------------------------

function EditableBpm({
  value,
  onSave,
  disabled,
}: {
  value: number | null;
  onSave: (v: number) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    if (!editing) setDraft(value != null ? String(value) : "");
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n > 0 && n !== value) onSave(n);
    else setDraft(value != null ? String(value) : "");
  }

  if (disabled) {
    return <span className="tabular-nums text-muted-foreground">{value != null ? `${value} bpm` : "—"}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-foreground"
      >
        {value != null ? `${value} bpm` : "— set"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value != null ? String(value) : "");
          setEditing(false);
        }
      }}
      className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-sm tabular-nums text-right"
    />
  );
}

function EditablePace({
  value,
  onSave,
  disabled,
}: {
  value: number | null;
  onSave: (secPerKm: number) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? secToClock(value) : "");

  useEffect(() => {
    if (!editing) setDraft(value != null ? secToClock(value) : "");
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const sec = clockToSec(draft);
    if (sec != null && sec > 0 && sec !== value) onSave(sec);
    else setDraft(value != null ? secToClock(value) : "");
  }

  if (disabled) {
    return <span className="tabular-nums text-muted-foreground">{value != null ? paceFmt(value) : "—"}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-foreground"
      >
        {value != null ? paceFmt(value) : "— set"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode="numeric"
      placeholder="mm:ss"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value != null ? secToClock(value) : "");
          setEditing(false);
        }
      }}
      className="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-sm tabular-nums text-right"
    />
  );
}

// ----------------------------------------------------------------------------
// Zone colour palette — matches the Z1-Z5 colours already used on the
// Analytics zone bar (emerald/sky/amber/orange/red), just reused here as a
// subtle row tint + a solid left border, so the table itself reads at a
// glance instead of needing to parse the Z-number.
// ----------------------------------------------------------------------------

const ZONE_COLORS: Record<string, { row: string; border: string; dot: string }> = {
  Z1: { row: "bg-emerald-400/10", border: "border-l-emerald-400", dot: "bg-emerald-400" },
  Z2: { row: "bg-sky-400/10", border: "border-l-sky-400", dot: "bg-sky-400" },
  Z3: { row: "bg-amber-400/10", border: "border-l-amber-400", dot: "bg-amber-400" },
  Z4: { row: "bg-orange-500/10", border: "border-l-orange-500", dot: "bg-orange-500" },
  Z5: { row: "bg-red-500/10", border: "border-l-red-500", dot: "bg-red-500" },
  Z6: { row: "bg-purple-600/10", border: "border-l-purple-600", dot: "bg-purple-600" },
};

// ----------------------------------------------------------------------------
// Main card
// ----------------------------------------------------------------------------

type ThresholdSource = "auto" | "manual" | "test";

const METHOD_LABEL: Record<string, string> = {
  max_hr_pct: "90% of HR max",
  best_effort_3k_plus: "Best effort ≥3K (12mo)",
  vdot: "VDOT (Daniels)",
};

type ZoneProfile =
  | {
      hr_max: number | null;
      hr_threshold: number | null;
      hr_z1_max: number | null;
      hr_z2_max: number | null;
      hr_z3_max: number | null;
      hr_z4_max: number | null;
      hr_z5_max: number | null;
      hr_z6_max: number | null;
      hr_zones_manual: boolean;
      hr_threshold_source: ThresholdSource;
      hr_method: string | null;
      pace_5k_sec_per_km: number | null;
      pace_threshold_sec_per_km: number | null;
      pace_z1_max_sec_per_km: number | null;
      pace_z2_max_sec_per_km: number | null;
      pace_z3_max_sec_per_km: number | null;
      pace_z4_max_sec_per_km: number | null;
      pace_z5_max_sec_per_km: number | null;
      pace_z6_max_sec_per_km: number | null;
      pace_zones_manual: boolean;
      pace_threshold_source: ThresholdSource;
      pace_method: string | null;
      vdot: number | null;
      vdot_source_performance_id: string | null;
      vdot_source_override: boolean;
      preferred_zone_basis: "hr" | "pace";
    }
  | null
  | undefined;

export function ZoneBoundariesCard({ athleteId, profile }: { athleteId: string; profile: ZoneProfile }) {
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Recompute flow — prompted automatically right after a real
  // preferred-basis change (see savePreferredBasis below), and also
  // available any time via the standalone button, since a zone boundary
  // edit (not just a basis switch) can just as easily make past
  // classifications stale.
  const bulkRecompute = useServerFn(bulkRecomputeSessionClassification);
  const [recomputePromptOpen, setRecomputePromptOpen] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<{ total: number; succeeded: number; errors: { sessionId: string; message: string }[] } | null>(null);

  async function runBulkRecompute() {
    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const result = await bulkRecompute({ data: { athleteId } });
      setRecomputeResult(result);
      if (result.total === 0) {
        toast.success("No uploaded-file sessions to recompute for this athlete.");
        setRecomputePromptOpen(false);
      } else if (result.errors.length === 0) {
        toast.success(`Recomputed ${result.succeeded} of ${result.total} sessions.`);
        setRecomputePromptOpen(false);
      } else {
        toast.error(`Recomputed ${result.succeeded} of ${result.total} — ${result.errors.length} failed. See details below.`);
        // Left open so the failure list stays visible rather than
        // vanishing into a toast that scrolls away.
      }
      invalidate();
    } catch (err: any) {
      toast.error(err?.message ?? "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  // Only fetched for the VDOT race-override picker — qualifying races
  // (>=3000m, same distance floor the auto-pick itself uses), most recent
  // first, so a coach can see and choose among them without needing to
  // leave this card.
  const { data: qualifyingPerformances } = useQuery({
    queryKey: ["vdot-qualifying-performances", athleteId],
    enabled: profile?.pace_method === "vdot",
    queryFn: async () => {
      const { data } = await supabase
        .from("performances")
        .select("id, distance_m, time_seconds, performance_date, event_name")
        .eq("athlete_id", athleteId)
        .gte("distance_m", 3000)
        .not("time_seconds", "is", null)
        .order("performance_date", { ascending: false });
      return data ?? [];
    },
  });

  function invalidate() {
    // Both the coach athlete page and the athlete's own profile page key
    // this query as ["zone-profile", athleteId] — keeping that key stable
    // across both call sites is what makes a save on one page show up
    // immediately if the other happens to be open too (same tab, different
    // route) without a manual refresh.
    qc.invalidateQueries({ queryKey: ["zone-profile", athleteId] });
  }

  async function run(key: string, fn: () => PromiseLike<{ error: any }>, successMsg?: string) {
    setSavingKey(key);
    const { error } = await fn();
    setSavingKey(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (successMsg) toast.success(successMsg);
    invalidate();
  }

  async function saveHrThreshold(bpm: number, source: ThresholdSource = profile?.hr_threshold_source ?? "manual") {
    await run(
      "hr_threshold",
      () => supabase.rpc("set_hr_threshold_manual", { _athlete_id: athleteId, _hr_threshold: bpm, _source: source }),
      "Threshold HR updated",
    );
  }

  async function savePaceThreshold(
    secPerKm: number,
    source: ThresholdSource = profile?.pace_threshold_source ?? "manual",
  ) {
    await run(
      "pace_threshold",
      () =>
        supabase.rpc("set_pace_threshold_manual", {
          _athlete_id: athleteId,
          _threshold_sec_per_km: secPerKm,
          _source: source,
        }),
      "Threshold pace updated",
    );
  }

  // Changing Type (Auto/Manual/Test) via the dropdown, independent of
  // editing the value itself. Auto always resets to the formula-derived
  // value (same as "Reset to auto" already did). Manual/Test carry the
  // athlete's current threshold value forward unchanged — switching from
  // Manual to Test (or back) is just relabeling where the number came
  // from, not a reason to lose it. Switching TO Manual/Test with no
  // existing value yet is blocked with a prompt to set one first, since
  // there'd otherwise be nothing to carry over.
  async function changeHrType(newType: ThresholdSource) {
    if (newType === "auto") {
      await resetHr();
      return;
    }
    if (profile?.hr_threshold == null) {
      toast.error("Set a threshold value first, then choose Manual or Test.");
      return;
    }
    await saveHrThreshold(profile.hr_threshold, newType);
  }

  async function changePaceType(newType: ThresholdSource) {
    if (newType === "auto") {
      await resetPace();
      return;
    }
    if (profile?.pace_threshold_sec_per_km == null) {
      toast.error("Set a threshold value first, then choose Manual or Test.");
      return;
    }
    await savePaceThreshold(profile.pace_threshold_sec_per_km, newType);
  }

  // Which basis (HR or pace) actually drives session/zone classification
  // for this athlete — both stay visible on this card regardless of which
  // one is preferred. Every past FIT-derived session was classified
  // against whichever basis was active AT THE TIME, so switching this
  // doesn't retroactively fix anything by itself — prompts for a bulk
  // recompute right after a real change (not fired on re-selecting the
  // value already in place, e.g. from a stale click).
  async function savePreferredBasis(basis: "hr" | "pace") {
    const changed = profile?.preferred_zone_basis !== basis;
    await run(
      "preferred_basis",
      () => supabase.from("athlete_zone_profiles").update({ preferred_zone_basis: basis } as any).eq("athlete_id", athleteId),
      "Preferred basis updated",
    );
    if (changed) {
      setRecomputeResult(null);
      setRecomputePromptOpen(true);
    }
  }

  // Switching the pace auto-method (Best effort vs VDOT) always implies
  // Type=Auto — matches the same intent as picking a Type in the first
  // place, so this forces pace_threshold_source back to 'auto' server-side
  // even if it was previously Manual/Test.
  async function savePaceMethod(method: string) {
    await run(
      "pace_method",
      () => supabase.rpc("set_pace_auto_method", { _athlete_id: athleteId, _method: method }),
      "Pace method updated",
    );
  }

  async function saveVdotSource(performanceId: string) {
    await run(
      "vdot_source",
      () => supabase.rpc("set_vdot_source_performance", { _athlete_id: athleteId, _performance_id: performanceId }),
      "VDOT source race updated",
    );
  }

  async function resetVdotSource() {
    await run(
      "vdot_reset",
      () => supabase.rpc("reset_vdot_to_auto", { _athlete_id: athleteId }),
      "VDOT reset to auto-pick",
    );
  }

  async function resetHr() {
    await run(
      "hr_reset",
      () => supabase.rpc("reset_hr_zones_to_auto", { _athlete_id: athleteId }),
      "HR zones reset to auto",
    );
  }

  async function resetPace() {
    await run(
      "pace_reset",
      () => supabase.rpc("reset_pace_zones_to_auto", { _athlete_id: athleteId }),
      "Pace zones reset to auto",
    );
  }

  // Editing an individual boundary (rather than the threshold) is a direct
  // update — same shared calc functions in the DB already gate every write
  // path through the *_manual flags, so this just needs to flip the flag
  // alongside the value. RLS (can_access_athlete) still governs who's
  // allowed to write for this athlete_id, coach or athlete alike.
  async function saveHrBoundary(field: string, bpm: number) {
    await run(field, () =>
      supabase
        .from("athlete_zone_profiles")
        .update({ [field]: bpm, hr_zones_manual: true } as any)
        .eq("athlete_id", athleteId),
    );
  }

  async function savePaceBoundary(field: string, secPerKm: number) {
    await run(field, () =>
      supabase
        .from("athlete_zone_profiles")
        .update({ [field]: secPerKm, pace_zones_manual: true } as any)
        .eq("athlete_id", athleteId),
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Zone boundaries</CardTitle>
          <CardDescription>No zone profile yet — set HR max and log a 5K PB.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/calculators/zonecalculator" search={{ athleteId }}>
              <Calculator className="h-3.5 w-3.5 mr-1.5" /> Try the Zone Calculator
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hrRows: Array<{ z: string; field: string; value: number | null; editable: boolean }> = [
    { z: "Z1", field: "hr_z1_max", value: profile.hr_z1_max, editable: true },
    { z: "Z2", field: "hr_z2_max", value: profile.hr_z2_max, editable: true },
    { z: "Z3", field: "hr_z3_max", value: profile.hr_z3_max, editable: true },
    { z: "Z4", field: "hr_z4_max", value: profile.hr_z4_max, editable: true },
    { z: "Z5", field: "hr_z5_max", value: profile.hr_z5_max, editable: true },
    { z: "Z6", field: "hr_z6_max", value: profile.hr_z6_max, editable: false }, // open-ended fastest zone; display only
  ];

  const paceRows: Array<{ z: string; field: string; value: number | null; editable: boolean }> = [
    { z: "Z1", field: "pace_z1_max_sec_per_km", value: profile.pace_z1_max_sec_per_km, editable: true },
    { z: "Z2", field: "pace_z2_max_sec_per_km", value: profile.pace_z2_max_sec_per_km, editable: true },
    { z: "Z3", field: "pace_z3_max_sec_per_km", value: profile.pace_z3_max_sec_per_km, editable: true },
    { z: "Z4", field: "pace_z4_max_sec_per_km", value: profile.pace_z4_max_sec_per_km, editable: true },
    { z: "Z5", field: "pace_z5_max_sec_per_km", value: profile.pace_z5_max_sec_per_km, editable: true },
    { z: "Z6", field: "pace_z6_max_sec_per_km", value: profile.pace_z6_max_sec_per_km, editable: false }, // open-ended fastest zone; display only
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Zone boundaries</CardTitle>
          <CardDescription>
            One threshold value drives each set of zones. Choose Auto, Manual, or Test for how each was determined —
            click any number to edit it directly. Both HR and pace stay visible here regardless of which one is
            actually applied for classification (set below).
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/app/calculators/zonecalculator" search={{ athleteId }}>
            <Calculator className="h-3.5 w-3.5 mr-1.5" /> Zone Calculator
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border border-border bg-card/40 p-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Preferred basis
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Which one actually drives session zone/intent classification for this athlete.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={profile.preferred_zone_basis}
              onValueChange={(v) => savePreferredBasis(v as "hr" | "pace")}
              disabled={savingKey === "preferred_basis"}
            >
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hr">Heart rate</SelectItem>
                <SelectItem value="pace">Pace</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => {
                setRecomputeResult(null);
                setRecomputePromptOpen(true);
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Recompute
            </Button>
          </div>
        </div>

        <AlertDialog open={recomputePromptOpen} onOpenChange={(open) => !recomputing && setRecomputePromptOpen(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Recompute past sessions?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Every past session built from an uploaded FIT/GPX file was classified (intent, title, zone time)
                    against whichever basis and boundaries were active at the time. Changing the basis or a boundary
                    value doesn't retroactively fix those — this re-runs classification for every uploaded-file
                    session this athlete has, using the current settings.
                  </p>
                  <p>
                    This can take a while for a long history and re-reads each session's stored files. Manually-
                    entered sessions with no uploaded file aren't affected — there's nothing to reclassify there.
                  </p>
                  {recomputeResult && recomputeResult.errors.length > 0 && (
                    <div className="border rounded-md p-2 text-xs text-destructive space-y-1 max-h-32 overflow-y-auto">
                      {recomputeResult.errors.map((e, i) => (
                        <p key={i}>Session {e.sessionId.slice(0, 8)}…: {e.message}</p>
                      ))}
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={recomputing}>
                {recomputeResult ? "Close" : "Not now"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  runBulkRecompute();
                }}
                disabled={recomputing}
              >
                {recomputing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Recomputing…
                  </>
                ) : (
                  "Recompute now"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-md border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Threshold HR
              </div>
              <Select
                value={profile.hr_threshold_source}
                onValueChange={(v) => changeHrType(v as ThresholdSource)}
                disabled={savingKey === "hr_threshold" || savingKey === "hr_reset"}
              >
                <SelectTrigger className="w-24 h-6 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="font-display text-3xl font-extrabold tabular-nums mt-1">
              <EditableBpm
                value={profile.hr_threshold}
                onSave={saveHrThreshold}
                disabled={savingKey === "hr_threshold"}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {profile.hr_threshold_source === "auto"
                ? `Auto-suggested — ${METHOD_LABEL[profile.hr_method ?? ""] ?? "90% of HR max"}.`
                : profile.hr_threshold_source === "test"
                  ? "From a field/lab test — enter a new value to update it."
                  : "Entered manually — enter a new value to update it."}
            </div>
            {profile.hr_threshold_source !== "auto" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 mt-2 text-xs"
                onClick={resetHr}
                disabled={savingKey === "hr_reset"}
              >
                Reset to auto
              </Button>
            )}
          </div>
          <div className="rounded-md border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Threshold Pace
              </div>
              <Select
                value={profile.pace_threshold_source}
                onValueChange={(v) => changePaceType(v as ThresholdSource)}
                disabled={savingKey === "pace_threshold" || savingKey === "pace_reset"}
              >
                <SelectTrigger className="w-24 h-6 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="font-display text-3xl font-extrabold tabular-nums mt-1">
              <EditablePace
                value={profile.pace_threshold_sec_per_km}
                onSave={savePaceThreshold}
                disabled={savingKey === "pace_threshold"}
              />
            </div>

            {profile.pace_threshold_source === "auto" && (
              <div className="mt-2">
                <Select
                  value={profile.pace_method ?? "best_effort_3k_plus"}
                  onValueChange={savePaceMethod}
                  disabled={savingKey === "pace_method"}
                >
                  <SelectTrigger className="h-6 text-[10px] w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best_effort_3k_plus">Best effort ≥3K (12mo)</SelectItem>
                    <SelectItem value="vdot">VDOT (Daniels)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="text-xs text-muted-foreground mt-1">
              {profile.pace_threshold_source === "auto"
                ? `Auto-suggested — ${METHOD_LABEL[profile.pace_method ?? ""] ?? "best recent race pace"}.`
                : profile.pace_threshold_source === "test"
                  ? "From a field/lab test — enter a new value to update it."
                  : "Entered manually — enter a new value to update it."}
            </div>

            {profile.pace_threshold_source === "auto" && profile.pace_method === "vdot" && (
              <div className="mt-2 space-y-1">
                <Select
                  value={profile.vdot_source_performance_id ?? ""}
                  onValueChange={saveVdotSource}
                  disabled={savingKey === "vdot_source"}
                >
                  <SelectTrigger className="h-6 text-[10px] w-full">
                    <SelectValue placeholder="Auto-picked race" />
                  </SelectTrigger>
                  <SelectContent>
                    {(qualifyingPerformances ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {metersFmt(p.distance_m)} in {secToClock(p.time_seconds)} — {p.performance_date}
                        {p.event_name ? ` (${p.event_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profile.vdot_source_override && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={resetVdotSource}
                    disabled={savingKey === "vdot_reset"}
                  >
                    Reset to auto-pick
                  </Button>
                )}
              </div>
            )}

            {profile.pace_threshold_source !== "auto" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 mt-2 text-xs"
                onClick={resetPace}
                disabled={savingKey === "pace_reset"}
              >
                Reset to auto
              </Button>
            )}
          </div>
          <div className="rounded-md border border-border bg-card/40 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">VO2max (VDOT)</div>
            <div className="font-display text-3xl font-extrabold tabular-nums mt-1">
              {profile.vdot != null ? profile.vdot.toFixed(1) : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {profile.vdot != null
                ? profile.vdot_source_override
                  ? "From the race selected above."
                  : "Auto-picked from best qualifying race (≥3K, 12mo)."
                : "No qualifying race (≥3K) in the last 12 months."}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Always shown for reference — only drives Threshold Pace when its Method is set to VDOT.
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">HR zones</div>
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1 px-2">Zone</th>
                  <th className="text-right px-2">Up to</th>
                </tr>
              </thead>
              <tbody>
                {hrRows.map((r) => {
                  const colors = ZONE_COLORS[r.z];
                  return (
                    <tr key={r.z} className={`border-l-4 ${colors.border} ${colors.row}`}>
                      <td className="py-1.5 px-2 font-medium rounded-l">
                        <span className={`inline-block h-2 w-2 rounded-full mr-2 align-middle ${colors.dot}`} />
                        {r.z}
                      </td>
                      <td className="text-right px-2 rounded-r">
                        {r.editable ? (
                          <EditableBpm
                            value={r.value}
                            onSave={(v) => saveHrBoundary(r.field, v)}
                            disabled={savingKey === r.field}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Pace zones</div>
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1 px-2">Zone</th>
                  <th className="text-right px-2">Slower than</th>
                </tr>
              </thead>
              <tbody>
                {paceRows.map((r) => {
                  const colors = ZONE_COLORS[r.z];
                  return (
                    <tr key={r.z} className={`border-l-4 ${colors.border} ${colors.row}`}>
                      <td className="py-1.5 px-2 font-medium rounded-l">
                        <span className={`inline-block h-2 w-2 rounded-full mr-2 align-middle ${colors.dot}`} />
                        {r.z}
                      </td>
                      <td className="text-right px-2 rounded-r">
                        {r.editable ? (
                          <EditablePace
                            value={r.value}
                            onSave={(v) => savePaceBoundary(r.field, v)}
                            disabled={savingKey === r.field}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
