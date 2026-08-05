import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { CalendarDays, MapPin, Plus, Upload, Trash2, Pencil, ChevronDown, ChevronUp, Loader2, Flag, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/format";
import { mapLink } from "@/lib/training-schedule-helpers";
import { computeEntryWindow, toDatetimeLocalValue, type RaceEntryRule } from "@/lib/entry-rules";
import { buildRaceSessionTitle, buildRaceSessionNotes } from "@/lib/race-session-details";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { LocationPicker } from "@/components/location-picker";
import { extractTextFromFile } from "@/lib/document-text-extract";
import { parseRaceScheduleText, type ParsedRaceScheduleEntry } from "@/lib/race-schedule.functions";

export const Route = createFileRoute("/_authenticated/app/race-schedule")({
  component: () => (
    <AppShell fullWidth>
      <RaceSchedulePage />
    </AppShell>
  ),
});

// Recognizes common distance labels well enough to pre-fill a planned
// session's distance when an event gets picked (800m, 5K, Half Marathon,
// etc.) — best-effort, not exhaustive. Left null (no guess) for anything
// it doesn't recognize, rather than a wrong number silently shown as fact.
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

// Entry-window timestamps display as "Wed 12 Feb, 12:00pm" — short enough
// for an inline row, still unambiguous about both the day and the time
// (which is the whole point of these being timestamps, not bare dates).
function formatEntryTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Prefers the linked saved location's name (and its real coordinates for
// the map link) over the plain-text fallback — a linked location is what
// makes "view on map" actually work, since free text alone has no
// coordinates to link to.
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

type RaceCalendar = { id: string; name: string; season: string | null };

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
  source: string;
  entry_opens: string | null;
  entry_closes: string | null;
  entry_url: string | null;
  entry_rule_id: string | null;
};

type Selection = {
  id: string;
  race_schedule_entry_id: string;
  athlete_id: string;
  selected_event: string | null;
  status: string;
  session_id: string | null;
  athletes: { name: string | null; profile_image_url: string | null } | null;
};

type EntryStatus = { athlete_race_selection_id: string; entry_status: string | null };

const ENTRY_STATUS_LABEL: Record<string, string> = {
  registered: "Registered",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
};

type PreviewRow = ParsedRaceScheduleEntry & { location_id: string | null };

function RaceSchedulePage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach") || roles.includes("manager");
  const qc = useQueryClient();

  const { data: groups } = useQuery({
    queryKey: ["training-groups"],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_groups").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const activeGroupId = selectedGroupId ?? groups?.[0]?.id ?? null;

  const { data: members } = useQuery({
    queryKey: ["race-schedule-group-members", activeGroupId],
    enabled: !!activeGroupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_group_members")
        .select("athlete_id, athletes(name, profile_image_url)")
        .eq("group_id", activeGroupId!);
      if (error) throw error;
      return (data ?? []) as unknown as { athlete_id: string; athletes: { name: string | null; profile_image_url: string | null } | null }[];
    },
  });
  const membersSorted = useMemo(
    () => [...(members ?? [])].sort((a, b) => (a.athletes?.name ?? "").localeCompare(b.athletes?.name ?? "")),
    [members],
  );

  // ── Calendars ────────────────────────────────────────────────────────
  // A calendar is owned once and applied to N groups via race_calendar_groups
  // — see the migration comment for why entries live on the calendar
  // rather than being copied per group.
  const { data: myCalendars } = useQuery({
    queryKey: ["race-calendars", user?.id],
    enabled: isCoach && !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("race_calendars").select("id, name, season").order("name");
      if (error) throw error;
      return (data ?? []) as RaceCalendar[];
    },
  });

  // Recurring entry-deadline rules (e.g. "AV XCR Individual", "AVSL Zone
  // Priority") — shared pool, same as training_locations, so a rule one
  // coach sets up is available to any coach on the roster rather than
  // needing to be recreated per person.
  const { data: entryRules } = useQuery({
    queryKey: ["race-entry-rules"],
    enabled: isCoach,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_entry_rules")
        .select("id, name, closes_weekday, closes_time, opens_weekday, opens_time, opens_min_days_before")
        .order("name");
      if (error) throw error;
      return (data ?? []) as RaceEntryRule[];
    },
  });

  const { data: appliedCalendarIds } = useQuery({
    queryKey: ["race-calendar-groups", activeGroupId],
    enabled: !!activeGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("race_calendar_groups").select("calendar_id").eq("training_group_id", activeGroupId);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.calendar_id as string);
    },
  });
  const appliedCalendars = useMemo(
    () => (myCalendars ?? []).filter((c) => (appliedCalendarIds ?? []).includes(c.id)),
    [myCalendars, appliedCalendarIds],
  );

  async function applyCalendarToGroup(calendarId: string) {
    if (!activeGroupId) return;
    const { error } = await (supabase as any)
      .from("race_calendar_groups")
      .insert({ calendar_id: calendarId, training_group_id: activeGroupId, applied_by: user?.id ?? null });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Calendar applied to this group");
    qc.invalidateQueries({ queryKey: ["race-calendar-groups", activeGroupId] });
    invalidateAll();
  }
  async function removeCalendarFromGroup(calendarId: string) {
    if (!activeGroupId) return;
    if (!confirm("Remove this calendar from the group? Athletes' existing picks from it stay untouched — this only stops it showing up here going forward.")) return;
    const { error } = await (supabase as any)
      .from("race_calendar_groups")
      .delete()
      .eq("calendar_id", calendarId)
      .eq("training_group_id", activeGroupId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-calendar-groups", activeGroupId] });
    invalidateAll();
  }

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["race-schedule-entries", activeGroupId, (appliedCalendarIds ?? []).join(",")],
    enabled: !!activeGroupId,
    queryFn: async () => {
      // Union of two ownership paths — a legacy entry owned directly by
      // this group, or an entry owned by a calendar applied to this
      // group. Two queries + client-side merge rather than a single
      // OR-across-tables query, which the Supabase client can't express
      // cleanly for a "calendar_id IN (subquery)" condition alongside a
      // plain column match.
      const legacyQ = (supabase as any)
        .from("race_schedule_entries")
        .select("*, training_locations(name, address, lat, lng)")
        .eq("training_group_id", activeGroupId);
      const calIds = appliedCalendarIds ?? [];
      const results = await Promise.all([
        legacyQ,
        calIds.length > 0
          ? (supabase as any)
              .from("race_schedule_entries")
              .select("*, training_locations(name, address, lat, lng)")
              .in("calendar_id", calIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      const merged = [...(results[0].data ?? []), ...(results[1].data ?? [])] as RaceScheduleEntry[];
      merged.sort((a, b) => a.event_date.localeCompare(b.event_date));
      return merged;
    },
  });

  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id), [entries]);
  const { data: selections } = useQuery({
    queryKey: ["race-schedule-selections", activeGroupId, entryIds.join(",")],
    enabled: entryIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_race_selections")
        .select("id, race_schedule_entry_id, athlete_id, selected_event, status, session_id, athletes(name, profile_image_url)")
        .in("race_schedule_entry_id", entryIds);
      if (error) throw error;
      return (data ?? []) as Selection[];
    },
  });
  const selectionsByEntry = useMemo(() => {
    const map = new Map<string, Selection[]>();
    for (const s of selections ?? []) {
      const list = map.get(s.race_schedule_entry_id) ?? [];
      list.push(s);
      map.set(s.race_schedule_entry_id, list);
    }
    return map;
  }, [selections]);

  // Entry-registration status, surfaced from Event Entries (Locker) — the
  // coach-visibility half of "how does the coach know an athlete has
  // entered". Keyed by selection id since that's the shared link between
  // a schedule pick and an athlete's own entry record.
  const selectionIds = useMemo(() => (selections ?? []).map((s) => s.id), [selections]);
  const { data: entryStatuses } = useQuery({
    queryKey: ["race-schedule-entry-statuses", selectionIds.join(",")],
    enabled: selectionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("event_entries")
        .select("athlete_race_selection_id, entry_status")
        .in("athlete_race_selection_id", selectionIds);
      if (error) throw error;
      return (data ?? []) as EntryStatus[];
    },
  });
  const entryStatusBySelection = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const e of entryStatuses ?? []) map.set(e.athlete_race_selection_id, e.entry_status);
    return map;
  }, [entryStatuses]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["race-schedule-entries", activeGroupId] });
    qc.invalidateQueries({ queryKey: ["race-schedule-selections"] });
    qc.invalidateQueries({ queryKey: ["race-schedule-entry-statuses"] });
    qc.invalidateQueries({ queryKey: ["race-calendars"] });
  }

  // ── Manual add ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [raceType, setRaceType] = useState("track");
  const [eventsText, setEventsText] = useState("");
  const [entryRuleId, setEntryRuleId] = useState<string>("none");
  const [entryOpens, setEntryOpens] = useState(""); // datetime-local value
  const [entryCloses, setEntryCloses] = useState(""); // datetime-local value
  const [entryUrl, setEntryUrl] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // ── Entry rules manager ──────────────────────────────────────────────
  const [rulesManagerOpen, setRulesManagerOpen] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleClosesWeekday, setRuleClosesWeekday] = useState("3");
  const [ruleClosesTime, setRuleClosesTime] = useState("12:00");
  const [ruleHasOpens, setRuleHasOpens] = useState(false);
  const [ruleOpensWeekday, setRuleOpensWeekday] = useState("3");
  const [ruleOpensTime, setRuleOpensTime] = useState("17:00");
  const [ruleOpensMinDaysBefore, setRuleOpensMinDaysBefore] = useState("10");
  const [savingRule, setSavingRule] = useState(false);

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function resetRuleForm() {
    setRuleName("");
    setRuleClosesWeekday("3");
    setRuleClosesTime("12:00");
    setRuleHasOpens(false);
    setRuleOpensWeekday("3");
    setRuleOpensTime("17:00");
    setRuleOpensMinDaysBefore("10");
  }

  // Quick-fill starting points matching the three patterns actually
  // described — still just fills the form, doesn't save until reviewed.
  function fillRulePreset(preset: "xcr_individual" | "xcr_relay" | "avsl") {
    if (preset === "xcr_individual") {
      setRuleName("AV XCR Individual");
      setRuleClosesWeekday("3");
      setRuleClosesTime("12:00");
      setRuleHasOpens(false);
    } else if (preset === "xcr_relay") {
      setRuleName("AV XCR Relay (club enters)");
      setRuleClosesWeekday("1");
      setRuleClosesTime("12:00");
      setRuleHasOpens(false);
    } else {
      setRuleName("AVSL Zone Priority");
      setRuleClosesWeekday("3");
      setRuleClosesTime("12:00");
      setRuleHasOpens(true);
      setRuleOpensWeekday("3");
      setRuleOpensTime("17:00");
      setRuleOpensMinDaysBefore("10");
    }
  }

  async function saveRule() {
    if (!ruleName.trim()) {
      toast.error("Name this rule first");
      return;
    }
    setSavingRule(true);
    const { error } = await (supabase as any).from("race_entry_rules").insert({
      name: ruleName.trim(),
      closes_weekday: Number(ruleClosesWeekday),
      closes_time: ruleClosesTime,
      opens_weekday: ruleHasOpens ? Number(ruleOpensWeekday) : null,
      opens_time: ruleHasOpens ? ruleOpensTime : null,
      opens_min_days_before: ruleHasOpens ? Number(ruleOpensMinDaysBefore) : null,
      created_by: user!.id,
    });
    setSavingRule(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Entry rule saved");
    resetRuleForm();
    qc.invalidateQueries({ queryKey: ["race-entry-rules"] });
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this entry rule? Races already using it keep their computed dates — this only removes the rule itself.")) return;
    const { error } = await (supabase as any).from("race_entry_rules").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-entry-rules"] });
  }

  // Recomputes the entry window from whichever rule is selected and the
  // current date field — called on both "pick a rule" and "change the
  // date" so the window stays in sync with whichever changed most
  // recently. Purely a starting point: both fields stay directly
  // editable afterward for a one-off exception (public holiday shifting
  // a deadline, etc.) without fighting the rule.
  function recomputeEntryWindow(ruleId: string, raceDate: string) {
    const rule = (entryRules ?? []).find((r) => r.id === ruleId);
    if (!rule || !raceDate) return;
    const { opens, closes } = computeEntryWindow(raceDate, rule);
    setEntryOpens(toDatetimeLocalValue(opens));
    setEntryCloses(toDatetimeLocalValue(closes));
  }

  function openAdd() {
    setName("");
    setDate(todayISO());
    setLocation("");
    setLocationId(null);
    setRaceType("track");
    setEventsText("");
    setEntryRuleId("none");
    setEntryOpens("");
    setEntryCloses("");
    setEntryUrl("");
    setAddOpen(true);
  }

  async function saveManual() {
    if (!name.trim() || !activeGroupId) {
      toast.error("Name the race first");
      return;
    }
    setSavingManual(true);
    const { error } = await (supabase as any).from("race_schedule_entries").insert({
      training_group_id: activeGroupId,
      name: name.trim(),
      event_date: date,
      location: locationId ? null : location.trim() || null,
      location_id: locationId,
      race_type: raceType || null,
      events_offered: eventsText.split(",").map((s) => s.trim()).filter(Boolean),
      entry_rule_id: entryRuleId === "none" ? null : entryRuleId,
      entry_opens: entryOpens ? new Date(entryOpens).toISOString() : null,
      entry_closes: entryCloses ? new Date(entryCloses).toISOString() : null,
      entry_url: entryUrl.trim() || null,
      source: "manual",
      created_by: user!.id,
    });
    setSavingManual(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Race added to the schedule");
    setAddOpen(false);
    invalidateAll();
  }

  async function deleteEntry(id: string) {
    if (!confirm("Remove this race from the schedule? This also unassigns it from any athletes.")) return;
    const { error } = await (supabase as any).from("race_schedule_entries").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAll();
  }

  // ── Import (upload / paste) ─────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importTab, setImportTab] = useState<"upload" | "paste">("upload");
  const [pasteText, setPasteText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const parseText = useServerFn(parseRaceScheduleText);

  // Which calendar imported entries land in — an existing one (reused, so
  // re-importing an updated document adds alongside what's already
  // there), or a brand new one, named up front. Defaults to "new" with a
  // blank name; the coach names it before extraction can run.
  const [targetCalendarId, setTargetCalendarId] = useState<string>("new");
  const [newCalendarName, setNewCalendarName] = useState("");

  async function runExtraction(text: string) {
    if (!text.trim()) {
      toast.error("Nothing to extract from");
      return;
    }
    if (targetCalendarId === "new" && !newCalendarName.trim()) {
      toast.error("Name this calendar first (e.g. \"2026 XCR Calendar\")");
      return;
    }
    setExtracting(true);
    try {
      const result = await parseText({ data: { text } });
      if (result.length === 0) {
        toast.error("Couldn't find any races in that document");
      } else {
        // AI extraction only ever produces free-text locations (it has no
        // way to know about your saved training_locations) — location_id
        // starts null on every row, and the picker below lets you link
        // one during review, same as adding a race manually.
        setPreview(result.map((r) => ({ ...r, location_id: null })));
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (targetCalendarId === "new" && !newCalendarName.trim()) {
      toast.error("Name this calendar first (e.g. \"2026 XCR Calendar\")");
      return;
    }
    setExtracting(true);
    try {
      const text = await extractTextFromFile(f);
      await runExtraction(text);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't read that file");
    } finally {
      setExtracting(false);
    }
  }

  function updatePreviewRow(i: number, patch: Partial<PreviewRow>) {
    setPreview((rows) => (rows ? rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : rows));
  }
  function removePreviewRow(i: number) {
    setPreview((rows) => (rows ? rows.filter((_, idx) => idx !== i) : rows));
  }

  const [importing, setImporting] = useState(false);
  async function commitImport() {
    if (!preview || !activeGroupId) return;
    const withDates = preview.filter((r) => r.event_date);
    if (withDates.length < preview.length) {
      toast.error(`${preview.length - withDates.length} row(s) still need a date before importing — fix or remove them.`);
      return;
    }
    setImporting(true);

    // Resolve the target calendar — create it if needed, and make sure
    // it's applied to the current group (auto-applying to whichever
    // group you were importing for is the sensible default; applying to
    // additional groups afterward happens from the Calendars section).
    let calendarId = targetCalendarId;
    if (calendarId === "new") {
      const { data: newCal, error: calErr } = await (supabase as any)
        .from("race_calendars")
        .insert({ name: newCalendarName.trim(), created_by: user!.id })
        .select("id")
        .single();
      if (calErr || !newCal) {
        setImporting(false);
        toast.error(calErr?.message ?? "Couldn't create the calendar");
        return;
      }
      calendarId = newCal.id;
    }
    if (!(appliedCalendarIds ?? []).includes(calendarId)) {
      // Ignore a unique-violation if it's already applied (race with
      // another tab, or picked an existing-but-already-applied calendar)
      // — not worth surfacing as an error.
      await (supabase as any)
        .from("race_calendar_groups")
        .insert({ calendar_id: calendarId, training_group_id: activeGroupId, applied_by: user!.id });
    }

    const { error } = await (supabase as any).from("race_schedule_entries").insert(
      preview.map((r) => ({
        calendar_id: calendarId,
        name: r.name,
        event_date: r.event_date,
        location: r.location_id ? null : r.location,
        location_id: r.location_id,
        race_type: r.race_type,
        events_offered: r.events_offered,
        source: "parsed",
        created_by: user!.id,
      })),
    );
    setImporting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Imported ${preview.length} race${preview.length === 1 ? "" : "s"} into ${targetCalendarId === "new" ? newCalendarName.trim() : myCalendars?.find((c) => c.id === calendarId)?.name ?? "the calendar"}`);
    setImportOpen(false);
    setPreview(null);
    setPasteText("");
    setTargetCalendarId("new");
    setNewCalendarName("");
    invalidateAll();
  }

  function closeImport() {
    setImportOpen(false);
    setPreview(null);
    setPasteText("");
    setTargetCalendarId("new");
    setNewCalendarName("");
  }

  // ── Assign / event selection ────────────────────────────────────────────
  // One optimistic-feeling upsert per athlete-row change, same "instant
  // apply, no separate save step" pattern as the access toggle on Race
  // Events — there's no batch of changes building up here worth a
  // confirm step.
  async function setAthleteSelection(entry: RaceScheduleEntry, athleteId: string, existing: Selection | undefined, selectedEvent: string | null) {
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

    // Sync the planned session on the athlete's calendar — only once an
    // event is actually known, since there's nothing meaningful to title
    // a session with before that. Location carries over too — a linked
    // saved location (with real coordinates) if the race has one, else
    // whatever plain text location it has, else nothing.
    if (selectedEvent) {
      const distance = parseDistanceFromLabel(selectedEvent);
      const sessionLocationPatch = entry.location_id
        ? { location_id: entry.location_id, location: null }
        : { location_id: null, location: entry.location };
      const title = buildRaceSessionTitle(entry.name, selectedEvent);
      if (existing?.session_id) {
        // Notes deliberately NOT touched on an existing session — see
        // race-session-details.ts. Only the structured fields (title,
        // date, distance, location) stay in sync on re-pick; free-text
        // notes might already have something the athlete or coach wrote.
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

    toast.success(selectedEvent ? `Set to ${selectedEvent}` : "Assigned — event still to be picked");
    invalidateAll();
    qc.invalidateQueries({ queryKey: ["sessions-list"] });
  }

  async function removeSelection(sel: Selection) {
    if (sel.session_id) {
      // Only clean up the planned session if it's still just a plan —
      // never silently delete a session someone actually went and ran.
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

  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  if (!isCoach) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Race Schedule is a coach tool — see My Schedule for your own upcoming races.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
          <Flag className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Schedules</div>
          <h1 className="text-2xl font-bold leading-tight">Race Schedule</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {groups && groups.length > 0 && (
            <Select value={activeGroupId ?? ""} onValueChange={setSelectedGroupId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Training group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={!activeGroupId}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import calendar
          </Button>
          <Button size="sm" onClick={openAdd} disabled={!activeGroupId}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add race
          </Button>
        </div>
      </div>

      {activeGroupId && (myCalendars ?? []).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground shrink-0">Calendars here:</span>
          {appliedCalendars.length === 0 ? (
            <span className="text-muted-foreground">None yet</span>
          ) : (
            appliedCalendars.map((c) => (
              <Badge key={c.id} variant="outline" className="gap-1.5 pr-1">
                {c.name}
                <button
                  type="button"
                  onClick={() => removeCalendarFromGroup(c.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove from this group"
                >
                  ×
                </button>
              </Badge>
            ))
          )}
          {(myCalendars ?? []).filter((c) => !appliedCalendarIds?.includes(c.id)).length > 0 && (
            <Select value="" onValueChange={applyCalendarToGroup}>
              <SelectTrigger className="h-6 w-[150px] text-xs">
                <SelectValue placeholder="+ Apply a calendar" />
              </SelectTrigger>
              <SelectContent>
                {(myCalendars ?? [])
                  .filter((c) => !appliedCalendarIds?.includes(c.id))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {!groups || groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No training groups yet — create one on Training Schedule first, since a race schedule belongs to a group.
          </CardContent>
        </Card>
      ) : entriesLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries || entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm text-muted-foreground">No races on this group's schedule yet.</p>
            <p className="text-xs text-muted-foreground">
              Add one manually, or import a calendar (PDF, Word, Excel, or pasted text) to populate several at once.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const entrySelections = selectionsByEntry.get(entry.id) ?? [];
            const expanded = expandedEntryId === entry.id;
            return (
              <Card key={entry.id}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                      onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedEntryId(expanded ? null : entry.id);
                        }
                      }}
                    >
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
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 hover:text-foreground hover:underline"
                            >
                              <MapPin className="h-3 w-3" /> {entryLocationLabel(entry)}
                            </a>
                          )}
                          {entry.race_type && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{entry.race_type}</Badge>}
                          {entry.source === "parsed" && <Badge variant="outline" className="text-[10px] h-4 px-1.5">imported</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center -space-x-2 shrink-0">
                        {entrySelections.slice(0, 5).map((s) => (
                          <UserAvatar key={s.id} name={s.athletes?.name} imageUrl={s.athletes?.profile_image_url} size="xs" className="ring-2 ring-card" />
                        ))}
                        {entrySelections.length > 5 && (
                          <span className="text-[10px] text-muted-foreground pl-2">+{entrySelections.length - 5}</span>
                        )}
                      </div>
                      {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground shrink-0" onClick={() => deleteEntry(entry.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {expanded && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      {entry.events_offered.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                          <span className="font-medium">Events:</span>
                          {entry.events_offered.map((ev) => (
                            <Badge key={ev} variant="outline" className="text-[10px] h-4 px-1.5">{ev}</Badge>
                          ))}
                        </div>
                      )}
                      {(entry.entry_opens || entry.entry_closes || entry.entry_url) && (
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
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
                        </div>
                      )}
                      {membersSorted.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No athletes in this training group yet.</p>
                      ) : (
                        <div className="divide-y">
                          {membersSorted.map((m) => {
                            const sel = entrySelections.find((s) => s.athlete_id === m.athlete_id);
                            const entryStatus = sel ? entryStatusBySelection.get(sel.id) : undefined;
                            return (
                              <div key={m.athlete_id} className="flex items-center gap-2 py-2">
                                <UserAvatar name={m.athletes?.name} imageUrl={m.athletes?.profile_image_url} size="xs" />
                                <span className="text-sm flex-1 min-w-0 truncate">{m.athletes?.name ?? "Athlete"}</span>
                                {sel && (
                                  <Badge
                                    variant={entryStatus ? "default" : "outline"}
                                    className="text-[10px] h-4 px-1.5 shrink-0"
                                    title="Whether this athlete has registered — self-reported from their Event Entries"
                                  >
                                    {entryStatus ? ENTRY_STATUS_LABEL[entryStatus] ?? entryStatus : "Not entered"}
                                  </Badge>
                                )}
                                <Select
                                  value={sel?.selected_event ?? (sel ? "unset" : "none")}
                                  onValueChange={(v) => {
                                    if (v === "none") {
                                      if (sel) removeSelection(sel);
                                    } else {
                                      setAthleteSelection(entry, m.athlete_id, sel, v === "unset" ? null : v);
                                    }
                                  }}
                                >
                                  <SelectTrigger className="w-[180px] h-8 text-xs">
                                    <SelectValue placeholder="Not assigned" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Not assigned</SelectItem>
                                    <SelectItem value="unset">Assigned — event TBD</SelectItem>
                                    {entry.events_offered.map((ev) => (
                                      <SelectItem key={ev} value={ev}>
                                        {ev}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add race (manual) ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a race to the schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AVSL Round 4" />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (entryRuleId !== "none") recomputeEntryWindow(entryRuleId, e.target.value);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Location (optional)</Label>
              <LocationPicker
                locationId={locationId}
                locationText={location}
                onChange={(patch) => {
                  setLocationId(patch.locationId);
                  setLocation(patch.locationText);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Surface</Label>
              <Select value={raceType} onValueChange={setRaceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="track">Track</SelectItem>
                  <SelectItem value="road">Road</SelectItem>
                  <SelectItem value="cross_country">Cross country</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Events offered (comma-separated)</Label>
              <Input value={eventsText} onChange={(e) => setEventsText(e.target.value)} placeholder="800m, 1500m, 3000m" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Entry rule (optional)</Label>
                <button type="button" onClick={() => setRulesManagerOpen(true)} className="text-[10px] text-muted-foreground hover:text-foreground underline">
                  Manage rules
                </button>
              </div>
              <Select
                value={entryRuleId}
                onValueChange={(v) => {
                  setEntryRuleId(v);
                  if (v !== "none") recomputeEntryWindow(v, date);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None — set dates manually" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — set dates manually</SelectItem>
                  {(entryRules ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Fills in the dates below from the rule — still fully editable after, for a one-off exception.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Entries open (optional)</Label>
                <Input type="datetime-local" value={entryOpens} onChange={(e) => setEntryOpens(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Entries close (optional)</Label>
                <Input type="datetime-local" value={entryCloses} onChange={(e) => setEntryCloses(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Link to enter (optional)</Label>
              <Input value={entryUrl} onChange={(e) => setEntryUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveManual} disabled={savingManual}>
              {savingManual ? "Adding…" : "Add race"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Entry rules manager ── */}
      <Dialog open={rulesManagerOpen} onOpenChange={setRulesManagerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entry deadline rules</DialogTitle>
            <DialogDescription>
              A recurring pattern like "closes the Wednesday before, 12 noon" — pick one when adding a race instead of
              working out the dates by hand each time.
            </DialogDescription>
          </DialogHeader>

          {(entryRules ?? []).length > 0 && (
            <div className="space-y-1.5 border rounded-md p-2">
              {(entryRules ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs py-1">
                  <div>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — closes {WEEKDAY_NAMES[r.closes_weekday]} {r.closes_time.slice(0, 5)}
                      {r.opens_weekday != null && `, opens ${WEEKDAY_NAMES[r.opens_weekday]} ${r.opens_time?.slice(0, 5)} (~${r.opens_min_days_before}d before)`}
                    </span>
                  </div>
                  <button type="button" onClick={() => deleteRule(r.id)} className="text-muted-foreground hover:text-destructive shrink-0 ml-2">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Quick fill</Label>
              <div className="flex gap-1.5 flex-wrap mt-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fillRulePreset("xcr_individual")}>
                  AV XCR Individual
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fillRulePreset("xcr_relay")}>
                  AV XCR Relay
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fillRulePreset("avsl")}>
                  AVSL Zone Priority
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. AV XCR Individual" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Closes on</Label>
                <Select value={ruleClosesWeekday} onValueChange={setRuleClosesWeekday}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_NAMES.map((w, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">At</Label>
                <Input type="time" value={ruleClosesTime} onChange={(e) => setRuleClosesTime(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Always resolves to the closest {WEEKDAY_NAMES[Number(ruleClosesWeekday)]} strictly before race day.
            </p>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={ruleHasOpens} onChange={(e) => setRuleHasOpens(e.target.checked)} />
              This series also has an entries-open date
            </label>

            {ruleHasOpens && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Opens on</Label>
                    <Select value={ruleOpensWeekday} onValueChange={setRuleOpensWeekday}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_NAMES.map((w, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">At</Label>
                    <Input type="time" value={ruleOpensTime} onChange={(e) => setRuleOpensTime(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">At least this many days before race day</Label>
                  <Input type="number" min={0} value={ruleOpensMinDaysBefore} onChange={(e) => setRuleOpensMinDaysBefore(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRulesManagerOpen(false)}>
              Done
            </Button>
            <Button onClick={saveRule} disabled={savingRule}>
              {savingRule ? "Saving…" : "Save rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import calendar ── */}
      <Dialog open={importOpen} onOpenChange={(open) => !open && closeImport()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import a race calendar</DialogTitle>
            <DialogDescription>
              Upload a PDF, Word, or Excel fixture list — or paste the text directly. Review what comes out before anything's saved.
            </DialogDescription>
          </DialogHeader>

          {!preview ? (
            <>
              <div>
                <Label className="text-xs">Import into</Label>
                <Select value={targetCalendarId} onValueChange={setTargetCalendarId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New calendar…</SelectItem>
                    {(myCalendars ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.season ? ` (${c.season})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targetCalendarId === "new" ? (
                  <Input
                    value={newCalendarName}
                    onChange={(e) => setNewCalendarName(e.target.value)}
                    placeholder="e.g. 2026 XCR Calendar"
                    className="mt-1.5"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Adds alongside whatever's already in this calendar — good for a re-published or updated version of
                    the same document.
                  </p>
                )}
              </div>
              <Tabs value={importTab} onValueChange={(v) => setImportTab(v as "upload" | "paste")}>
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="upload">Upload file</TabsTrigger>
                <TabsTrigger value="paste">Paste text</TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFilePicked}
                  disabled={extracting}
                  className="hidden"
                />
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={extracting}>
                  {extracting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Reading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5 mr-1.5" /> Choose file
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Scanned PDFs (photos of a page, no real text underneath) won't extract — paste the text instead if that's what you've
                  got.
                </p>
              </TabsContent>
              <TabsContent value="paste" className="mt-3 space-y-2">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={10}
                  placeholder="Paste the fixture list text here…"
                />
                <Button size="sm" onClick={() => runExtraction(pasteText)} disabled={extracting || !pasteText.trim()}>
                  {extracting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Reading…
                    </>
                  ) : (
                    "Extract races"
                  )}
                </Button>
              </TabsContent>
            </Tabs>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {preview.length} race{preview.length === 1 ? "" : "s"} found — check these over before importing, especially any dates.
              </p>
              <div className="max-h-[50vh] overflow-y-auto space-y-2 brand-scrollbar">
                {preview.map((row, i) => (
                  <div key={i} className="border rounded-md p-2.5 grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <Input
                        value={row.name}
                        onChange={(e) => updatePreviewRow(i, { name: e.target.value })}
                        className="h-8 text-sm font-medium"
                      />
                    </div>
                    <Input
                      type="date"
                      value={row.event_date ?? ""}
                      onChange={(e) => updatePreviewRow(i, { event_date: e.target.value || null })}
                      className={`h-8 text-xs ${!row.event_date ? "border-destructive" : ""}`}
                    />
                    <div className="col-span-2">
                      <LocationPicker
                        locationId={row.location_id}
                        locationText={row.location ?? ""}
                        onChange={(patch) => updatePreviewRow(i, { location_id: patch.locationId, location: patch.locationText || null })}
                        compact
                      />
                    </div>
                    <Input
                      value={row.events_offered.join(", ")}
                      onChange={(e) => updatePreviewRow(i, { events_offered: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      placeholder="Events (comma-separated)"
                      className="h-8 text-xs col-span-2"
                    />
                    <div className="col-span-2 flex justify-end">
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground" onClick={() => removePreviewRow(i)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeImport}>
              Cancel
            </Button>
            {preview && (
              <Button onClick={commitImport} disabled={importing || preview.length === 0}>
                {importing ? "Importing…" : `Import ${preview.length} race${preview.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 
