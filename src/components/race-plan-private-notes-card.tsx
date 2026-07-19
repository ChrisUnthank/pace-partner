import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles } from "@/lib/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Lock, Plus, Trash2 } from "lucide-react";

// Phase 13 — the private half of collaboration. RLS on
// race_tactics_private_notes already makes this table unreadable to
// anyone but the athlete's coach, but the component itself is also
// gated client-side (returns null for non-coaches) rather than rendering
// an empty "Private notes" card that would just confuse an athlete
// wondering what they're not being shown.

export function PrivateNotesCard({ planId }: { planId: string }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: notes } = useQuery({
    queryKey: ["race-plan-private-notes", planId],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("race_tactics_private_notes" as any)
        .select("*")
        .eq("plan_id", planId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (!isCoach) return null;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["race-plan-private-notes", planId] });
  }

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("race_tactics_private_notes" as any).insert({ plan_id: planId, note: text.trim() });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setText("");
    setShowForm(false);
    invalidate();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("race_tactics_private_notes" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidate();
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Private notes
          </CardTitle>
          <CardDescription>Visible to you only — never shown to the athlete.</CardDescription>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add note
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <div className="space-y-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Only you can see this." />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {(notes ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No private notes yet.</p>
        ) : (
          <div className="space-y-2">
            {(notes ?? []).map((n: any) => (
              <div key={n.id} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
                <div>
                  <p className="text-sm">{n.note}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{n.created_at?.slice(0, 10)}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 shrink-0" onClick={() => remove(n.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
