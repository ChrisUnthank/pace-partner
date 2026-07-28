import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { INTENT_LABEL, STRUCTURE_LABEL } from "@/lib/session-categories";
import { applyTemplateToSession } from "@/lib/templates";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { Trash2, Play, Plus, BookmarkCheck } from "lucide-react";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const qc = useQueryClient();

  const { data: templates } = useQuery({
    queryKey: ["templates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const tplIds = (templates ?? []).map((t: any) => t.id);
  const { data: stepsByTpl } = useQuery({
    queryKey: ["template-steps-summary", tplIds.join(",")],
    enabled: tplIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("template_steps").select("template_id, kind, reps, set_count, target_distance_m, target_time_seconds").in("template_id", tplIds);
      if (error) throw error;
      const map = new Map<string, any[]>();
      (data ?? []).forEach((r: any) => {
        const list = map.get(r.template_id) ?? [];
        list.push(r); map.set(r.template_id, list);
      });
      return map;
    },
  });

  const [applyOpen, setApplyOpen] = useState<string | null>(null);

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template? Sessions previously created from it are unaffected.")) return;
    const { error } = await supabase.from("session_templates").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Template deleted"); qc.invalidateQueries({ queryKey: ["templates"] }); }
  }

  if (!isCoach) return <AppShell fullWidth><p className="text-sm">Templates are coach-only.</p></AppShell>;

  return (
    <AppShell fullWidth>
      <div className="max-w-3xl space-y-4">
        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/templates" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <BookmarkCheck className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Coaching</div>
              <h1 className="text-2xl font-bold leading-tight">Templates</h1>
              <p className="text-sm text-muted-foreground">Save reusable session structures and apply them to any athlete on any date.</p>
            </div>
          </div>
          {/* Same destination as the New session buttons on Home and the
              Coaching Hub overview — templates and building from scratch
              are two paths to the same builder, so both should be reachable
              from wherever a coach happens to be. */}
          <Button asChild size="sm">
            <Link to="/app/sessions/new">
              <Plus className="h-4 w-4 mr-1.5" /> New session
            </Link>
          </Button>
        </div>

        {(templates ?? []).length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">
            No templates yet. Open any session and tap <span className="font-semibold">Save as template</span> to add the first one.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {(templates ?? []).map((t: any) => {
              const tsteps = stepsByTpl?.get(t.id) ?? [];
              const work = tsteps.filter((s) => s.kind === "work");
              const summary = work.length === 0
                ? `${tsteps.length} step${tsteps.length === 1 ? "" : "s"}`
                : work.map((w) => {
                    const sets = (w.set_count ?? 1) > 1 ? `${w.set_count}×` : "";
                    const target = w.target_distance_m ? `${w.target_distance_m}m` : w.target_time_seconds ? `${w.target_time_seconds}s` : "";
                    return `${sets}${w.reps}×${target}`;
                  }).join(" + ");
              return (
                <Card key={t.id}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary">{INTENT_LABEL[t.intent as keyof typeof INTENT_LABEL] ?? t.intent}</Badge>
                        <Badge variant="outline">{STRUCTURE_LABEL[t.structure as keyof typeof STRUCTURE_LABEL] ?? t.structure}</Badge>
                        {t.is_long_run && <Badge>Long run</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{summary}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" onClick={() => setApplyOpen(t.id)}><Play className="h-3 w-3 mr-1" />Apply</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {applyOpen && (
          <ApplyDialog
            templateId={applyOpen}
            template={(templates ?? []).find((t: any) => t.id === applyOpen)}
            onClose={() => setApplyOpen(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

function ApplyDialog({ templateId, template, onClose }: { templateId: string; template: any; onClose: () => void }) {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const { data: myAthlete } = useMyAthlete();
  const { data: rosterAthletes } = useQuery({
    queryKey: ["coach-roster", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase.from("coach_athletes")
        .select("athletes(id, name)").eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });
  const [athleteId, setAthleteId] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState<string>(template?.title ?? "");

  async function apply() {
    if (!athleteId) { toast.error("Pick an athlete"); return; }
    const res = await applyTemplateToSession({
      templateId, athleteId, createdByUserId: user!.id, sessionDate: date, titleOverride: title,
    });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Session created from template");
    window.location.href = `/app/sessions/${res.sessionId}`;
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply template</DialogTitle>
          <DialogDescription>{template?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Athlete</Label>
            <Select value={athleteId} onValueChange={setAthleteId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick athlete" /></SelectTrigger>
              <SelectContent>
                {myAthlete && <SelectItem value={myAthlete.id}>{myAthlete.name} (me)</SelectItem>}
                {(rosterAthletes ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
