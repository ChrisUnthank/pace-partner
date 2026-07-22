import { supabase } from "@/integrations/supabase/client";

// Fields copied between sessions/steps and session_templates/template_steps.
// Kept aligned so a future device-sync matcher can compare incoming activities
// against either planned sessions or saved templates with one query shape.
const STEP_STRUCTURAL_COLS = [
  "step_order", "kind", "reps", "set_count",
  "target_kind", "target_distance_m", "target_time_seconds", "target_pace_sec_per_km",
  "target_mode", "target_threshold_pace_pct", "target_threshold_hr_pct",
  "target_zone", "target_rpe",
  "is_ladder", "counts_toward_distance",
  "recovery_between_reps_seconds", "recovery_between_reps_mode",
  "recovery_between_reps_target_kind", "recovery_between_reps_distance_m",
  "recovery_between_sets_seconds", "recovery_between_sets_mode",
  "recovery_between_sets_target_kind", "recovery_between_sets_distance_m",
  "recovery_mode", "recovery_target_kind", "recovery_target_seconds", "recovery_target_distance_m",
  "notes",
] as const;

// Columns that are NOT NULL (with a default) in steps/template_steps. Older
// rows — especially FIT-imported steps created before some of these columns
// existed — can hold genuine blanks for them, and the previous pickStructural
// turned every blank into an explicit `null`, which the destination table
// rejects with "null value in column … violates not-null constraint". Copying
// a blank now falls back to the same default the database itself would use.
const NOT_NULL_FALLBACKS: Record<string, unknown> = {
  reps: 1,
  set_count: 1,
  is_ladder: false,
  counts_toward_distance: true,
  recovery_between_reps_target_kind: "time",
  recovery_between_sets_target_kind: "time",
};

function pickStructural(row: any) {
  const out: any = {};
  for (const k of STEP_STRUCTURAL_COLS) {
    const v = row[k];
    out[k] = v ?? (k in NOT_NULL_FALLBACKS ? NOT_NULL_FALLBACKS[k] : null);
  }
  return out;
}

// ── Snapping GPS actuals to prescribable values ──────────────────────────────
// Sessions rebuilt from FIT files store what the athlete actually ran
// (20×408m reps, a 3998m warmup, 93s recoveries). A template is a
// prescription, so on save-as-template these get snapped to the value a
// coach would actually write: 409→400, 925→1000, 3998→4000, 3:02→3:00.
// Manually planned values are already round numbers, so snapping is a
// no-op for them. The source session itself is never modified.

// Common prescribed rep distances from 150m up — snapping picks the nearest
// rung, so 190 goes to 200, 409 to 400, and 925 to 1000. Note 900 is
// deliberately NOT a rung: reps in the 900s are almost always a GPS-short
// 1km, and adding it would stop 925 snapping to 1000. Below 150m (sprint
// territory) prescriptions run in 10m increments, so those round to the
// nearest 10 instead — see snapDistanceM.
const REP_DISTANCE_LADDER_M = [
  150, 200, 250, 300, 400, 500, 600, 700, 800,
  1000, 1200, 1500, 1600, 2000, 2400, 3000,
];

function snapDistanceM(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return v ?? null;
  // Half and full marathon get pinned exactly when the recording is close.
  if (Math.abs(v - 21100) <= 400) return 21100;
  if (Math.abs(v - 42200) <= 600) return 42200;
  if (v < 145) return Math.max(10, Math.round(v / 10) * 10); // sprints: nearest 10m
  if (v <= 3000) {
    let best = REP_DISTANCE_LADDER_M[0];
    for (const d of REP_DISTANCE_LADDER_M) {
      if (Math.abs(v - d) < Math.abs(v - best)) best = d;
    }
    return best;
  }
  if (v <= 10000) return Math.round(v / 500) * 500; // 3–10km: nearest 500m
  return Math.round(v / 1000) * 1000; // beyond: nearest km
}

function snapTimeS(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return v ?? null;
  if (v < 600) return Math.max(5, Math.round(v / 15) * 15); // under 10 min: nearest 15s
  if (v < 1800) return Math.round(v / 30) * 30; // 10–30 min: nearest 30s
  return Math.round(v / 60) * 60; // beyond: whole minutes
}

function tidyStepForTemplate(row: any) {
  return {
    ...row,
    target_distance_m: snapDistanceM(row.target_distance_m),
    target_time_seconds: snapTimeS(row.target_time_seconds),
    recovery_between_reps_seconds: snapTimeS(row.recovery_between_reps_seconds),
    recovery_between_reps_distance_m: snapDistanceM(row.recovery_between_reps_distance_m),
    recovery_between_sets_seconds: snapTimeS(row.recovery_between_sets_seconds),
    recovery_between_sets_distance_m: snapDistanceM(row.recovery_between_sets_distance_m),
    recovery_target_seconds: snapTimeS(row.recovery_target_seconds),
    recovery_target_distance_m: snapDistanceM(row.recovery_target_distance_m),
  };
}

/** Save an existing session as a coach-owned template (copies its steps). */
export async function saveSessionAsTemplate(args: {
  sessionId: string;
  ownerUserId: string;
  name: string;
}): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  const { data: session, error: sessErr } = await supabase
    .from("sessions").select("*").eq("id", args.sessionId).single();
  if (sessErr || !session) return { ok: false, error: sessErr?.message ?? "Session not found" };
  if ((session as any).day_type !== "training") {
    return { ok: false, error: "Only training sessions can be saved as templates" };
  }

  const { data: steps, error: stepErr } = await supabase
    .from("steps").select("*").eq("session_id", args.sessionId).order("step_order");
  if (stepErr) return { ok: false, error: stepErr.message };

  const { data: tpl, error: tplErr } = await supabase.from("session_templates").insert({
    owner_user_id: args.ownerUserId,
    name: args.name,
    title: (session as any).title,
    notes: (session as any).notes ?? null,
    intent: (session as any).intent,
    structure: (session as any).structure,
    is_long_run: (session as any).is_long_run ?? false,
  } as any).select().single();
  if (tplErr || !tpl) return { ok: false, error: tplErr?.message ?? "Failed to create template" };

  if (steps && steps.length > 0) {
    const rows = steps.map((s: any) => ({
      template_id: (tpl as any).id,
      ...pickStructural(tidyStepForTemplate(s)),
    }));
    const { error: tsErr } = await supabase.from("template_steps").insert(rows as any);
    if (tsErr) {
      // Roll back the template row so a failed steps copy can't leave an
      // empty "shell" template behind — a shell shows up in the Templates
      // list but populates nothing when applied.
      await supabase.from("session_templates").delete().eq("id", (tpl as any).id);
      return { ok: false, error: tsErr.message };
    }
  }
  return { ok: true, templateId: (tpl as any).id };
}

/** Apply a saved template by copying it into a new planned session for an athlete + date. */
export async function applyTemplateToSession(args: {
  templateId: string;
  athleteId: string;
  createdByUserId: string;
  sessionDate: string;
  titleOverride?: string;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const { data: tpl, error: tplErr } = await supabase
    .from("session_templates").select("*").eq("id", args.templateId).single();
  if (tplErr || !tpl) return { ok: false, error: tplErr?.message ?? "Template not found" };

  const { data: tsteps, error: tsErr } = await supabase
    .from("template_steps").select("*").eq("template_id", args.templateId).order("step_order");
  if (tsErr) return { ok: false, error: tsErr.message };

  // A template with no steps is a broken shell (created while template
  // saving was failing partway) — applying it would create a session with
  // a title and nothing else. Refuse with a clear explanation instead.
  if (!tsteps || tsteps.length === 0) {
    return {
      ok: false,
      error:
        "This template has no steps — it was saved while template saving was broken. Delete it and re-save it from the original session.",
    };
  }

  const { data: sess, error: sErr } = await supabase.from("sessions").insert({
    athlete_id: args.athleteId,
    created_by: args.createdByUserId,
    session_date: args.sessionDate,
    title: args.titleOverride ?? (tpl as any).title,
    day_type: "training",
    intent: (tpl as any).intent,
    structure: (tpl as any).structure,
    is_long_run: (tpl as any).is_long_run,
    notes: (tpl as any).notes ?? null,
    is_planned: true,
    applied_from_template_id: (tpl as any).id,
  } as any).select().single();
  if (sErr || !sess) return { ok: false, error: sErr?.message ?? "Failed to create session" };

  const rows = tsteps.map((s: any) => ({ session_id: (sess as any).id, ...pickStructural(s) }));
  const { error: insErr } = await supabase.from("steps").insert(rows as any);
  if (insErr) {
    // Roll back the session row so a failed steps copy can't leave an
    // empty planned session on the athlete's calendar.
    await supabase.from("sessions").delete().eq("id", (sess as any).id);
    return { ok: false, error: insErr.message };
  }
  return { ok: true, sessionId: (sess as any).id };
}
