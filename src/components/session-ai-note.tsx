import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getLatestAthleteNote, generateSessionNote, getAiAccessStatus } from "@/lib/ai.functions";

// Scoped to exactly one session (or race — races are stored as sessions
// under the hood) — generateSessionNote only ever reads that one session's
// own fields plus its session_insights row, never the athlete's broader
// history. Was duplicated identically across the race detail and session
// detail pages; extracted here so there's one copy, reused on both plus
// the Race Analysis page.
export function SessionAiNote({ sessionId, athleteId }: { sessionId: string; athleteId: string }) {
  const getNote = useServerFn(getLatestAthleteNote);
  const gen = useServerFn(generateSessionNote);
  const access = useServerFn(getAiAccessStatus);
  const { data: ai } = useQuery({ queryKey: ["ai-access"], queryFn: () => access() });
  const { data: note, refetch } = useQuery({
    queryKey: ["ai-session-note", sessionId],
    queryFn: () => getNote({ data: { athleteId, kind: "session", sessionId } }),
  });
  if (ai && !ai.allowed) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI session reflection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {note?.content ? (
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No AI reflection yet.</p>
        )}
        <Button size="sm" variant="outline" onClick={() => gen({ data: { sessionId } }).then(() => refetch())}>
          {note?.content ? "Regenerate" : "Generate"}
        </Button>
      </CardContent>
    </Card>
  );
}
