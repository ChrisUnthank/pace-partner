import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listGroupChatMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("group_chat_messages")
      .select("id, sender_id, body, created_at, edited_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    const senderIds = Array.from(new Set((data ?? []).map((m) => m.sender_id)));
    const { data: senders } = senderIds.length
      ? await context.supabase.from("profiles").select("id, full_name, profile_image_url").in("id", senderIds)
      : { data: [] as any[] };
    const senderMap = new Map((senders ?? []).map((s: any) => [s.id, { name: s.full_name, image: s.profile_image_url ?? null }]));

    return (data ?? []).map((m) => ({
      ...m,
      sender_name: senderMap.get(m.sender_id)?.name ?? "Someone",
      sender_image_url: senderMap.get(m.sender_id)?.image ?? null,
    }));
  });

export const sendGroupChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const { error } = await context.supabase
      .from("group_chat_messages")
      .insert({ sender_id: context.userId, body });
    if (error) throw error;
    return { ok: true };
  });

export const editGroupChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; body: string }) => d)
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Empty message");
    const { error } = await context.supabase
      .from("group_chat_messages")
      .update({ body, edited_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("sender_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteGroupChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("group_chat_messages")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
