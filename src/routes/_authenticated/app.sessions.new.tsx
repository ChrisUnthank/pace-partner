import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { todayISO, clockToSec, secToClock } from "@/lib/format";
import { SESSION_INTENTS, INTENT_LABEL, SESSION_STRUCTURES, STRUCTURE_LABEL, SESSION_DAY_TYPES, DAY_TYPE_LABEL } from "@/lib/session-categories";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Lock } from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/_authenticated/app/sessions/new")({
  component: NewSession,
});

type StepDraft = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  reps: number;
  set_count?: number;
  target_kind?: "time" | "distance";
  target_distance_m?: number | null;
  target_time_seconds?: number | null;
  target_pace_sec_per_km?: number | null;
  is_ladder?: boolean;
  counts_toward_distance?: boolean;
  recovery_between_reps_seconds?: number | null;
  recovery_between_reps_mode?: "standing" | "walk" | "jog" | "float";
  recovery_between_reps_target_kind?: "time" | "distance";
  recovery_between_reps_distance_m?: number | null;
  recovery_between_sets_seconds?: number | null;
  recovery_between_sets_mode?: "standing" | "walk" | "jog" | "float";
  recovery_between_sets_target_kind?: "time" | "distance";
  recovery_between_sets_distance_m?: number | null;
  recovery_mode?: "standing" | "walk" | "jog" | "float";
  recovery_target_kind?: "time" | "distance";
  recovery_target_seconds?: number | null;
  recovery_target_distance_m?: number | null;
  notes?: string;
  _uid?: string;
};

const defaultStep = (kind: StepDraft["kind"]): StepDraft => kind === "recovery"
  ? { kind, reps: 1, recovery_mode: "jog", recovery_target_kind: "time", recovery_target_seconds: 90 }
  : kind === "work"
    ? { kind, reps: 6, set_count: 1, target_kind: "distance", target_distance_m: 400,
        recovery_between_reps_seconds: 90, recovery_between_reps_mode: "jog", recovery_between_reps_target_kind: "time",
        recovery_between_sets_seconds: 180, recovery_between_sets_mode: "walk", recovery_between_sets_target_kind: "time",
        counts_toward_distance: true }
    : kind === "strides"
      ? { kind, reps: 4, target_kind: "distance", target_distance_m: 80, counts_toward_distance: true }
      : { kind, reps: 1, target_kind: "time", target_time_seconds: 600, counts_toward_distance: true };

let _uidCounter = 0;
const withUid = (s: StepDraft): StepDraft => ({ ...s, _uid: s._uid ?? `s${++_uidCounter}_${Date.now()}` });

function NewSession() {
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");

  const { data: rosterAthletes } = useQuery({
    queryKey: ["coach-roster", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase.from("coach_athletes")
        .select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["templates", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase.from("session_templates").select("id, name, title, intent, structure, is_long_run, notes").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const [athleteId, setAthleteId] = useState<string>("");
  const [sessionDate, setSessionDate] = useState(todayISO());
  const [title, setTitle] = useState("");
  const [dayType, setDayType] = useState<string>("training");
  const [intent, setIntent] = useState<string>("threshold");
  const [structure, setStructure] = useState<string>("reps_intervals");
  const [isLongRun, setIsLongRun] = useState<boolean>(false);
  const [notes, setNotes] = useState("");
  const [appliedFromTemplateId, setAppliedFromTemplateId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([
    withUid(defaultStep("warmup")),
    withUid(defaultStep("work")),
    withUid(defaultStep("cooldown")),
  ]);

  const effectiveAthleteId = athleteId || myAthlete?.id || "";

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeStep(i: number) { setSteps((s) => s.filter((_, idx) => idx !== i)); }
  function addStep(kind: StepDraft["kind"]) {
    setSteps((s) => {
      const next = withUid(defaultStep(kind));
      if (kind === "warmup") {
        // Insert at top of middle (after existing warmups)
        const lastWarm = s.map((x) => x.kind).lastIndexOf("warmup");
        const idx = lastWarm >= 0 ? lastWarm + 1 : 0;
        return [...s.slice(0, idx), next, ...s.slice(idx)];
      }
      if (kind === "cooldown") return [...s, next];
      // work / recovery / strides → insert before first cooldown (or at end)
      const firstCool = s.findIndex((x) => x.kind === "cooldown");
      const idx = firstCool === -1 ? s.length : firstCool;
      return [...s.slice(0, idx), next, ...s.slice(idx)];
    });
  }

  function moveStep(from: number, to: number) {
    setSteps((s) => {
      if (to < 0 || to >= s.length) return s;
      // Anchors: first warmup must stay at 0; last cooldown at end.
      if (s[from].kind === "warmup" || s[from].kind === "cooldown") return s;
      if (s[to].kind === "warmup" || s[to].kind === "cooldown") return s;
      return arrayMove(s, from, to);
    });
  }

  async function loadTemplate(templateId: string) {
    const tpl = (templates ?? []).find((t: any) => t.id === templateId);
    if (!tpl) return;
    const { data: tsteps, error } = await supabase
      .from("template_steps").select("*").eq("template_id", templateId).order("step_order");
    if (error) { toast.error(error.message); return; }
    setTitle((tpl as any).title ?? "");
    setNotes((tpl as any).notes ?? "");
    setDayType("training");
    setIntent((tpl as any).intent);
    setStructure((tpl as any).structure);
    setIsLongRun(!!(tpl as any).is_long_run);
    setAppliedFromTemplateId(templateId);
    setSteps((tsteps ?? []).map((s: any) => withUid({
      kind: s.kind, reps: s.reps, set_count: s.set_count,
      target_kind: s.target_kind, target_distance_m: s.target_distance_m,
      target_time_seconds: s.target_time_seconds, target_pace_sec_per_km: s.target_pace_sec_per_km,
      is_ladder: s.is_ladder, counts_toward_distance: s.counts_toward_distance,
      recovery_between_reps_seconds: s.recovery_between_reps_seconds,
      recovery_between_reps_mode: s.recovery_between_reps_mode,
      recovery_between_reps_target_kind: s.recovery_between_reps_target_kind ?? "time",
      recovery_between_reps_distance_m: s.recovery_between_reps_distance_m,
      recovery_between_sets_seconds: s.recovery_between_sets_seconds,
      recovery_between_sets_mode: s.recovery_between_sets_mode,
      recovery_between_sets_target_kind: s.recovery_between_sets_target_kind ?? "time",
      recovery_between_sets_distance_m: s.recovery_between_sets_distance_m,
      recovery_mode: s.recovery_mode, recovery_target_kind: s.recovery_target_kind,
      recovery_target_seconds: s.recovery_target_seconds, recovery_target_distance_m: s.recovery_target_distance_m,
      notes: s.notes,
    })));
    toast.success(`Loaded "${(tpl as any).name}" — edit freely before saving`);
  }

  async function save() {
    if (!effectiveAthleteId) { toast.error("Pick an athlete"); return; }
    if (!title) { toast.error("Title is required"); return; }
    if (dayType === "training" && (!intent || !structure)) {
      toast.error("Training sessions need intent and structure"); return;
    }
    const { data: sess, error } = await supabase.from("sessions").insert({
      athlete_id: effectiveAthleteId,
      created_by: user!.id,
      session_date: sessionDate,
      title,
      day_type: dayType as any,
      intent: dayType === "training" ? (intent as any) : null,
      structure: dayType === "training" ? (structure as any) : null,
      is_long_run: dayType === "training" ? isLongRun : false,
      notes: notes || null,
      is_planned: true,
      applied_from_template_id: appliedFromTemplateId,
    } as any).select().single();
    if (error || !sess) { toast.error(error?.message ?? "Failed"); return; }

    const stepRows = steps.map((s, i) => ({
      session_id: sess.id, step_order: i + 1,
      kind: s.kind, reps: s.reps,
      set_count: s.kind === "work" ? Math.max(1, s.set_count ?? 1) : 1,
      target_kind: s.target_kind ?? null,
      target_distance_m: s.target_distance_m ?? null,
      target_time_seconds: s.target_time_seconds ?? null,
      target_pace_sec_per_km: s.target_pace_sec_per_km ?? null,
      is_ladder: s.kind === "work" ? !!s.is_ladder : false,
      counts_toward_distance: s.counts_toward_distance ?? true,
      recovery_between_reps_seconds: s.kind === "work" ? (s.recovery_between_reps_seconds ?? null) : null,
      recovery_between_reps_mode: s.kind === "work" ? (s.recovery_between_reps_mode ?? null) : null,
      recovery_between_sets_seconds: s.kind === "work" && (s.set_count ?? 1) > 1 ? (s.recovery_between_sets_seconds ?? null) : null,
      recovery_between_sets_mode: s.kind === "work" && (s.set_count ?? 1) > 1 ? (s.recovery_between_sets_mode ?? null) : null,
      recovery_mode: s.recovery_mode ?? null,
      recovery_target_kind: s.recovery_target_kind ?? null,
      recovery_target_seconds: s.recovery_target_seconds ?? null,
      recovery_target_distance_m: s.recovery_target_distance_m ?? null,
      notes: s.notes ?? null,
    }));
    const { error: stepErr } = await supabase.from("steps").insert(stepRows);
    if (stepErr) { toast.error(stepErr.message); return; }
    toast.success("Session created");
    navigate({ to: "/app/sessions/$sessionId", params: { sessionId: sess.id } });
  }

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold">New session</h1>

        {isCoach && (templates ?? []).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Start from a template</CardTitle>
              <CardDescription>Prefills the builder. Everything stays fully editable.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value="" onValueChange={loadTemplate}>
                <SelectTrigger><SelectValue placeholder="Pick a template…" /></SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Athlete</Label>
              {isCoach ? (
                <Select value={athleteId} onValueChange={setAthleteId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Pick athlete" /></SelectTrigger>
                  <SelectContent>
                    {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                    {(rosterAthletes ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <Input className="mt-1" value={myAthlete?.name ?? ""} readOnly />}
            </div>
            <div><Label>Date</Label><Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="mt-1" /></div>
            <div className="sm:col-span-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 6x800m @ 3k pace, 200m jog" className="mt-1" /></div>
            <div>
              <Label>Day type</Label>
              <Select value={dayType} onValueChange={setDayType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SESSION_DAY_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>{DAY_TYPE_LABEL[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {dayType === "training" && (
              <>
                <div>
                  <Label>Intent</Label>
                  <Select value={intent} onValueChange={setIntent}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SESSION_INTENTS.map((i) => (
                        <SelectItem key={i} value={i}>{INTENT_LABEL[i]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Structure</Label>
                  <Select value={structure} onValueChange={setStructure}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SESSION_STRUCTURES.map((s) => (
                        <SelectItem key={s} value={s}>{STRUCTURE_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <Checkbox id="is-long-run" checked={isLongRun} onCheckedChange={(v) => setIsLongRun(!!v)} />
                  <Label htmlFor="is-long-run" className="text-sm font-normal">
                    Long run — tracked separately for weekly long-run accountability
                  </Label>
                </div>
              </>
            )}
            <div className="sm:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            <CardDescription>Build the session: warmup → work + recovery blocks → cooldown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((s, i) => (
              <div key={i} className="border rounded-md p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold capitalize">{i+1}. {s.kind}</span>
                  <Button size="sm" variant="ghost" onClick={() => removeStep(i)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {s.kind === "work" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Sets</Label><Input type="number" min={1} value={s.set_count ?? 1} onChange={(e) => updateStep(i, { set_count: Math.max(1, Number(e.target.value)) })} /></div>
                    <div><Label className="text-xs">Reps</Label><Input type="number" value={s.reps} onChange={(e) => updateStep(i, { reps: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Target</Label>
                      <Select value={s.target_kind} onValueChange={(v) => updateStep(i, { target_kind: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="distance">Distance (m)</SelectItem>
                          <SelectItem value="time">Time (mm:ss)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {s.target_kind === "distance" ? (
                      <div><Label className="text-xs">Distance (m)</Label><Input type="number" value={s.target_distance_m ?? ""} onChange={(e) => updateStep(i, { target_distance_m: Number(e.target.value) })} /></div>
                    ) : (
                      <div><Label className="text-xs">Time (mm:ss)</Label><Input placeholder="3:00" onChange={(e) => updateStep(i, { target_time_seconds: clockToSec(e.target.value) })} /></div>
                    )}
                    <div><Label className="text-xs">Target pace (mm:ss /km)</Label><Input placeholder="3:30" onChange={(e) => updateStep(i, { target_pace_sec_per_km: clockToSec(e.target.value) })} /></div>
                    <div><Label className="text-xs">Recovery between reps (mm:ss)</Label><Input placeholder="1:30" defaultValue={s.recovery_between_reps_seconds ? secToClock(s.recovery_between_reps_seconds) : ""} onChange={(e) => updateStep(i, { recovery_between_reps_seconds: clockToSec(e.target.value) })} /></div>
                    {(s.set_count ?? 1) > 1 && (
                      <div><Label className="text-xs">Recovery between sets (mm:ss)</Label><Input placeholder="3:00" defaultValue={s.recovery_between_sets_seconds ? secToClock(s.recovery_between_sets_seconds) : ""} onChange={(e) => updateStep(i, { recovery_between_sets_seconds: clockToSec(e.target.value) })} /></div>
                    )}
                    <div className="col-span-2 text-xs text-muted-foreground">
                      Plan: <span className="font-semibold">{s.set_count ?? 1} set{(s.set_count ?? 1) > 1 ? "s" : ""} × {s.reps} rep{s.reps === 1 ? "" : "s"}</span>
                      {(s.set_count ?? 1) > 1 && <> = {(s.set_count ?? 1) * s.reps} total reps</>}
                    </div>
                    <div className="col-span-2 flex items-center gap-2 pt-1">
                      <Checkbox id={`ladder-${i}`} checked={!!s.is_ladder} onCheckedChange={(v) => updateStep(i, { is_ladder: !!v })} />
                      <Label htmlFor={`ladder-${i}`} className="text-xs font-normal">
                        Ladder (reps have different distances/paces) — suppresses fatigue score until per-rep targets ship
                      </Label>
                    </div>
                  </div>
                )}
                {s.kind === "strides" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Reps</Label><Input type="number" value={s.reps} onChange={(e) => updateStep(i, { reps: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Distance (m)</Label><Input type="number" value={s.target_distance_m ?? ""} onChange={(e) => updateStep(i, { target_distance_m: Number(e.target.value), target_kind: "distance" })} /></div>
                    <div className={`col-span-2 rounded-md border-2 p-2 ${s.counts_toward_distance ? "border-emerald-500 bg-emerald-500/5" : "border-amber-500 bg-amber-500/10"}`}>
                      <div className="flex items-center gap-2">
                        <Checkbox id={`ctd-${i}`} checked={!!s.counts_toward_distance} onCheckedChange={(v) => updateStep(i, { counts_toward_distance: !!v })} />
                        <Label htmlFor={`ctd-${i}`} className="text-xs font-semibold">
                          {s.counts_toward_distance ? "✓ Counts toward weekly distance (end-of-session Stride)" : "⚠ Does NOT count toward weekly distance (warm-up Run-through)"}
                        </Label>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        <strong>Strides</strong> = end-of-session work, counts toward weekly km and zone time. <strong>Run-throughs</strong> = warm-up prep, must NOT count. Place before/after main work accordingly and double-check this toggle before saving.
                      </p>
                    </div>
                  </div>
                )}
                {s.kind === "recovery" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Mode</Label>
                      <Select value={s.recovery_mode} onValueChange={(v) => updateStep(i, { recovery_mode: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standing">Standing</SelectItem>
                          <SelectItem value="walk">Walk</SelectItem>
                          <SelectItem value="jog">Jog</SelectItem>
                          <SelectItem value="float">Float</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-xs">Target</Label>
                      <Select value={s.recovery_target_kind} onValueChange={(v) => updateStep(i, { recovery_target_kind: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="time">Time</SelectItem>
                          <SelectItem value="distance">Distance</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {s.recovery_target_kind === "time" ? (
                      <div className="col-span-2"><Label className="text-xs">Recovery (mm:ss)</Label><Input placeholder="1:30" onChange={(e) => updateStep(i, { recovery_target_seconds: clockToSec(e.target.value) })} /></div>
                    ) : (
                      <div className="col-span-2"><Label className="text-xs">Recovery distance (m)</Label><Input type="number" value={s.recovery_target_distance_m ?? ""} onChange={(e) => updateStep(i, { recovery_target_distance_m: Number(e.target.value) })} /></div>
                    )}
                  </div>
                )}
                {(s.kind === "warmup" || s.kind === "cooldown") && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Time (mm:ss)</Label><Input placeholder="10:00" onChange={(e) => updateStep(i, { target_time_seconds: clockToSec(e.target.value), target_kind: "time" })} /></div>
                    <div><Label className="text-xs">Distance (m)</Label><Input type="number" value={s.target_distance_m ?? ""} onChange={(e) => updateStep(i, { target_distance_m: Number(e.target.value), target_kind: "distance" })} /></div>
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => addStep("warmup")}><Plus className="h-3 w-3 mr-1" />Warmup</Button>
              <Button variant="outline" size="sm" onClick={() => addStep("strides")}><Plus className="h-3 w-3 mr-1" />Strides / Run-throughs</Button>
              <Button variant="outline" size="sm" onClick={() => addStep("work")}><Plus className="h-3 w-3 mr-1" />Work</Button>
              <Button variant="outline" size="sm" onClick={() => addStep("recovery")}><Plus className="h-3 w-3 mr-1" />Recovery</Button>
              <Button variant="outline" size="sm" onClick={() => addStep("cooldown")}><Plus className="h-3 w-3 mr-1" />Cooldown</Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/app/sessions" })}>Cancel</Button>
          <Button onClick={save}>Save session</Button>
        </div>
      </div>
    </AppShell>
  );
}