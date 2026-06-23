import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCoachSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data } = await sb.from("coach_settings").select("*").eq("coach_id", context.userId).maybeSingle();
    if (data) return data;
    // lazy create
    const { data: row } = await sb.from("coach_settings").insert({ coach_id: context.userId }).select().single();
    return row;
  });

export const updateCoachSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { morning: string; evening: string; defaultEnabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { error } = await sb.from("coach_settings").upsert({
      coach_id: context.userId,
      default_reminder_morning_local: data.morning,
      default_reminder_evening_local: data.evening,
      reminders_enabled_default: data.defaultEnabled,
    }, { onConflict: "coach_id" });
    if (error) throw error;
    return { ok: true };
  });

export const updateAthleteReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; morning: string; evening: string; enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { error } = await sb.from("athletes").update({
      reminder_morning_local: data.morning,
      reminder_evening_local: data.evening,
      reminders_enabled: data.enabled,
    }).eq("id", data.athleteId);
    if (error) throw error;
    return { ok: true };
  });