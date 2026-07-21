import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useMyRawRoles, useMyAthlete, useMyLinkedAthletes } from "@/lib/use-auth";
import { BucketTabStrip, LOCKER_TABS } from "@/components/bucket-tab-strip";
import { DAY_TYPE_META, type TrainingDayType } from "@/lib/training-day-types";
import { PERSONAL_CATEGORY_META, PERSONAL_CATEGORY_OPTIONS, type PersonalEntryCategory } from "@/lib/personal-calendar-categories";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/my-schedule")({
  component: () => (
    <AppShell>
      <MySchedulePage />
    </AppShell>
  ),
});

const AGENDA_DAYS = 21;

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rangeDates(days: number): string[] {
  const out: string[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(toISO(d));
  }
  return out;
}

function MySchedulePage() {
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isAthleteRole = roles.includes("athlete");
  const isCoach = roles.includes("coach") || roles.includes("manager");
  const isParent = rawRoles.includes("parent") && !isCoach;
  const qc = useQueryClient();

  const { data: myAthlete } = useMyAthlete();
  const { data: linkedAthletes } = useMyLinkedAthletes();
  const [viewingChildId, setViewingChildId] = useState<string | null>(null);
  const targetAthleteId = isAthleteRole ? myAthlete?.id : isParent ? (viewingChildId ?? linkedAthletes?.[0]?.athletes?.id) : undefined;

  const dates = rangeDates(AGENDA_DAYS);
  const rangeEnd = dates[dates.length - 1];

  const { data: groupId } = useQuery({
    queryKey: ["my-schedule-group", targetAthleteId],
    enabled: !!targetAthleteId,
    queryFn: async () => {
      const { data } = await supabase.from("training_group_members").select("group_id").eq("athlete_id", targetAthleteId!).limit(1).maybeSingle();
      return data?.group_id ?? null;
    },
  });

  const { data: trainingSlots } = useQuery({
    queryKey: ["my-schedule-training-slots", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_sessions")
        .select("*, training_locations(name)")
        .eq("group_id", groupId!)
        .eq("active", true);
      if (error) return [];
      return data ?? [];
    },
  });

  const scheduleIds = (trainingSlots ?? []).map((s: any) => s.id);
  const { data: overrides } = useQuery({
    queryKey: ["my-schedule-overrides", scheduleIds.join(",")],
    enabled: scheduleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_overrides")
        .select("*, training_locations(name)")
        .in("schedule_id", scheduleIds)
        .gte("occurrence_date", dates[0])
        .lte("occurrence_date", rangeEnd);
      if (error) return [];
      return data ?? [];
    },
  });
  const overrideByKey = new Map((overrides ?? []).map((o: any) => [`${o.schedule_id}:${o.occurrence_date}`, o]));

  const { data: personalEntries } = useQuery({
    queryKey: ["my-schedule-personal", targetAthleteId],
    enabled: !!targetAthleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athlete_personal_calendar_entries")
        .select("*")
        .eq("athlete_id", targetAthleteId!)
        .eq("active", true);
      if (error) return [];
      return data ?? [];
    },
  });

  // Build, for each date in the agenda window, the list of training
  // occurrences (read-only, with overrides applied) and personal entries.
  const byDate = new Map<string, { training: any[]; personal: any[] }>();
  for (const d of dates) byDate.set(d, { training: [], personal: [] });

  for (const slot of trainingSlots ?? []) {
    if (slot.specific_date) {
      if (byDate.has(slot.specific_date)) byDate.get(slot.specific_date)!.training.push(slot);
      continue;
    }
    if (slot.day_of_week == null) continue;
    for (const d of dates) {
      const dow = new Date(d + "T00:00:00").getDay();
      if (dow !== slot.day_of_week) continue;
      const ov = overrideByKey.get(`${slot.id}:${d}`);
      if (ov?.cancelled) continue;
      byDate.get(d)!.training.push(
        ov
          ? {
              ...slot,
              start_time: ov.start_time ?? slot.start_time,
              location_text: ov.location_text ?? slot.location_text,
              training_locations: ov.training_locations ?? slot.training_locations,
              notes: ov.notes ?? slot.notes,
              _overridden: true,
            }
          : slot,
      );
    }
  }

  for (const entry of personalEntries ?? []) {
    if (entry.specific_date) {
      if (byDate.has(entry.specific_date)) byDate.get(entry.specific_date)!.personal.push(entry);
      continue;
    }
    if (entry.day_of_week == null) continue;
    for (const d of dates) {
      const dow = new Date(d + "T00:00:00").getDay();
      if (dow === entry.day_of_week) byDate.get(d)!.personal.push(entry);
    }
  }

  const [entryDialog, setEntryDialog] = useState<{ date?: string; initial?: any } | null>(null);
  const todayISO = toISO(new Date());

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Your coach's training schedule, plus anything else on your plate — work shifts, appointments, whatever else.
        </p>
      </div>

      <BucketTabStrip items={LOCKER_TABS} active="/app/my-schedule" />

      {isParent && (linkedAthletes?.length ?? 0) > 1 && (
        <Select value={targetAthleteId ?? ""} onValueChange={setViewingChildId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select child" /></SelectTrigger>
          <SelectContent>
            {linkedAthletes!.map((r: any) => (
              <SelectItem key={r.athletes.id} value={r.athletes.id}>{r.athletes.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setEntryDialog({})}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add personal item
        </Button>
      </div>

      <div className="space-y-2">
        {dates.map((d) => {
          const day = byDate.get(d)!;
          const isToday = d === todayISO;
          return (
            <Card key={d} className={cn(isToday && "border-primary/50")}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {format(new Date(d + "T00:00:00"), "EEE d MMM")}
                    {isToday && <span className="ml-1.5 text-primary">· Today</span>}
                  </div>
                  <button
                    onClick={() => setEntryDialog({ date: d })}
                    className="text-muted-foreground hover:text-foreground"
                    title="Add personal item on this date"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {day.training.length === 0 && day.personal.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">Nothing scheduled</p>
                ) : (
                  <div className="space-y-1.5">
                    {day.training.map((s: any) => {
                      const meta = DAY_TYPE_META[s.day_type as TrainingDayType] ?? DAY_TYPE_META.group_session;
                      const loc = s.training_locations?.name ?? s.location_text;
                      return (
                        <div key={s.id} className={cn("rounded-md border px-2.5 py-1.5 text-xs flex items-center justify-between gap-2", meta.colorCls)}>
                          <span className="truncate">
                            <span className="font-semibold">{meta.label}</span>
                            {s.start_time ? ` · ${s.start_time.slice(0, 5)}` : s.time_of_day ? ` · ${s.time_of_day.toUpperCase()}` : ""}
                            {loc ? ` · ${loc}` : ""}
                            {s._overridden && " (changed)"}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide opacity-70 shrink-0">From coach</span>
                        </div>
                      );
                    })}
                    {day.personal.map((e: any) => {
                      const meta = PERSONAL_CATEGORY_META[e.category as PersonalEntryCategory] ?? PERSONAL_CATEGORY_META.other;
                      return (
                        <div key={e.id} className={cn("rounded-md border px-2.5 py-1.5 text-xs flex items-center justify-between gap-2", meta.colorCls)}>
                          <span className="truncate">
                            <span className="font-semibold">{e.title}</span>
                            {e.start_time ? ` · ${e.start_time.slice(0, 5)}${e.end_time ? `–${e.end_time.slice(0, 5)}` : ""}` : ""}
                            {e.location_text ? ` · ${e.location_text}` : ""}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setEntryDialog({ date: e.specific_date ?? d, initial: e })} className="opacity-70 hover:opacity-100">
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {entryDialog && targetAthleteId && (
        <PersonalEntryDialog
          athleteId={targetAthleteId}
          initial={entryDialog.initial}
          initialDate={entryDialog.date}
          onClose={() => setEntryDialog(null)}
          onSaved={() => {
            setEntryDialog(null);
            qc.invalidateQueries({ queryKey: ["my-schedule-personal"] });
          }}
        />
      )}
    </div>
  );
}

function PersonalEntryDialog({
  athleteId,
  initial,
  initialDate,
  onClose,
  onSaved,
}: {
  athleteId: string;
  initial?: any;
  initialDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [mode, setMode] = useState<"one-off" | "recurring">(initial?.day_of_week != null ? "recurring" : "one-off");
  const [category, setCategory] = useState<PersonalEntryCategory>(initial?.category ?? "personal");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [specificDate, setSpecificDate] = useState(initial?.specific_date ?? initialDate ?? toISO(new Date()));
  const [dayOfWeek, setDayOfWeek] = useState<string>(String(initial?.day_of_week ?? new Date(initialDate ?? Date.now()).getDay()));
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(initial?.end_time?.slice(0, 5) ?? "");
  const [locationText, setLocationText] = useState(initial?.location_text ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const m = useMutation({
    mutationFn: async () => {
      const payload: any = {
        athlete_id: athleteId,
        category,
        title,
        day_of_week: mode === "recurring" ? Number(dayOfWeek) : null,
        specific_date: mode === "one-off" ? specificDate : null,
        start_time: startTime || null,
        end_time: endTime || null,
        location_text: locationText || null,
        notes: notes || null,
      };
      if (isEdit) {
        const { error } = await supabase.from("athlete_personal_calendar_entries").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("athlete_personal_calendar_entries").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Updated" : "Added");
      onSaved();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  async function remove() {
    if (!initial) return;
    const { error } = await supabase.from("athlete_personal_calendar_entries").delete().eq("id", initial.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Removed");
    onSaved();
  }

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : "Add personal item"}</DialogTitle>
          <DialogDescription>Only visible to you{isEdit ? "" : " and a linked parent, if you have one"} — your coach doesn't see this.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as PersonalEntryCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERSONAL_CATEGORY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Evening shift at the cafe" />
          </div>
          {!isEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "one-off" ? "default" : "outline"} onClick={() => setMode("one-off")}>One date</Button>
              <Button size="sm" variant={mode === "recurring" ? "default" : "outline"} onClick={() => setMode("recurring")}>Every week</Button>
            </div>
          )}
          {mode === "one-off" ? (
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label className="text-xs">Day of week</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAY_NAMES.map((d, i) => (
                    <SelectItem key={i} value={i.toString()}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start time (optional)</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">End time (optional)</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Location (optional)</Label>
            <Input value={locationText} onChange={(e) => setLocationText(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => m.mutate()} disabled={!title.trim() || m.isPending}>{isEdit ? "Save" : "Add"}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {isEdit && (
            <Button variant="ghost" className="text-destructive ml-auto" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
