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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, MapPin, CalendarPlus, ExternalLink, Ban, Megaphone, ChevronRight, Users } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete, useMyLinkedAthletes } from "@/lib/use-auth";
import { createPost } from "@/lib/noticeboard.functions";
import { BucketTabStrip, TRAINING_TABS } from "@/components/bucket-tab-strip";
import { DAY_TYPE_META, DAY_TYPE_OPTIONS, WEEKDAY_NAMES, WEEKDAY_SHORT, type TrainingDayType } from "@/lib/training-day-types";
import { downloadICS, googleCalendarLink, mapLink } from "@/lib/training-schedule-helpers";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/_authenticated/app/training-schedule")({
  component: () => (
    <AppShell>
      <TrainingSchedulePage />
    </AppShell>
  ),
});

// Monday-first weekday order for display — matches the rest of the app's
// calendar (Calendar page grid is also Monday-start).
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, Sunday last

// Next real calendar date a given weekday falls on (today if it's today
// and not yet past the slot's time, otherwise the next occurrence).
function nextDateForWeekday(dayOfWeek: number, time: string | null): Date {
  const now = new Date();
  const [h, m] = (time ?? "09:00").split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  let delta = (dayOfWeek - now.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() < now.getTime()) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}
function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TrainingSchedulePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");
  const isAthleteRole = roles.includes("athlete");
  const isParent = rawRoles.includes("parent") && !isCoach;
  const qc = useQueryClient();

  const { data: myAthlete } = useMyAthlete();
  const { data: linkedAthletes } = useMyLinkedAthletes();
  // Athlete sees their own group by default; a parent sees their first
  // linked child's group. Neither overrides an explicit manual pick.
  const selfAthleteId = isAthleteRole ? myAthlete?.id : isParent ? linkedAthletes?.[0]?.athletes?.id : undefined;
  const { data: myMembership } = useQuery({
    queryKey: ["my-training-group", selfAthleteId],
    enabled: !!selfAthleteId,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_group_members")
        .select("group_id")
        .eq("athlete_id", selfAthleteId!)
        .limit(1)
        .maybeSingle();
      return data?.group_id ?? null;
    },
  });

  const { data: groups } = useQuery({
    queryKey: ["training-groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_groups").select("*").order("name");
      if (error) {
        toast.error(error.message);
        return [];
      }
      return data ?? [];
    },
  });

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const activeGroupId = selectedGroupId ?? myMembership ?? groups?.[0]?.id ?? null;

  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  async function createGroup() {
    if (!newGroupName.trim()) return;
    const { data, error } = await supabase
      .from("training_groups")
      .insert({ coach_user_id: user!.id, name: newGroupName.trim() })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Group created");
    setNewGroupName("");
    setNewGroupOpen(false);
    qc.invalidateQueries({ queryKey: ["training-groups"] });
    setSelectedGroupId(data.id);
  }

  const { data: slots } = useQuery({
    queryKey: ["squad-training-sessions", activeGroupId],
    enabled: !!activeGroupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_sessions")
        .select("*, training_locations(name, address, lat, lng)")
        .eq("group_id", activeGroupId)
        .eq("active", true);
      if (error) {
        toast.error(error.message);
        return [];
      }
      return data ?? [];
    },
  });

  const recurring = (slots ?? []).filter((s: any) => s.day_of_week != null);
  const oneOff = (slots ?? [])
    .filter((s: any) => s.specific_date != null)
    .sort((a: any, b: any) => a.specific_date.localeCompare(b.specific_date));

  const [detailSlot, setDetailSlot] = useState<any | null>(null);
  const [newSlotDay, setNewSlotDay] = useState<number | "one-off" | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);

  const groupIds = (groups ?? []).map((g: any) => g.id);
  const { data: memberCounts } = useQuery({
    queryKey: ["training-group-member-counts", groupIds.join(",")],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_group_members").select("group_id").in("group_id", groupIds);
      if (error) return new Map<string, number>();
      const counts = new Map<string, number>();
      for (const r of data ?? []) counts.set(r.group_id, (counts.get(r.group_id) ?? 0) + 1);
      return counts;
    },
  });

  if (!groups) return null;

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Training Schedule</h1>
        <p className="text-sm text-muted-foreground">Location, days, and times for squad, group, or individual training with the coach.</p>
      </div>

      <BucketTabStrip items={TRAINING_TABS} active="/app/training-schedule" />

      <div className="flex flex-wrap items-center gap-2">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet.</p>
        ) : (
          <Select value={activeGroupId ?? ""} onValueChange={setSelectedGroupId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select group" /></SelectTrigger>
            <SelectContent>
              {groups.map((g: any) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} {memberCounts?.get(g.id) ? `(${memberCounts.get(g.id)})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isCoach && (
          <Button size="sm" variant="outline" onClick={() => setNewGroupOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New group
          </Button>
        )}
        {isCoach && activeGroupId && (
          <Button size="sm" variant="outline" onClick={() => setRosterOpen(true)}>
            <Users className="h-3.5 w-3.5 mr-1" /> Manage athletes
          </Button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        {DAY_TYPE_OPTIONS.map((o) => (
          <span key={o.value} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", DAY_TYPE_META[o.value].dotCls)} />
            {o.label}
          </span>
        ))}
      </div>

      {activeGroupId && (
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
              {DISPLAY_ORDER.map((dow) => {
                const daySlots = recurring.filter((s: any) => s.day_of_week === dow);
                return (
                  <div key={dow} className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-center mb-1.5">
                      {WEEKDAY_SHORT[dow]}
                    </div>
                    <div className="space-y-1.5">
                      {daySlots.map((s: any) => {
                        const meta = DAY_TYPE_META[s.day_type as TrainingDayType] ?? DAY_TYPE_META.group_session;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setDetailSlot(s)}
                            className={cn(
                              "w-full text-left rounded-md border px-2 py-1.5 text-[11px] leading-tight transition-colors hover:opacity-80",
                              meta.colorCls,
                            )}
                          >
                            <div className="font-semibold">{meta.short}</div>
                            {s.start_time && <div className="tabular-nums opacity-80">{s.start_time.slice(0, 5)}</div>}
                          </button>
                        );
                      })}
                      {isCoach && (
                        <button
                          onClick={() => setNewSlotDay(dow)}
                          className="w-full flex items-center justify-center rounded-md border border-dashed h-7 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {activeGroupId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">One-off sessions</CardTitle>
            {isCoach && (
              <Button size="sm" variant="outline" onClick={() => setNewSlotDay("one-off")}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add one-off
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {oneOff.length === 0 && <p className="text-sm text-muted-foreground">No one-off sessions scheduled.</p>}
            {oneOff.map((s: any) => {
              const meta = DAY_TYPE_META[s.day_type as TrainingDayType] ?? DAY_TYPE_META.group_session;
              return (
                <button
                  key={s.id}
                  onClick={() => setDetailSlot(s)}
                  className="w-full flex items-center justify-between gap-2 border rounded px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dotCls)} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {format(new Date(s.specific_date + "T00:00:00"), "EEE d MMM")}
                        {s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {meta.label}
                        {s.location_text || s.training_locations?.name ? ` · ${s.training_locations?.name ?? s.location_text}` : ""}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {detailSlot && (
        <SlotDetailDialog
          slot={detailSlot}
          isCoach={isCoach}
          onClose={() => setDetailSlot(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["squad-training-sessions"] })}
        />
      )}

      {newSlotDay !== null && activeGroupId && (
        <SlotFormDialog
          groupId={activeGroupId}
          initialDayOfWeek={typeof newSlotDay === "number" ? newSlotDay : null}
          initialMode={newSlotDay === "one-off" ? "one-off" : "recurring"}
          onClose={() => setNewSlotDay(null)}
          onSaved={() => {
            setNewSlotDay(null);
            qc.invalidateQueries({ queryKey: ["squad-training-sessions"] });
          }}
        />
      )}

      <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>A group runs its own independent weekly schedule — e.g. Senior Squad vs Junior Squad.</DialogDescription>
          </DialogHeader>
          <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Senior Squad" />
          <Button onClick={createGroup} disabled={!newGroupName.trim()}>Create group</Button>
        </DialogContent>
      </Dialog>

      {rosterOpen && activeGroupId && (
        <RosterDialog
          groups={groups}
          activeGroupId={activeGroupId}
          onClose={() => setRosterOpen(false)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["training-group-member-counts"] })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage athletes — assign, remove, or move an athlete between the
// coach's groups. Presented as one dropdown per athlete rather than a
// checkbox grid, since the described use case is "pick their group," not
// genuine multi-group membership.
// ---------------------------------------------------------------------------
function RosterDialog({
  groups,
  activeGroupId,
  onClose,
  onChanged,
}: {
  groups: any[];
  activeGroupId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuthUser();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isManager = rawRoles.includes("manager");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const groupIds = groups.map((g) => g.id);

  const { data: roster } = useQuery({
    queryKey: ["roster-for-groups", user?.id, isManager],
    enabled: !!user,
    queryFn: async () => {
      if (isManager) {
        const { data } = await supabase.from("athletes").select("id, name").order("name");
        return data ?? [];
      }
      const { data } = await supabase
        .from("coach_athletes")
        .select("athletes(id, name)")
        .eq("coach_user_id", user!.id);
      return (data ?? []).map((r: any) => r.athletes).filter(Boolean);
    },
  });

  const { data: memberships } = useQuery({
    queryKey: ["training-group-memberships", groupIds.join(",")],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_group_members").select("athlete_id, group_id").in("group_id", groupIds);
      if (error) return new Map<string, string>();
      const map = new Map<string, string>();
      for (const r of data ?? []) map.set(r.athlete_id, r.group_id);
      return map;
    },
  });

  async function setAthleteGroup(athleteId: string, newGroupId: string | null) {
    const { error: delError } = await supabase
      .from("training_group_members")
      .delete()
      .eq("athlete_id", athleteId)
      .in("group_id", groupIds);
    if (delError) {
      toast.error(delError.message);
      return;
    }
    if (newGroupId) {
      const { error: insError } = await supabase
        .from("training_group_members")
        .insert({ group_id: newGroupId, athlete_id: athleteId, added_by: user!.id });
      if (insError) {
        toast.error(insError.message);
        return;
      }
    }
    toast.success(newGroupId ? "Group updated" : "Removed from group");
    qc.invalidateQueries({ queryKey: ["training-group-memberships"] });
    onChanged();
  }

  const filtered = (roster ?? []).filter((a: any) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage athletes</DialogTitle>
          <DialogDescription>Assign each athlete to a group, or set to "Not assigned" to remove them.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search athletes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="space-y-1.5">
          {(!roster || roster.length === 0) && <p className="text-sm text-muted-foreground">No athletes on your roster yet.</p>}
          {filtered.map((a: any) => {
            const currentGroupId = memberships?.get(a.id) ?? "";
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar name={a.name} imageUrl={null} size="sm" />
                  <span className="text-sm font-medium truncate">{a.name}</span>
                </div>
                <Select
                  value={currentGroupId || "none"}
                  onValueChange={(v) => setAthleteGroup(a.id, v === "none" ? null : v)}
                >
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not assigned</SelectItem>
                    {groups.map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
        <Button variant="outline" onClick={onClose}>Done</Button>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Slot detail dialog — view/edit the series, manage per-occurrence
// overrides, calendar export + map link for the next occurrence.
// ---------------------------------------------------------------------------
function SlotDetailDialog({
  slot,
  isCoach,
  onClose,
  onChanged,
}: {
  slot: any;
  isCoach: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const meta = DAY_TYPE_META[slot.day_type as TrainingDayType] ?? DAY_TYPE_META.group_session;

  const { data: overrides } = useQuery({
    queryKey: ["squad-training-overrides", slot.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("squad_training_overrides")
        .select("*, training_locations(name, address, lat, lng)")
        .eq("schedule_id", slot.id)
        .gte("occurrence_date", toISO(new Date()))
        .order("occurrence_date");
      if (error) {
        toast.error(error.message);
        return [];
      }
      return data ?? [];
    },
  });

  const locationName = slot.training_locations?.name ?? slot.location_text ?? null;
  const map = mapLink({ lat: slot.training_locations?.lat, lng: slot.training_locations?.lng, text: locationName });

  const nextDate =
    slot.specific_date ??
    (slot.day_of_week != null ? toISO(nextDateForWeekday(slot.day_of_week, slot.start_time)) : null);

  function exportOccurrence(dateOverride?: string, timeOverride?: string | null, locOverride?: string | null, notesOverride?: string | null) {
    const occ = {
      title: `${meta.label}${slot.squad_label ? ` — ${slot.squad_label}` : ""}`,
      date: dateOverride ?? nextDate!,
      startTime: timeOverride !== undefined ? timeOverride : slot.start_time?.slice(0, 5) ?? null,
      location: locOverride !== undefined ? locOverride : locationName,
      notes: notesOverride !== undefined ? notesOverride : slot.notes,
    };
    return occ;
  }

  async function deleteSlot() {
    if (!confirm("Delete this from the schedule? This removes the whole series, not just one occurrence.")) return;
    const { error } = await supabase.from("squad_training_sessions").delete().eq("id", slot.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Removed");
    onChanged();
    onClose();
  }

  if (editing) {
    return (
      <SlotFormDialog
        groupId={slot.group_id}
        initial={slot}
        initialDayOfWeek={slot.day_of_week}
        initialMode={slot.specific_date ? "one-off" : "recurring"}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", meta.dotCls)} />
            <DialogTitle>{meta.label}</DialogTitle>
          </div>
          <DialogDescription>
            {slot.squad_label && <span className="block">{slot.squad_label}</span>}
            {slot.specific_date
              ? format(new Date(slot.specific_date + "T00:00:00"), "EEEE d MMMM")
              : `Every ${WEEKDAY_NAMES[slot.day_of_week]}`}
            {slot.start_time ? ` · ${slot.start_time.slice(0, 5)}` : " · No fixed time"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {locationName && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {locationName}</span>
              {map && (
                <Button asChild size="sm" variant="ghost">
                  <a href={map} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" /> Map</a>
                </Button>
              )}
            </div>
          )}
          {slot.notes && <p className="text-muted-foreground">{slot.notes}</p>}

          {nextDate && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => downloadICS(exportOccurrence())}>
                <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Add to calendar
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={googleCalendarLink(exportOccurrence())} target="_blank" rel="noreferrer">
                  Google Calendar
                </a>
              </Button>
            </div>
          )}

          {/* Overrides only make sense for a recurring rule — a one-off
              specific_date row is already a single occurrence. */}
          {slot.day_of_week != null && (
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Upcoming changes to this series</Label>
                {isCoach && (
                  <Button size="sm" variant="ghost" onClick={() => setOverrideOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Change one date
                  </Button>
                )}
              </div>
              {(!overrides || overrides.length === 0) && (
                <p className="text-xs text-muted-foreground">No exceptions — this series runs as scheduled.</p>
              )}
              {overrides?.map((ov: any) => (
                <OverrideRow key={ov.id} override={ov} slot={slot} isCoach={isCoach} onChanged={() => qc.invalidateQueries({ queryKey: ["squad-training-overrides", slot.id] })} />
              ))}
            </div>
          )}

          {isCoach && (
            <div className="flex gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit series
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteSlot}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            </div>
          )}
        </div>

        {overrideOpen && (
          <OverrideFormDialog
            slot={slot}
            onClose={() => setOverrideOpen(false)}
            onSaved={() => {
              setOverrideOpen(false);
              qc.invalidateQueries({ queryKey: ["squad-training-overrides", slot.id] });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OverrideRow({ override, slot, isCoach, onChanged }: { override: any; slot: any; isCoach: boolean; onChanged: () => void }) {
  const locationName = override.training_locations?.name ?? override.location_text ?? slot.training_locations?.name ?? slot.location_text ?? null;
  const time = override.start_time ?? slot.start_time;
  const map = mapLink({ lat: override.training_locations?.lat, lng: override.training_locations?.lng, text: locationName });

  async function remove() {
    const { error } = await supabase.from("squad_training_overrides").delete().eq("id", override.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Change removed — this date reverts to the normal schedule");
    onChanged();
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="font-medium flex items-center gap-1.5">
          {format(new Date(override.occurrence_date + "T00:00:00"), "EEE d MMM")}
          {override.cancelled && <Badge variant="outline" className="text-[10px]"><Ban className="h-2.5 w-2.5 mr-0.5" />Cancelled</Badge>}
        </div>
        {!override.cancelled && (
          <div className="text-muted-foreground truncate">
            {time?.slice(0, 5)}{locationName ? ` · ${locationName}` : ""}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!override.cancelled && map && (
          <Button asChild size="icon" variant="ghost" className="h-6 w-6">
            <a href={map} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>
          </Button>
        )}
        {!override.cancelled && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() =>
              downloadICS({
                title: `${DAY_TYPE_META[slot.day_type as TrainingDayType]?.label ?? "Training"}${slot.squad_label ? ` — ${slot.squad_label}` : ""}`,
                date: override.occurrence_date,
                startTime: time?.slice(0, 5) ?? null,
                location: locationName,
                notes: override.notes ?? slot.notes,
              })
            }
          >
            <CalendarPlus className="h-3 w-3" />
          </Button>
        )}
        {isCoach && (
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={remove}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function OverrideFormDialog({ slot, onClose, onSaved }: { slot: any; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuthUser();
  const [date, setDate] = useState(toISO(nextDateForWeekday(slot.day_of_week, slot.start_time)));
  const [cancelled, setCancelled] = useState(false);
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [time, setTime] = useState(slot.start_time?.slice(0, 5) ?? "09:00");
  const [useCustomLocation, setUseCustomLocation] = useState(false);
  const [locationText, setLocationText] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const payload: any = {
        schedule_id: slot.id,
        occurrence_date: date,
        cancelled,
        start_time: !cancelled && useCustomTime ? time : null,
        location_text: !cancelled && useCustomLocation ? locationText || null : null,
        notes: notes || null,
        created_by: user!.id,
      };
      const { error } = await supabase.from("squad_training_overrides").upsert(payload, { onConflict: "schedule_id,occurrence_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Date updated");
      onSaved();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change one date</DialogTitle>
          <DialogDescription>Only this date changes — the rest of the series stays as scheduled.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />
            Cancel this date entirely
          </label>
          {!cancelled && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useCustomTime} onChange={(e) => setUseCustomTime(e.target.checked)} />
                Different time for this date
              </label>
              {useCustomTime && <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useCustomLocation} onChange={(e) => setUseCustomLocation(e.target.checked)} />
                Different location for this date
              </label>
              {useCustomLocation && (
                <Input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="e.g. Indoor track (wet weather)" />
              )}
            </>
          )}
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for the change, if useful to note" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => m.mutate()} disabled={m.isPending}>Save change</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add/edit a recurring or one-off slot (the base series).
// ---------------------------------------------------------------------------
function SlotFormDialog({
  groupId,
  initial,
  initialDayOfWeek,
  initialMode,
  onClose,
  onSaved,
}: {
  groupId: string;
  initial?: any;
  initialDayOfWeek: number | null;
  initialMode: "recurring" | "one-off";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuthUser();
  const createPostFn = useServerFn(createPost);
  const isEdit = !!initial;

  const { data: savedLocations } = useQuery({
    queryKey: ["training-locations-list"],
    queryFn: async () => {
      const { data } = await supabase.from("training_locations").select("id, name, address").order("name");
      return data ?? [];
    },
  });

  const [mode, setMode] = useState<"recurring" | "one-off">(initialMode);
  const [dayType, setDayType] = useState<TrainingDayType>(initial?.day_type ?? "group_session");
  const [squadLabel, setSquadLabel] = useState(initial?.squad_label ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<string>(String(initial?.day_of_week ?? initialDayOfWeek ?? 1));
  const [specificDate, setSpecificDate] = useState(initial?.specific_date ?? "");
  const [hasTime, setHasTime] = useState(!!initial?.start_time || !isEdit);
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? "06:00");
  const [locationMode, setLocationMode] = useState<"saved" | "custom" | "none">(
    initial?.location_id ? "saved" : initial?.location_text ? "custom" : "none",
  );
  const [locationId, setLocationId] = useState(initial?.location_id ?? "");
  const [locationText, setLocationText] = useState(initial?.location_text ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [announce, setAnnounce] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const payload: any = {
        group_id: groupId,
        day_type: dayType,
        squad_label: squadLabel || null,
        day_of_week: mode === "recurring" ? Number(dayOfWeek) : null,
        specific_date: mode === "one-off" ? specificDate : null,
        start_time: hasTime ? startTime : null,
        location_id: locationMode === "saved" ? locationId || null : null,
        location_text: locationMode === "custom" ? locationText || null : null,
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
        const meta = DAY_TYPE_META[dayType];
        const when =
          mode === "one-off"
            ? new Date(specificDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
            : `${WEEKDAY_NAMES[Number(dayOfWeek)]}s`;
        const timeLabel = hasTime ? new Date(`2000-01-01T${startTime}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
        const locLabel = locationMode === "saved" ? savedLocations?.find((l: any) => l.id === locationId)?.name : locationMode === "custom" ? locationText : "";
        await createPostFn({
          data: {
            post_type: "training_event",
            title: isEdit ? `Training schedule updated: ${meta.label}` : `New on the schedule: ${meta.label}`,
            body: `${when}${timeLabel ? ` at ${timeLabel}` : ""}${locLabel ? ` · ${locLabel}` : ""}${notes ? `\n${notes}` : ""}`,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Updated" : "Added");
      onSaved();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit series" : "Add to schedule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Day type</Label>
            <Select value={dayType} onValueChange={(v) => setDayType(v as TrainingDayType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAY_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Label (optional)</Label>
            <Input value={squadLabel} onChange={(e) => setSquadLabel(e.target.value)} placeholder="e.g. Track intervals" />
          </div>

          {!isEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "recurring" ? "default" : "outline"} onClick={() => setMode("recurring")}>Weekly</Button>
              <Button size="sm" variant={mode === "one-off" ? "default" : "outline"} onClick={() => setMode("one-off")}>One-off date</Button>
            </div>
          )}

          {mode === "recurring" ? (
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
          ) : (
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} />
            Has a fixed time
          </label>
          {hasTime && <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}

          <div>
            <Label className="text-xs">Location</Label>
            <div className="flex gap-2 mb-1.5">
              <Button size="sm" variant={locationMode === "saved" ? "default" : "outline"} onClick={() => setLocationMode("saved")}>Saved location</Button>
              <Button size="sm" variant={locationMode === "custom" ? "default" : "outline"} onClick={() => setLocationMode("custom")}>Custom text</Button>
              <Button size="sm" variant={locationMode === "none" ? "default" : "outline"} onClick={() => setLocationMode("none")}>None</Button>
            </div>
            {locationMode === "saved" && (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Pick a saved location" /></SelectTrigger>
                <SelectContent>
                  {(savedLocations ?? []).map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {locationMode === "custom" && (
              <Input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="e.g. Athletics track" />
            )}
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <label className="flex items-start gap-2 text-sm border rounded-md p-2.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            <span>
              <span className="font-medium flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Announce on Noticeboard</span>
              <span className="text-xs text-muted-foreground block mt-0.5">Off by default — turn on for changes worth calling out.</span>
            </span>
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => m.mutate()}
            disabled={(mode === "one-off" && !specificDate) || m.isPending}
          >
            {isEdit ? "Save" : "Add"}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
