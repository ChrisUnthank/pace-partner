import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by pg_cron every 15 minutes. For each athlete with reminders enabled,
 * fire morning push if vitals not yet logged today and the local time has passed
 * the configured morning reminder, and similarly evening push if no session yet.
 * Each (athlete, period, date) fires at most once via notifications dedupe key.
 */
export const Route = createFileRoute("/api/public/hooks/run-daily-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const today = new Date().toISOString().slice(0, 10);
        const now = new Date();
        const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

        const { data: athletes } = await supabaseAdmin
          .from("athletes")
          .select("id, user_id, name, reminder_morning_local, reminder_evening_local, reminders_enabled")
          .eq("reminders_enabled", true)
          .not("user_id", "is", null);

        let queued = 0;
        for (const a of athletes ?? []) {
          const morning = (a.reminder_morning_local ?? "08:00").slice(0, 5);
          const evening = (a.reminder_evening_local ?? "20:00").slice(0, 5);
          // morning reminder window: any time at or after morning, before 12:00
          if (hhmm >= morning && hhmm < "12:00") {
            const { data: vitals } = await supabaseAdmin
              .from("daily_vitals").select("id").eq("athlete_id", a.id).eq("vitals_date", today).maybeSingle();
            if (!vitals) {
              await queueNotification(supabaseAdmin, a.user_id, "reminder_vitals", today,
                "Log today's vitals", "Sleep, resting HR, weight, hydration.", "/app/daily-log");
              queued++;
            }
          }
          // evening reminder window: any time at or after evening
          if (hhmm >= evening) {
            const { data: sess } = await supabaseAdmin
              .from("sessions").select("id").eq("athlete_id", a.id).eq("session_date", today).limit(1);
            const has = (sess ?? []).length > 0;
            if (!has) {
              await queueNotification(supabaseAdmin, a.user_id, "reminder_session", today,
                "Log today's training", "Upload your session file or add a quick note.", "/app/daily-log");
              queued++;
            }
          }
        }
        return new Response(JSON.stringify({ ok: true, queued }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});

async function queueNotification(sb: any, userId: string, kind: string, date: string, title: string, body: string, link: string) {
  // dedupe per user/kind/date
  const { data: existing } = await sb.from("notifications").select("id")
    .eq("user_id", userId).eq("kind", kind)
    .gte("created_at", `${date}T00:00:00Z`).limit(1);
  if ((existing ?? []).length > 0) return;
  await sb.from("notifications").insert({ user_id: userId, kind, title, body, link, data: { date } });
}