import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Megaphone, CheckCheck, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { listMessageContacts, listThread, sendMessage, markThreadRead, broadcastToAthletes } from "@/lib/messages.functions";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/messages")({
  component: () => <AppShell><Messages /></AppShell>,
  errorComponent: ({ error }) => <AppShell><p className="text-sm text-destructive">{String(error)}</p></AppShell>,
  notFoundComponent: () => <AppShell><p>Not found</p></AppShell>,
});

function Messages() {
  const contactsFn = useServerFn(listMessageContacts);
  const threadFn = useServerFn(listThread);
  const sendFn = useServerFn(sendMessage);
  const markFn = useServerFn(markThreadRead);
  const broadcastFn = useServerFn(broadcastToAthletes);
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");

  const { data: contacts = [] } = useQuery({ queryKey: ["msg-contacts"], queryFn: () => contactsFn() });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  useEffect(() => { if (!activeId && contacts.length) setActiveId(contacts[0].user_id); }, [contacts, activeId]);

  const { data: messages = [] } = useQuery({
    queryKey: ["dm-thread", activeId],
    enabled: !!activeId,
    queryFn: () => threadFn({ data: { otherUserId: activeId! } }),
  });

  // realtime
  useEffect(() => {
    if (!user || !activeId) return;
    const ch = supabase.channel(`dm-${user.id}-${activeId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages" },
        (payload: any) => {
          const m = payload.new;
          const isPair = (m.sender_id === user.id && m.recipient_id === activeId) || (m.sender_id === activeId && m.recipient_id === user.id);
          if (isPair) qc.invalidateQueries({ queryKey: ["dm-thread", activeId] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, activeId, qc]);

  // mark as read when viewing
  useEffect(() => {
    if (!user || !activeId) return;
    const hasUnread = (messages as any[]).some((m) => m.sender_id === activeId && !m.read_at);
    if (hasUnread) {
      markFn({ data: { otherUserId: activeId } }).then(() => {
        qc.invalidateQueries({ queryKey: ["dm-thread", activeId] });
        qc.invalidateQueries({ queryKey: ["notifications", user.id] });
      });
    }
  }, [messages, activeId, user?.id]);

  const [input, setInput] = useState("");
  const sendM = useMutation({
    mutationFn: () => sendFn({ data: { recipientId: activeId!, body: input } }),
    onSuccess: () => { setInput(""); qc.invalidateQueries({ queryKey: ["dm-thread", activeId] }); },
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  const activeContact = contacts.find((c: any) => c.user_id === activeId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground">Direct conversations with your {isCoach ? "athletes" : "coach"}.</p>
        </div>
        {isCoach && (
          <Button variant="outline" onClick={() => setBroadcastOpen(true)}>
            <Megaphone className="h-4 w-4 mr-2" /> Broadcast
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Conversations</CardTitle></CardHeader>
          <CardContent className="p-0">
            {contacts.length === 0 && <p className="px-4 pb-4 text-xs text-muted-foreground">No contacts yet.</p>}
            {contacts.map((c: any) => (
              <button
                key={c.user_id}
                onClick={() => setActiveId(c.user_id)}
                className={`w-full text-left px-4 py-2.5 border-b border-border/60 text-sm hover:bg-muted/40 ${activeId === c.user_id ? "bg-muted/40 font-medium" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex flex-col h-[600px]">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-base">{activeContact?.name ?? "Select a conversation"}</CardTitle>
          </CardHeader>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
            {(messages as any[]).map((m) => {
              const mine = m.sender_id === user?.id;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <div className={`text-[10px] mt-1 flex items-center gap-1 ${mine ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"}`}>
                      {format(new Date(m.created_at), "h:mm a")}
                      {mine && (m.read_at ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                    </div>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && activeId && <p className="text-center text-xs text-muted-foreground py-8">No messages yet — say hello.</p>}
          </div>
          {activeId && (
            <div className="p-3 border-t border-border flex gap-2">
              <Textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.trim()) sendM.mutate(); } }}
                placeholder="Type a message…"
                className="resize-none min-h-[40px]"
              />
              <Button size="icon" onClick={() => sendM.mutate()} disabled={!input.trim() || sendM.isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      </div>

      {broadcastOpen && (
        <BroadcastDialog
          onClose={() => setBroadcastOpen(false)}
          onSend={async (body) => {
            const r = await broadcastFn({ data: { body } });
            toast.success(`Broadcast sent to ${r.sent} athlete${r.sent === 1 ? "" : "s"}`);
            setBroadcastOpen(false);
          }}
        />
      )}
    </div>
  );
}

function BroadcastDialog({ onClose, onSend }: { onClose: () => void; onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader><CardTitle>Broadcast to all athletes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your one-way message…" />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!body.trim() || sending}
              onClick={async () => { setSending(true); try { await onSend(body); } finally { setSending(false); } }}
            >Send</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}