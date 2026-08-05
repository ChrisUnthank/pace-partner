import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarPlus, MapPin, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete, useMyLinkedAthletes } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/my-race-schedule")({
  component: () => (
    <AppShell fullWidth>
      <MyRaceSchedulePage />
    </AppShell>
  ),
});

// Same best-effort label→distance recognition as the coach-side Race
// Schedule page — kept in sync there; see that file's comment for why
// this is deliberately not exhaustive.
function parseDistanceFromLabel(label: string): number | null {
  const s = label.toLowerCase();
  if (/half\s*marathon/.test(s)) return 21097;
  if (/marathon/.test(s)) return 42195;
  if (/\bmile\b/.test(s)) return 1609;
  const km = s.match(/(\d+(?:\.\d+)?)\s*k(m)?\b/);
  if (km) return Math.round(parseFloat(km[1]) * 1000);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

type RaceScheduleEntry = {
  id: string;
  training_group_id: string;
  name: string;
  event_date: string;
  location: string | null;
  race_type: string | null;
  events_offered: string[];
};

type Selection = {
  id: string;
  race_schedule_entry_id: string;
  selected_event: string | null;
  session_id: string | null;
};

function MyRaceSchedulePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const { data: rawRoles = [] } = useMyRawRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");
  const isAthleteRole = roles.includes("athlete");
  const isParent = rawRoles.includes("parent") && !isCoach;
  const qc = useQueryClient();

  const { data: myAthlete } = useMyAthlete();
  const { data: linkedAthletes } = useMyLinkedAthletes();
  const [viewingChildId, setViewingChildId] = useState<string | null>(null);
  // Same resolution order as Training Schedule — athlete sees their own
  // races by default, a parent sees their first linked child's (or
  // whichever they've switched to).
  const athleteId = isAthleteRole ? myAthlete?.id : isParent ? (viewingChildId ?? linkedAthletes?.[0]?.athletes?.id) : undefined;

  const { data: groupIds } = useQuery({
    queryKey: ["my-race-schedule-groups", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_group_members").select("group_id").eq("athlete_id", athleteId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.group_id);
    },
  });

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["my-race-schedule-entries", (groupIds ?? []).join(",")],
    enabled: !!groupIds && groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_schedule_entries")
        .select("*")
        .in("training_group_id", groupIds)
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RaceScheduleEntry[];
    },
  });

  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id), [entries]);
  const { data: mySelections } = useQuery({
    queryKey: ["my-race-selections", athleteId, entryIds.join(",")],
    enabled: !!athleteId && entryIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_race_selections")
        .select("id, race_schedule_entry_id, selected_event, session_id")
        .eq("athlete_id", athleteId)
        .in("race_schedule_entry_id", entryIds);
      if (error) throw error;
      return (data ?? []) as Selection[];
    },
  });
  const selectionByEntry = useMemo(() => {
    const map = new Map<string, Selection>();
    for (const s of mySelections ?? []) map.set(s.race_schedule_entry_id, s);
    return map;
  }, [mySelections]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["my-race-schedule-entries"] });
    qc.invalidateQueries({ queryKey: ["my-race-selections"] });
    qc.invalidateQueries({ queryKey: ["sessions-list"] });
  }

  // Self-service pick — same instant-apply pattern as the coach page's
  // assign control, and the same session-sync logic (only create/update
  // the planned session once an event is actually known).
  async function pickEvent(entry: RaceScheduleEntry, existing: Selection | undefined, selectedEvent: string | null) {
    if (!athleteId) return;
    if (!existing) {
      const { error } = await (supabase as any).from("athlete_race_selections").insert({
        race_schedule_entry_id: entry.id,
        athlete_id: athleteId,
        selected_event: selectedEvent,
        assigned_by: user?.id ?? null,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await (supabase as any)
        .from("athlete_race_selections")
        .update({ selected_event: selectedEvent })
        .eq("id", existing.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }

    if (selectedEvent) {
      const distance = parseDistanceFromLabel(selectedEvent);
      if (existing?.session_id) {
        await supabase
          .from("sessions")
          .update({ title: selectedEvent, session_date: entry.event_date, total_distance_m: distance ?? undefined })
          .eq("id", existing.session_id);
      } else {
        const { data: sessionRow, error: sessErr } = await supabase
          .from("sessions")
          .insert({
            athlete_id: athleteId,
            session_date: entry.event_date,
            day_type: "race",
            title: selectedEvent,
            is_planned: true,
            source: "manual",
            total_distance_m: distance ?? null,
            created_by: user!.id,
          } as any)
          .select("id")
          .single();
        if (!sessErr && sessionRow) {
          await (supabase as any)
            .from("athlete_race_selections")
            .update({ session_id: sessionRow.id })
            .eq("race_schedule_entry_id", entry.id)
            .eq("athlete_id", athleteId);
        }
      }
    }

    toast.success(selectedEvent ? `Added ${selectedEvent} to your calendar` : "Marked as planned — pick an event when you're ready");
    invalidateAll();
  }

  async function removeSelection(sel: Selection) {
    if (sel.session_id) {
      const { data: sess } = await supabase.from("sessions").select("completed_at").eq("id", sel.session_id).maybeSingle();
      if (sess && !sess.completed_at) {
        await supabase.from("sessions").delete().eq("id", sel.session_id);
      }
    }
    const { error } = await (supabase as any).from("athlete_race_selections").delete().eq("id", sel.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => (entries ?? []).filter((e) => e.event_date >= today), [entries, today]);
  const past = useMemo(() => (entries ?? []).filter((e) => e.event_date < today).reverse(), [entries, today]);
  const [showPast, setShowPast] = useState(false);

  if (isCoach) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">
          My Race Schedule is the athlete-facing view — see Race Schedule under Performances to build and assign a group's calendar.
        </p>
      </div>
    );
  }

  function renderEntry(entry: RaceScheduleEntry) {
    const sel = selectionByEntry.get(entry.id);
    return (
      <Card key={entry.id}>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <div className="w-14 shrink-0 text-center">
              <div className="text-[10px] uppercase text-muted-foreground font-bold">
                {new Date(entry.event_date + "T00:00:00").toLocaleDateString(undefined, { month: "short" })}
              </div>
              <div className="text-lg font-extrabold leading-none">{new Date(entry.event_date + "T00:00:00").getDate()}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{entry.name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                {entry.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {entry.location}
                  </span>
                )}
                {entry.race_type && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{entry.race_type}</Badge>}
              </div>
            </div>
            <Select
              value={sel?.selected_event ?? (sel ? "unset" : "none")}
              onValueChange={(v) => {
                if (v === "none") {
                  if (sel) removeSelection(sel);
                } else {
                  pickEvent(entry, sel, v === "unset" ? null : v);
                }
              }}
            >
              <SelectTrigger className="w-[190px] h-8 text-xs shrink-0">
                <SelectValue placeholder="Not doing this one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not doing this one</SelectItem>
                <SelectItem value="unset">Planned — pick event later</SelectItem>
                {entry.events_offered.map((ev) => (
                  <SelectItem key={ev} value={ev}>
                    {ev}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
          <CalendarPlus className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Performances</div>
          <h1 className="text-2xl font-bold leading-tight">My Race Schedule</h1>
        </div>
        {isParent && linkedAthletes && linkedAthletes.length > 1 && (
          <Select value={athleteId ?? ""} onValueChange={setViewingChildId}>
            <SelectTrigger className="ml-auto w-[160px]">
              <SelectValue placeholder="Choose child" />
            </SelectTrigger>
            <SelectContent>
              {linkedAthletes.map((l: any) => (
                <SelectItem key={l.athletes.id} value={l.athletes.id}>
                  {l.athletes.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="text-sm text-muted-foreground -mt-3">
        Every race your training group has on the calendar — pick which ones you're doing, and which event, to add them to your session
        calendar as an upcoming race.
      </p>

      {entriesLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-1">
            <Users className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No races on your training group's calendar yet.</p>
            <p className="text-xs text-muted-foreground">Check back once your coach has built one out.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {upcoming.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">No upcoming races on the calendar right now.</CardContent>
            </Card>
          ) : (
            <div className="space-y-2">{upcoming.map(renderEntry)}</div>
          )}

          {past.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                {showPast ? "Hide" : "Show"} past races ({past.length})
              </button>
              {showPast && <div className="space-y-2 mt-2">{past.map(renderEntry)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
