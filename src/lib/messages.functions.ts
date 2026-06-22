import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMessageContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    // coach: athletes linked + managers see all athletes with user_id
    const { data: links } = await sb
      .from("coach_athletes")
      .select("coach_user_id, athlete_id, athletes(user_id, name)")
      .or(`coach_user_id.eq.${context.userId}`);
    const coachContacts = (links ?? [])
      .filter((l: any) => l.athletes?.user_id)
      .map((l: any) => ({ user_id: l.athletes.user_id as string, name: l.athletes.name as string }));
    // athlete: their coaches
    const { data: myAthlete } = await sb.from("athletes").select("id").eq("user_id", context.userId).maybeSingle();
    let coachesOfMe: any[] = [];
    if (myAthlete) {
      const { data: coaches } = await sb
        .from("coach_athletes")
        .select("coach_user_id, profiles!coach_athletes_coach_user_id_fkey(full_name)")
        .eq("athlete_id", myAthlete.id);
      coachesOfMe = (coaches ?? []).map((c: any) => ({
        user_id: c.coach_user_id as string,
        name: c.profiles?.full_name ?? "Coach",
      }));
    }
    const map = new Map<string, { user_id: string; name: string }>();
    [...coachContacts, ...coachesOfMe].forEach((c) => map.set(c.user_id, c));
    return Array.from(map.values());
  });

export const listThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { otherUserId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: msgs, error } = await sb
      .from("direct_messages")
      .select("id, sender_id, recipient_id, body, read_at, created_at")
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