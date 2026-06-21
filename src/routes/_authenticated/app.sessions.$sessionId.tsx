import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { secToClock, clockToSec, metersFmt } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2, Apple } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();

  const { data: session, isLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions").select("*, athletes(name)").eq("id", sessionId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["steps", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("steps").select("*").eq("session_id", sessionId).order("step_order");
      if (error) throw error;
      return data;
    },
  });

  const stepIds = steps?.map((s) => s.id) ?? [];
  const { data: results } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results").select("*").in("step_id", stepIds).order("rep_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: zoneTime } = useQuery({
    queryKey: ["zone-time", sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_zone_time")
        .select("zone, seconds, source")
        .eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: fatigue } = useQuery({
    queryKey: ["fatigue", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("session_fatigue").select("*").eq("session_id", sessionId);
      return data ?? [];
    },
  });

  const { data: fuelEvents } = useQuery({
    queryKey: ["fuel-events", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("session_fuel_events").select("*").eq("session_id", sessionId).order("created_at");
      return data ?? [];
    },
  });

  if (isLoading || !session) return <AppShell><p>Loading…</p></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link to="/app/sessions" className="text-sm text-muted-foreground underline">← Sessions</Link>
          <h1 className="text-2xl font-bold mt-2">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.session_date} · {session.athletes?.name} · <span className="capitalize">{session.category}</span>
            {session.completed_at && <span className="ml-2 text-emerald-600">Completed</span>}
          </p>
        </div>

        {session.notes && <Card><CardContent className="pt-4 text-sm">{session.notes}</CardContent></Card>}

        <div className="space-y-3">
          {(steps ?? []).map((step: any) => (
            <StepBlock
              key={step.id}
              session={session}
              step={step}
              results={(results ?? []).filter((r: any) => r.step_id === step.id)}
              fatigue={(fatigue ?? []).find((f: any) => f.step_id === step.id)}
              fuelEvents={(fuelEvents ?? []).filter((f: any) => f.step_id === step.id)}
            />
          ))}
        </div>

        <SessionSummary session={session} onSaved={() => qc.invalidateQueries({ queryKey: ["session", sessionId] })} />

        <SessionAvgFatigue rows={fatigue ?? []} />
        <ZoneTimePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "pace")} title="Time in pace zones" subtitle="Pace-based" />
        <ZoneTimePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "hr")} title="Time in HR zones" subtitle="HR-based" />
        <FuelingPanel session={session} />
      </div>
    </AppShell>
  );
}

const ZONE_ORDER = ["easy", "steady", "threshold", "vo2", "rep", "sprint", "recovery"] as const;

function ZoneTimePanel({ rows, title, subtitle }: { rows: { zone: string; seconds: number; source: string }[]; title: string; subtitle: string }) {
  if (rows.length === 0) {
    return null;
  }
  const total = rows.reduce((a, r) => a + Number(r.seconds || 0), 0) || 1;
  const sorted = [...rows].sort((a, b) => ZONE_ORDER.indexOf(a.zone as any) - ZONE_ORDER.indexOf(b.zone as any));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
          {sorted.map((r) => (
            <div key={`${r.zone}-${r.source}`} className={zoneBarClass(r.zone)} style={{ width: `${(Number(r.seconds) / total) * 100}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {sorted.map((r) => (
            <div key={`${r.zone}-${r.source}`} className="flex justify-between border rounded px-2 py-1">
              <span className="capitalize flex items-center gap-2"><span className={`h-2 w-2 rounded ${zoneDotClass(r.zone)}`} />{r.zone}</span>
              <span className="tabular-nums">{secToClock(Number(r.seconds))}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function zoneBarClass(zone: string) {
  const m: Record<string, string> = {
    easy: "bg-emerald-400", steady: "bg-sky-400", threshold: "bg-amber-400",
    vo2: "bg-orange-500", rep: "bg-red-500", sprint: "bg-fuchsia-500", recovery: "bg-slate-300",
  };
  return m[zone] ?? "bg-muted";
}
function zoneDotClass(zone: string) { return zoneBarClass(zone); }

function StepBlock({ session, step, results, fatigue, fuelEvents }: { session: any; step: any; results: any[]; fatigue?: any; fuelEvents: any[] }) {
  const qc = useQueryClient();
  const isWork = step.kind === "work";
  const isRecovery = step.kind === "recovery";

  async function saveRep(repNumber: number, patch: any) {
    const existing = results.find((r) => r.rep_number === repNumber);
    if (existing) {
      await supabase.from("interval_results").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("interval_results").insert({ step_id: step.id, rep_number: repNumber, ...patch });
    }
    qc.invalidateQueries({ queryKey: ["results"] });
    qc.invalidateQueries({ queryKey: ["fatigue"] });
    qc.invalidateQueries({ queryKey: ["zone-time"] });
  }

  async function addFuelNote(repNumber: number) {
    const note = window.prompt(`Fueling note for rep ${repNumber}:`);
    if (!note) return;
    await supabase.from("session_fuel_events").insert({
      session_id: session.id, step_id: step.id, rep_number: repNumber,
      athlete_id: session.athlete_id, note,
    });
    qc.invalidateQueries({ queryKey: ["fuel-events", session.id] });
    toast.success("Fueling note added");
  }

  const reps = Array.from({ length: step.reps || 1 }, (_, i) => i + 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base capitalize">
          {step.kind}
          {isWork && step.target_kind === "distance" && ` · ${step.reps}×${metersFmt(step.target_distance_m)}`}
          {isWork && step.target_kind === "time" && ` · ${step.reps}×${secToClock(step.target_time_seconds)}`}
          {isRecovery && ` · ${step.recovery_mode} · ${step.recovery_target_kind === "time" ? secToClock(step.recovery_target_seconds) : metersFmt(step.recovery_target_distance_m)}`}
          {step.is_ladder && <Badge variant="outline" className="ml-2 text-[10px]">Ladder</Badge>}
        </CardTitle>
        {step.target_pace_sec_per_km && <CardDescription>Target pace {secToClock(step.target_pace_sec_per_km)} /km</CardDescription>}
      </CardHeader>
      <CardContent>
        {(isWork || isRecovery) && (
          <div className="space-y-2">
            {reps.map((rep) => {
              const r = results.find((x) => x.rep_number === rep);
              const fuelForRep = fuelEvents.filter((f) => f.rep_number === rep);
              return (
                <RepRow
                  key={rep}
                  step={step}
                  rep={rep}
                  result={r}
                  onSave={(p) => saveRep(rep, p)}
                  onAddFuel={() => addFuelNote(rep)}
                  fuelNotes={fuelForRep}
                />
              );
            })}
          </div>
        )}
        {(step.kind === "warmup" || step.kind === "cooldown") && (
          <RepRow step={step} rep={1} result={results[0]} onSave={(p) => saveRep(1, p)} onAddFuel={() => addFuelNote(1)} fuelNotes={fuelEvents.filter((f) => f.rep_number === 1)} />
        )}
        {isWork && <StepFatiguePanel fatigue={fatigue} isLadder={step.is_ladder} reps={results.length} />}
      </CardContent>
    </Card>
  );
}

function RepRow({ step, rep, result, onSave, onAddFuel, fuelNotes }: { step: any; rep: number; result?: any; onSave: (patch: any) => void; onAddFuel: () => void; fuelNotes: any[] }) {
  const isRecovery = step.kind === "recovery";
  const [time, setTime] = useState(result?.actual_time_seconds ? secToClock(result.actual_time_seconds) : "");
  const [dist, setDist] = useState(result?.actual_distance_m ?? "");
  const [hrEnd, setHrEnd] = useState(result?.hr_end ?? "");
  const [hrRec, setHrRec] = useState(result?.hr_end_recovery ?? "");
  const [hrAvg, setHrAvg] = useState(result?.hr_avg ?? "");
  const [cadence, setCadence] = useState(result?.cadence ?? "");
  const [stride, setStride] = useState(result?.stride_length_cm ?? "");

  function commit() {
    const patch: any = {
      actual_time_seconds: clockToSec(time as any),
      actual_distance_m: dist === "" ? null : Number(dist),
      hr_end: hrEnd === "" ? null : Number(hrEnd),
      hr_end_recovery: hrRec === "" ? null : Number(hrRec),
      hr_avg: hrAvg === "" ? null : Number(hrAvg),
      cadence: cadence === "" ? null : Number(cadence),
      stride_length_cm: stride === "" ? null : Number(stride),
    };
    if (patch.actual_time_seconds && patch.actual_distance_m) {
      patch.actual_pace_sec_per_km = (patch.actual_time_seconds / patch.actual_distance_m) * 1000;
    }
    onSave(patch);
  }

  return (
    <div className="space-y-2 border-l-2 pl-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Rep {rep}</span>
        {!isRecovery && (
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={onAddFuel}>
            <Apple className="h-3 w-3 mr-1" /> Fueling note
          </Button>
        )}
      </div>
      <div className="grid grid-cols-12 gap-2 items-end text-sm">
        <div className="col-span-4 sm:col-span-3"><Label className="text-xs">Time</Label><Input placeholder="mm:ss" value={time} onChange={(e) => setTime(e.target.value)} onBlur={commit} /></div>
        <div className="col-span-4 sm:col-span-3"><Label className="text-xs">Dist (m)</Label><Input type="number" value={dist} onChange={(e) => setDist(e.target.value)} onBlur={commit} /></div>
        {!isRecovery && <div className="col-span-4 sm:col-span-2"><Label className="text-xs">HR avg</Label><Input type="number" value={hrAvg} onChange={(e) => setHrAvg(e.target.value)} onBlur={commit} /></div>}
        <div className="col-span-4 sm:col-span-2"><Label className="text-xs">{isRecovery ? "HR rec" : "HR end"}</Label><Input type="number" value={isRecovery ? hrRec : hrEnd} onChange={(e) => isRecovery ? setHrRec(e.target.value) : setHrEnd(e.target.value)} onBlur={commit} /></div>
        {!isRecovery && <>
          <div className="col-span-4 sm:col-span-2"><Label className="text-xs">Cadence</Label><Input type="number" value={cadence} onChange={(e) => setCadence(e.target.value)} onBlur={commit} /></div>
          <div className="col-span-4 sm:col-span-2"><Label className="text-xs">Stride (cm)</Label><Input type="number" value={stride} onChange={(e) => setStride(e.target.value)} onBlur={commit} /></div>
        </>}
      </div>
      {fuelNotes.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {fuelNotes.map((f) => <div key={f.id}>🍌 {f.note}</div>)}
        </div>
      )}
    </div>
  );
}

function StepFatiguePanel({ fatigue, isLadder, reps }: { fatigue?: any; isLadder?: boolean; reps: number }) {
  if (isLadder) {
    return <div className="mt-3 text-xs text-muted-foreground border-t pt-2">Ladder step — fatigue score suppressed. Per-rep target support coming in a follow-up.</div>;
  }
  if (!fatigue) {
    if (reps < 3) return <div className="mt-3 text-xs text-muted-foreground border-t pt-2">Fatigue score needs at least 3 completed reps.</div>;
    return null;
  }
  const score = fatigue.efficiency_score;
  const label = score == null ? "—" : score >= 85 ? "Held form" : score >= 65 ? "Moderate fade" : "Heavy fade";
  const tone = score == null ? "bg-muted" : score >= 85 ? "bg-emerald-500/15 text-emerald-700" : score >= 65 ? "bg-amber-500/15 text-amber-700" : "bg-red-500/15 text-red-700";
  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Within-session fatigue ({fatigue.method.replace("_", " ")}, {fatigue.rep_count} reps)</div>
        <div className={`px-2 py-0.5 rounded text-sm font-semibold ${tone}`}>{score ?? "—"} · {label}</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <DriftChip label="Pace" value={fatigue.pace_drift_pct} suffix="%" worseHigh />
        <DriftChip label="HR" value={fatigue.hr_drift_bpm} suffix=" bpm" worseHigh />
        <DriftChip label="Stride" value={fatigue.stride_drift_pct} suffix="%" worseHigh />
        <DriftChip label="Cadence" value={fatigue.cadence_drift_pct} suffix="%" worseHigh />
      </div>
    </div>
  );
}

function DriftChip({ label, value, suffix, worseHigh }: { label: string; value: number | null; suffix: string; worseHigh?: boolean }) {
  if (value == null) return <div className="border rounded px-2 py-1 text-muted-foreground">{label}: —</div>;
  const bad = worseHigh ? value > 2 : value < -2;
  return <div className={`border rounded px-2 py-1 ${bad ? "text-red-600 border-red-300" : ""}`}>{label}: {value > 0 ? "+" : ""}{value}{suffix}</div>;
}

function SessionAvgFatigue({ rows }: { rows: any[] }) {
  const scored = rows.filter((r) => r.efficiency_score != null && r.duration_seconds);
  if (scored.length === 0) return null;
  const totalDur = scored.reduce((a, r) => a + Number(r.duration_seconds), 0);
  const weighted = scored.reduce((a, r) => a + Number(r.efficiency_score) * Number(r.duration_seconds), 0) / totalDur;
  const avg = Math.round(weighted);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Within-session fatigue · Session avg</CardTitle>
        <CardDescription>Duration-weighted across {scored.length} scored step{scored.length === 1 ? "" : "s"}. Different from daily readiness.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{avg}<span className="text-base font-normal text-muted-foreground"> / 100</span></div>
      </CardContent>
    </Card>
  );
}

function FuelingPanel({ session }: { session: any }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(session.fueling_notes ?? "");
  async function save() {
    const { error } = await supabase.from("sessions").update({ fueling_notes: notes || null }).eq("id", session.id);
    if (error) toast.error(error.message); else { toast.success("Fueling notes saved"); qc.invalidateQueries({ queryKey: ["session", session.id] }); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Fueling notes (session)</CardTitle><CardDescription>Pre-session, mid-session, post-session — anything food/drink related.</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. oats + banana 2h before, gel at rep 4" />
        <Button variant="outline" size="sm" onClick={save}>Save notes</Button>
      </CardContent>
    </Card>
  );
}

function SessionSummary({ session, onSaved }: { session: any; onSaved: () => void }) {
  const [totalDist, setTotalDist] = useState(session.total_distance_m ?? "");
  const [totalTime, setTotalTime] = useState(session.total_time_seconds ? secToClock(session.total_time_seconds) : "");
  const [avgHr, setAvgHr] = useState(session.avg_hr ?? "");
  const [rpe, setRpe] = useState(session.rpe ?? 5);

  async function complete() {
    const { error } = await supabase.from("sessions").update({
      total_distance_m: totalDist === "" ? null : Number(totalDist),
      total_time_seconds: clockToSec(totalTime as any),
      avg_hr: avgHr === "" ? null : Number(avgHr),
      rpe,
      completed_at: new Date().toISOString(),
    }).eq("id", session.id);
    if (error) toast.error(error.message);
    else { toast.success("Session marked complete"); onSaved(); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Session totals & RPE</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Total distance (m)</Label><Input type="number" value={totalDist} onChange={(e) => setTotalDist(e.target.value)} /></div>
          <div><Label>Total time (mm:ss)</Label><Input value={totalTime} onChange={(e) => setTotalTime(e.target.value)} /></div>
          <div><Label>Avg HR</Label><Input type="number" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} /></div>
        </div>
        <div>
          <Label>RPE (1–10): <span className="tabular-nums">{rpe}</span></Label>
          <Slider min={1} max={10} step={1} value={[rpe]} onValueChange={(v) => setRpe(v[0])} className="mt-2" />
        </div>
        <Button onClick={complete} className="w-full"><CheckCircle2 className="h-4 w-4 mr-1" /> Mark complete</Button>
      </CardContent>
    </Card>
  );
}