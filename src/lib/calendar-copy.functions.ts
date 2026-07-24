import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Mirrors the exact `steps` column set plan.functions.ts's copy functions
// use — kept in sync deliberately rather than importing across the two
// files, since a step insert payload here has no reason to depend on the
// plan-assignment module.
type DraftStepInput = {
  kind: string;
  reps: number;
  set_count: number;
  target_kind: string | null;
  target_distance_m: number | null;
  target_time_seconds: number | null;
  target_mode: string | null;
  target_pace_sec_per_km: number | null;
  target_threshold_pace_pct: number | null;
  target_threshold_hr_pct: number | null;
  target_zone: string | null;
  target_rpe: number | null;
  is_ladder: boolean;
  counts_toward_distance: boolean;
  recovery_between_reps_seconds: number | null;
  recovery_between_reps_mode: string | null;
  recovery_between_reps_target_kind: string | null;
  recovery_between_sets_seconds: number | null;
  recovery_between_sets_mode: string | null;
  recovery_mode: string | null;
  recovery_target_kind: string | null;
  recovery_target_seconds: number | null;
  recovery_target_distance_m: number | null;
  notes: string | null;
};

type DraftSessionInput = {
  athlete_id: string;
  session_date: string;
  title: string;
  day_type: string;
  intent: string | null;
  structure: string | null;
  is_long_run: boolean;
  steps: DraftStepInput[];
};

/**
 * Commits the final draft array from the Copy Period dialog as real
 * sessions + steps. The dialog already did all the scaling and any
 * per-session edits/swaps client-side (calendar-copy.ts) — this just
 * writes what it's given, exactly like assignPlanToAthlete writes
 * whatever a plan template resolves to. Always creates fresh planned
 * sessions; never overwrites or skips existing sessions on the target
 * dates — a copy always lands alongside whatever's already there.
 */
export const commitCopyDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { drafts: DraftSessionInput[] }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    let created = 0;

    // Sequential, not parallel — same reasoning as assignPlanToAthlete
    // and the Plans bulk-assign loop: each draft is independent, so one
    // failure partway through shouldn't roll back everything created
    // before it.
    for (const draft of data.drafts) {
      const { data: newSession, error: sessErr } = await sb
        .from("sessions")
        .insert({
          athlete_id: draft.athlete_id,
          created_by: context.userId,
          session_date: draft.session_date,
          title: draft.title,
          day_type: draft.day_type,
          intent: draft.intent,
          structure: draft.structure,
          is_long_run: draft.is_long_run,
          is_planned: true,
          source: "manual",
        } as any)
        .select()
        .single();

      if (sessErr || !newSession) {
        throw sessErr ?? new Error(`Failed to create copied session for ${draft.session_date}`);
      }

      if (draft.steps.length > 0) {
        const stepsToInsert = draft.steps.map((s, i) => ({
          session_id: newSession.id,
          step_order: i + 1,
          ...s,
        }));
        const { error: stepsErr } = await sb.from("steps").insert(stepsToInsert as any);
        if (stepsErr) throw stepsErr;
      }

      created++;
    }

    return { ok: true, created };
  });
