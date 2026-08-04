import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMyRoles, useCoachRoster } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Trash2, Users, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  generateBulkAiReviews,
  generateSquadAiReview,
  listAllReviewsForCoach,
  listSquadReviews,
  deleteAiReview,
  deleteSquadReview,
} from "@/lib/ai-reviews.functions";

type ReviewType = "weekly" | "monthly" | "phase" | "yearly" | "custom";
type Mode = "individual" | "squad";
// Every place in the app that generates AI content mirrors into ai_reviews
// now, not just this page's own generator — 'source' is what tells these
// apart in the unified history below.
type HistorySource = "review" | "chat" | "daily_note" | "session_note" | "weekly_summary" | "chart_insight";

const TYPE_LABEL: Record<ReviewType, string> = {
  weekly: "Weekly", monthly: "Monthly", phase: "Completed Phase", yearly: "Yearly", custom: "Custom range",
};

const SOURCE_LABEL: Record<HistorySource, string> = {
  review: "Review",
  chat: "Coaching chat",
  daily_note: "Daily reflection",
  session_note: "Session reflection",
  weekly_summary: "Weekly summary",
  chart_insight: "Chart insight",
};

function historyItemLabel(r: any): string {
  if (r.source === "review") return TYPE_LABEL[r.review_type as ReviewType] ?? r.review_type ?? "Review";
  return SOURCE_LABEL[r.source as HistorySource] ?? r.source;
}

const searchSchema = z.object({
  // Arriving from an athlete's own page via the "Generate or view AI
  // reviews" link pre-selects just that athlete in Individual mode,
  // instead of landing on an empty picker.
  athleteId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/reports/ai-review")({
  validateSearch: searchSchema,
  component: AiReviewPage,
});

function AiReviewPage() {
  const search = Route.useSearch();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: roster = [] } = useCoachRoster();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("individual");
  const [selected, setSelected] = useState<Set<string>>(new Set(search.athleteId ? [search.athleteId] : []));
  const [reviewType, setReviewType] = useState<ReviewType>("weekly");
  const [customStart, setCustomStart] = useState(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ generated: any[]; errors: { athleteId: string; message: string }[] } | null>(null);
  const [squadResult, setSquadResult] = useState<any | null>(null);
  const [historyAthlete, setHistoryAthlete] = useState<string>("all");
  const [historySource, setHistorySource] = useState<HistorySource | "all">("all");

  const genBulk = useServerFn(generateBulkAiReviews);
  const genSquad = useServerFn(generateSquadAiReview);
  const listAll = useServerFn(listAllReviewsForCoach);
  const listSquad = useServerFn(listSquadReviews);
  const delReview = useServerFn(deleteAiReview);
  const delSquad = useServerFn(deleteSquadReview);

  const { data: allReviews = [] } = useQuery({ queryKey: ["all-ai-reviews"], queryFn: () => listAll(), enabled: isCoach });
  const { data: squadReviews = [] } = useQuery({ queryKey: ["squad-ai-reviews"], queryFn: () => listSquad(), enabled: isCoach });

  const rosterSorted = useMemo(
    () => [...roster].sort((a: any, b: any) => (a.athletes?.name ?? "").localeCompare(b.athletes?.name ?? "")),
    [roster],
  );

  const filteredReviews = useMemo(() => {
    return (allReviews as any[]).filter((r) => {
      if (historyAthlete !== "all" && r.athlete_id !== historyAthlete) return false;
      if (historySource !== "all" && r.source !== historySource) return false;
      return true;
    });
  }, [allReviews, historyAthlete, historySource]);

  function toggleAthlete(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (mode === "individual" && selected.size === 0) {
      toast.error("Select at least one athlete");
      return;
    }
    setBusy(true);
    setBulkResult(null);
    setSquadResult(null);
    const args = {
      athleteIds: Array.from(selected),
      reviewType,
      customStart: reviewType === "custom" ? customStart : undefined,
      customEnd: reviewType === "custom" ? customEnd : undefined,
    };
    try {
      if (mode === "individual") {
        const result = await genBulk({ data: args });
        setBulkResult(result);
        if (result.generated.length > 0) toast.success(`Generated ${result.generated.length} review${result.generated.length === 1 ? "" : "s"}`);
        if (result.errors.length > 0) toast.error(`${result.errors.length} review${result.errors.length === 1 ? "" : "s"} failed`);
        qc.invalidateQueries({ queryKey: ["all-ai-reviews"] });
        qc.invalidateQueries({ queryKey: ["recent-reviews"] });
      } else {
        // Empty selection in squad mode means "whole roster" — the backend
        // treats it the same way, this just makes the UI's default state
        // (nothing checked yet) do the sensible thing instead of erroring.
        const row = await genSquad({ data: args });
        setSquadResult(row);
        toast.success("Squad review generated");
        qc.invalidateQueries({ queryKey: ["squad-ai-reviews"] });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isCoach) {
    return (
      <AppShell fullWidth>
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground">
            AI Review is a coach tool. Athletes get their own AI review widget on their home dashboard.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
            <Sparkles className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
            <h1 className="text-2xl font-bold leading-tight">AI Review</h1>
          </div>
          <Link to="/app/reports" className="ml-auto text-xs text-muted-foreground hover:text-foreground underline">
            ← Back to Reports
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate</CardTitle>
            <CardDescription>
              Individual reviews are one review per selected athlete — same output as generating from an athlete's own
              page. Squad narrative is one combined write-up across the group.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex border rounded-md overflow-hidden text-sm w-fit">
              <button
                onClick={() => setMode("individual")}
                className={`px-3 py-1.5 flex items-center gap-1.5 ${mode === "individual" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
              >
                <User className="h-3.5 w-3.5" /> Individual
              </button>
              <button
                onClick={() => setMode("squad")}
                className={`px-3 py-1.5 flex items-center gap-1.5 ${mode === "squad" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
              >
                <Users className="h-3.5 w-3.5" /> Squad narrative
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px]">
                <Label className="text-xs">Review type</Label>
                <Select value={reviewType} onValueChange={(v) => setReviewType(v as ReviewType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly (past 7 days)</SelectItem>
                    <SelectItem value="monthly">Monthly (past 30 days)</SelectItem>
                    <SelectItem value="phase">Completed Phase</SelectItem>
                    <SelectItem value="yearly">Yearly (past 12 months)</SelectItem>
                    <SelectItem value="custom">Custom date range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reviewType === "custom" && (
                <>
                  <div><Label className="text-xs">From</Label><Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></div>
                  <div><Label className="text-xs">To</Label><Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></div>
                </>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">
                  {mode === "individual" ? "Athletes (one review each)" : "Athletes to include (leave empty for your whole roster)"}
                </Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSelected(new Set(rosterSorted.map((r: any) => r.athlete_id)))}>
                    Select all
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="border rounded-md max-h-56 overflow-y-auto brand-scrollbar divide-y">
                {rosterSorted.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">No athletes on your roster yet.</p>
                ) : (
                  rosterSorted.map((r: any) => (
                    <label key={r.athlete_id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40 cursor-pointer">
                      <Checkbox checked={selected.has(r.athlete_id)} onCheckedChange={() => toggleAthlete(r.athlete_id)} />
                      {r.athletes?.name ?? "Athlete"}
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{selected.size} selected</p>
            </div>

            <Button onClick={generate} disabled={busy}>
              {busy ? "Generating…" : mode === "individual" ? "Generate reviews" : "Generate squad review"}
            </Button>
          </CardContent>
        </Card>

        {bulkResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Just generated</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bulkResult.errors.length > 0 && (
                <div className="text-sm text-destructive space-y-1">
                  {bulkResult.errors.map((e, i) => {
                    const name = (rosterSorted.find((r: any) => r.athlete_id === e.athleteId) as any)?.athletes?.name ?? e.athleteId;
                    return <p key={i}>{name}: {e.message}</p>;
                  })}
                </div>
              )}
              {bulkResult.generated.map((row: any) => {
                const name = (rosterSorted.find((r: any) => r.athlete_id === row.athlete_id) as any)?.athletes?.name ?? "Athlete";
                return (
                  <div key={row.id} className="border rounded-md p-3">
                    <div className="text-xs font-medium mb-2">{name}</div>
                    <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                      <ReactMarkdown>{row.content_md}</ReactMarkdown>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {squadResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Just generated — squad review</CardTitle>
              <CardDescription>{squadResult.athlete_ids?.length ?? 0} athletes · {squadResult.period_start} → {squadResult.period_end}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                <ReactMarkdown>{squadResult.content_md}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">AI history</CardTitle>
                <CardDescription>
                  Everything AI-generated for your roster — reviews from this page, coaching-assistant chats, daily
                  and session reflections, weekly summaries, and chart insights from elsewhere in the app.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={historyAthlete} onValueChange={setHistoryAthlete}>
                <SelectTrigger className="h-8 text-xs w-[200px]">
                  <SelectValue placeholder="All athletes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All athletes</SelectItem>
                  {rosterSorted.map((r: any) => (
                    <SelectItem key={r.athlete_id} value={r.athlete_id}>
                      {r.athletes?.name ?? "Athlete"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={historySource} onValueChange={(v) => setHistorySource(v as HistorySource | "all")}>
                <SelectTrigger className="h-8 text-xs w-[190px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="review">Reviews</SelectItem>
                  <SelectItem value="chat">Coaching chats</SelectItem>
                  <SelectItem value="daily_note">Daily reflections</SelectItem>
                  <SelectItem value="session_note">Session reflections</SelectItem>
                  <SelectItem value="weekly_summary">Weekly summaries</SelectItem>
                  <SelectItem value="chart_insight">Chart insights</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing matches this filter yet.</p>
            ) : (
              filteredReviews.map((r: any) => (
                <details key={r.id} className="border rounded-md p-3">
                  <summary className="flex items-center justify-between cursor-pointer text-xs gap-2">
                    <span className="min-w-0">
                      <span className="font-medium">{r.athletes?.name ?? "Athlete"}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {historyItemLabel(r)}
                        {r.title ? ` — ${r.title}` : ""}
                        {r.period_start ? ` · ${r.period_start}${r.period_end && r.period_end !== r.period_start ? ` → ${r.period_end}` : ""}` : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async (e) => {
                        e.preventDefault();
                        if (!confirm("Delete this item from AI history?")) return;
                        await delReview({ data: { reviewId: r.id } });
                        qc.invalidateQueries({ queryKey: ["all-ai-reviews"] });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </summary>
                  <div className="prose prose-sm max-w-none dark:prose-invert text-sm mt-2">
                    <ReactMarkdown>{r.content_md}</ReactMarkdown>
                  </div>
                </details>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Squad review history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {squadReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No squad reviews yet.</p>
            ) : (
              (squadReviews as any[]).map((r) => (
                <details key={r.id} className="border rounded-md p-3">
                  <summary className="flex items-center justify-between cursor-pointer text-xs">
                    <span>
                      <span className="font-medium">{TYPE_LABEL[r.review_type as ReviewType] ?? r.review_type}</span>
                      <span className="text-muted-foreground"> · {r.athlete_ids?.length ?? 0} athletes · {r.period_start} → {r.period_end}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async (e) => {
                        e.preventDefault();
                        if (!confirm("Delete this squad review?")) return;
                        await delSquad({ data: { reviewId: r.id } });
                        qc.invalidateQueries({ queryKey: ["squad-ai-reviews"] });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </summary>
                  <div className="prose prose-sm max-w-none dark:prose-invert text-sm mt-2">
                    <ReactMarkdown>{r.content_md}</ReactMarkdown>
                  </div>
                </details>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
