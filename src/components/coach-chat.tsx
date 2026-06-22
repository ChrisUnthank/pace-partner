import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Brain } from "lucide-react";
import { getOrCreateAthleteThread, listThreadMessages, coachChatSend } from "@/lib/ai.functions";

export function CoachChat({ athleteId, athleteName }: { athleteId: string; athleteName?: string }) {
  const getThread = useServerFn(getOrCreateAthleteThread);
  const listMsgs = useServerFn(listThreadMessages);
  const sendMsg = useServerFn(coachChatSend);
  const qc = useQueryClient();

  const { data: thread } = useQuery({
    queryKey: ["ai-thread", athleteId],
    queryFn: () => getThread({ data: { athleteId } }),
  });
  const { data: messages = [] } = useQuery({
    queryKey: ["ai-messages", thread?.id],
    enabled: !!thread?.id,
    queryFn: () => listMsgs({ data: { threadId: thread!.id } }),
  });

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const send = useMutation({
    mutationFn: (text: string) => sendMsg({ data: { threadId: thread!.id, message: text } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-messages", thread?.id] });
      setInput("");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  useEffect(() => { inputRef.current?.focus(); }, [thread?.id]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || !thread?.id || send.isPending) return;
    send.mutate(t);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-[var(--accent-red)]" />
          AI Coaching Assistant{athleteName ? ` — ${athleteName}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="border rounded-md bg-muted/30 max-h-[420px] overflow-y-auto p-3 space-y-3 min-h-[180px]">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask anything about this athlete's training. Try: "How's their load this week?" or "Should they do tomorrow's interval session?"
            </p>
          )}
          {messages.map((m: any) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap"
                  : "text-sm prose prose-sm max-w-none dark:prose-invert"
              }>
                {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e as any); } }}
            placeholder="Ask about this athlete…"
            rows={2}
            className="min-h-[44px] resize-none"
            disabled={send.isPending}
          />
          <Button type="submit" size="icon" disabled={send.isPending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}