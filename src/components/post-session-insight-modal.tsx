import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

export function PostSessionInsightModal({
  open, onOpenChange, sessionId, athleteId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  athleteId: string;
  onSaved?: () => void;
}) {
  const [feel, setFeel] = useState(7);
  const [wentWell, setWentWell] = useState("");
  const [difficult, setDifficult] = useState("");
  const [niggles, setNiggles] = useState("");
  const [saving, setSaving] = useState(false);

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
            <Label>Overall feel: <span className="tabular-nums">{feel}/10</span></Label>
            <Slider min={1} max={10} step={1} value={[feel]} onValueChange={(v) => setFeel(v[0])} className="mt-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Terrible</span><span>Great</span>
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