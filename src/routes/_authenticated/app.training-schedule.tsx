import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Clock, Users, Megaphone } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { createPost } from "@/lib/noticeboard.functions";
import { BucketTabStrip, TRAINING_TABS } from "@/components/bucket-tab-strip";

export const Route = createFileRoute("/_authenticated/app/training-schedule")({
  component: () => (
    <AppShell>
      <TrainingSchedule />
    </AppShell>
  ),
});

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Computes the next real calendar date a recurring (day_of_week) or one-off
// (specific_date) squad training slot falls on. Recurring slots that
// already happened today at an earlier time roll to next week rather than
// showing as "today" once they're past.
function nextOccurrence(row: { day_of_week: number | null; specific_date: string | null; start_time: string }): Date {
  const now = new Date();
  if (row.specific_date) {
    const [h, m] = row.start_time.split(":").map(Number);
    const d = new Date(row.specific_date + "T00:00:00");
    d.setHours(h, m, 0, 0);
    return d;
  }
  const [h, m] = row.start_time.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let deltaDays = (row.day_of_week! - now.getDay() + 7) % 7;
  if (deltaDays === 0 && d.getTime() < now.getTime()) deltaDays = 7;
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function TrainingSchedule() {
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");

  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["squad-training-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_sessions")
        .select("*")
        .eq("active", true);
      if (error) {
        toast.error(error.message);
        return [];
      }
      return data ?? [];
    },
  });

  const sorted = [...rows]
    .map((r: any) => ({ ...r, _next: nextOccurrence(r) }))
    .sort((a, b) => a._next.getTime() - b._next.getTime());

  async function deleteRow(id: string) {
    const { error } = await supabase.from("squad_training_sessions").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Removed from schedule");
    qc.invalidateQueries({ queryKey: ["squad-training-sessions"] });
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Training Schedule</h1>
        <p className="text-sm text-muted-foreground">Location, days, and times for squad, group, or individual training with the coach.</p>
      </div>

      <BucketTabStrip items={TRAINING_TABS} active="/app/training-schedule" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Schedule
          </CardTitle>
          {isCoach && (
            <Button size="sm" variant="outline" onClick={() => { setEditing(null); setOpen(true); }}>
              Add slot
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {sorted.length === 0 && <p className="text-sm text-muted-foreground">No upcoming training slots posted yet.</p>}
          {sorted.map((r: any) => (
            <div key={r.id} className="flex items-start justify-between gap-2 border rounded px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{r.squad_label}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.specific_date ? format(r._next, "EEE d MMM") : DAY_NAMES[r.day_of_week] + "s"}
                  {" · "}
                  {format(r._next, "h:mm a")}
                  {r.location_text ? ` · ${r.location_text}` : ""}
                </div>
                {r.notes && <div className="text-xs text-muted-foreground mt-1">{r.notes}</div>}
              </div>
              {isCoach && (
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteRow(r.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>

        {open && (
          <TrainingSlotForm
            initial={editing}
            onClose={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              qc.invalidateQueries({ queryKey: ["squad-training-sessions"] });
            }}
          />
        )}
      </Card>
    </div>
  );
}

function TrainingSlotForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuthUser();
  const createPostFn = useServerFn(createPost);
  const isEdit = !!initial;
  const [mode, setMode] = useState<"recurring" | "one-off">(initial?.specific_date ? "one-off" : "recurring");
  const [squadLabel, setSquadLabel] = useState(initial?.squad_label ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<string>(initial?.day_of_week?.toString() ?? "1");
  const [specificDate, setSpecificDate] = useState(initial?.specific_date ?? "");
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? "06:00");
  const [locationText, setLocationText] = useState(initial?.location_text ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Coach's choice — off by default, so an ordinary edit (fixing a typo,
  // tweaking a time slightly) doesn't spam the Noticeboard unless the
  // coach actually wants this specific change called out.
  const [announce, setAnnounce] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const payload: any = {
        squad_label: squadLabel,
        day_of_week: mode === "recurring" ? Number(dayOfWeek) : null,
        specific_date: mode === "one-off" ? specificDate : null,
        start_time: startTime,
        location_text: locationText || null,
        notes: notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from("squad_training_sessions").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("squad_training_sessions").insert({ ...payload, coach_user_id: user!.id });
        if (error) throw error;
      }

      if (announce) {
        const when =
          mode === "one-off"
            ? new Date(specificDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
            : `${DAY_NAMES[Number(dayOfWeek)]}s`;
        const timeLabel = new Date(`2000-01-01T${startTime}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        await createPostFn({
          data: {
            post_type: "training_event",
            title: isEdit ? `Training schedule updated: ${squadLabel}` : `New training slot: ${squadLabel}`,
            body: `${when} at ${timeLabel}${locationText ? ` · ${locationText}` : ""}${notes ? `\n${notes}` : ""}`,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Slot updated" : "Slot added");
      onSaved();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  return (
    <CardContent className="border-t pt-4 space-y-3">
      <div>
        <Label className="text-xs">Squad / group</Label>
        <Input value={squadLabel} onChange={(e) => setSquadLabel(e.target.value)} placeholder="Senior squad" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={mode === "recurring" ? "default" : "outline"} onClick={() => setMode("recurring")}>Weekly</Button>
        <Button size="sm" variant={mode === "one-off" ? "default" : "outline"} onClick={() => setMode("one-off")}>One-off date</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {mode === "recurring" ? (
          <div>
            <Label className="text-xs">Day of week</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d, i) => (
                  <SelectItem key={i} value={i.toString()}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
          </div>
        )}
        <div>
          <Label className="text-xs">Start time</Label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Location</Label>
        <Input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Athletics track" />
      </div>
      <div>
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <label className="flex items-start gap-2 text-sm border rounded-md p-2.5 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
        <span>
          <span className="font-medium flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Announce on Noticeboard</span>
          <span className="text-xs text-muted-foreground block mt-0.5">
            Posts a "Training" announcement summarizing this change. Off by default — turn on for changes worth calling out.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button
          onClick={() => m.mutate()}
          disabled={!squadLabel.trim() || (mode === "one-off" && !specificDate) || m.isPending}
        >
          {isEdit ? "Save" : "Add"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </CardContent>
  );
}
