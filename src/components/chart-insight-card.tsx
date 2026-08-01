import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { generateChartInsight } from "@/lib/ai-insights.functions";
import { getAiAccessStatus } from "@/lib/ai.functions";
import { toast } from "sonner";

type InsightKind = "training_load" | "zone_distribution";

export function ChartInsightCard({
  athleteId,
  kind,
  title = "AI Insight",
}: {
  athleteId: string;
  kind: InsightKind;
  title?: string;
}) {
  const gen = useServerFn(generateChartInsight);
  const access = useServerFn(getAiAccessStatus);
  const { data: ai } = useQuery({ queryKey: ["ai-access"], queryFn: () => access() });
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ai && !ai.allowed) return null;

  async function run() {
    setBusy(true);
    try {
      const result = await gen({ data: { athleteId, kind } });
      setContent(result.content);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't generate an insight");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {content ? (
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Get a quick AI read on this chart.</p>
        )}
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Thinking…
            </>
          ) : content ? (
            "Regenerate"
          ) : (
            "Generate insight"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
