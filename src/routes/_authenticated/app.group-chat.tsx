import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Send } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import {
  listGroupChatMessages,
  sendGroupChatMessage,
  editGroupChatMessage,
  deleteGroupChatMessage,
} from "@/lib/group-chat.functions";

export const Route = createFileRoute("/_authenticated/app/group-chat")({
  component: () => (
    <AppShell>
      <GroupChat />
    </AppShell>
  ),
});

function GroupChat() {
  const listFn = useServerFn(listGroupChatMessages);
  const sendFn = useServerFn(sendGroupChatMessage);
  const editFn = useServerFn(editGroupChatMessage);
  const deleteFn = useServerFn(deleteGroupChatMessage);

  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");

  const { data: messages = [] } = useQuery({
    queryKey: ["group-chat"],
    queryFn: () => listFn(),
  });

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const sendM = useMutation({
    mutationFn: () => sendFn({ data: { body: input } }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: ["group-chat"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const editM = useMutation({
    mutationFn: (v: { id: string; body: string }) => editFn({ data: v }),
    onSuccess: () => {
      setEditingId(null);
      setEditBody("");
      qc.invalidateQueries({ queryKey: ["group-chat"] });
      toast.success("Message edited");
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["group-chat"] }),
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  // Realtime: any insert/update/delete on the room refreshes the list.
  // One shared channel since this is a single room, not per-thread like DMs.
  useEffect(() => {
    const ch = supabase
      .channel("group-chat-room")
      .on("postgres_changes", { event: "*", schema: "public", table: "group_chat_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["group-chat"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function canEdit(m: any) {
    return m.sender_id === user?.id && Date.now() - new Date(m.created_at).getTime() < 24 * 60 * 60 * 1000;
  }
  function canDelete(m: any) {
    return m.sender_id === user?.id || isCoach;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Group chat</h1>
        <p className="text-sm text-muted-foreground">One room for the whole squad — coaches, athletes, and parents.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Squad chat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div ref={scrollRef} className="h-[55vh] overflow-y-auto space-y-3 pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No messages yet — say hello.</p>
            )}
            {messages.map((m: any) => {
              const isMine = m.sender_id === user?.id;
              return (
                <div key={m.id} className={`flex gap-2 ${isMine ? "flex-row-reverse text-right" : ""}`}>
                  <UserAvatar name={m.sender_name} imageUrl={m.sender_image_url} size="sm" className="shrink-0" />
                  <div className={`min-w-0 max-w-[80%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
                    <div className="text-xs text-muted-foreground">
                      {m.sender_name} · {format(new Date(m.created_at), "MMM d, h:mm a")}
                      {m.edited_at && " (edited)"}
                    </div>
                    {editingId === m.id ? (
                      <div className="flex gap-2 mt-1 w-full">
                        <Input value={editBody} onChange={(e) => setEditBody(e.target.value)} className="text-sm" />
                        <Button size="sm" onClick={() => editM.mutate({ id: m.id, body: editBody })}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div
                        className={`mt-1 rounded-lg px-3 py-2 text-sm inline-block ${
                          isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {m.body}
                      </div>
                    )}
                    {editingId !== m.id && (canEdit(m) || canDelete(m)) && (
                      <div className="flex gap-1 mt-0.5">
                        {canEdit(m) && (
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => { setEditingId(m.id); setEditBody(m.body); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {canDelete(m) && (
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => deleteM.mutate(m.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 border-t pt-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message the squad…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) sendM.mutate();
              }}
            />
            <Button onClick={() => sendM.mutate()} disabled={!input.trim() || sendM.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
