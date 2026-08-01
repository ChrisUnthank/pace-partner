import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateAiReview, listAthleteReviews, deleteAiReview } from "@/lib/ai-reviews.functions";
import { Sparkles, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const TYPE_LABEL: Record<string, string> = {
  weekly: "Weekly", monthly: "Monthly", phase: "Completed Phase", yearly: "Yearly", custom: "Custom range",
};

export function GenerateReviewCard({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const gen = useServerFn(generateAiReview);
  const list = useServerFn(listAthleteReviews);
  const del = useServerFn(deleteAiReview);
  const [type, setType] = useState<"weekly" | "monthly" | "phase" | "yearly" | "custom">("weekly");
  const [customStart, setCustomStart] = useState(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const { data: reviews = [] } = useQuery({
    queryKey: ["ai-reviews", athleteId],
    queryFn: () => list({ data: { athleteId } }),
  });

  async function run() {
    setBusy(true);
    try {
      await gen({ data: { athleteId, reviewType: type, customStart: type === "custom" ? customStart : undefined, customEnd: type === "custom" ? customEnd : undefined } });
      toast.success("Review generated");
      qc.invalidateQueries({ queryKey: ["ai-reviews", athleteId] });
      qc.invalidateQueries({ queryKey: ["recent-reviews"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Generation failed");
    } finally { setBusy(false); }
  }

  // phase availability stub — no training_phases yet
  const phasesAvailable = false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-[var(--accent-red)]" /> AI Reviews
        </CardTitle>
        <CardDescription>Generate a structured review using the latest data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <Label className="text-xs">Review type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly (past 7 days)</SelectItem>
                <SelectItem value="monthly">Monthly (past 30 days)</SelectItem>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <SelectItem value="phase" disabled={!phasesAvailable}>Completed Phase</SelectItem>
                      </div>
                    </TooltipTrigger>
                    {!phasesAvailable && (
                      <TooltipContent>Available when a training phase is marked complete</TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <SelectItem value="yearly">Yearly (past 12 months)</SelectItem>
                <SelectItem value="custom">Custom date range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "custom" && (
            <>
              <div><Label className="text-xs">From</Label><Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></div>
            </>
          )}
          <Button onClick={run} disabled={busy}>{busy ? "Generating…" : "Generate Review"}</Button>
        </div>

        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r: any) => (
              <div key={r.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs">
                    <span className="font-medium">{TYPE_LABEL[r.review_type] ?? r.review_type}</span>
                    <span className="text-muted-foreground"> · {r.period_start} → {r.period_end} · generated {r.created_at?.slice(0, 10)}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!confirm("Delete this review?")) return;
                    await del({ data: { reviewId: r.id } });
                    qc.invalidateQueries({ queryKey: ["ai-reviews", athleteId] });
                  }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                  <ReactMarkdown>{r.content_md}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
