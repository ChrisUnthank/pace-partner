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
  WORKOUT_TARGET_ZONES,
  inferWorkoutTargetMode,
  type WorkoutTargetMode,
  type WorkoutTargetZone,
} from "@/lib/workout-target-modes";

type TargetMode = WorkoutTargetMode | "open";

// This route previously had no search-param handling at all — the
// Calendar page's "+" menu has been passing date/mode/dayType here for a
// while, but none of it was ever read, so every link silently landed on
// today's date with "Training" pre-selected regardless of what was
// clicked. `mode` is accepted here but not yet acted on (Manual Session
// Entry vs. Create Session don't currently render anything different on
// this page) — flagged rather than guessed at, since building that
// distinction is a separate piece of work from what actually broke.
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

  target_mode?: TargetMode | null;
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

function clearModePayload(mode: TargetMode, s: StepDraft): StepDraft {
  return {
    ...s,
    target_mode: mode,
    target_pace_sec_per_km: mode === "pace" ? (s.target_pace_sec_per_km ?? 300) : null,
    target_threshold_pace_pct: mode === "threshold_pace_pct" ? (s.target_threshold_pace_pct ?? 100) : null,
    target_threshold_hr_pct: mode === "threshold_hr_pct" ? (s.target_threshold_hr_pct ?? 100) : null,
    target_zone: mode === "zone" ? (s.target_zone ?? ("z3" as WorkoutTargetZone)) : null,
    target_rpe: mode === "rpe" ? (s.target_rpe ?? 6) : null,
  };
}

const defaultStep = (kind: StepDraft["kind"]): StepDraft =>
  kind === "recovery"
    ? {
        kind,
        reps: 1,
        recovery_mode: "jog",
        recovery_target_kind: "time",
        recovery_target_seconds: 90,
      }
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
        ? {
            kind,
            reps: 4,
            target_kind: "distance",
            target_distance_m: 80,
            counts_toward_distance: true,
          }
        : {
            kind,
            reps: 1,
            target_kind: "time",
            target_time_seconds: 600,
            counts_toward_distance: true,
          };

let _uidCounter = 0;

const withUid = (s: StepDraft): StepDraft => ({
  ...s,
  _uid: s._uid ?? `s${++_uidCounter}_${Date.now()}`,
});

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

      const { data } = await supabase
        .from("coach_athletes")
        .select("athletes(id, name)")
        .eq("coach_user_id", user!.id);

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

  // Cross-training doesn't get the full running steps builder below — per
  // instruction, most runners do swim/bike as supplementary (often during
  // injury recovery) and gym more consistently, but none of them need
  // warmup/work/cooldown rep structure planned in advance. Activity type
  // (gym/ride/swim) plus, for gym specifically, a lightweight category/
  // subtype is enough to plan the day; actual duration/distance/RPE gets
  // logged later (Daily Log, or directly on the session once it happens).
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

  // The useState initializers above only ever read search.date/search.dayType
  // on this component's FIRST mount. TanStack Router doesn't remount this
  // page just because search params changed on a second visit to the same
  // route — it reuses the existing instance — so a coach who'd already
  // opened this page once (any date) and then clicked "+", say, "Add Race"
  // on a different day later in the same session got a form still holding
  // the date/day-type from that first visit, silently ignoring the new
  // one. This keeps both in sync on every navigation, not just the first.
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

  // Strip rep/set/recovery/ladder fields from a Work step — used when switching to continuous structure.
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
        const inferred = inferWorkoutTargetMode(s) as TargetMode;

        return withUid({
          kind: s.kind,
          reps: s.reps,
          set_count: s.set_count,
          target_kind: s.target_kind,
          target_distance_m: s.target_distance_m,
          target_time_seconds: s.target_time_seconds,

          target_mode: (s.target_mode ?? inferred) as TargetMode,
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
    if (!effectiveAthleteId) {
      toast.error("Pick an athlete");
      return;
    }

    if (!title) {
      toast.error("Title is required");
      return;
    }

    if (dayType === "training") {
      if (!intent || !structure) {
        toast.error("Training sessions need intent and structure");
        return;
      }
    }

    if (dayType === "cross_training" && !activityType) {
      toast.error("Pick an activity type (Gym / Ride / Swim)");
      return;
    }

    const isGymPlan = dayType === "cross_training" && activityType === "gym";

    // Maps the coach-friendly easy/moderate/hard picker to a concrete RPE —
    // sessions.rpe is already correctly wired into session_training_load(),
    // so this gets the planned session counting toward training load
    // immediately without needing to touch that function (see the
    // migration's note on why that's being avoided for now).
    const GYM_INTENSITY_TO_RPE: Record<string, number> = {
      easy: 3,
      moderate: 5,
      hard: 8,
    };

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

    if (error || !sess) {
      toast.error(error?.message ?? "Failed");
      return;
    }

    // Cross-training (gym/ride/swim) doesn't use the running warmup/work/
    // cooldown step model — nothing to insert into `steps` for it.
    if (dayType === "cross_training") {
      toast.success("Session created");
      navigate({ to: "/app/sessions/$sessionId", params: { sessionId: sess.id } });
      return;
    }

    const isContinuous = dayType === "training" && structure === "continuous";
    const stepsToSave = isContinuous ? steps.map(flattenWorkToContinuous) : steps;

    const stepRows = stepsToSave.map((s, i) => {
      const mode = s.kind === "work" ? ((s.target_mode ?? inferWorkoutTargetMode(s as any)) as TargetMode) : null;
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

        recovery_between_reps_seconds:
          cleaned.kind === "work" ? (cleaned.recovery_between_reps_seconds ?? null) : null,
        recovery_between_reps_mode:
          cleaned.kind === "work" ? (cleaned.recovery_between_reps_mode ?? null) : null,
        recovery_between_reps_target_kind:
          cleaned.kind === "work" ? (cleaned.recovery_between_reps_target_kind ?? "time") : "time",
        recovery_between_reps_distance_m:
          cleaned.kind === "work" ? (cleaned.recovery_between_reps_distance_m ?? null) : null,

        recovery_between_sets_seconds:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1
            ? (cleaned.recovery_between_sets_seconds ?? null)
            : null,
        recovery_between_sets_mode:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1
            ? (cleaned.recovery_between_sets_mode ?? null)
            : null,
        recovery_between_sets_target_kind:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1
            ? (cleaned.recovery_between_sets_target_kind ?? "time")
            : "time",
        recovery_between_sets_distance_m:
          cleaned.kind === "work" && (cleaned.set_count ?? 1) > 1
            ? (cleaned.recovery_between_sets_distance_m ?? null)
            : null,

        recovery_mode: cleaned.recovery_mode ?? null,
        recovery_target_kind: cleaned.recovery_target_kind ?? null,
        recovery_target_seconds: cleaned.recovery_target_seconds ?? null,
        recovery_target_distance_m: cleaned.recovery_target_distance_m ?? null,
        notes: cleaned.notes ?? null,
      };
    });

    const { error: stepErr } = await supabase.from("steps").insert(stepRows);

    if (stepErr) {
      toast.error(stepErr.message);
      return;
    }

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
                    {myAthlete && (
                      <SelectItem value={myAthlete.id}>
                        {myAthlete.name} (me)
                      </SelectItem>
                    )}
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
              <Input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="mt-1"
              />
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
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SESSION_INTENTS.map((i) => (
                        <SelectItem key={i} value={i}>
                          {INTENT_LABEL[i]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Structure</Label>
                  <Select value={structure} onValueChange={handleStructureChange}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SESSION_STRUCTURES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STRUCTURE_LABEL[s]}
                        </SelectItem>
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

            {dayType === "cross_training" && (
              <>
                <div>
                  <Label>Activity type</Label>
                  <Select value={activityType} onValueChange={setActivityType}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gym">Gym</SelectItem>
                      <SelectItem value="ride">Ride</SelectItem>
                      <SelectItem value="swim">Swim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {activityType === "gym" && (
                  <div>
                    <Label>Gym type</Label>
                    <Select
                      value={gymCategory}
                      onValueChange={(v) => {
                        setGymCategory(v);
                        // Subtype only ever applies to Strength & Resistance —
                        // clear any stale value if the category changes away
                        // from it, so a leftover "Upper" doesn't silently
                        // stick to e.g. a Mobility session.
                        if (v !== "strength_resistance") setGymSubtype("");
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Pick a type…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mobility">Mobility</SelectItem>
                        <SelectItem value="flexibility_core">Flexibility / Core</SelectItem>
                        <SelectItem value="circuit">Circuit</SelectItem>
                        <SelectItem value="strength_resistance">Strength &amp; Resistance</SelectItem>
                        <SelectItem value="cardio">Cardio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {activityType === "gym" && gymCategory === "strength_resistance" && (
                  <div>
                    <Label>Focus</Label>
                    <Select value={gymSubtype} onValueChange={setGymSubtype}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Pick a focus…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upper">Upper</SelectItem>
                        <SelectItem value="lower">Lower</SelectItem>
                        <SelectItem value="full_body">Full body</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {activityType === "gym" && (
                  <div>
                    <Label>Duration (min)</Label>
                    <Input
                      type="number"
                      value={gymDuration}
                      onChange={(e) => setGymDuration(Number(e.target.value))}
                      className="mt-1"
                    />
                  </div>
                )}

                {activityType === "gym" && (
                  <div>
                    <Label>Intensity</Label>
                    <Select value={gymIntensity} onValueChange={setGymIntensity}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Pick intensity…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="moderate">Moderate</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
                // uids = new order of middle uids; warmups stay leading, cooldowns trailing
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
          <Button variant="outline" onClick={() => navigate({ to: "/app/sessions" })}>
            Cancel
          </Button>
          <Button onClick={save}>Save session</Button>
        </div>
      </div>
    </AppShell>
  );
}

// ===== Steps card with anchored warmup/cooldown + sortable middle =====

type StepEditorProps = {
  step: StepDraft;
  index: number;
  position: number; // 1-based for label
  onUpdate: (patch: Partial<StepDraft>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  draggable?: boolean;
  anchored?: "top" | "bottom";
  structure?: string;
};

function WorkTargetModeFields({
  step,
  onUpdate,
}: {
  step: StepDraft;
  onUpdate: (p: Partial<StepDraft>) => void;
}) {
  const mode = (step.target_mode ?? inferWorkoutTargetMode(step as any) ?? "pace") as TargetMode;

  function updateMode(next: TargetMode) {
    onUpdate(clearModePayload(next, { ...step, target_mode: next }));
  }

  return (
    <div className="col-span-2 rounded-md border p-2 space-y-2">
      <div>
        <Label className="text-xs">Target mode</Label>
        <Select value={mode} onValueChange={(v) => updateMode(v as TargetMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pace">Pace</SelectItem>
            <SelectItem value="threshold_pace_pct">Threshold pace percent</SelectItem>
            <SelectItem value="threshold_hr_pct">Threshold HR percent</SelectItem>
            <SelectItem value="zone">Zone</SelectItem>
            <SelectItem value="rpe">RPE</SelectItem>
            <SelectItem value="open">Open / no target</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "pace" && (
        <div>
          <Label className="text-xs">Target pace mm:ss /km</Label>
          <Input
            placeholder="3:30"
            defaultValue={step.target_pace_sec_per_km ? secToClock(step.target_pace_sec_per_km) : ""}
            onChange={(e) => onUpdate({ target_pace_sec_per_km: clockToSec(e.target.value) })}
          />
        </div>
      )}

      {mode === "threshold_pace_pct" && (
        <div>
          <Label className="text-xs">Threshold pace percent</Label>
          <Input
            type="number"
            placeholder="100"
            value={step.target_threshold_pace_pct ?? ""}
            onChange={(e) =>
              onUpdate({
                target_threshold_pace_pct: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Example: 100 means threshold pace. 95 means slightly slower than threshold.
          </p>
        </div>
      )}

      {mode === "threshold_hr_pct" && (
        <div>
          <Label className="text-xs">Threshold HR percent</Label>
          <Input
            type="number"
            placeholder="95"
            value={step.target_threshold_hr_pct ?? ""}
            onChange={(e) =>
              onUpdate({
                target_threshold_hr_pct: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Example: 95 means 95 percent of threshold heart rate.
          </p>
        </div>
      )}

      {mode === "zone" && (
        <div>
          <Label className="text-xs">Zone</Label>
          <Select
            value={step.target_zone ?? ("z3" as WorkoutTargetZone)}
            onValueChange={(v) => onUpdate({ target_zone: v as WorkoutTargetZone })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKOUT_TARGET_ZONES.map((z: any) => {
                const value = typeof z === "string" ? z : z.value;
                const label = typeof z === "string" ? z.toUpperCase() : z.label;

                return (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "rpe" && (
        <div>
          <Label className="text-xs">RPE</Label>
          <Input
            type="number"
            min={1}
            max={10}
            placeholder="6"
            value={step.target_rpe ?? ""}
            onChange={(e) =>
              onUpdate({
                target_rpe: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </div>
      )}

      {mode === "open" && (
        <p className="text-[11px] text-muted-foreground">
          No fixed intensity target. Useful for less advanced athletes, easy aerobic work, or sessions guided by feel.
        </p>
      )}
    </div>
  );
}

function StepFields({
  step: s,
  onUpdate,
  structure,
}: {
  step: StepDraft;
  onUpdate: (p: Partial<StepDraft>) => void;
  structure?: string;
}) {
  if (s.kind === "work") {
    const isContinuous = structure === "continuous";

    if (isContinuous) {
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 text-[11px] text-muted-foreground leading-snug -mt-1">
            Continuous effort — one sustained block. For reps with recovery, change the session structure to
            Reps/Intervals.
          </div>

          <div>
            <Label className="text-xs">Target</Label>
            <Select value={s.target_kind} onValueChange={(v) => onUpdate({ target_kind: v as any })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distance">Distance (m)</SelectItem>
                <SelectItem value="time">Time (mm:ss)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {s.target_kind === "distance" ? (
            <div>
              <Label className="text-xs">Distance (m)</Label>
              <Input
                type="number"
                value={s.target_distance_m ?? ""}
                onChange={(e) => onUpdate({ target_distance_m: Number(e.target.value) })}
              />
            </div>
          ) : (
            <div>
              <Label className="text-xs">Time (mm:ss)</Label>
              <Input
                placeholder="40:00"
                defaultValue={s.target_time_seconds ? secToClock(s.target_time_seconds) : ""}
                onChange={(e) => onUpdate({ target_time_seconds: clockToSec(e.target.value) })}
              />
            </div>
          )}

          <WorkTargetModeFields step={s} onUpdate={onUpdate} />
        </div>
      );
    }

    const repsKind = s.recovery_between_reps_target_kind ?? "time";
    const setsKind = s.recovery_between_sets_target_kind ?? "time";

    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Sets</Label>
          <Input
            type="number"
            min={1}
            value={s.set_count ?? 1}
            onChange={(e) => onUpdate({ set_count: Math.max(1, Number(e.target.value)) })}
          />
        </div>

        <div>
          <Label className="text-xs">Reps</Label>
          <Input type="number" value={s.reps} onChange={(e) => onUpdate({ reps: Number(e.target.value) })} />
        </div>

        <div>
          <Label className="text-xs">Target</Label>
          <Select value={s.target_kind} onValueChange={(v) => onUpdate({ target_kind: v as any })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="distance">Distance (m)</SelectItem>
              <SelectItem value="time">Time (mm:ss)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {s.target_kind === "distance" ? (
          <div>
            <Label className="text-xs">Distance (m)</Label>
            <Input
              type="number"
              value={s.target_distance_m ?? ""}
              onChange={(e) => onUpdate({ target_distance_m: Number(e.target.value) })}
            />
          </div>
        ) : (
          <div>
            <Label className="text-xs">Time (mm:ss)</Label>
            <Input placeholder="3:00" onChange={(e) => onUpdate({ target_time_seconds: clockToSec(e.target.value) })} />
          </div>
        )}

        <WorkTargetModeFields step={s} onUpdate={onUpdate} />

        {/* Recovery between reps */}
        <div className="col-span-2 rounded-md border p-2 space-y-2">
          <div className="text-xs font-semibold">Recovery between reps</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Mode</Label>
              <Select
                value={s.recovery_between_reps_mode ?? "jog"}
                onValueChange={(v) => onUpdate({ recovery_between_reps_mode: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standing">Standing</SelectItem>
                  <SelectItem value="walk">Walk</SelectItem>
                  <SelectItem value="jog">Jog</SelectItem>
                  <SelectItem value="float">Float</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Target</Label>
              <Select
                value={repsKind}
                onValueChange={(v) => onUpdate({ recovery_between_reps_target_kind: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">Time</SelectItem>
                  <SelectItem value="distance">Distance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {repsKind === "time" ? (
              <div>
                <Label className="text-xs">Time (mm:ss)</Label>
                <Input
                  placeholder="1:30"
                  defaultValue={s.recovery_between_reps_seconds ? secToClock(s.recovery_between_reps_seconds) : ""}
                  onChange={(e) => onUpdate({ recovery_between_reps_seconds: clockToSec(e.target.value) })}
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Distance (m)</Label>
                <Input
                  type="number"
                  placeholder="100"
                  value={s.recovery_between_reps_distance_m ?? ""}
                  onChange={(e) => onUpdate({ recovery_between_reps_distance_m: Number(e.target.value) })}
                />
              </div>
            )}
          </div>
        </div>

        {(s.set_count ?? 1) > 1 && (
          <div className="col-span-2 rounded-md border p-2 space-y-2">
            <div className="text-xs font-semibold">Recovery between sets</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Mode</Label>
                <Select
                  value={s.recovery_between_sets_mode ?? "walk"}
                  onValueChange={(v) => onUpdate({ recovery_between_sets_mode: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standing">Standing</SelectItem>
                    <SelectItem value="walk">Walk</SelectItem>
                    <SelectItem value="jog">Jog</SelectItem>
                    <SelectItem value="float">Float</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Target</Label>
                <Select
                  value={setsKind}
                  onValueChange={(v) => onUpdate({ recovery_between_sets_target_kind: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time">Time</SelectItem>
                    <SelectItem value="distance">Distance</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {setsKind === "time" ? (
                <div>
                  <Label className="text-xs">Time (mm:ss)</Label>
                  <Input
                    placeholder="3:00"
                    defaultValue={s.recovery_between_sets_seconds ? secToClock(s.recovery_between_sets_seconds) : ""}
                    onChange={(e) => onUpdate({ recovery_between_sets_seconds: clockToSec(e.target.value) })}
                  />
                </div>
              ) : (
                <div>
                  <Label className="text-xs">Distance (m)</Label>
                  <Input
                    type="number"
                    placeholder="400"
                    value={s.recovery_between_sets_distance_m ?? ""}
                    onChange={(e) => onUpdate({ recovery_between_sets_distance_m: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="col-span-2 text-xs text-muted-foreground">
          Plan:{" "}
          <span className="font-semibold">
            {s.set_count ?? 1} set{(s.set_count ?? 1) > 1 ? "s" : ""} × {s.reps} rep{s.reps === 1 ? "" : "s"}
          </span>
          {(s.set_count ?? 1) > 1 && <> = {(s.set_count ?? 1) * s.reps} total reps</>}
        </div>

        <div className="col-span-2 flex items-center gap-2 pt-1">
          <Checkbox checked={!!s.is_ladder} onCheckedChange={(v) => onUpdate({ is_ladder: !!v })} />
          <Label className="text-xs font-normal">
            Ladder (reps have different distances/paces) — suppresses fatigue score until per-rep targets ship
          </Label>
        </div>
      </div>
    );
  }

  if (s.kind === "strides") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Reps</Label>
          <Input type="number" value={s.reps} onChange={(e) => onUpdate({ reps: Number(e.target.value) })} />
        </div>

        <div>
          <Label className="text-xs">Distance (m)</Label>
          <Input
            type="number"
            value={s.target_distance_m ?? ""}
            onChange={(e) => onUpdate({ target_distance_m: Number(e.target.value), target_kind: "distance" })}
          />
        </div>

        <div
          className={`col-span-2 rounded-md border-2 p-2 ${
            s.counts_toward_distance ? "border-emerald-500 bg-emerald-500/5" : "border-amber-500 bg-amber-500/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <Checkbox
              checked={!!s.counts_toward_distance}
              onCheckedChange={(v) => onUpdate({ counts_toward_distance: !!v })}
            />
            <Label className="text-xs font-semibold">
              {s.counts_toward_distance
                ? "✓ Counts toward weekly distance (end-of-session Stride)"
                : "⚠ Does NOT count toward weekly distance (warm-up Run-through)"}
            </Label>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            <strong>Strides</strong> = end-of-session work, counts toward weekly km and zone time.{" "}
            <strong>Run-throughs</strong> = warm-up prep, must NOT count. Place before/after main work accordingly and
            double-check this toggle before saving.
          </p>
        </div>
      </div>
    );
  }

  if (s.kind === "recovery") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 text-[11px] text-muted-foreground leading-snug -mt-1">
          Easy effort <strong>between separate Work blocks</strong> (e.g. 90s jog between a threshold block and a speed
          block). For recovery between reps or sets inside a single Work block, use the fields inside that Work step.
        </div>

        <div>
          <Label className="text-xs">Mode</Label>
          <Select value={s.recovery_mode} onValueChange={(v) => onUpdate({ recovery_mode: v as any })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standing">Standing</SelectItem>
              <SelectItem value="walk">Walk</SelectItem>
              <SelectItem value="jog">Jog</SelectItem>
              <SelectItem value="float">Float</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Target</Label>
          <Select value={s.recovery_target_kind} onValueChange={(v) => onUpdate({ recovery_target_kind: v as any })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="time">Time</SelectItem>
              <SelectItem value="distance">Distance</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {s.recovery_target_kind === "time" ? (
          <div className="col-span-2">
            <Label className="text-xs">Recovery (mm:ss)</Label>
            <Input
              placeholder="1:30"
              defaultValue={s.recovery_target_seconds ? secToClock(s.recovery_target_seconds) : ""}
              onChange={(e) => onUpdate({ recovery_target_seconds: clockToSec(e.target.value) })}
            />
          </div>
        ) : (
          <div className="col-span-2">
            <Label className="text-xs">Recovery distance (m)</Label>
            <Input
              type="number"
              value={s.recovery_target_distance_m ?? ""}
              onChange={(e) => onUpdate({ recovery_target_distance_m: Number(e.target.value) })}
            />
          </div>
        )}
      </div>
    );
  }

  // warmup / cooldown
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Time (mm:ss)</Label>
        <Input
          placeholder="10:00"
          onChange={(e) => onUpdate({ target_time_seconds: clockToSec(e.target.value), target_kind: "time" })}
        />
      </div>

      <div>
        <Label className="text-xs">Distance (m)</Label>
        <Input
          type="number"
          value={s.target_distance_m ?? ""}
          onChange={(e) => onUpdate({ target_distance_m: Number(e.target.value), target_kind: "distance" })}
        />
      </div>
    </div>
  );
}

function stepTitle(s: StepDraft): string {
  if (s.kind === "recovery") return "Recovery between blocks";
  if (s.kind === "strides") return "Strides / Run-throughs";
  return s.kind.charAt(0).toUpperCase() + s.kind.slice(1);
}

function StepCard({ step, position, onUpdate, onRemove, anchored, structure }: StepEditorProps) {
  return (
    <div className="flex flex-col h-full border rounded-md bg-background overflow-hidden">
      <div className={`h-1.5 w-full shrink-0 ${stepKindBarClass(step.kind)}`} />
      <div className="flex-1 min-w-0 p-3 space-y-2">
        <div className="flex justify-between items-center">
          <span className={`text-sm font-semibold flex items-center gap-2 ${stepKindTextClass(step.kind)}`}>
            {anchored && <Lock className="h-3 w-3 text-muted-foreground" />}
            {position}. {stepTitle(step)}
            {anchored && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
                anchored {anchored}
              </span>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <StepFields step={step} onUpdate={onUpdate} structure={structure} />
      </div>
    </div>
  );
}

function SortableStep(props: StepEditorProps & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col h-full border rounded-md bg-background overflow-hidden">
      <div className={`h-1.5 w-full shrink-0 ${stepKindBarClass(props.step.kind)}`} />
      <div className="flex-1 min-w-0 p-3 space-y-2">
        <div className="flex justify-between items-center">
          <span className={`text-sm font-semibold flex items-center gap-2 ${stepKindTextClass(props.step.kind)}`}>
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
              {...attributes}
              {...listeners}
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            {props.position}. {stepTitle(props.step)}
          </span>

          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={props.onMoveUp} disabled={!props.onMoveUp} aria-label="Move up">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onMoveDown}
              disabled={!props.onMoveDown}
              aria-label="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <StepFields step={props.step} onUpdate={props.onUpdate} structure={props.structure} />
      </div>
    </div>
  );
}

function StepsCard({
  steps,
  structure,
  updateStep,
  removeStep,
  addStep,
  moveStep,
  reorder,
}: {
  steps: StepDraft[];
  structure: string;
  updateStep: (i: number, patch: Partial<StepDraft>) => void;
  removeStep: (i: number) => void;
  addStep: (kind: StepDraft["kind"]) => void;
  moveStep: (from: number, to: number) => void;
  reorder: (uids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Partition by global index so we can pass real indices to updateStep/removeStep.
  const warmIdx: number[] = [];
  const midIdx: number[] = [];
  const coolIdx: number[] = [];

  steps.forEach((s, i) => {
    if (s.kind === "warmup") warmIdx.push(i);
    else if (s.kind === "cooldown") coolIdx.push(i);
    else midIdx.push(i);
  });

  const midUids = midIdx.map((i) => steps[i]._uid!);

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;

    const from = midUids.indexOf(String(active.id));
    const to = midUids.indexOf(String(over.id));

    if (from === -1 || to === -1) return;

    reorder(arrayMove(midUids, from, to));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Steps</CardTitle>
        <CardDescription>
          Warmup is locked at the top, cooldown at the bottom. Drag the middle steps (Work / Recovery between blocks /
          Strides) to reorder.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {warmIdx.map((i, pos) => (
            <StepCard
              key={steps[i]._uid}
              step={steps[i]}
              index={i}
              position={pos + 1}
              anchored="top"
              onUpdate={(p) => updateStep(i, p)}
              onRemove={() => removeStep(i)}
              structure={structure}
            />
          ))}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={midUids} strategy={rectSortingStrategy}>
              {midIdx.map((i, pos) => (
                <SortableStep
                  key={steps[i]._uid}
                  id={steps[i]._uid!}
                  step={steps[i]}
                  index={i}
                  position={warmIdx.length + pos + 1}
                  onUpdate={(p) => updateStep(i, p)}
                  onRemove={() => removeStep(i)}
                  onMoveUp={pos > 0 ? () => moveStep(i, midIdx[pos - 1]) : undefined}
                  onMoveDown={pos < midIdx.length - 1 ? () => moveStep(i, midIdx[pos + 1]) : undefined}
                  structure={structure}
                />
              ))}
            </SortableContext>
          </DndContext>

          {coolIdx.map((i, pos) => (
            <StepCard
              key={steps[i]._uid}
              step={steps[i]}
              index={i}
              position={warmIdx.length + midIdx.length + pos + 1}
              anchored="bottom"
              onUpdate={(p) => updateStep(i, p)}
              onRemove={() => removeStep(i)}
              structure={structure}
            />
          ))}
        </div>

        <div className="lg:col-span-1">
          <div className="grid grid-cols-1 gap-2 lg:sticky lg:top-4">
            <Button variant="outline" className="h-auto py-3 justify-start" onClick={() => addStep("warmup")}>
              <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass("warmup")}`} />
              <Plus className="h-3 w-3 mr-1" />
              Warmup
            </Button>

            <Button variant="outline" className="h-auto py-3 justify-start" onClick={() => addStep("work")}>
              <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass("work")}`} />
              <Plus className="h-3 w-3 mr-1" />
              Work block
            </Button>

            <Button variant="outline" className="h-auto py-3 justify-start" onClick={() => addStep("recovery")}>
              <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass("recovery")}`} />
              <Plus className="h-3 w-3 mr-1" />
              Recovery between blocks
            </Button>

            <Button variant="outline" className="h-auto py-3 justify-start" onClick={() => addStep("cooldown")}>
              <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass("cooldown")}`} />
              <Plus className="h-3 w-3 mr-1" />
              Cooldown
            </Button>

            <Button variant="outline" className="h-auto py-3 justify-start" onClick={() => addStep("strides")}>
              <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${stepKindBarClass("strides")}`} />
              <Plus className="h-3 w-3 mr-1" />
              Strides / Run-throughs
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
