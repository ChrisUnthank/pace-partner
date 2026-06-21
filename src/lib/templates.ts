import { supabase } from "@/integrations/supabase/client";

// Fields copied between sessions/steps and session_templates/template_steps.
// Kept aligned so a future device-sync matcher can compare incoming activities
// against either planned sessions or saved templates with one query shape.
const STEP_STRUCTURAL_COLS = [
  "step_order", "kind", "reps", "set_count",
  "target_kind", "target_distance_m", "target_time_seconds", "target_pace_sec_per_km",
  "is_ladder", "counts_toward_distance",
  "recovery_between_reps_seconds", "recovery_between_reps_mode",
  "recovery_between_reps_target_kind", "recovery_between_reps_distance_m",
  "recovery_between_sets_seconds", "recovery_between_sets_mode",
  "recovery_between_sets_target_kind", "recovery_between_sets_distance_m",
  "recovery_mode", "recovery_target_kind", "recovery_target_seconds", "recovery_target_distance_m",
  "notes",
] as const;

function pickStructural(row: any) {
  const out: any = {};
  for (const k of STEP_STRUCTURAL_COLS) out[k] = row[k] ?? null;
  return out;
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
    const rows = steps.map((s: any) => ({ template_id: (tpl as any).id, ...pickStructural(s) }));
    const { error: tsErr } = await supabase.from("template_steps").insert(rows as any);
    if (tsErr) return { ok: false, error: tsErr.message };
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

  if (tsteps && tsteps.length > 0) {
    const rows = tsteps.map((s: any) => ({ session_id: (sess as any).id, ...pickStructural(s) }));
    const { error: insErr } = await supabase.from("steps").insert(rows as any);
    if (insErr) return { ok: false, error: insErr.message };
  }
  return { ok: true, sessionId: (sess as any).id };
}