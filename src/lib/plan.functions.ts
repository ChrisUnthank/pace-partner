import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scaleStep, resolveEffectiveRules, type ProgressionRules, type CopyBucket, type DraftStep, type WeekOverride } from "./calendar-copy";
import { bucketForEffortType } from "./plan-progression";

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

// One resolved, review-ready day — output of resolveTemplateDrafts(),
// and the shape both previewPlanAssignment returns and assignPlanToAthlete
// accepts back once a coach has reviewed/edited it. Deliberately shaped as
// a superset of calendar-copy.ts's DraftSession (tempId, sourceSessionId,
// athlete_id, session_date, title, day_type, intent, structure,
// is_long_run, bucket, needsReview, steps) so the Copy dialogs' review-step
// UI, quick-adjustment functions, and EditDraftForm can all be reused here
// without a parallel implementation — athlete_id is left "" (a template's
// content is athlete-independent; it's only resolved per-athlete at
// commit), and week_number/session_template_id are carried as the two
// extra fields the commit step actually needs.
export type PlanAssignDraft = {
  tempId: string;
  sourceSessionId: string;
  athlete_id: string;
  week_number: number;
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  structure: string | null;
  is_long_run: boolean;
  bucket: CopyBucket | null;
  needsReview: boolean;
  steps: DraftStep[];
  session_template_id: string | null;
};

// Full column set carried across regardless of origin (a plan day's own
// manual recipe, or a linked library template's steps) — scaleStep()'s
// baseDraftStep() already normalizes both shapes into this same DraftStep
// shape, so one insert-row builder covers both instead of one per origin.
//
// Phase 4 fix (kept from the original implementation): this previously
// dropped target_mode/target_threshold_pace_pct/target_threshold_hr_pct/
// target_zone/target_rpe on one or both origin paths — a plan day built
// from either a manual recipe or an attached library template was losing
// every non-pace target the moment the plan was assigned. Both paths now
// go through the same normalized shape, so neither can drop a field the
// other keeps.
function stepInsertFromTemplateStep(sessionId: string, stepOrder: number, ts: any) {
  return {
    session_id: sessionId,
    step_order: stepOrder,
    kind: ts.kind,
    reps: ts.reps ?? 1,
    set_count: ts.set_count ?? 1,
    target_kind: ts.target_kind ?? null,
    target_distance_m: ts.target_distance_m ?? null,
    target_time_seconds: ts.target_time_seconds ?? null,
    target_mode: ts.target_mode ?? null,
    target_pace_sec_per_km: ts.target_pace_sec_per_km ?? null,
    target_threshold_pace_pct: ts.target_threshold_pace_pct ?? null,
    target_threshold_hr_pct: ts.target_threshold_hr_pct ?? null,
    target_zone: ts.target_zone ?? null,
    target_rpe: ts.target_rpe ?? null,
    is_ladder: ts.is_ladder ?? false,
    counts_toward_distance: ts.counts_toward_distance ?? true,
    recovery_between_reps_seconds: ts.recovery_between_reps_seconds ?? null,
    recovery_between_reps_mode: ts.recovery_between_reps_mode ?? null,
    recovery_between_reps_target_kind: ts.recovery_between_reps_target_kind ?? null,
    recovery_between_sets_seconds: ts.recovery_between_sets_seconds ?? null,
    recovery_between_sets_mode: ts.recovery_between_sets_mode ?? null,
    recovery_mode: ts.recovery_mode ?? null,
    recovery_target_kind: ts.recovery_target_kind ?? null,
    recovery_target_seconds: ts.recovery_target_seconds ?? null,
    recovery_target_distance_m: ts.recovery_target_distance_m ?? null,
    notes: ts.notes ?? null,
  };
}

/**
 * Reads a template's sessions, resolves any linked-library-template steps
 * (from that library template's OWN current steps, not a snapshot — same
 * behavior as before), computes each day's real calendar date from
 * startDate, and — new — applies optional per-bucket progression via the
 * same scaleStep() engine Copy Period Forward uses. Pure read + compute,
 * no writes, so this is safe to call from a preview endpoint as well as
 * from assignPlanToAthlete's own no-drafts-supplied fallback path.
 */
async function resolveTemplateDrafts(
  sb: any,
  planTemplateId: string,
  startDate: string,
  progressionRules?: ProgressionRules,
  weekOverrides?: WeekOverride[],
): Promise<{ drafts: PlanAssignDraft[]; durationWeeks: number }> {
  const { data: template, error: templateErr } = await sb
    .from("plan_templates")
    .select("duration_weeks")
    .eq("id", planTemplateId)
    .single();
  if (templateErr || !template) throw templateErr ?? new Error("Plan template not found");

  const { data: templateSessions, error: sessErr } = await sb
    .from("plan_template_sessions")
    .select("*")
    .eq("plan_template_id", planTemplateId)
    .order("week_number")
    .order("day_of_week");
  if (sessErr) throw sessErr;
  if (!templateSessions || templateSessions.length === 0) {
    throw new Error("This plan template has no sessions defined yet");
  }

  const start = new Date(startDate + "T00:00:00");
  const drafts: PlanAssignDraft[] = [];

  for (const ts of templateSessions as any[]) {
    if (ts.effort_type === "rest") continue;

    const offsetDays = (ts.week_number - 1) * 7 + (ts.day_of_week - 1);
    const sessionDate = new Date(start);
    sessionDate.setDate(sessionDate.getDate() + offsetDays);
    const sessionDateStr = sessionDate.toISOString().slice(0, 10);

    // A day linked to the Templates library resolves from that template's
    // OWN current steps at assignment time — not a snapshot taken when the
    // plan day was authored — so editing the library template later is
    // reflected in any plan assigned from it since.
    let title = ts.title;
    let linkedSteps: any[] | null = null;
    let linkedIntent: string | null = null;
    let linkedStructure: string | null = null;

    if (ts.session_template_id) {
      const { data: libTemplate, error: libErr } = await sb
        .from("session_templates")
        .select("*")
        .eq("id", ts.session_template_id)
        .single();
      if (libErr || !libTemplate) {
        throw libErr ?? new Error(`Linked library template not found for week ${ts.week_number}, day ${ts.day_of_week}`);
      }

      const { data: libSteps, error: libStepsErr } = await sb
        .from("template_steps")
        .select("*")
        .eq("template_id", ts.session_template_id)
        .order("step_order");
      if (libStepsErr) throw libStepsErr;

      title = (libTemplate as any).title ?? title;
      linkedIntent = (libTemplate as any).intent ?? null;
      linkedStructure = (libTemplate as any).structure ?? null;
      linkedSteps = libSteps ?? [];
    }

    const recipeSteps = (ts.steps as any[] | null) ?? [];
    const rawSteps = linkedSteps ?? recipeSteps;
    const isIntervalWork = rawSteps.some((s: any) => s.kind === "work" && Number(s.reps ?? 1) > 1);

    const bucket = bucketForEffortType(ts.effort_type);
    const effectiveRules = resolveEffectiveRules(progressionRules ?? {}, weekOverrides, ts.week_number);
    const rule = bucket ? effectiveRules[bucket] : undefined;
    let needsReview = false;
    const scaledSteps = rawSteps.map((s: any) => {
      const { step, flagged } = scaleStep(s, rule);
      if (flagged) needsReview = true;
      return step;
    });

    drafts.push({
      tempId: `${ts.week_number}-${ts.day_of_week}`,
      sourceSessionId: `${ts.week_number}-${ts.day_of_week}`,
      athlete_id: "",
      week_number: ts.week_number,
      session_date: sessionDateStr,
      title,
      // 'race' and 'cross_training' are distinct session_day_type enum
      // values from 'training' — a cross-train day filed as 'training'
      // trips the DB trigger requiring intent+structure on training rows
      // (cross-train legitimately has neither).
      day_type: ts.effort_type === "race" ? "race" : ts.effort_type === "cross_train" ? "cross_training" : "training",
      intent: linkedIntent ?? EFFORT_TO_INTENT[ts.effort_type] ?? null,
      structure: linkedStructure ?? (isIntervalWork ? "intervals" : "continuous"),
      is_long_run: ts.effort_type === "long",
      bucket,
      needsReview,
      steps: scaledSteps,
      session_template_id: ts.session_template_id ?? null,
    });
  }

  return { drafts, durationWeeks: (template as any).duration_weeks };
}

/**
 * Preview-only: resolves a template into review-ready drafts (real dates,
 * resolved linked-template steps, optional progression scaling applied)
 * without writing anything. Powers the Assign dialog's Review step —
 * same "see it before it's created" pattern Copy Period Forward already
 * uses, now available for template assignment too.
 */
export const previewPlanAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { planTemplateId: string; startDate: string; progressionRules?: ProgressionRules; weekOverrides?: WeekOverride[] }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    return resolveTemplateDrafts(sb, data.planTemplateId, data.startDate, data.progressionRules, data.weekOverrides);
  });

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
 *
 * `drafts`, if supplied, is used as-is instead of re-resolving the template
 * — this is how the Assign dialog's Review step (edits, Quick adjustments,
 * removed days) actually reaches the database: preview → coach edits in
 * memory → the edited array comes back here unchanged. Omitting `drafts`
 * falls back to resolving the template fresh with no progression, exactly
 * the original one-step behavior, so nothing else calling this function
 * needs to change.
 *
 * CAMPAIGN LINKAGE (all optional, all no-ops when omitted — the direct
 * assign flow is unchanged):
 *
 *   campaignId          stamped on athlete_plans so the plan knows which
 *                       season it was created to serve.
 *   campaignFillRows    campaign_week_fills rows from buildFillRows(), minus
 *                       athlete_plan_id, which only exists once the plan is
 *                       inserted here. Upserted on campaign_week_id so a
 *                       refill replaces rather than accumulating.
 *   campaignWriteBacks  weeks whose load the coach changed during the fill
 *                       review, bringing the campaign back into agreement
 *                       with what was actually prescribed.
 */
export const assignPlanToAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      athleteId: string;
      planTemplateId: string;
      startDate: string;
      goalId?: string | null;
      drafts?: PlanAssignDraft[];
      campaignId?: string | null;
      campaignFillRows?: {
        campaign_week_id: string;
        plan_template_id: string | null;
        template_name: string | null;
        template_week_number: number;
        is_repeat: boolean;
        load_pct_applied: number;
      }[];
      campaignWriteBacks?: { campaignWeekId: string; toLoadPct: number }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const { data: template, error: templateErr } = await sb
      .from("plan_templates")
      .select("*")
      .eq("id", data.planTemplateId)
      .single();

    if (templateErr || !template) throw templateErr ?? new Error("Plan template not found");

    const sourceDrafts =
      data.drafts && data.drafts.length > 0 ? data.drafts : (await resolveTemplateDrafts(sb, data.planTemplateId, data.startDate)).drafts;

    if (sourceDrafts.length === 0) {
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
        campaign_id: data.campaignId ?? null,
      } as any)
      .select()
      .single();

    if (planErr || !planRow) throw planErr ?? new Error("Failed to create plan");

    let created = 0;

    // Sequential, not parallel — session_date collisions with an athlete's
    // existing same-day sessions are possible (e.g. a manually-logged easy
    // run on a day the plan also wants a long run) and each insert below is
    // independent, so a mid-batch failure should still leave everything
    // before it correctly created rather than an all-or-nothing rollback
    // the caller can't act on.
    for (const d of sourceDrafts) {
      const { data: newSession, error: newSessErr } = await sb
        .from("sessions")
        .insert({
          athlete_id: data.athleteId,
          created_by: context.userId,
          session_date: d.session_date,
          title: d.title,
          day_type: d.day_type,
          intent: d.intent,
          structure: d.structure,
          is_planned: true,
          // session_source only allows 'manual' | 'synced' | 'fit_import' —
          // 'plan_template' isn't a valid enum member (this was the actual
          // cause of sessions never reaching the calendar). A plan-generated
          // session is conceptually the same as one built by hand in the
          // Session Builder, so 'manual' is the accurate value here, not a
          // placeholder — which sessions came from a plan is already
          // tracked precisely via athlete_plan_sessions, not this column.
          source: "manual",
          applied_from_template_id: (d as any).session_template_id ?? null,
        } as any)
        .select()
        .single();

      if (newSessErr || !newSession) {
        throw newSessErr ?? new Error(`Failed to create session for ${d.session_date}`);
      }

      if (d.steps && d.steps.length > 0) {
        const stepsToInsert = d.steps.map((s: any, i: number) => stepInsertFromTemplateStep(newSession.id, i + 1, s));
        const { error: stepsErr } = await sb.from("steps").insert(stepsToInsert as any);
        if (stepsErr) throw stepsErr;
      }

      const { error: linkErr } = await sb.from("athlete_plan_sessions").insert({
        athlete_plan_id: planRow.id,
        session_id: newSession.id,
        week_number: (d as any).week_number ?? 1,
      } as any);
      if (linkErr) throw linkErr;

      created++;
    }

    // ---- Campaign linkage -------------------------------------------------
    //
    // Deliberately AFTER the sessions. A fill record or a rewritten campaign
    // week describing training that failed to be created would be worse than
    // no record at all — the campaign would assert a filled week with nothing
    // underneath it.
    //
    // Neither of these throws. By this point every session exists, and
    // failing the whole call would tell the coach the fill failed when the
    // training is sitting on their calendar. They're reported back instead so
    // the UI can say precisely what did and didn't land.
    const warnings: string[] = [];

    if (data.campaignFillRows && data.campaignFillRows.length > 0) {
      // Upsert, not insert: campaign_week_fills is UNIQUE on campaign_week_id,
      // so refilling a week replaces its record rather than colliding.
      const { error: fillErr } = await (sb as any)
        .from("campaign_week_fills")
        .upsert(
          data.campaignFillRows.map((r) => ({ ...r, athlete_plan_id: planRow.id })) as any,
          { onConflict: "campaign_week_id" },
        );
      if (fillErr) {
        warnings.push(
          `Sessions were created, but the campaign's record of which weeks are filled could not be written (${fillErr.message}). The timeline will show these weeks as unfilled.`,
        );
      }
    }

    if (data.campaignWriteBacks && data.campaignWriteBacks.length > 0) {
      let failed = 0;
      for (const wb of data.campaignWriteBacks) {
        // One at a time rather than an upsert: campaign_weeks has a BEFORE
        // UPDATE trigger that sets is_locked whenever load_pct changes, and
        // an upsert would need every NOT NULL column restated to avoid
        // overwriting week_start or phase with nulls.
        const { error: wbErr } = await sb
          .from("campaign_weeks")
          .update({ load_pct: wb.toLoadPct } as any)
          .eq("id", wb.campaignWeekId);
        if (wbErr) failed++;
      }
      if (failed > 0) {
        warnings.push(
          `${failed} of ${data.campaignWriteBacks.length} campaign week loads could not be updated. The timeline still shows the old figures for those weeks.`,
        );
      }
    }

    return { ok: true, planId: planRow.id, sessionsCreated: created, warnings };
  });

/**
 * Removes a fill: deletes the sessions a plan put on a set of campaign weeks,
 * clears their fill records, and abandons the plan once nothing is left of it.
 *
 * Same restraint as cancelAthletePlan — anything already completed, or dated
 * in the past, is left alone. That is real training history regardless of
 * which plan prescribed it, and a coach refilling a block in week 4 of 6 must
 * not lose the three weeks the athlete has already run.
 */
export const unfillCampaignWeeks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { campaignWeekIds: string[] }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    if (!data.campaignWeekIds || data.campaignWeekIds.length === 0) {
      return { ok: true, sessionsDeleted: 0, weeksCleared: 0, keptCompleted: 0 };
    }

    const { data: fills, error: fillsErr } = await (sb as any)
      .from("campaign_week_fills")
      .select("id, athlete_plan_id, campaign_week_id, campaign_weeks(week_start)")
      .in("campaign_week_id", data.campaignWeekIds);
    if (fillsErr) throw fillsErr;
    if (!fills || fills.length === 0) {
      return { ok: true, sessionsDeleted: 0, weeksCleared: 0, keptCompleted: 0 };
    }

    const today = new Date().toISOString().slice(0, 10);
    const planIds = [...new Set((fills as any[]).map((f) => f.athlete_plan_id))];

    // The date ranges this unfill actually covers — a plan can span weeks
    // beyond the ones being cleared (a fill of one block, then another block
    // from the same plan), so deleting by plan alone would take out sessions
    // in weeks the coach is keeping.
    const weekStarts = (fills as any[])
      .map((f) => f.campaign_weeks?.week_start as string | undefined)
      .filter((s): s is string => !!s);
    const inRange = (date: string) =>
      weekStarts.some((ws) => {
        const start = Date.parse(`${ws}T00:00:00Z`);
        const d = Date.parse(`${date}T00:00:00Z`);
        return d >= start && d < start + 7 * 86400000;
      });

    let sessionsDeleted = 0;
    let keptCompleted = 0;

    for (const planId of planIds) {
      const { data: planSessions } = await sb
        .from("athlete_plan_sessions")
        .select("session_id, sessions(session_date, completed_at)")
        .eq("athlete_plan_id", planId);

      for (const ps of (planSessions ?? []) as any[]) {
        const date = ps.sessions?.session_date as string | undefined;
        if (!date || !inRange(date)) continue;
        if (ps.sessions?.completed_at || date < today) {
          keptCompleted++;
          continue;
        }

        const { data: steps } = await sb.from("steps").select("id").eq("session_id", ps.session_id);
        const stepIds = (steps ?? []).map((s: any) => s.id);
        if (stepIds.length > 0) {
          await sb.from("interval_results").delete().in("step_id", stepIds);
        }
        await sb.from("steps").delete().eq("session_id", ps.session_id);
        await sb.from("sessions").delete().eq("id", ps.session_id);
        sessionsDeleted++;
      }
    }

    const { error: delErr } = await (sb as any)
      .from("campaign_week_fills")
      .delete()
      .in("campaign_week_id", data.campaignWeekIds);
    if (delErr) throw delErr;

    // A plan with no fills left is a plan that no longer describes anything.
    // Abandoned rather than deleted — athlete_plan_sessions still points at
    // any completed sessions that were kept above, and that provenance is
    // worth more than a tidy table.
    for (const planId of planIds) {
      const { count } = await (sb as any)
        .from("campaign_week_fills")
        .select("id", { count: "exact", head: true })
        .eq("athlete_plan_id", planId);
      if ((count ?? 0) === 0) {
        await sb.from("athlete_plans").update({ status: "abandoned" } as any).eq("id", planId);
      }
    }

    return {
      ok: true,
      sessionsDeleted,
      weeksCleared: data.campaignWeekIds.length,
      keptCompleted,
    };
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
