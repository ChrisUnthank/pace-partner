import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FeelFaces } from "@/components/feel-faces";

export function PostSessionInsightModal({
  open, onOpenChange, sessionId, athleteId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  athleteId: string;
  onSaved?: () => void;
}) {
  // Load whatever's already saved for this session — the Overview page's own
  // "How did you feel?" faces write to this same session_insights row, so
  // this modal (which can open right after) needs to start from that value
  // instead of always resetting to a default 7 and silently overwriting it.
  const { data: existing } = useQuery({
    queryKey: ["session-insight-full", sessionId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("session_insights" as any).select("*").eq("session_id", sessionId).maybeSingle();
      return (data as any) ?? null;
    },
  });

  const [feel, setFeel] = useState<number | null>(7);
  const [wentWell, setWentWell] = useState("");
  const [difficult, setDifficult] = useState("");
  const [niggles, setNiggles] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed every time the modal opens (or the existing row finishes
  // loading) rather than only once on mount — it's reused across sessions,
  // not remounted per-open, so a stale value from a previous session's
  // reflection could otherwise leak into the next one.
  useEffect(() => {
    if (!open) return;
    setFeel(existing?.feel_score ?? 7);
    setWentWell(existing?.went_well ?? "");
    setDifficult(existing?.was_difficult ?? "");
    setNiggles(existing?.niggles ?? "");
  }, [open, existing]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("session_insights" as any)
      .upsert({
        session_id: sessionId,
        athlete_id: athleteId,
        feel_score: feel,
        went_well: wentWell || null,
        was_difficult: difficult || null,
        niggles: niggles || null,
      }, { onConflict: "session_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Reflection saved");
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did that session feel?</DialogTitle>
          <DialogDescription>Optional, but it helps your coach.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Overall feel</Label>
            <div className="mt-2">
              <FeelFaces value={feel} onChange={setFeel} />
            </div>
          </div>
          <div><Label>What went well?</Label><Textarea value={wentWell} onChange={(e) => setWentWell(e.target.value)} className="mt-1" rows={2} /></div>
          <div><Label>What was difficult?</Label><Textarea value={difficult} onChange={(e) => setDifficult(e.target.value)} className="mt-1" rows={2} /></div>
          <div><Label>Any niggles or discomfort?</Label><Textarea value={niggles} onChange={(e) => setNiggles(e.target.value)} className="mt-1" rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Skip</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save reflection"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
