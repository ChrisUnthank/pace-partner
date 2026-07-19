import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyAthlete } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { MessageSquare, Send, CheckCircle2, User } from "lucide-react";

// Phase 13 — Coach / Athlete Collaboration (the shared-visibility half —
// see race-plan-private-notes-card.tsx for the coach-only half).

export function CollaborationCard({
  planId,
  athleteId,
  publishedAt,
  athleteIntentions,
  canEdit,
}: {
  planId: string;
  athleteId: string;
  publishedAt: string | null;
  athleteIntentions: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: myAthlete } = useMyAthlete();
  const isSelf = myAthlete?.id === athleteId;

  const [editingIntentions, setEditingIntentions] = useState(false);
  const [intentionsDraft, setIntentionsDraft] = useState(athleteIntentions ?? "");
  const [savingIntentions, setSavingIntentions] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isSuggestion, setIsSuggestion] = useState(false);
  const [posting, setPosting] = useState(false);

  const { data: comments } = useQuery({
    queryKey: ["race-plan-comments", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_tactics_comments" as any)
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  function invalidatePlan() {
    qc.invalidateQueries({ queryKey: ["race-tactics-plan", planId] });
  }

  async function publish() {
    setPublishing(true);
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ published_at: new Date().toISOString() })
      .eq("id", planId);
    setPublishing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Plan published");
    invalidatePlan();
  }

  async function saveIntentions() {
    setSavingIntentions(true);
    const { error } = await supabase
      .from("race_tactics_plans" as any)
      .update({ athlete_intentions: intentionsDraft.trim() || null })
      .eq("id", planId);
    setSavingIntentions(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEditingIntentions(false);
    invalidatePlan();
  }

  async function postComment() {
    if (!commentText.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("race_tactics_comments" as any).insert({
      plan_id: planId,
      body: commentText.trim(),
      is_suggestion: isSuggestion,
    });
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCommentText("");
    setIsSuggestion(false);
    qc.invalidateQueries({ queryKey: ["race-plan-comments", planId] });
  }

  // The athlete's own intentions are only theirs to write — a coach can
  // read them (transparency, matches everything else in this feature)
  // but editing this one field specifically is athlete-only, distinct
  // from `canEdit` which otherwise covers the whole plan for both sides.
  const canEditIntentions = isSelf;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Sharing</CardTitle>
            <CardDescription>Publishing doesn't change who can see this plan — it's just a shared "this is ready" marker.</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {publishedAt ? (
              <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Published {publishedAt.slice(0, 10)}
              </Badge>
            ) : (
              isCoach && (
                <Button size="sm" variant="outline" onClick={publish} disabled={publishing}>
                  {publishing ? "…" : "Publish"}
                </Button>
              )
            )}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-[var(--accent-red)]" />
              Athlete's race intentions
            </CardTitle>
            <CardDescription>In the athlete's own words — separate from the coach's plan above.</CardDescription>
          </div>
          {canEditIntentions && !editingIntentions && (
            <Button size="sm" variant="outline" onClick={() => { setIntentionsDraft(athleteIntentions ?? ""); setEditingIntentions(true); }}>
              {athleteIntentions ? "Edit" : "Add"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingIntentions ? (
            <div className="space-y-2">
              <Textarea
                value={intentionsDraft}
                onChange={(e) => setIntentionsDraft(e.target.value)}
                placeholder="How you're feeling about this race, what you want out of it..."
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveIntentions} disabled={savingIntentions}>
                  {savingIntentions ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingIntentions(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : athleteIntentions ? (
            <p className="text-sm leading-relaxed">{athleteIntentions}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canEditIntentions ? "Not recorded yet." : "The athlete hasn't recorded their intentions for this race yet."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-[var(--accent-red)]" />
            Comments
          </CardTitle>
          <CardDescription>Open to both coach and athlete. Flag a comment as a suggested change to make it stand out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(comments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            <div className="space-y-2">
              {(comments ?? []).map((c: any) => (
                <div key={c.id} className={`rounded-md border p-2.5 ${c.is_suggestion ? "border-amber-300 bg-amber-50" : ""}`}>
                  {c.is_suggestion && (
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] mb-1">
                      Suggested change
                    </Badge>
                  )}
                  <p className="text-sm">{c.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{c.created_at?.slice(0, 10)}</p>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className="space-y-2 pt-2 border-t">
              <Textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment…" rows={2} />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={isSuggestion} onCheckedChange={(v) => setIsSuggestion(!!v)} />
                  This is a suggested change
                </label>
                <Button size="sm" onClick={postComment} disabled={posting || !commentText.trim()}>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  Post
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
