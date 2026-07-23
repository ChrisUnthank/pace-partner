import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { BucketTabStrip, COACHING_HUB_TABS } from "@/components/bucket-tab-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DAY_TYPE_META } from "@/lib/training-day-types";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/coach-diary")({
  component: CoachDiaryPage,
});

const AGENDA_DAYS = 21;

// Stable per-group colors, assigned by group creation order. The
// training_groups.color column exists (added in the same migration as this
// page) for a proper per-group picker later — until that UI exists, a group
// with no stored color falls back to this palette by index.
const GROUP_PALETTE = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];

// Personal-entry categories — deliberately self-contained (values match the
// CHECK constraint on coach_personal_calendar_entries) rather than importing
// the athlete-side meta, so the two can diverge without coupling.
const PERSONAL_META: Record<string, { label: string; dot: string }> = {
  work_shift: { label: "Work shift", dot: "bg-slate-500" },
  appointment: { label: "Appointment", dot: "bg-fuchsia-500" },
  personal: { label: "Personal", dot: "bg-cyan-500" },
  other: { label: "Other", dot: "bg-stone-400" },
};

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeDates(n: number): string[] {
  const out: string[] = [];
  const start = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toISO(d));
  }
  return out;
}

function timeLabel(t: string | null, timeOfDay: string | null): string {
  if (t) return t.slice(0, 5);
  if (timeOfDay) return timeOfDay.toUpperCase();
  return "";
}

function CoachDiaryPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isManager = roles.includes("manager");
  const qc = useQueryClient();

  const dates = rangeDates(AGENDA_DAYS);
  const rangeEnd = dates[dates.length - 1];
  const todayIso = dates[0];

  // ── All of this coach's groups (managers see every group) ────────────────
  const { data: groups = [] } = useQuery({
    queryKey: ["coach-diary-groups", user?.id, isManager],
    enabled: !!user && isCoach,
    queryFn: async () => {
      let q = supabase.from("training_groups").select("*").order("created_at");
      if (!isManager) q = q.eq("coach_user_id", user!.id);
      const { data, error } = await q;
      if (error) return [];
      return data ?? [];
    },
  });

  const groupIds = (groups as any[]).map((g) => g.id);
  const groupMeta = new Map(
    (groups as any[]).map((g, i) => [
      g.id,
      { name: g.name, dot: g.color && String(g.color).startsWith("bg-") ? g.color : GROUP_PALETTE[i % GROUP_PALETTE.length] },
    ]),
  );

  // ── Every active slot across every group ─────────────────────────────────
  const { data: slots = [] } = useQuery({
    queryKey: ["coach-diary-slots", groupIds.join(",")],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_sessions")
        .select("*, training_locations(name)")
        .in("group_id", groupIds)
        .eq("active", true);
      if (error) return [];
      return data ?? [];
    },
  });

  const scheduleIds = (slots as any[]).map((s) => s.id);
  const { data: overrides = [] } = useQuery({
    queryKey: ["coach-diary-overrides", scheduleIds.join(",")],
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
  const overrideByKey = new Map((overrides as any[]).map((o) => [`${o.schedule_id}:${o.occurrence_date}`, o]));

  // ── The coach's own diary items ──────────────────────────────────────────
  const { data: personalEntries = [] } = useQuery({
    queryKey: ["coach-diary-personal", user?.id],
    enabled: !!user && isCoach,
    queryFn: async () => {
      const { data, error } = await (supabase.from("coach_personal_calendar_entries" as any) as any)
        .select("*")
        .eq("coach_user_id", user!.id)
        .eq("active", true);
      if (error) return [];
      return data ?? [];
    },
  });

  // ── Merge into a per-date agenda, same algorithm as the athlete Diary ────
  const byDate = new Map<string, { training: any[]; personal: any[] }>();
  for (const d of dates) byDate.set(d, { training: [], personal: [] });

  for (const slot of slots as any[]) {
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

  for (const entry of personalEntries as any[]) {
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

  if (!isCoach) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">The coach diary is only available to coaches.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Diary</h1>
          <p className="text-sm text-muted-foreground">
            All your training groups' schedules combined into one agenda, alongside your own appointments and
            commitments.
          </p>
        </div>

        <BucketTabStrip items={COACHING_HUB_TABS} active="/app/coach-diary" />

        {/* Group color legend */}
        {(groups as any[]).length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(groups as any[]).map((g) => (
              <span key={g.id} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", groupMeta.get(g.id)!.dot)} />
                {g.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setEntryDialog({})}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add personal item
          </Button>
        </div>

        <div className="space-y-2">
          {dates.map((d) => {
            const day = byDate.get(d)!;
            const isEmpty = day.training.length === 0 && day.personal.length === 0;
            const dateObj = new Date(d + "T00:00:00");
            return (
              <div key={d} className={cn("border rounded-md px-3 py-2", d === todayIso && "border-primary/50 bg-accent/20")}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    {dateObj.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    {d === todayIso && <span className="ml-2 text-xs text-primary font-normal">Today</span>}
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setEntryDialog({ date: d })}
                  >
                    + add
                  </button>
                </div>

                {isEmpty ? (
                  <p className="text-xs text-muted-foreground mt-1">Nothing scheduled.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {day.training
                      .slice()
                      .sort((a, b) => String(a.start_time ?? "99").localeCompare(String(b.start_time ?? "99")))
                      .map((s, i) => {
                        const g = groupMeta.get(s.group_id);
                        const meta = DAY_TYPE_META[s.day_type as keyof typeof DAY_TYPE_META] ?? DAY_TYPE_META.group_session;
                        const loc = s.training_locations?.name ?? s.location_text ?? null;
                        const t = timeLabel(s.start_time, s.time_of_day);
                        return (
                          <div key={s.id + ":" + i} className="flex items-start gap-2 text-sm">
                            <span className={cn("h-2.5 w-2.5 rounded-full mt-1 shrink-0", g?.dot ?? "bg-muted")} />
                            <div className="min-w-0">
                              <span className="font-medium">{g?.name ?? "Group"}</span>
                              {t && <span className="text-muted-foreground"> · {t}</span>}
                              {loc && <span className="text-muted-foreground"> · {loc}</span>}
                              {s._overridden && <span className="text-[10px] text-amber-600 ml-1">changed</span>}
                              <span className="inline-flex items-center gap-1 ml-2 text-[11px] text-muted-foreground align-middle">
                                <span className={cn("h-1.5 w-1.5 rounded-full", (meta as any).dotCls ?? "bg-muted")} />
                                {(meta as any).label ?? s.day_type}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    {day.personal.map((p) => {
                      const meta = PERSONAL_META[p.category] ?? PERSONAL_META.other;
                      return (
                        <button
                          key={p.id + ":" + d}
                          onClick={() => setEntryDialog({ initial: p })}
                          className="flex items-start gap-2 text-sm w-full text-left hover:bg-accent/30 rounded"
                        >
                          <span className={cn("h-2.5 w-2.5 rounded-full mt-1 shrink-0", meta.dot)} />
                          <div className="min-w-0">
                            <span className="font-medium">{p.title}</span>
                            {p.start_time && <span className="text-muted-foreground"> · {String(p.start_time).slice(0, 5)}</span>}
                            <span className="text-[11px] text-muted-foreground ml-2">{meta.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {entryDialog && (
        <PersonalEntryDialog
          coachUserId={user!.id}
          date={entryDialog.date}
          initial={entryDialog.initial}
          onClose={() => setEntryDialog(null)}
          onSaved={() => {
            setEntryDialog(null);
            qc.invalidateQueries({ queryKey: ["coach-diary-personal"] });
          }}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Add/edit a personal diary item — one-off date or weekly recurring.
// ---------------------------------------------------------------------------
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function PersonalEntryDialog({
  coachUserId,
  date,
  initial,
  onClose,
  onSaved,
}: {
  coachUserId: string;
  date?: string;
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "other");
  const [mode, setMode] = useState<"one-off" | "weekly">(initial?.day_of_week != null ? "weekly" : "one-off");
  const [specificDate, setSpecificDate] = useState(initial?.specific_date ?? date ?? toISO(new Date()));
  const [dayOfWeek, setDayOfWeek] = useState(String(initial?.day_of_week ?? 1));
  const [startTime, setStartTime] = useState(initial?.start_time ? String(initial.start_time).slice(0, 5) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) {
      toast.error("A title is required");
      return;
    }
    setSaving(true);
    const payload: any = {
      coach_user_id: coachUserId,
      title: title.trim(),
      category,
      specific_date: mode === "one-off" ? specificDate : null,
      day_of_week: mode === "weekly" ? Number(dayOfWeek) : null,
      start_time: startTime || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const tbl = (supabase.from("coach_personal_calendar_entries" as any) as any);
    const { error } = isEdit ? await tbl.update(payload).eq("id", initial.id) : await tbl.insert(payload);
    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }
    toast.success(isEdit ? "Updated" : "Added");
    setSaving(false);
    onSaved();
  }

  async function remove() {
    if (!isEdit) return;
    if (!confirm("Delete this diary item?")) return;
    const { error } = await (supabase.from("coach_personal_calendar_entries" as any) as any)
      .delete()
      .eq("id", initial.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted");
    onSaved();
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit personal item" : "Add personal item"}</DialogTitle>
          <DialogDescription>Private to you — never shown to athletes or parents.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Physio appointment" />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PERSONAL_META).map(([k, m]) => (
                  <SelectItem key={k} value={k}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>When</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one-off">One-off date</SelectItem>
                <SelectItem value="weekly">Every week</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "one-off" ? (
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Day of week</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w, i) => (
                    <SelectItem key={i} value={String(i)}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Time (optional)</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <Button variant="destructive" size="sm" onClick={remove} disabled={saving}>Delete</Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
