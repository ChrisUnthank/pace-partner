import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { sessionClassificationLabel } from "@/lib/session-categories";
import { saveSessionAsTemplate } from "@/lib/templates";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, Apple, BookmarkPlus, LineChart, Sparkles } from "lucide-react";
import { PostSessionInsightModal } from "@/components/post-session-insight-modal";
import { useServerFn } from "@tanstack/react-start";
import { getLatestAthleteNote, generateSessionNote, getAiAccessStatus } from "@/lib/ai.functions";
import ReactMarkdown from "react-markdown";
import { markAttendance } from "@/lib/messages.functions";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { ActivityIcon } from "@/lib/activity-icon";
import { invalidateSession } from "@/lib/session-invalidation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/sessions/$sessionId/")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);

  const { data: session, isLoading, error } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions").select("*, athletes(name, profile_image_url)").eq("id", sessionId).single();
      if (error) throw error;
      return data;
    },
    retry: false,
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
  const { data: results, isFetching: resultsLoading } = useQuery({
    queryKey: ["results", sessionId, stepIds.join(",")],
    enabled: stepIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interval_results").select("*").in("step_id", stepIds).order("set_number").order("rep_number");
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

  const { data: insight } = useQuery({
    queryKey: ["session_insights", sessionId],
    queryFn: async () => {
      const { data } = await supabase.from("session_insights" as any).select("*").eq("session_id", sessionId).maybeSingle();
      return data as any;
    },
  });

  if (isLoading) return <AppShell><p>Loading…</p></AppShell>;
  if (error || !session) {
    return (
      <AppShell>
        <div className="space-y-3 max-w-lg">
          <h1 className="text-lg font-semibold">Session not found</h1>
          <p className="text-sm text-muted-foreground">
            This session may have been deleted, or you may not have access to it.
            {error ? <> <span className="block mt-1 text-xs">({(error as any).message})</span></> : null}
          </p>
          <Button asChild variant="outline" size="sm"><Link to="/app/sessions">← Back to sessions</Link></Button>
        </div>
      </AppShell>
    );
  }

  const canSaveAsTemplate = isCoach && (session as any).day_type === "training";

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link to="/app/sessions" className="text-sm text-muted-foreground underline">← Sessions</Link>
          <div className="flex items-start justify-between gap-3 mt-2">
            <div className="flex items-start gap-3">
              <UserAvatar
                name={session.athletes?.name}
                imageUrl={(session.athletes as any)?.profile_image_url}
                size="lg"
              />
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <ActivityIcon session={session as any} size={22} className="text-muted-foreground" />
                  {session.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {session.session_date} · {session.athletes?.name} · {sessionClassificationLabel(session as any)}
                  {(session as any).applied_from_template_id && <span className="ml-2 italic">· from template</span>}
                  {session.completed_at && <span className="ml-2 text-emerald-600">Completed</span>}
                  {session.completed_at && session.rpe != null && (
                    <span className="ml-2">· RPE <span className="tabular-nums font-medium">{session.rpe}</span>/10</span>
                  )}
                </p>
              </div>
            </div>
            {canSaveAsTemplate && (
              <Button size="sm" variant="outline" onClick={() => { setTplName(session.title ?? ""); setSaveTplOpen(true); }}>
                <BookmarkPlus className="h-4 w-4 mr-1" />Save as template
              </Button>
            )}
            {session.completed_at && (
              <Button asChild size="sm" variant="outline">
                <Link to="/app/sessions/$sessionId/analysis" params={{ sessionId }}>
                  <LineChart className="h-4 w-4 mr-1" />View analysis
                </Link>
              </Button>
            )}
          </div>
        </div>

        {session.notes && <Card><CardContent className="pt-4 text-sm">{session.notes}</CardContent></Card>}

        <div className="space-y-3">
          {stepIds.length > 0 && resultsLoading && !results ? (
            <Card><CardContent className="pt-4 text-sm text-muted-foreground">Loading session data…</CardContent></Card>
          ) : (steps ?? []).map((step: any) => (
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

        <SessionSummary
          session={session}
          onSaved={() => invalidateSession(qc, sessionId, session.athlete_id)}
          onCompleted={() => setInsightOpen(true)}
        />

        {isCoach && (
          <AttendanceCard
            sessionId={sessionId}
            athleteId={session.athlete_id}
            athleteName={session.athletes?.name ?? "Athlete"}
          />
        )}

        {insight && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Athlete reflection</CardTitle>
              <CardDescription>How the session felt afterwards.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Feel</span>
                <span className="font-display text-2xl font-extrabold tabular-nums">{insight.feel_score ?? "—"}<span className="text-sm font-normal text-muted-foreground">/10</span></span>
              </div>
              {insight.went_well && <p><span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Went well</span>{insight.went_well}</p>}
              {insight.was_difficult && <p><span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Difficult</span>{insight.was_difficult}</p>}
              {insight.niggles && <p className="text-amber-500"><span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">Niggles</span>{insight.niggles}</p>}
            </CardContent>
          </Card>
        )}

        <SessionAvgFatigue rows={fatigue ?? []} />
        <ZoneTimePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "pace")} title="Time in pace zones" subtitle="Pace-based" />
        <ZoneTimePanel rows={(zoneTime ?? []).filter((r: any) => r.source === "hr")} title="Time in HR zones" subtitle="HR-based" />
        <FuelingPanel session={session} />
      </div>

      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save session as template</DialogTitle>
            <DialogDescription>Saves the structure (steps, sets, reps, targets, recovery) — not athlete, date, or results.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Template name</Label>
            <Input className="mt-1" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="e.g. Tuesday threshold — 6x800m" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!tplName.trim()) { toast.error("Name required"); return; }
              const res = await saveSessionAsTemplate({ sessionId, ownerUserId: user!.id, name: tplName.trim() });
              if (!res.ok) { toast.error(res.error); return; }
              toast.success("Template saved"); setSaveTplOpen(false);
              qc.invalidateQueries({ queryKey: ["templates"] });
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PostSessionInsightModal
        open={insightOpen}
        onOpenChange={setInsightOpen}
        sessionId={sessionId}
        athleteId={session.athlete_id}
        onSaved={() => qc.invalidateQueries({ queryKey: ["session_insights", sessionId] })}
      />
      <div className="max-w-4xl mt-4">
        <SessionAINote sessionId={sessionId} athleteId={session.athlete_id} />
      </div>
    </AppShell>
  );
}

function AttendanceCard({ sessionId, athleteId, athleteName }: { sessionId: string; athleteId: string; athleteName: string }) {
  const qc = useQueryClient();
  const markFn = useServerFn(markAttendance);
  const { data: attended } = useQuery({
    queryKey: ["attendance", sessionId, athleteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_attendance")
        .select("id")
        .eq("session_id", sessionId)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      return !!data;
    },
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Attendance</CardTitle>
        <CardDescription>Mark whether {athleteName} attended this session.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Switch
          checked={!!attended}
          onCheckedChange={async (v) => {
            await markFn({ data: { sessionId, athleteId, attended: v } });
            qc.invalidateQueries({ queryKey: ["attendance", sessionId, athleteId] });
            toast.success(v ? "Marked attended" : "Marked absent");
          }}
        />
        <span className="text-sm text-muted-foreground">{attended ? "Attended" : "Not marked"}</span>
      </CardContent>
    </Card>
  );
}

function SessionAINote({ sessionId, athleteId }: { sessionId: string; athleteId: string }) {
  const getNote = useServerFn(getLatestAthleteNote);
  const gen = useServerFn(generateSessionNote);
  const access = useServerFn(getAiAccessStatus);
  const { data: ai } = useQuery({ queryKey: ["ai-access"], queryFn: () => access() });
  const { data: note, refetch } = useQuery({
    queryKey: ["ai-session-note", sessionId],
    queryFn: () => getNote({ data: { athleteId, kind: "session", sessionId } }),
  });
  if (ai && !ai.allowed) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI session reflection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {note?.content ? (
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{note.content}</ReactMarkdown></div>
        ) : (
          <p className="text-sm text-muted-foreground">No AI reflection yet.</p>
        )}
        <Button size="sm" variant="outline" onClick={() => gen({ data: { sessionId } }).then(() => refetch())}>
          {note?.content ? "Regenerate" : "Generate"}
        </Button>
      </CardContent>
    </Card>
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
  const isStrides = step.kind === "strides";
  const setCount = Math.max(1, step.set_count ?? 1);

  async function saveRep(setNumber: number, repNumber: number, patch: any) {
    const row = { step_id: step.id, set_number: setNumber, rep_number: repNumber, ...patch };
    const { error } = await supabase
      .from("interval_results")
      .upsert(row, { onConflict: "step_id,set_number,rep_number" });
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    invalidateSession(qc, session.id, session.athlete_id);
  }

  const reps = Array.from({ length: step.reps || 1 }, (_, i) => i + 1);
  const sets = Array.from({ length: setCount }, (_, i) => i + 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base capitalize">
          {step.kind === "recovery" ? "Recovery between blocks" : step.kind}
          {isWork && step.target_kind === "distance" && ` · ${setCount > 1 ? `${setCount}×` : ""}${step.reps}×${metersFmt(step.target_distance_m)}`}
          {isWork && step.target_kind === "time" && ` · ${step.reps}×${secToClock(step.target_time_seconds)}`}
          {isStrides && ` · ${step.reps}×${metersFmt(step.target_distance_m)}`}
          {isRecovery && ` · ${step.recovery_mode} · ${step.recovery_target_kind === "time" ? secToClock(step.recovery_target_seconds) : metersFmt(step.recovery_target_distance_m)}`}
          {step.is_ladder && <Badge variant="outline" className="ml-2 text-[10px]">Ladder</Badge>}
          {isStrides && (
            step.counts_toward_distance
              ? <Badge className="ml-2 text-[10px] bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">Stride · counts</Badge>
              : <Badge className="ml-2 text-[10px] bg-amber-500/20 text-amber-700 hover:bg-amber-500/20">Run-through · excluded from weekly km</Badge>
          )}
        </CardTitle>
        {step.target_pace_sec_per_km && <CardDescription>Target pace {secToClock(step.target_pace_sec_per_km)} /km</CardDescription>}
        {isWork && (() => {
          const repsKind = step.recovery_between_reps_target_kind ?? "time";
          const setsKind = step.recovery_between_sets_target_kind ?? "time";
          const repsVal = repsKind === "distance"
            ? (step.recovery_between_reps_distance_m ? metersFmt(step.recovery_between_reps_distance_m) : null)
            : (step.recovery_between_reps_seconds ? secToClock(step.recovery_between_reps_seconds) : null);
          const setsVal = setsKind === "distance"
            ? (step.recovery_between_sets_distance_m ? metersFmt(step.recovery_between_sets_distance_m) : null)
            : (step.recovery_between_sets_seconds ? secToClock(step.recovery_between_sets_seconds) : null);
          const mode = step.recovery_between_reps_mode;
          if (!repsVal && !setsVal) return null;
          return (
            <CardDescription className="text-xs">
              {repsVal && <>Recovery between reps: {mode ? `${mode} ` : ""}{repsVal}</>}
              {repsVal && setsVal && " · "}
              {setsVal && <>Between sets: {step.recovery_between_sets_mode ? `${step.recovery_between_sets_mode} ` : ""}{setsVal}</>}
            </CardDescription>
          );
        })()}
      </CardHeader>
      <CardContent>
        {(isWork || isStrides) && (
          <div className="space-y-3">
            {sets.map((setN) => (
              <div key={setN} className="space-y-2">
                {setCount > 1 && (
                  <div className="text-xs font-semibold text-muted-foreground border-b pb-1">Set {setN} of {setCount}</div>
                )}
                {reps.map((rep) => {
                  const r = results.find((x) => x.rep_number === rep && (x.set_number ?? 1) === setN);
                  const fuelForRep = fuelEvents.filter((f) => f.rep_number === rep);
                  return (
                    <RepRow
                      key={`${setN}-${rep}`}
                      step={step}
                      rep={rep}
                      result={r}
                      onSave={(p) => saveRep(setN, rep, p)}
                      onAddFuel={() => addFuelNote(rep)}
                      fuelNotes={fuelForRep}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {isRecovery && (
          <div className="space-y-2">
            {reps.map((rep) => {
              const r = results.find((x) => x.rep_number === rep);
              return <RepRow key={rep} step={step} rep={rep} result={r} onSave={(p) => saveRep(1, rep, p)} onAddFuel={() => addFuelNote(rep)} fuelNotes={[]} />;
            })}
          </div>
        )}
        {(step.kind === "warmup" || step.kind === "cooldown") && (
          <RepRow step={step} rep={1} result={results[0]} onSave={(p) => saveRep(1, 1, p)} onAddFuel={() => addFuelNote(1)} fuelNotes={fuelEvents.filter((f) => f.rep_number === 1)} />
        )}
        {isWork && <StepFatiguePanel fatigue={fatigue} isLadder={step.is_ladder} reps={results.length} />}
      </CardContent>
    </Card>
  );
}

function RepRow({ step, rep, result, onSave, onAddFuel, fuelNotes }: { step: any; rep: number; result?: any; onSave: (patch: any) => void; onAddFuel: () => void; fuelNotes: any[] }) {
  const isRecovery = step.kind === "recovery";
  const [time, setTime] = useState("");
  const [dist, setDist] = useState<string | number>("");
  const [hrEnd, setHrEnd] = useState<string | number>("");
  const [hrRec, setHrRec] = useState<string | number>("");
  const [hrAvg, setHrAvg] = useState<string | number>("");
  const [cadence, setCadence] = useState<string | number>("");
  const [stride, setStride] = useState<string | number>("");
  // Hydrate / re-hydrate from the loaded result whenever it changes.
  const resultKey = result?.id ?? "none";
  useEffect(() => {
    setTime(result?.actual_time_seconds ? secToClock(result.actual_time_seconds) : "");
    setDist(result?.actual_distance_m ?? "");
    setHrEnd(result?.hr_end ?? "");
    setHrRec(result?.hr_end_recovery ?? "");
    setHrAvg(result?.hr_avg ?? "");
    setCadence(result?.cadence ?? "");
    setStride(result?.stride_length_cm ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);

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

function SessionSummary({ session, onSaved, onCompleted }: { session: any; onSaved: () => void; onCompleted?: () => void }) {
  const [totalDist, setTotalDist] = useState<string | number>("");
  const [totalTime, setTotalTime] = useState("");
  const [avgHr, setAvgHr] = useState<string | number>("");
  const [rpe, setRpe] = useState<number>(5);
  // Re-sync whenever the underlying session row changes (after server-side recompute).
  useEffect(() => {
    setTotalDist(session.total_distance_m ?? "");
    setTotalTime(session.total_time_seconds ? secToClock(session.total_time_seconds) : "");
    setAvgHr(session.avg_hr ?? "");
    setRpe(session.rpe ?? 5);
  }, [session.id, session.updated_at, session.total_distance_m, session.total_time_seconds, session.avg_hr, session.rpe]);

  async function complete() {
    const wasAlreadyComplete = !!session.completed_at;
    const { error } = await supabase.from("sessions").update({
      total_distance_m: totalDist === "" ? null : Number(totalDist),
      total_time_seconds: clockToSec(totalTime as any),
      avg_hr: avgHr === "" ? null : Number(avgHr),
      rpe,
      ...(wasAlreadyComplete ? {} : { completed_at: new Date().toISOString() }),
    }).eq("id", session.id);
    if (error) toast.error(error.message);
    else {
      toast.success(wasAlreadyComplete ? "Session updated" : "Session marked complete");
      onSaved();
      if (!wasAlreadyComplete) onCompleted?.();
    }
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
        <Button onClick={complete} className="w-full">
          <CheckCircle2 className="h-4 w-4 mr-1" />
          {session.completed_at ? "Update totals & RPE" : "Mark complete"}
        </Button>
      </CardContent>
    </Card>
  );
}