import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { generateChartInsight } from "@/lib/ai-insights.functions";
import { getAiAccessStatus } from "@/lib/ai.functions";
import { toast } from "sonner";

type InsightKind = "training_load" | "zone_distribution";
type InsightFocus = "trend" | "snapshot" | "risk" | "comparison";

const FOCUS_OPTIONS: { value: InsightFocus; label: string; hint: string }[] = [
  { value: "trend", label: "Trend & trajectory", hint: "Is it rising, falling, or stable — and for how long?" },
  { value: "snapshot", label: "Current snapshot", hint: "What today's numbers mean right now" },
  { value: "risk", label: "Risks & watch-outs", hint: "Only flag genuine concerns" },
  { value: "comparison", label: "Vs this athlete's own targets", hint: "Compared to their own physiological profile" },
];

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
  const [focus, setFocus] = useState<InsightFocus>("trend");

  if (ai && !ai.allowed) return null;

  async function run() {
    setBusy(true);
    try {
      const result = await gen({ data: { athleteId, kind, focus } });
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
          <p className="text-sm text-muted-foreground">Pick an angle, then get a quick AI read on this chart.</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={focus} onValueChange={(v) => setFocus(v as InsightFocus)}>
            <SelectTrigger className="h-8 text-xs w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOCUS_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        </div>
        <p className="text-[11px] text-muted-foreground">
          {FOCUS_OPTIONS.find((f) => f.value === focus)?.hint} · saved to AI history in Reports → AI Review
        </p>
      </CardContent>
    </Card>
  );
}
