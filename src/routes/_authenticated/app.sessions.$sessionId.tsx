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
import { secToClock, clockToSec, metersFmt } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

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
            <StepBlock key={step.id} step={step} results={(results ?? []).filter((r: any) => r.step_id === step.id)} />
          ))}
        </div>

        <SessionSummary session={session} onSaved={() => qc.invalidateQueries({ queryKey: ["session", sessionId] })} />
      </div>
    </AppShell>
  );
}

function StepBlock({ step, results }: { step: any; results: any[] }) {
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
        </CardTitle>
        {step.target_pace_sec_per_km && <CardDescription>Target pace {secToClock(step.target_pace_sec_per_km)} /km</CardDescription>}
      </CardHeader>
      <CardContent>
        {(isWork || isRecovery) && (
          <div className="space-y-2">
            {reps.map((rep) => {
              const r = results.find((x) => x.rep_number === rep);
              return <RepRow key={rep} step={step} rep={rep} result={r} onSave={(p) => saveRep(rep, p)} />;
            })}
          </div>
        )}
        {(step.kind === "warmup" || step.kind === "cooldown") && (
          <RepRow step={step} rep={1} result={results[0]} onSave={(p) => saveRep(1, p)} />
        )}
      </CardContent>
    </Card>
  );
}

function RepRow({ step, rep, result, onSave }: { step: any; rep: number; result?: any; onSave: (patch: any) => void }) {
  const isRecovery = step.kind === "recovery";
  const [time, setTime] = useState(result?.actual_time_seconds ? secToClock(result.actual_time_seconds) : "");
  const [dist, setDist] = useState(result?.actual_distance_m ?? "");
  const [hrEnd, setHrEnd] = useState(result?.hr_end ?? "");
  const [hrRec, setHrRec] = useState(result?.hr_end_recovery ?? "");

  function commit() {
    const patch: any = {
      actual_time_seconds: clockToSec(time as any),
      actual_distance_m: dist === "" ? null : Number(dist),
      hr_end: hrEnd === "" ? null : Number(hrEnd),
      hr_end_recovery: hrRec === "" ? null : Number(hrRec),
    };
    if (patch.actual_time_seconds && patch.actual_distance_m) {
      patch.actual_pace_sec_per_km = (patch.actual_time_seconds / patch.actual_distance_m) * 1000;
    }
    onSave(patch);
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-end text-sm">
      <div className="col-span-2 text-muted-foreground">Rep {rep}</div>
      <div className="col-span-3"><Label className="text-xs">Time</Label><Input placeholder="mm:ss" value={time} onChange={(e) => setTime(e.target.value)} onBlur={commit} /></div>
      <div className="col-span-3"><Label className="text-xs">Distance (m)</Label><Input type="number" value={dist} onChange={(e) => setDist(e.target.value)} onBlur={commit} /></div>
      {!isRecovery && <div className="col-span-2"><Label className="text-xs">HR end</Label><Input type="number" value={hrEnd} onChange={(e) => setHrEnd(e.target.value)} onBlur={commit} /></div>}
      <div className="col-span-2"><Label className="text-xs">{isRecovery ? "HR after rec" : "HR rec"}</Label><Input type="number" value={hrRec} onChange={(e) => setHrRec(e.target.value)} onBlur={commit} /></div>
    </div>
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