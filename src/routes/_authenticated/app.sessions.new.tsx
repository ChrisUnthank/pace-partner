import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { todayISO, clockToSec, secToClock } from "@/lib/format";
import {
  SESSION_INTENTS,
  INTENT_LABEL,
  SESSION_STRUCTURES,
  STRUCTURE_LABEL,
  SESSION_DAY_TYPES,
  DAY_TYPE_LABEL,
} from "@/lib/session-categories";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Lock } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { stepKindBarClass, stepKindTextClass } from "@/lib/step-kind-colors";
import {
  WORKOUT_TARGET_MODES,
  WORKOUT_TARGET_ZONES,
  inferWorkoutTargetMode,
  type WorkoutTargetMode,
  type WorkoutTargetZone,
} from "@/lib/workout-target-modes";

const searchSchema = z.object({
  date: z.string().optional(),
  mode: z.string().optional(),
  dayType: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/sessions/new")({
  validateSearch: searchSchema,
  component: NewSession,
});

type StepDraft = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  reps: number;
  set_count?: number;
  target_kind?: "time" | "distance";
  target_distance_m?: number | null;
  target_time_seconds?: number | null;

  target_mode?: WorkoutTargetMode | null;
  target_pace_sec_per_km?: number | null;
  target_threshold_pace_pct?: number | null;
  target_threshold_hr_pct?: number | null;
  target_zone?: WorkoutTargetZone | null;
  target_rpe?: number | null;

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

function clearModePayload(mode: WorkoutTargetMode, s: StepDraft): StepDraft {
  return {
    ...s,
    target_pace_sec_per_km: mode === "pace" ? s.target_pace_sec_per_km ?? 300 : null,
    target_threshold_pace_pct: mode === "threshold_pace_pct" ? s.target_threshold_pace_pct ?? 100 : null,
    target_threshold_hr_pct: mode === "threshold_hr_pct" ? s.target_threshold_hr_pct ?? 100 : null,
    target_zone: mode === "zone" ? (s.target_zone ?? "z3") : null,
    target_rpe: mode === "rpe" ? s.target_rpe ?? 6 : null,
  };
}

const defaultStep = (kind: StepDraft["kind"]): StepDraft =>
  kind === "recovery"
    ? { kind, reps: 1, recovery_mode: "jog", recovery_target_kind: "time", recovery_target_seconds: 90 }
    : kind === "work"
      ? {
          kind,
          reps: 6,
          set_count: 1,
          target_kind: "distance",
          target_distance_m: 400,
          target_mode: "pace",
          target_pace_sec_per_km: null,
          target_threshold_pace_pct: null,
          target_threshold_hr_pct: null,
          target_zone: null,
          target_rpe: null,
          recovery_between_reps_seconds: 90,
          recovery_between_reps_mode: "jog",
          recovery_between_reps_target_kind: "time",
          recovery_between_sets_seconds: 180,
          recovery_between_sets_mode: "walk",
          recovery_between_sets_target_kind: "time",
          counts_toward_distance: true,
        }
      : kind === "strides"
        ? { kind, reps: 4, target_kind: "distance", target_distance_m: 80, counts_toward_distance: true }
        : { kind, reps: 1, target_kind: "time", target_time_seconds: 600, counts_toward_distance: true };

let _uidCounter = 0;
const withUid = (s: StepDraft): StepDraft => ({ ...s, _uid: s._uid ?? `s${++_uidCounter}_${Date.now()}` });

function NewSession() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const { data: myAthlete } = useMyAthlete();
  const isCoach = roles.includes("coach");
  const isManager = rawRoles.includes("manager");

  const { data: rosterAthletes } = useQuery({
    queryKey: ["coach-roster", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase.from("coach_athletes").select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["templates", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data } = await supabase
        .from("session_templates")
        .select("id, name, title, intent, structure, is_long_run, notes")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const [athleteId, setAthleteId] = useState<string>("");
  const [sessionDate, setSessionDate] = useState(search.date || todayISO());
  const [title, setTitle] = useState("");
  const [dayType, setDayType] = useState<string>(search.dayType || "training");
  const [intent, setIntent] = useState<string>("threshold");
  const [structure, setStructure] = useState<string>("reps_intervals");
  const [isLongRun, setIsLongRun] = useState<boolean>(false);
  const [activityType, setActivityType] = useState<string>("gym");
  const [gymCategory, setGymCategory] = useState<string>("");
  const [gymSubtype, setGymSubtype] = useState<string>("");
  const [gymDuration, setGymDuration] = useState<number>(60);
  const [gymIntensity, setGymIntensity] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [appliedFromTemplateId, setAppliedFromTemplateId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([
    withUid(defaultStep("warmup")),
    withUid(defaultStep("work")),
    withUid(defaultStep("cooldown")),
  ]);

  useEffect(() => {
    if (search.date) setSessionDate(search.date);
  }, [search.date]);
  useEffect(() => {
    if (search.dayType) setDayType(search.dayType);
  }, [search.dayType]);

  const effectiveAthleteId = athleteId || myAthlete?.id || "";

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function flattenWorkToContinuous(s: StepDraft): StepDraft {
    if (s.kind !== "work") return s;
    return {
      ...s,
      reps: 1,
      set_count: 1,
      is_ladder: false,
      recovery_between_reps_seconds: null,
      recovery_between_reps_mode: undefined,
      recovery_between_reps_target_kind: undefined,
      recovery_between_reps_distance_m: null,
      recovery_between_sets_seconds: null,
      recovery_between_sets_mode: undefined,
      recovery_between_sets_target_kind: undefined,
      recovery_between_sets_distance_m: null,
    };
  }

  function handleStructureChange(next: string) {
    setStructure(next);
    if (next === "continuous") {
      setSteps((s) => s.map(flattenWorkToContinuous));
    }
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function addStep(kind: StepDraft["kind"]) {
    setSteps((s) => {
      const next = withUid(defaultStep(kind));
      if (kind === "warmup") {
        const lastWarm = s.map((x) => x.kind).lastIndexOf("warmup");
        const idx = lastWarm >= 0 ? lastWarm + 1 : 0;
        return [...s.slice(0, idx), next, ...s.slice(idx)];
      }
      if (kind === "cooldown") return [...s, next];
      const firstCool = s.findIndex((x) => x.kind === "cooldown");
      const idx = firstCool === -1 ? s.length : firstCool;
      return [...s.slice(0, idx), next, ...s.slice(idx)];
    });
  }

  function moveStep(from: number, to: number) {
    setSteps((s) => {
      if (to < 0 || to >= s.length) return s;
      if (s[from].kind === "warmup" || s[from].kind === "cooldown") return s;
      if (s[to].kind === "warmup" || s[to].kind === "cooldown") return s;
      return arrayMove(s, from, to);
    });
  }

  async function loadTemplate(templateId: string) {
    const tpl = (templates ?? []).find((t: any) => t.id === templateId);
    if (!tpl) return;
    const { data: tsteps, error } = await supabase
      .from("template_steps")
      .select("*")
      .eq("template_id", templateId)
      .order("step_order");
    if (error) {
      toast.error(error.message);
      return;
    }

    setTitle((tpl as any).title ?? "");
    setNotes((tpl as any).notes ?? "");
    setDayType("training");
    setIntent((tpl as any).intent);
    setStructure((tpl as any).structure);
    setIsLongRun(!!(tpl as any).is_long_run);
    setAppliedFromTemplateId(templateId);

    setSteps(
      (tsteps ?? []).map((s: any) => {
        const inferred = inferWorkoutTargetMode(s);
        return withUid({
          kind: s.kind,
          reps: s.reps,
          set_count: s.set_count,
          target_kind: s.target_kind,
          target_distance_m: s.target_distance_m,
          target_time_seconds: s.target_time_seconds,

          target_mode: (s.target_mode ?? inferred) as WorkoutTargetMode,
          target_pace_sec_per_km: s.target_pace_sec_per_km,
          target_threshold_pace_pct: s.target_threshold_pace_pct,
          target_threshold_hr_pct: s.target_threshold_hr_pct,
          target_zone: s.target_zone,
          target_rpe: s.target_rpe,

          is_ladder: s.is_ladder,
          counts_toward_distance: s.counts_toward_distance,
          recovery_between_reps_seconds: s.recovery_between_reps_seconds,
          recovery_between_reps_mode: s.recovery_between_reps_mode,
          recovery_between_reps_target_kind: s.recovery_between_reps_target_kind ?? "time",
          recovery_between_reps_distance_m: s.recovery_between_reps_distance_m,
          recovery_between_sets_seconds: s.recovery_between_sets_seconds,
          recovery_between_sets_mode: s.recovery_between_sets_mode,
          recovery_between_sets_target_kind: s.recovery_between_sets_target_kind ?? "time",
          recovery_between_sets_distance_m: s.recovery_between_sets_distance_m,
          recovery_mode: s.recovery_mode,
          recovery_target_kind: s.recovery_target_kind,
          recovery_target_seconds: s.recovery_target_seconds,
          recovery_target_distance_m: s.recovery_target_distance_m,
          notes: s.notes,
        });
      }),
    );

    toast.success(`Loaded "${(tpl as any).name}" — edit freely before saving`);
  }

  async function save() {
    if (!effectiveAthleteId) return toast.error("Pick an athlete");
    if (!title) return toast.error("Title is required");
    if (dayType === "training" && (!intent || !structure)) return toast.error("Training sessions need intent and structure");
    if (dayType === "cross_training" && !activityType) return toast.error("Pick an activity type (Gym / Ride / Swim)");

    const isGymPlan = dayType === "cross_training" && activityType === "gym";
    const GYM_INTENSITY_TO_RPE: Record<string, number> = { easy: 3, moderate: 5, hard: 8 };

    const { data: sess, error } = await supabase
      .from("sessions")
      .insert({
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
        activity_type: dayType === "cross_training" ? activityType : null,
        gym_category: isGymPlan ? gymCategory || null : null,
        gym_subtype: isGymPlan && gymCategory === "strength_resistance" ? gymSubtype || null : null,
        gym_intensity: isGymPlan ? gymIntensity || null : null,
        total_time_seconds: isGymPlan && gymDuration > 0 ? gymDuration * 60 : null,
        rpe: isGymPlan && gymIntensity ? GYM_INTENSITY_TO_RPE[gymIntensity] : null,
      } as any)
      .select()
      .single();

    if (error || !sess) return toast.error(error?.message ?? "Failed");

    if (dayType === "cross_training") {
      toast.success("Session created");
      navigate({ to: "/app/sessions/$sessionId", params: { sessionId: sess.id } });
      return;
    }

    const isContinuous = dayType === "training" && structure === "continuous";
    const stepsToSave = isContinuous ? steps.map(flattenWorkToContinuous) : steps;

    const stepRows = stepsToSave.map((s, i) => {
      const mode = s.kind === "work" ? (s.target_mode ?? inferWorkoutTargetMode(s as any)) : null;
      const cleaned = s.kind === "work" && mode ? clearModePayload(mode, s) : s;

      return {
        session_id: sess.id,
        step_order: i + 1,
        kind: cleaned.kind,
        reps: cleaned.reps,
        set_count: cleaned.kind === "work" ? Math.max(1, cleaned.set_count ?? 1) : 1,
        target_kind: cleaned.target_kind ?? null,
        target_distance_m: cleaned.target_distance_m ?? null,
        target_time_seconds: cleaned.target_time_seconds ?? null,

        target_mode: mode,
        target_pace_sec_per_km: cleaned.target_pace_sec_per_km ?? null,
        target_threshold_pace_pct: cleaned.target_threshold_pace_pct ?? null,
        target_threshold_hr_pct: cleaned.target_threshold_hr_pct ?? null,
        target_zone: cleaned.target_zone ?? null,
        target_rpe: cleaned.target_rpe ?? null,

        is_ladder: cleaned.kind === "work" ? !!cleaned.is_ladder : false,
        counts_toward_distance: cleaned.counts_toward_distance ?? true,
        recovery_between_reps_seconds: cleaned.kind === "work" ? (cleaned.recovery_between_reps_seconds ?? null) : null,
        recovery_between_reps_mode: cleaned.kind === "work" ? (cleaned.recovery_between_reps_mode ?? null) : null,
        recovery_between_reps_target_kind: cleaned.kind === "work" ? (cleaned.recovery_between_reps_target_kind ?? "time") : "time",
        recovery_between_reps_distance_m: cleaned.kind === "work" ? (cleaned.recovery_between_reps_distance_m ?? null) : null,
        recovery_between_sets_seconds:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1 ? (cleaned.recovery_between_sets_seconds ?? null) : null,
        recovery_between_sets_mode:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1 ? (cleaned.recovery_between_sets_mode ?? null) : null,
        recovery_between_sets_target_kind:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1 ? (cleaned.recovery_between_sets_target_kind ?? "time") : "time",
        recovery_between_sets_distance_m:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1 ? (cleaned.recovery_between_sets_distance_m ?? null) : null,
        recovery_mode: cleaned.recovery_mode ?? null,
        recovery_target_kind: cleaned.recovery_target_kind ?? null,
        recovery_target_seconds: cleaned.recovery_target_seconds ?? null,
        recovery_target_distance_m: cleaned.recovery_target_distance_m ?? null,
        notes: cleaned.notes ?? null,
      };
    });

    const { error: stepErr } = await supabase.from("steps").insert(stepRows);
    if (stepErr) return toast.error(stepErr.message);

    toast.success("Session created");
    navigate({ to: "/app/sessions/$sessionId", params: { sessionId: sess.id } });
  }

  return (
    <AppShell>
      <div className="max-w-7xl space-y-6">
        <h1 className="text-2xl font-bold">New session</h1>

        {isCoach && (templates ?? []).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Start from a template</CardTitle>
              <CardDescription>Prefills the builder. Everything stays fully editable.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value="" onValueChange={loadTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a template…" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label>Athlete</Label>
              {isCoach ? (
                <Select value={athleteId} onValueChange={setAthleteId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pick athlete" />
                  </SelectTrigger>
                  <SelectContent>
                    {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                    {(rosterAthletes ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="mt-1" value={myAthlete?.name ?? ""} readOnly />
              )}
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Day type</Label>
              <Select value={dayType} onValueChange={setDayType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_DAY_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DAY_TYPE_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 6x800m @ 3k pace, 200m jog"
                className="mt-1"
              />
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
                  <Select value={structure} onValueChange={handleStructureChange}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SESSION_STRUCTURES.map((s) => (
                        <SelectItem key={s} value={s}>{STRUCTURE_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="is-long-run" checked={isLongRun} onCheckedChange={(v) => setIsLongRun(!!v)} />
                  <Label htmlFor="is-long-run" className="text-sm font-normal">
                    Long run — tracked separately for weekly long-run accountability
                  </Label>
                </div>
              </>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {dayType !== "cross_training" && (
          <StepsCard
            steps={steps}
            structure={structure}
            updateStep={updateStep}
            removeStep={removeStep}
            addStep={addStep}
            moveStep={moveStep}
            reorder={(uids) =>
              setSteps((prev) => {
                const warm = prev.filter((s) => s.kind === "warmup");
                const cool = prev.filter((s) => s.kind === "cooldown");
                const middle = prev.filter((s) => s.kind !== "warmup" && s.kind !== "cooldown");
                const byUid = new Map(middle.map((s) => [s._uid!, s]));
                const newMiddle = uids.map((u) => byUid.get(u)!).filter(Boolean);
                return [...warm, ...newMiddle, ...cool];
              })
            }
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/app/sessions" })}>Cancel</Button>
          <Button onClick={save}>Save session</Button>
        </div>
      </div>
    </AppShell>
  );
}

/* keep your existing StepCard / SortableStep / StepsCard implementation,
   but update StepFields(work) to add Target Mode selector + mode-specific inputs:
   - pace: target_pace_sec_per_km
   - threshold_pace_pct: target_threshold_pace_pct
   - threshold_hr_pct: target_threshold_hr_pct
   - zone: target_zone (WORKOUT_TARGET_ZONES)
   - rpe: target_rpe
   - open: no payload
*/
