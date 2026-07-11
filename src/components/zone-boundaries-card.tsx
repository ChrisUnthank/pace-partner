import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { secToClock, clockToSec, paceFmt } from "@/lib/format";

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
// Main card
// ----------------------------------------------------------------------------

type ZoneProfile = {
  hr_max: number | null;
  hr_threshold: number | null;
  hr_z1_max: number | null;
  hr_z2_max: number | null;
  hr_z3_max: number | null;
  hr_z4_max: number | null;
  hr_z5_max: number | null;
  hr_zones_manual: boolean;
  pace_5k_sec_per_km: number | null;
  pace_threshold_sec_per_km: number | null;
  pace_z1_max_sec_per_km: number | null;
  pace_z2_max_sec_per_km: number | null;
  pace_z3_max_sec_per_km: number | null;
  pace_z4_max_sec_per_km: number | null;
  pace_z5_max_sec_per_km: number | null;
  pace_zones_manual: boolean;
} | null | undefined;

export function ZoneBoundariesCard({ athleteId, profile }: { athleteId: string; profile: ZoneProfile }) {
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  async function saveHrThreshold(bpm: number) {
    await run(
      "hr_threshold",
      () => supabase.rpc("set_hr_threshold_manual", { _athlete_id: athleteId, _hr_threshold: bpm }),
      "Threshold HR updated",
    );
  }

  async function savePaceThreshold(secPerKm: number) {
    await run(
      "pace_threshold",
      () => supabase.rpc("set_pace_threshold_manual", { _athlete_id: athleteId, _threshold_sec_per_km: secPerKm }),
      "Threshold pace updated",
    );
  }

  async function resetHr() {
    await run("hr_reset", () => supabase.rpc("reset_hr_zones_to_auto", { _athlete_id: athleteId }), "HR zones reset to auto");
  }

  async function resetPace() {
    await run("pace_reset", () => supabase.rpc("reset_pace_zones_to_auto", { _athlete_id: athleteId }), "Pace zones reset to auto");
  }

  // Editing an individual boundary (rather than the threshold) is a direct
  // update — same shared calc functions in the DB already gate every write
  // path through the *_manual flags, so this just needs to flip the flag
  // alongside the value. RLS (can_access_athlete) still governs who's
  // allowed to write for this athlete_id, coach or athlete alike.
  async function saveHrBoundary(field: string, bpm: number) {
    await run(field, () =>
      supabase.from("athlete_zone_profiles").update({ [field]: bpm, hr_zones_manual: true } as any).eq("athlete_id", athleteId),
    );
  }

  async function savePaceBoundary(field: string, secPerKm: number) {
    await run(field, () =>
      supabase.from("athlete_zone_profiles").update({ [field]: secPerKm, pace_zones_manual: true } as any).eq("athlete_id", athleteId),
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Zone boundaries</CardTitle>
          <CardDescription>No zone profile yet — set HR max and log a 5K PB.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hrRows: Array<{ z: string; field: string; value: number | null; editable: boolean }> = [
    { z: "Z1", field: "hr_z1_max", value: profile.hr_z1_max, editable: true },
    { z: "Z2", field: "hr_z2_max", value: profile.hr_z2_max, editable: true },
    { z: "Z3", field: "hr_z3_max", value: profile.hr_z3_max, editable: true },
    { z: "Z4", field: "hr_z4_max", value: profile.hr_z4_max, editable: true },
    { z: "Z5", field: "hr_z5_max", value: profile.hr_z5_max, editable: false }, // open-ended fastest zone; display only
  ];

  const paceRows: Array<{ z: string; field: string; value: number | null; editable: boolean }> = [
    { z: "Z1", field: "pace_z1_max_sec_per_km", value: profile.pace_z1_max_sec_per_km, editable: true },
    { z: "Z2", field: "pace_z2_max_sec_per_km", value: profile.pace_z2_max_sec_per_km, editable: true },
    { z: "Z3", field: "pace_z3_max_sec_per_km", value: profile.pace_z3_max_sec_per_km, editable: true },
    { z: "Z4", field: "pace_z4_max_sec_per_km", value: profile.pace_z4_max_sec_per_km, editable: true },
    { z: "Z5", field: "pace_z5_max_sec_per_km", value: profile.pace_z5_max_sec_per_km, editable: false }, // open-ended fastest zone; display only
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zone boundaries</CardTitle>
        <CardDescription>
          One threshold value drives each set of zones. Click any number to override it directly — that switches
          this set to manual and stops it from being recalculated when a new PB or HR max comes in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Threshold HR</div>
              {profile.hr_zones_manual ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Manual</span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Auto</span>
              )}
            </div>
            <div className="font-display text-3xl font-extrabold tabular-nums mt-1">
              <EditableBpm value={profile.hr_threshold} onSave={saveHrThreshold} disabled={savingKey === "hr_threshold"} />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {profile.hr_zones_manual
                ? "Set from a field test — enter a new value to update it."
                : "Auto-suggested as 90% of HR max."}
            </div>
            {profile.hr_zones_manual && (
              <Button size="sm" variant="ghost" className="h-6 px-2 mt-2 text-xs" onClick={resetHr} disabled={savingKey === "hr_reset"}>
                Reset to auto
              </Button>
            )}
          </div>
          <div className="rounded-md border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Threshold Pace</div>
              {profile.pace_zones_manual ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Manual</span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Auto</span>
              )}
            </div>
            <div className="font-display text-3xl font-extrabold tabular-nums mt-1">
              <EditablePace value={profile.pace_threshold_sec_per_km} onSave={savePaceThreshold} disabled={savingKey === "pace_threshold"} />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {profile.pace_zones_manual
                ? "Set from a field test — enter a new value to update it."
                : "Auto-suggested from recent 5K/3K/10K PBs."}
            </div>
            {profile.pace_zones_manual && (
              <Button size="sm" variant="ghost" className="h-6 px-2 mt-2 text-xs" onClick={resetPace} disabled={savingKey === "pace_reset"}>
                Reset to auto
              </Button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">HR zones</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">Zone</th>
                  <th className="text-right">Up to</th>
                </tr>
              </thead>
              <tbody>
                {hrRows.map((r) => (
                  <tr key={r.z} className="border-t">
                    <td className="py-1.5 font-medium">{r.z}</td>
                    <td className="text-right">
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
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Pace zones</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">Zone</th>
                  <th className="text-right">Slower than</th>
                </tr>
              </thead>
              <tbody>
                {paceRows.map((r) => (
                  <tr key={r.z} className="border-t">
                    <td className="py-1.5 font-medium">{r.z}</td>
                    <td className="text-right">
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
