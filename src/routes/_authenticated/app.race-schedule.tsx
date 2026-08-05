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
import { CalendarDays, MapPin, Plus, Upload, Trash2, Pencil, ChevronDown, ChevronUp, Loader2, Flag } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/format";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
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

type RaceScheduleEntry = {
  id: string;
  training_group_id: string;
  name: string;
  event_date: string;
  location: string | null;
  race_type: string | null;
  events_offered: string[];
  source: string;
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

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ["race-schedule-entries", activeGroupId],
    enabled: !!activeGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("race_schedule_entries")
        .select("*")
        .eq("training_group_id", activeGroupId)
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RaceScheduleEntry[];
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

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["race-schedule-entries", activeGroupId] });
    qc.invalidateQueries({ queryKey: ["race-schedule-selections"] });
  }

  // ── Manual add ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [raceType, setRaceType] = useState("track");
  const [eventsText, setEventsText] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  function openAdd() {
    setName("");
    setDate(todayISO());
    setLocation("");
    setRaceType("track");
    setEventsText("");
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
      location: location.trim() || null,
      race_type: raceType || null,
      events_offered: eventsText.split(",").map((s) => s.trim()).filter(Boolean),
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
  const [preview, setPreview] = useState<ParsedRaceScheduleEntry[] | null>(null);
  const parseText = useServerFn(parseRaceScheduleText);

  async function runExtraction(text: string) {
    if (!text.trim()) {
      toast.error("Nothing to extract from");
      return;
    }
    setExtracting(true);
    try {
      const result = await parseText({ data: { text } });
      if (result.length === 0) {
        toast.error("Couldn't find any races in that document");
      } else {
        setPreview(result);
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

  function updatePreviewRow(i: number, patch: Partial<ParsedRaceScheduleEntry>) {
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
    const { error } = await (supabase as any).from("race_schedule_entries").insert(
      preview.map((r) => ({
        training_group_id: activeGroupId,
        name: r.name,
        event_date: r.event_date,
        location: r.location,
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
    toast.success(`Imported ${preview.length} race${preview.length === 1 ? "" : "s"}`);
    setImportOpen(false);
    setPreview(null);
    setPasteText("");
    invalidateAll();
  }

  function closeImport() {
    setImportOpen(false);
    setPreview(null);
    setPasteText("");
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
    // a session with before that.
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
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
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
                          {entry.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {entry.location}
                            </span>
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
                    </button>
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
                      {membersSorted.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No athletes in this training group yet.</p>
                      ) : (
                        <div className="divide-y">
                          {membersSorted.map((m) => {
                            const sel = entrySelections.find((s) => s.athlete_id === m.athlete_id);
                            return (
                              <div key={m.athlete_id} className="flex items-center gap-2 py-2">
                                <UserAvatar name={m.athletes?.name} imageUrl={m.athletes?.profile_image_url} size="xs" />
                                <span className="text-sm flex-1 min-w-0 truncate">{m.athletes?.name ?? "Athlete"}</span>
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
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Location (optional)</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
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
                    <Input
                      value={row.location ?? ""}
                      onChange={(e) => updatePreviewRow(i, { location: e.target.value || null })}
                      placeholder="Location"
                      className="h-8 text-xs"
                    />
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
