import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useAuthUser } from "@/lib/use-auth";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

// A chat thread scoped to exactly this session — separate from the
// general 1:1 Messages inbox on purpose. "What happened on rep 4" or
// "how's the niggle from this run" is a conversation that belongs
// attached to the session it's about, not buried in a running DM
// thread with everything else mixed in. Any coach of this athlete and
// the athlete themself can both read and post; a DB trigger notifies
// whichever side didn't write the comment.

type CommentRow = {
  id: string;
  session_id: string;
  athlete_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: { full_name: string | null; profile_image_url: string | null } | null;
};

export function SessionCommentsCard({
  sessionId,
  athleteId,
}: {
  sessionId: string;
  athleteId: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["session-comments", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_comments")
        .select("id, session_id, athlete_id, author_id, body, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as CommentRow[];
      // profiles has no direct FK to session_comments (both point at
      // auth.users independently), so PostgREST can't embed it — fetch
      // the distinct authors' names/avatars separately and merge, same
      // pattern messages.functions.ts already uses for DM contacts.
      const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
      if (authorIds.length === 0) return rows;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, profile_image_url")
        .in("id", authorIds);
      const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return rows.map((r) => ({ ...r, author: byId.get(r.author_id) ?? null }));
    },
  });

  // Realtime — so a coach and athlete looking at the same session at the
  // same time see each other's messages land without a manual refresh,
  // same pattern the Messages page and Group Chat already use.
  useEffect(() => {
    const ch = supabase
      .channel(`session-comments-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "session_comments", filter: `session_id=eq.${sessionId}` },
        () => qc.invalidateQueries({ queryKey: ["session-comments", sessionId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [comments.length]);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || !user) return;
    setSending(true);
    const { error } = await supabase.from("session_comments").insert({
      session_id: sessionId,
      athlete_id: athleteId,
      author_id: user.id,
      body: trimmed,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBody("");
    qc.invalidateQueries({ queryKey: ["session-comments", sessionId] });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-[var(--accent-red)]" />
          Session chat
        </CardTitle>
        <CardDescription>Talk about this specific session — separate from your general Messages inbox.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet — start the conversation below.</p>
        ) : (
          <div ref={scrollRef} className="max-h-72 overflow-y-auto brand-scrollbar space-y-3 pr-1">
            {comments.map((c) => {
              const mine = c.author_id === user?.id;
              return (
                <div key={c.id} className={`flex gap-2 ${mine ? "flex-row-reverse text-right" : ""}`}>
                  <UserAvatar name={c.author?.full_name} imageUrl={c.author?.profile_image_url} size="sm" className="shrink-0" />
                  <div className={`min-w-0 max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    <div
                      className={`rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words ${
                        mine ? "bg-[var(--accent-red)] text-white" : "bg-muted"
                      }`}
                    >
                      {c.body}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {c.author?.full_name ?? (mine ? "You" : "Them")} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment about this session…"
            rows={2}
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button size="sm" onClick={send} disabled={sending || !body.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
