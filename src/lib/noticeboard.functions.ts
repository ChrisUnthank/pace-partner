import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("noticeboard_posts")
      .select("id, author_id, post_type, title, body, link_url, event_date, pinned, created_at")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const ids = (data ?? []).map((p) => p.id);
    const [{ data: reactions }, { data: authors }] = await Promise.all([
      ids.length
        ? context.supabase.from("noticeboard_reactions").select("post_id, user_id, emoji").in("post_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      context.supabase.from("profiles").select("id, full_name").in("id", Array.from(new Set((data ?? []).map((p) => p.author_id)))),
    ]);
    const authorMap = new Map((authors ?? []).map((a: any) => [a.id, a.full_name]));
    return (data ?? []).map((p) => ({
      ...p,
      author_name: authorMap.get(p.author_id) ?? "Coach",
      reactions: (reactions ?? []).filter((r: any) => r.post_id === p.id),
    }));
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    post_type: "announcement" | "result" | "upcoming_race" | "training_event" | "resource";
    title: string;
    body?: string;
    link_url?: string;
    event_date?: string;
    pinned?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("noticeboard_posts")
      .insert({
        author_id: context.userId,
        post_type: data.post_type,
        title: data.title,
        body: data.body ?? null,
        link_url: data.link_url ?? null,
        event_date: data.event_date ?? null,
        pinned: !!data.pinned,
      })
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("noticeboard_posts").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { post_id: string; emoji: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("noticeboard_reactions")
      .select("id")
      .eq("post_id", data.post_id)
      .eq("user_id", context.userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      const { error } = await context.supabase.from("noticeboard_reactions").delete().eq("id", existing.id);
      if (error) throw error;
      return { state: "removed" as const };
    }
    const { error } = await context.supabase
      .from("noticeboard_reactions")
      .insert({ post_id: data.post_id, user_id: context.userId, emoji: data.emoji });
    if (error) throw error;
    return { state: "added" as const };
  });