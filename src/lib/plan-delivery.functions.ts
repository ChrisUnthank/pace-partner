import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DeliveryChannel = "noticeboard" | "email";
type EmailStatus = "not_attempted" | "sent" | "failed" | "skipped_no_email";

/**
 * Persists one Deliver Program batch. The actual emails are sent by the
 * caller (DeliverProgramDialog) before this is called, one at a time via
 * the send-plan-delivery-email edge function — same pattern the existing
 * Athlete/Coach report pages already use for email (supabase.functions.
 * invoke straight from the client). This function's job is just to record
 * the outcome and, if the Noticeboard channel was chosen, create the one
 * shared post.
 *
 * Noticeboard is broadcast-only (every athlete the coach coaches, not just
 * the selected recipients) — the caller is responsible for making that
 * clear in the UI before this runs.
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
      recipients: { athlete_id: string; email_to: string | null; email_status: EmailStatus }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

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
        notified_in_app: data.channels.includes("noticeboard"),
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
