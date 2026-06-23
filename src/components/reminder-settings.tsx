import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Pencil } from "lucide-react";
import { updateAthleteReminders } from "@/lib/reminders.functions";
import { toast } from "sonner";

export function AthleteReminderSettings({ athleteId }: { athleteId: string }) {
  const qc = useQueryClient();
  const update = useServerFn(updateAthleteReminders);
  const { data: a } = useQuery({
    queryKey: ["athlete-reminders", athleteId],
    queryFn: async () => {
      const { data } = await supabase.from("athletes")
        .select("reminder_morning_local, reminder_evening_local, reminders_enabled")
        .eq("id", athleteId).maybeSingle();
      return data as any;
    },
  });

  const [editing, setEditing] = useState(false);
  const [morning, setMorning] = useState(a?.reminder_morning_local?.slice(0, 5) ?? "08:00");
  const [evening, setEvening] = useState(a?.reminder_evening_local?.slice(0, 5) ?? "20:00");
  const [enabled, setEnabled] = useState<boolean>(a?.reminders_enabled ?? true);

  if (!a) return null;
  const m = (a.reminder_morning_local ?? "08:00").slice(0, 5);
  const e = (a.reminder_evening_local ?? "20:00").slice(0, 5);

  async function save() {
    try {
      await update({ data: { athleteId, morning, evening, enabled } });
      toast.success("Reminder schedule saved");
      qc.invalidateQueries({ queryKey: ["athlete-reminders", athleteId] });
      setEditing(false);
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Reminders</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {a.reminders_enabled ? (
              <span>Daily log reminders: <span className="font-medium">{m} / {e}</span></span>
            ) : (
              <span className="text-muted-foreground">Reminders off</span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setMorning(m); setEvening(e); setEnabled(a.reminders_enabled); setEditing(true); }}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Reminders</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Morning</Label><Input type="time" value={morning} onChange={(ev) => setMorning(ev.target.value)} /></div>
          <div><Label className="text-xs">Evening</Label><Input type="time" value={evening} onChange={(ev) => setEvening(ev.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between">
          <Label>Reminders enabled</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}