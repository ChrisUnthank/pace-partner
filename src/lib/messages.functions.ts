import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMessageContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const map = new Map<string, { user_id: string; name: string }>();

    // coach: athletes I coach
    const { data: links } = await sb
      .from("coach_athletes")
      .select("athlete_id, athletes(user_id, name)")
      .eq("coach_user_id", context.userId);
    (links ?? []).forEach((l: any) => {
      if (l.athletes?.user_id) map.set(l.athletes.user_id, { user_id: l.athletes.user_id, name: l.athletes.name });
    });

    // athlete: my coaches
    const { data: myAthlete } = await sb.from("athletes").select("id").eq("user_id", context.userId).maybeSingle();
    if (myAthlete) {
      const { data: coaches } = await sb.from("coach_athletes").select("coach_user_id").eq("athlete_id", myAthlete.id);
      const coachIds = (coaches ?? []).map((c: any) => c.coach_user_id);
      if (coachIds.length) {
        const { data: profs } = await sb.from("profiles").select("id, full_name").in("id", coachIds);
        (profs ?? []).forEach((p: any) => map.set(p.id, { user_id: p.id, name: p.full_name ?? "Coach" }));
      }
    }

    const contacts = Array.from(map.values());
    if (!contacts.length) return [];

    const otherIds = contacts.map((c) => c.user_id);
    const { data: recent } = await sb
      .from("direct_messages")
      .select("sender_id, recipient_id, body, created_at, read_at")
      .or(`sender_id.in.(${otherIds.join(",")}),recipient_id.in.(${otherIds.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(500);

    const decorated = contacts.map((c) => {
      const msgs = (recent ?? []).filter(
        (m: any) =>
          (m.sender_id === c.user_id && m.recipient_id === context.userId) ||
          (m.sender_id === context.userId && m.recipient_id === c.user_id),
      );
      const last = msgs[0];
      const unread = msgs.filter((m: any) => m.sender_id === c.user_id && !m.read_at).length;
      return {
        ...c,
        last_body: last?.body ?? null,
        last_at: last?.created_at ?? null,
        unread,
      };
    });
    decorated.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
    return decorated;
  });

export const listThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { otherUserId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: msgs, error } = await sb
      .from("direct_messages")
      .select("id, sender_id, recipient_id, body, read_at, created_at, edited_at")
      .or(
        `and(sender_id.eq.${context.userId},recipient_id.eq.${data.otherUserId}),and(sender_id.eq.${data.otherUserId},recipient_id.eq.${context.userId})`,
      )
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return msgs ?? [];
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { recipientId: string; body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const { data: row, error } = await context.supabase
      .from("direct_messages")
      .insert({ sender_id: context.userId, recipient_id: data.recipientId, body })
      .select("id, created_at")
      .single();
    if (error) throw error;
    return row;
  });

export const editMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const { data: row, error } = await (context.supabase as any)
      .from("direct_messages")
      .update({ body, edited_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Message can no longer be edited (24h limit).");
    return { ok: true };
  });

export const editBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const { error } = await (context.supabase as any)
      .from("message_broadcasts")
      .update({ body, edited_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("coach_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const listMyBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("message_broadcasts")
      .select("id, body, recipient_count, created_at, edited_at")
      .eq("coach_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data ?? [];
  });

export const markThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { otherUserId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("sender_id", data.otherUserId)
      .eq("recipient_id", context.userId)
      .is("read_at", null);
    if (error) throw error;
    return { ok: true };
  });

export const broadcastToAthletes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const sb = context.supabase;
    const { data: links } = await sb
      .from("coach_athletes")
      .select("athletes(user_id)")
      .eq("coach_user_id", context.userId);
    const recipients = Array.from(
      new Set(((links ?? []) as any[]).map((l) => l.athletes?.user_id).filter(Boolean) as string[]),
    );
    if (!recipients.length) return { sent: 0 };
    const rows = recipients.map((rid) => ({ sender_id: context.userId, recipient_id: rid, body }));
    const { error } = await sb.from("direct_messages").insert(rows);
    if (error) throw error;
    await sb.from("message_broadcasts").insert({ coach_id: context.userId, body, recipient_count: recipients.length });
    return { sent: recipients.length };
  });

export const markAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string; athleteId: string; attended: boolean }) => d)
  .handler(async ({ data, context }) => {
    if (data.attended) {
      const { error } = await context.supabase
        .from("session_attendance")
        .upsert(
          {
            session_id: data.sessionId,
            athlete_id: data.athleteId,
            source: "manual",
            confirmed_by: context.userId,
          },
          { onConflict: "session_id,athlete_id" },
        );
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("session_attendance")
        .delete()
        .eq("session_id", data.sessionId)
        .eq("athlete_id", data.athleteId);
      if (error) throw error;
    }
    return { ok: true };
  });