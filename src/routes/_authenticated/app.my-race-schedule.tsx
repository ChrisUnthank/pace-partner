import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CalendarPlus, MapPin, Users, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuthUser, useMyRoles, useMyRawRoles, useMyAthlete, useMyLinkedAthletes } from "@/lib/use-auth";
import { mapLink } from "@/lib/training-schedule-helpers";
import { buildRaceSessionTitle, buildRaceSessionNotes } from "@/lib/race-session-details";
import { buildScheduleRows, buildScheduleText, buildScheduleIcs, downloadTextFile, openMailtoWithSchedule } from "@/lib/race-schedule-export";

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

// Same formatting as the coach-side Race Schedule page — entry_opens/
// entry_closes are timestamps now (time of day matters: "closes Wed 12
// noon" vs "closes Wed 5pm" are different deadlines), not bare dates.
function formatEntryTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Same helpers as the coach-side Race Schedule page — prefer the linked
// saved location (real coordinates, so "view on map" actually works)
// over the plain-text fallback.
function entryLocationLabel(entry: { location: string | null; training_locations: { name: string } | null }): string | null {
  return entry.training_locations?.name ?? entry.location;
}
function entryMapLink(entry: {
  location: string | null;
  training_locations: { name: string; lat: number | null; lng: number | null } | null;
}): string | null {
  return mapLink({
    lat: entry.training_locations?.lat,
    lng: entry.training_locations?.lng,
    text: entry.training_locations?.name ?? entry.location,
  });
}

type RaceScheduleEntry = {
  id: string;
  training_group_id: string | null;
  calendar_id: string | null;
  name: string;
  event_date: string;
  location: string | null;
  location_id: string | null;
  training_locations: { name: string; address: string | null; lat: number | null; lng: number | null } | null;
  race_type: string | null;
  events_offered: string[];
  entry_opens: string | null;
  entry_closes: string | null;
  entry_url: string | null;
};

type Selection = {
  id: string;
  race_schedule_entry_id: string;
  selected_event: string | null;
  session_id: string | null;
};

const ENTRY_STATUS_LABEL: Record<string, string> = {
  registered: "Registered",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
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
  const athleteName = isAthleteRole
    ? (myAthlete as any)?.name ?? "My"
    : (linkedAthletes ?? []).find((l: any) => l.athletes?.id === athleteId)?.athletes?.name ?? "My";

  const { data: groupIds } = useQuery({
    queryKey: ["my-race-schedule-groups", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_group_members").select("group_id").eq("athlete_id", athleteId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.group_id);
    },
  });

  const { data: calendarIds } = useQuery({
    queryKey: ["my-race-schedule-calendars", (groupIds ?? []).join(",")],
    enabled: !!groupIds && groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("race_calendar_groups").select("calendar_id").in("training_group_id", groupIds);
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((r: any) => r.calendar_id as string)));
    },
  });

  // Every selection this athlete has, independent of group/calendar
  // visibility — fetched first specifically so the entries query below
  // can guarantee "an entry I'm assigned to always shows up here", even
  // in an edge case where group/calendar membership has since drifted
  // from what it was when the assignment was made.
  const { data: myAllSelections } = useQuery({
    queryKey: ["my-race-selections-all", athleteId],
    enabled: !!athleteId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_race_selections")
        .select("id, race_schedule_entry_id, selected_event, session_id")
        .eq("athlete_id", athleteId);
      if (error) throw error;
      return (data ?? []) as Selection[];
    },
  });
  const mySelectedEntryIds = useMemo(() => (myAllSelections ?? []).map((s) => s.race_schedule_entry_id), [myAllSelections]);

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: [
      "my-race-schedule-entries",
      (groupIds ?? []).join(","),
      (calendarIds ?? []).join(","),
      mySelectedEntryIds.join(","),
    ],
    enabled: !!groupIds && groupIds.length > 0,
    queryFn: async () => {
      // Union of three ownership/visibility paths — an entry owned
      // directly by one of my groups, one owned by a calendar applied to
      // one of my groups, or (the fallback that actually matters here) one
      // I already have a selection for regardless of the other two —
      // see the "readable via own selection" RLS policy this depends on.
      const legacyQ = (supabase as any)
        .from("race_schedule_entries")
        .select("*, training_locations(name, address, lat, lng)")
        .in("training_group_id", groupIds);
      const calIds = calendarIds ?? [];
      const results = await Promise.all([
        legacyQ,
        calIds.length > 0
          ? (supabase as any).from("race_schedule_entries").select("*, training_locations(name, address, lat, lng)").in("calendar_id", calIds)
          : Promise.resolve({ data: [], error: null }),
        mySelectedEntryIds.length > 0
          ? (supabase as any).from("race_schedule_entries").select("*, training_locations(name, address, lat, lng)").in("id", mySelectedEntryIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      const byId = new Map<string, RaceScheduleEntry>();
      for (const r of results) for (const row of r.data ?? []) byId.set(row.id, row as RaceScheduleEntry);
      const merged = Array.from(byId.values());
      merged.sort((a, b) => a.event_date.localeCompare(b.event_date));
      return merged;
    },
  });

  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id), [entries]);
  // myAllSelections (fetched above) is already a superset of what a
  // second query scoped to entryIds would return — entries always
  // includes every race myAllSelections references (that's the third
  // union leg above), so there's no separate narrower query needed here.
  const selectionByEntry = useMemo(() => {
    const map = new Map<string, Selection>();
    for (const s of myAllSelections ?? []) map.set(s.race_schedule_entry_id, s);
    return map;
  }, [myAllSelections]);

  // Entry-registration status per selection, from Event Entries (Locker)
  // — same link used on the coach page, read here so the athlete sees
  // their own "have I entered" state without leaving this page.
  const selectionIds = useMemo(() => (myAllSelections ?? []).map((s) => s.id), [myAllSelections]);
  const { data: myEntryRows } = useQuery({
    queryKey: ["my-race-schedule-entry-rows", selectionIds.join(",")],
    enabled: selectionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("event_entries")
        .select("id, athlete_race_selection_id, entry_status")
        .in("athlete_race_selection_id", selectionIds);
      if (error) throw error;
      return (data ?? []) as { id: string; athlete_race_selection_id: string; entry_status: string | null }[];
    },
  });
  const entryRowBySelection = useMemo(() => {
    const map = new Map<string, { id: string; entry_status: string | null }>();
    for (const e of myEntryRows ?? []) map.set(e.athlete_race_selection_id, e);
    return map;
  }, [myEntryRows]);

  // Export — only ever the races actually flagged (selected), never the
  // full browsable calendar shown above. hasEnteredEntry looks up through
  // selectionByEntry rather than taking a selection id directly, since
  // that's what buildScheduleRows works with.
  const scheduleRows = useMemo(() => {
    if (!entries) return [];
    return buildScheduleRows(entries as any, (myAllSelections ?? []) as any, (entryId) => {
      const sel = selectionByEntry.get(entryId);
      return sel ? entryRowBySelection.has(sel.id) : false;
    });
  }, [entries, myAllSelections, selectionByEntry, entryRowBySelection]);

  function exportSchedule(format: "txt" | "ics" | "email") {
    if (scheduleRows.length === 0) {
      toast.error("No flagged races to export yet — pick an event on at least one race first.");
      return;
    }
    const label = athleteName === "My" ? "My" : `${athleteName}'s`;
    if (format === "ics") {
      downloadTextFile(`${athleteName}-race-schedule.ics`, buildScheduleIcs(athleteName, scheduleRows), "text/calendar");
    } else if (format === "txt") {
      downloadTextFile(`${athleteName}-race-schedule.txt`, buildScheduleText(label, scheduleRows));
    } else {
      openMailtoWithSchedule(label, buildScheduleText(label, scheduleRows));
    }
  }

  async function markEntered(entry: RaceScheduleEntry, sel: Selection) {
    const { error } = await supabase.from("event_entries").insert({
      athlete_id: athleteId!,
      event_name: sel.selected_event ? `${entry.name} — ${sel.selected_event}` : entry.name,
      event_date: entry.event_date,
      location: entryLocationLabel(entry),
      entry_status: "registered",
      athlete_race_selection_id: sel.id,
    } as any);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked as entered — your coach can see this too");
    qc.invalidateQueries({ queryKey: ["my-race-schedule-entry-rows"] });
  }

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
      const sessionLocationPatch = entry.location_id
        ? { location_id: entry.location_id, location: null }
        : { location_id: null, location: entry.location };
      const title = buildRaceSessionTitle(entry.name, selectedEvent);
      if (existing?.session_id) {
        // Notes deliberately NOT touched here — see race-session-details.ts.
        // Title/date/distance/location do get kept in sync, since those
        // are structured fields nobody's expected to hand-edit on a
        // planned race the way they might add a free-text note.
        await supabase
          .from("sessions")
          .update({ title, session_date: entry.event_date, total_distance_m: distance ?? undefined, ...sessionLocationPatch } as any)
          .eq("id", existing.session_id);
      } else {
        const notes = buildRaceSessionNotes(entry, entryLocationLabel(entry));
        const { data: sessionRow, error: sessErr } = await supabase
          .from("sessions")
          .insert({
            athlete_id: athleteId,
            session_date: entry.event_date,
            day_type: "race",
            title,
            notes: notes || null,
            is_planned: true,
            source: "manual",
            total_distance_m: distance ?? null,
            created_by: user!.id,
            ...sessionLocationPatch,
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
                {entryLocationLabel(entry) && (
                  <a
                    href={entryMapLink(entry) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <MapPin className="h-3 w-3" /> {entryLocationLabel(entry)}
                  </a>
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
          {sel && (
            <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              {(entry.entry_opens || entry.entry_closes) && (
                <span>
                  Entries {entry.entry_opens ? `open ${formatEntryTimestamp(entry.entry_opens)}` : ""}
                  {entry.entry_opens && entry.entry_closes ? " · " : ""}
                  {entry.entry_closes ? `close ${formatEntryTimestamp(entry.entry_closes)}` : ""}
                </span>
              )}
              {entry.entry_url && (
                <a href={entry.entry_url} target="_blank" rel="noreferrer" className="text-[var(--accent-red)] hover:underline font-medium">
                  Enter now →
                </a>
              )}
              <span className="ml-auto flex items-center gap-2">
                {entryRowBySelection.has(sel.id) ? (
                  <Badge variant="default" className="text-[10px] h-4 px-1.5">
                    {ENTRY_STATUS_LABEL[entryRowBySelection.get(sel.id)?.entry_status ?? ""] ?? "Entered"}
                  </Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => markEntered(entry, sel)}
                    className="text-[var(--accent-red)] hover:underline font-medium"
                  >
                    I've entered this
                  </button>
                )}
              </span>
            </div>
          )}
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
        <div className="ml-auto flex items-center gap-2">
          {isParent && linkedAthletes && linkedAthletes.length > 1 && (
            <Select value={athleteId ?? ""} onValueChange={setViewingChildId}>
              <SelectTrigger className="w-[160px]">
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
          {athleteId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportSchedule("txt")}>Download as text</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportSchedule("ics")}>Download as calendar (.ics)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportSchedule("email")}>Email schedule</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
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
