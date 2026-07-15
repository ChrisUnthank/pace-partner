import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Maps a template's richer effort_type vocabulary down onto the existing
// sessions.intent column (easy/aerobic/tempo/threshold/vo2 — the same
// vocabulary session-files.functions.ts's classifier already produces from
// real FIT uploads), so a plan-generated session reads identically to an
// uploaded one anywhere intent is used (Zones page, Analytics, etc).
// cross_train/rest have no running intent at all.
const EFFORT_TO_INTENT: Record<string, string | null> = {
  easy: "easy",
  long: "easy",
  tempo: "tempo",
  threshold: "threshold",
  vo2: "vo2",
  strides: "easy",
  race: "threshold",
  cross_train: null,
  rest: null,
};

type StepRecipe = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "strides";
  reps?: number;
  set_count?: number;
  target_kind: "distance" | "time";
  target_distance_m?: number | null;
  target_time_seconds?: number | null;
  recovery_between_reps_seconds?: number | null;
  recovery_between_reps_target_kind?: "distance" | "time" | null;
  recovery_between_reps_mode?: string | null;
  counts_toward_distance?: boolean;
};

/**
 * Assigns a plan template to an athlete starting on a given date, generating
 * real `sessions` + `steps` rows for every non-rest day in the template.
 * `startDate` is treated as the Monday of week 1 — every template day's
 * real calendar date is computed as startDate + (week-1)*7 + (day_of_week-1).
 *
 * Deliberately reuses the exact same sessions/steps shape the FIT upload
 * pipeline and manual Session Builder already write, rather than a parallel
 * "plan session" concept — a generated session is a completely ordinary
 * planned session the moment it's created (editable via the normal Session
 * Overview drag-and-drop editor, visible on the Calendar, classifiable,
 * everything).
 */
export const assignPlanToAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; planTemplateId: string; startDate: string; goalId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const { data: template, error: templateErr } = await sb
      .from("plan_templates")
      .select("*")
      .eq("id", data.planTemplateId)
      .single();

    if (templateErr || !template) throw templateErr ?? new Error("Plan template not found");

    const { data: templateSessions, error: sessErr } = await sb
      .from("plan_template_sessions")
      .select("*")
      .eq("plan_template_id", data.planTemplateId)
      .order("week_number")
      .order("day_of_week");

    if (sessErr) throw sessErr;
    if (!templateSessions || templateSessions.length === 0) {
      throw new Error("This plan template has no sessions defined yet");
    }

    const { data: planRow, error: planErr } = await sb
      .from("athlete_plans")
      .insert({
        athlete_id: data.athleteId,
        plan_template_id: data.planTemplateId,
        goal_id: data.goalId ?? null,
        name: template.name,
        start_date: data.startDate,
        duration_weeks: template.duration_weeks,
        created_by: context.userId,
      } as any)
      .select()
      .single();

    if (planErr || !planRow) throw planErr ?? new Error("Failed to create plan");

    const startDate = new Date(data.startDate + "T00:00:00");
    let created = 0;

    // Sequential, not parallel — session_date collisions with an athlete's
    // existing same-day sessions are possible (e.g. a manually-logged easy
    // run on a day the plan also wants a long run) and each insert below is
    // independent, so a mid-batch failure should still leave everything
    // before it correctly created rather than an all-or-nothing rollback
    // the caller can't act on.
    for (const ts of templateSessions) {
      if (ts.effort_type === "rest") continue;

      const offsetDays = (ts.week_number - 1) * 7 + (ts.day_of_week - 1);
      const sessionDate = new Date(startDate);
      sessionDate.setDate(sessionDate.getDate() + offsetDays);
      const sessionDateStr = sessionDate.toISOString().slice(0, 10);

      const steps = (ts.steps as StepRecipe[] | null) ?? [];
      const isIntervalWork = steps.some((s) => s.kind === "work" && Number(s.reps ?? 1) > 1);

      const { data: newSession, error: newSessErr } = await sb
        .from("sessions")
        .insert({
          athlete_id: data.athleteId,
          created_by: context.userId,
          session_date: sessionDateStr,
          title: ts.title,
          day_type: ts.effort_type === "race" ? "race" : "training",
          intent: EFFORT_TO_INTENT[ts.effort_type] ?? null,
          structure: isIntervalWork ? "intervals" : "continuous",
          is_planned: true,
          source: "plan_template",
        } as any)
        .select()
        .single();

      if (newSessErr || !newSession) {
        throw newSessErr ?? new Error(`Failed to create session for week ${ts.week_number}, day ${ts.day_of_week}`);
      }

      if (steps.length > 0) {
        const stepsToInsert = steps.map((s, i) => ({
          session_id: newSession.id,
          step_order: i + 1,
          kind: s.kind,
          reps: s.reps ?? 1,
          set_count: s.set_count ?? 1,
          target_kind: s.target_kind,
          target_distance_m: s.target_distance_m ?? null,
          target_time_seconds: s.target_time_seconds ?? null,
          recovery_between_reps_seconds: s.recovery_between_reps_seconds ?? null,
          recovery_between_reps_target_kind: s.recovery_between_reps_target_kind ?? null,
          recovery_between_reps_mode: s.recovery_between_reps_mode ?? null,
          counts_toward_distance: s.counts_toward_distance ?? true,
        }));

        const { error: stepsErr } = await sb.from("steps").insert(stepsToInsert as any);
        if (stepsErr) throw stepsErr;
      }

      const { error: linkErr } = await sb.from("athlete_plan_sessions").insert({
        athlete_plan_id: planRow.id,
        session_id: newSession.id,
        week_number: ts.week_number,
      } as any);
      if (linkErr) throw linkErr;

      created++;
    }

    return { ok: true, planId: planRow.id, sessionsCreated: created };
  });

/**
 * Cancels an athlete's plan. Optionally deletes any of its generated
 * sessions that are still in the future and haven't been completed —
 * leaves anything already done or already in progress alone, since that's
 * real training history regardless of where it came from.
 */
export const cancelAthletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athletePlanId: string; deleteFutureSessions: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    if (data.deleteFutureSessions) {
      const today = new Date().toISOString().slice(0, 10);

      const { data: planSessions } = await sb
        .from("athlete_plan_sessions")
        .select("session_id, sessions(session_date, completed_at)")
        .eq("athlete_plan_id", data.athletePlanId);

      const toDelete = (planSessions ?? [])
        .filter((ps: any) => !ps.sessions?.completed_at && ps.sessions?.session_date >= today)
        .map((ps: any) => ps.session_id as string);

      for (const sessionId of toDelete) {
        const { data: steps } = await sb.from("steps").select("id").eq("session_id", sessionId);
        const stepIds = (steps ?? []).map((s: any) => s.id);

        if (stepIds.length > 0) {
          await sb.from("interval_results").delete().in("step_id", stepIds);
        }

        await sb.from("steps").delete().eq("session_id", sessionId);
        await sb.from("sessions").delete().eq("id", sessionId);
      }
    }

    const { error } = await sb.from("athlete_plans").update({ status: "abandoned" } as any).eq("id", data.athletePlanId);
    if (error) throw error;

    return { ok: true };
  });
