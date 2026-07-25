import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DeliveryChannel = "noticeboard" | "in_app" | "email";
type EmailStatus = "not_attempted" | "sent" | "failed" | "skipped_no_email";

/**
 * Persists one Deliver Program batch. The actual emails are sent by the
 * caller (DeliverProgramDialog) before this is called, one at a time via
 * the send-plan-delivery-email edge function — same pattern the existing
 * Athlete/Coach report pages already use for email (supabase.functions.
 * invoke straight from the client). This function's job is to record the
 * outcome and fire the two in-app channels:
 *
 *  - "noticeboard": broadcasts to the coach's ENTIRE squad — an existing
 *    DB trigger (trg_notify_noticeboard_post) already notifies every
 *    athlete the coach coaches the moment the post is created, regardless
 *    of who's actually a recipient of this specific delivery.
 *  - "in_app": targeted — only this delivery's selected recipients (the
 *    ones with an app login) get a notification, via the
 *    notify_plan_delivery RPC. A direct `notifications` table insert
 *    does NOT work here — its RLS policy only allows a user to insert
 *    their own rows (`user_id = auth.uid()`), so a coach's session
 *    inserting a row for an athlete's user_id gets silently rejected.
 *    Every other cross-user notification in this app (Noticeboard posts,
 *    DMs, session updates) already goes through a SECURITY DEFINER
 *    function for exactly this reason — notify_plan_delivery is that
 *    same pattern, added for this channel.
 *
 * A coach can use either, both, or neither (email-only / Excel-only is a
 * valid choice too).
 */
export const recordPlanDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      dateRangeStart: string;
      dateRangeEnd: string;
      summary: string;
      channels: DeliveryChannel[];
      exportDetailLevel: "simple" | "detailed" | "both";
      noticeboardTitle?: string;
      noticeboardBody?: string;
      // Powers the coach-diary chip label ("Jane Smith · 1-8 Aug" /
      // "Senior Squad · 1-31 Aug" / "Select (3) · ..." / "Roster · ...").
      scopeType: "athlete" | "select" | "group" | "roster";
      scopeLabel: string;
      recipients: { athlete_id: string; email_to: string | null; email_status: EmailStatus }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    // Looked up once, reused both for the targeted in-app notification
    // below and for the notified_in_app flag recorded per recipient.
    const athleteIds = data.recipients.map((r) => r.athlete_id);
    const { data: athleteRows } = athleteIds.length
      ? await sb.from("athletes").select("id, user_id").in("id", athleteIds)
      : { data: [] as any[] };
    const userIdByAthlete = new Map((athleteRows ?? []).map((a: any) => [a.id, a.user_id as string | null]));

    let noticeboardPostId: string | null = null;
    if (data.channels.includes("noticeboard")) {
      const { data: post, error: postErr } = await sb
        .from("noticeboard_posts")
        .insert({
          author_id: context.userId,
          post_type: "announcement",
          title: data.noticeboardTitle ?? "New training block posted",
          body: data.noticeboardBody ?? null,
          link_url: "/app/sessions/calendar",
        } as any)
        .select("id")
        .single();
      if (postErr) throw postErr;
      noticeboardPostId = (post as any).id;
    }

    if (data.channels.includes("in_app")) {
      const title = data.noticeboardTitle ?? "Your training is ready";
      const body = data.noticeboardBody ?? `Sessions from ${data.dateRangeStart} to ${data.dateRangeEnd} are on your calendar.`;
      for (const r of data.recipients) {
        if (!userIdByAthlete.get(r.athlete_id)) continue; // no app login — nothing to notify, skip quietly
        const { error: notifErr } = await sb.rpc("notify_plan_delivery" as any, {
          _athlete_id: r.athlete_id,
          _title: title,
          _body: body,
          _link: "/app/sessions/calendar",
          _data: { date_range_start: data.dateRangeStart, date_range_end: data.dateRangeEnd },
        } as any);
        if (notifErr) throw notifErr;
      }
    }

    const { data: delivery, error: delErr } = await sb
      .from("plan_deliveries")
      .insert({
        coach_user_id: context.userId,
        date_range_start: data.dateRangeStart,
        date_range_end: data.dateRangeEnd,
        summary: data.summary,
        channels: data.channels,
        export_detail_level: data.exportDetailLevel,
        noticeboard_post_id: noticeboardPostId,
        scope_type: data.scopeType,
        scope_label: data.scopeLabel,
      } as any)
      .select("id")
      .single();
    if (delErr || !delivery) throw delErr ?? new Error("Failed to record delivery");

    if (data.recipients.length > 0) {
      const rows = data.recipients.map((r) => ({
        delivery_id: (delivery as any).id,
        athlete_id: r.athlete_id,
        email_to: r.email_to,
        email_status: r.email_status,
        notified_in_app:
          (data.channels.includes("noticeboard") || data.channels.includes("in_app")) &&
          !!userIdByAthlete.get(r.athlete_id),
      }));
      const { error: recErr } = await sb.from("plan_delivery_recipients").insert(rows as any);
      if (recErr) throw recErr;
    }

    return { ok: true, deliveryId: (delivery as any).id, noticeboardPostId };
  });

/**
 * Delivery history for one athlete, filtered to batches whose date range
 * overlaps the requested window — powers the "Plan sent" chip on My
 * Schedule. Simple overlap filter done in JS rather than a range-overlap
 * SQL query, since the row count per athlete is always small.
 */
export const listAthletePlanDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; rangeStart: string; rangeEnd: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: rows, error } = await sb
      .from("plan_delivery_recipients")
      .select("id, created_at, plan_deliveries(date_range_start, date_range_end)")
      .eq("athlete_id", data.athleteId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return (rows ?? [])
      .filter((r: any) => {
        const pd = r.plan_deliveries;
        return !!pd && pd.date_range_start <= data.rangeEnd && pd.date_range_end >= data.rangeStart;
      })
      .map((r: any) => ({
        delivered_at: r.created_at as string,
        range_start: r.plan_deliveries.date_range_start as string,
        range_end: r.plan_deliveries.date_range_end as string,
      }));
  });
