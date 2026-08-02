import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ActivityEventType =
  | "session_logged"
  | "session_uploaded"
  | "sessions_bulk_uploaded"
  | "ai_generated"
  | "message_sent"
  | "message_received"
  | "plan_built"
  | "plan_sent"
  | "raced"
  | "pb_achieved"
  | "report_generated";

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  title: string;
  description?: string | null;
  link?: string | null;
};

const SOURCE_LIMIT = 100;

// Bulk-upload detection: session_files carries no batch id of its own, so
// this groups files by athlete + upload timestamp rounded to the nearest
// 2 minutes — the same window a person dragging in 10 FIT files at once
// would realistically land in, without being so wide it merges two
// genuinely separate upload sessions on the same day.
function timeBucket(iso: string): string {
  const ms = new Date(iso).getTime();
  const bucketMs = 2 * 60 * 1000;
  return String(Math.floor(ms / bucketMs));
}

function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "";
  return `${(m / 1000).toFixed(2)}km`;
}

function fmtClock(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return "";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export const listAthleteActivityHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const athleteId = data.athleteId;
    const events: ActivityEvent[] = [];

    const { data: athleteRow } = await sb.from("athletes").select("user_id").eq("id", athleteId).maybeSingle();
    const athleteUserId = athleteRow?.user_id as string | null | undefined;

    // ---- Sessions: uploaded (single or bulk) vs. manually logged ----
    const [{ data: files }, { data: sessions }] = await Promise.all([
      sb
        .from("session_files")
        .select("id, session_id, created_at, sessions(title)")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
      sb
        .from("sessions")
        .select("id, title, session_date, day_type, completed_at, created_at")
        .eq("athlete_id", athleteId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(SOURCE_LIMIT),
    ]);

    const uploadedSessionIds = new Set<string>();
    const uploadBuckets = new Map<string, { sessionIds: Set<string>; latestAt: string; titles: string[] }>();
    for (const f of files ?? []) {
      if (!f.session_id) continue;
      uploadedSessionIds.add(f.session_id);
      const key = timeBucket(f.created_at);
      if (!uploadBuckets.has(key)) uploadBuckets.set(key, { sessionIds: new Set(), latestAt: f.created_at, titles: [] });
      const bucket = uploadBuckets.get(key)!;
      bucket.sessionIds.add(f.session_id);
      if (f.created_at > bucket.latestAt) bucket.latestAt = f.created_at;
      const title = (f as any).sessions?.title;
      if (title) bucket.titles.push(title);
    }
    for (const [key, bucket] of uploadBuckets) {
      if (bucket.sessionIds.size >= 2) {
        events.push({
          id: `bulk-upload-${key}`,
          type: "sessions_bulk_uploaded",
          timestamp: bucket.latestAt,
          title: `Bulk uploaded ${bucket.sessionIds.size} sessions`,
          description: bucket.titles.slice(0, 5).join(", ") + (bucket.titles.length > 5 ? "…" : ""),
        });
      } else {
        events.push({
          id: `upload-${key}`,
          type: "session_uploaded",
          timestamp: bucket.latestAt,
          title: `Session uploaded${bucket.titles[0] ? ` — ${bucket.titles[0]}` : ""}`,
        });
      }
    }
    // Completed sessions with no file at all — a genuinely manual entry,
    // not an upload. Races are excluded here (they get their own "raced"
    // event below, not a generic "logged" one too).
    for (const s of sessions ?? []) {
      if (uploadedSessionIds.has(s.id) || s.day_type === "race") continue;
      events.push({
        id: `logged-${s.id}`,
        type: "session_logged",
        timestamp: s.completed_at ?? s.created_at,
        title: `Session logged — ${s.title ?? "Untitled"}`,
        link: `/app/sessions/${s.id}`,
      });
    }
    // Races — their own event type, separate from the generic upload/log
    // events above regardless of how the race data got into the system.
    for (const s of sessions ?? []) {
      if (s.day_type !== "race") continue;
      events.push({
        id: `race-${s.id}`,
        type: "raced",
        timestamp: s.completed_at ?? s.created_at,
        title: `Raced — ${s.title ?? "Race"}`,
        link: `/app/sessions/${s.id}`,
      });
    }

    // ---- AI generated (reviews, squad reviews, session/daily notes) ----
    const [{ data: aiReviews }, { data: squadReviews }, { data: aiNotes }] = await Promise.all([
      sb
        .from("ai_reviews")
        .select("id, review_type, created_at")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
      sb
        .from("ai_squad_reviews" as any)
        .select("id, review_type, athlete_ids, created_at")
        .contains("athlete_ids", [athleteId])
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
      sb
        .from("ai_athlete_notes" as any)
        .select("id, kind, note_date, created_at")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
    ]);
    for (const r of aiReviews ?? []) {
      events.push({
        id: `ai-review-${r.id}`,
        type: "ai_generated",
        timestamp: r.created_at,
        title: `AI review generated (${r.review_type})`,
      });
    }
    for (const r of (squadReviews ?? []) as any[]) {
      events.push({
        id: `ai-squad-review-${r.id}`,
        type: "ai_generated",
        timestamp: r.created_at,
        title: `AI squad review generated (${r.review_type})`,
      });
    }
    for (const n of (aiNotes ?? []) as any[]) {
      events.push({
        id: `ai-note-${n.id}`,
        type: "ai_generated",
        timestamp: n.created_at,
        title: `AI ${n.kind} reflection generated`,
      });
    }

    // ---- Messages sent/received ----
    if (athleteUserId) {
      const { data: msgs } = await sb
        .from("direct_messages")
        .select("id, sender_id, recipient_id, body, created_at")
        .or(`sender_id.eq.${athleteUserId},recipient_id.eq.${athleteUserId}`)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT);
      const counterpartyIds = Array.from(
        new Set((msgs ?? []).map((m: any) => (m.sender_id === athleteUserId ? m.recipient_id : m.sender_id))),
      );
      const { data: counterparties } = counterpartyIds.length
        ? await sb.from("profiles").select("id, full_name").in("id", counterpartyIds)
        : { data: [] as any[] };
      const nameById = new Map((counterparties ?? []).map((p: any) => [p.id, p.full_name]));
      for (const m of msgs ?? []) {
        const sent = m.sender_id === athleteUserId;
        const other = sent ? m.recipient_id : m.sender_id;
        const otherName = nameById.get(other) ?? "someone";
        events.push({
          id: `msg-${m.id}`,
          type: sent ? "message_sent" : "message_received",
          timestamp: m.created_at,
          title: sent ? `Message sent to ${otherName}` : `Message received from ${otherName}`,
          description: m.body?.slice(0, 120),
        });
      }
    }

    // ---- Plans built / sent ----
    const [{ data: plansBuilt }, { data: deliveries }] = await Promise.all([
      sb
        .from("athlete_plans" as any)
        .select("id, name, created_at")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
      sb
        .from("plan_delivery_recipients" as any)
        .select("id, created_at, plan_deliveries(summary, date_range_start, date_range_end)")
        .eq("athlete_id", athleteId)
        .order("created_at", { ascending: false })
        .limit(SOURCE_LIMIT),
    ]);
    for (const p of (plansBuilt ?? []) as any[]) {
      events.push({
        id: `plan-built-${p.id}`,
        type: "plan_built",
        timestamp: p.created_at,
        title: `Plan built — ${p.name}`,
      });
    }
    for (const d of (deliveries ?? []) as any[]) {
      const delivery = d.plan_deliveries;
      events.push({
        id: `plan-sent-${d.id}`,
        type: "plan_sent",
        timestamp: d.created_at,
        title: "Plan sent",
        description: delivery?.summary ?? undefined,
      });
    }

    // ---- PBs ----
    const { data: pbs } = await sb
      .from("performances")
      .select("id, distance_m, time_seconds, performance_date, event_name, created_at")
      .eq("athlete_id", athleteId)
      .eq("is_pb", true)
      .order("performance_date", { ascending: false })
      .limit(SOURCE_LIMIT);
    for (const p of (pbs ?? []) as any[]) {
      events.push({
        id: `pb-${p.id}`,
        type: "pb_achieved",
        timestamp: p.created_at ?? p.performance_date,
        title: `PB achieved — ${fmtDistance(p.distance_m)} in ${fmtClock(p.time_seconds)}`,
        description: p.event_name ?? undefined,
      });
    }

    // ---- Report runs ----
    const { data: reportRuns } = await sb
      .from("report_runs" as any)
      .select("id, report_type, period_start, period_end, created_at")
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT);
    for (const r of (reportRuns ?? []) as any[]) {
      events.push({
        id: `report-${r.id}`,
        type: "report_generated",
        timestamp: r.created_at,
        title: r.report_type === "coach_roster" ? "Coach Roster Summary generated" : "Athlete Report generated",
        description: `${r.period_start} → ${r.period_end}`,
      });
    }

    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return events;
  });
