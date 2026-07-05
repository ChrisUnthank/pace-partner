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
        const now = new Date();

        const { data: athletes } = await supabaseAdmin
          .from("athletes")
          .select("id, user_id, name, reminder_morning_local, reminder_evening_local, reminders_enabled")
          .eq("reminders_enabled", true)
          .not("user_id", "is", null);

        const userIds = Array.from(new Set((athletes ?? []).map((a) => a.user_id).filter(Boolean) as string[]));
        const tzByUser = new Map<string, string>();
        if (userIds.length) {
          const { data: profs } = await supabaseAdmin
            .from("profiles").select("id, timezone").in("id", userIds);
          for (const p of profs ?? []) tzByUser.set(p.id, (p as any).timezone || "UTC");
        }

        let queued = 0;
        for (const a of athletes ?? []) {
          const morning = (a.reminder_morning_local ?? "08:00").slice(0, 5);
          const evening = (a.reminder_evening_local ?? "20:00").slice(0, 5);
          const tz = tzByUser.get(a.user_id as string) || "UTC";
          const { hhmm, today } = localClock(now, tz);
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

function localClock(now: Date, timeZone: string): { hhmm: string; today: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return {
      hhmm: `${hour}:${get("minute")}`,
      today: `${get("year")}-${get("month")}-${get("day")}`,
    };
  } catch {
    return {
      hhmm: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
      today: now.toISOString().slice(0, 10),
    };
  }
}

async function queueNotification(sb: any, userId: string, kind: string, date: string, title: string, body: string, link: string) {
  // dedupe per user/kind/date
  const { data: existing } = await sb.from("notifications").select("id")
    .eq("user_id", userId).eq("kind", kind)
    .gte("created_at", `${date}T00:00:00Z`).limit(1);
  if ((existing ?? []).length > 0) return;
  await sb.from("notifications").insert({ user_id: userId, kind, title, body, link, data: { date } });
}