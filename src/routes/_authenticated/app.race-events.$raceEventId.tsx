import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/user-avatar";
import { MultiRouteFlyoverMap, type AthleteTrack } from "@/components/multi-route-flyover-map";
import { Users, MapPin, CalendarDays, Pencil, Trash2, Link2Off, Route as RouteIcon, Medal, ChevronLeft, Video, UserPlus, Link2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { secToClock, paceFmt, metersFmt, clockToSec, todayISO } from "@/lib/format";
import { useMyRoles, useCoachRoster } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/race-events/$raceEventId")({
  component: RaceEventDetailPage,
});

// Identity colors for the group flyover map + legend — cycles if there are
// more linked athletes than colors. Deliberately separate from the HR-zone
// color palette used elsewhere (ZONE_COLORS): this is about telling
// athletes apart from each other, not encoding intensity.
const TRACK_PALETTE = ["#FF004C", "#00B8D9", "#FFAB00", "#36B37E", "#6554C0", "#FF5630", "#00875A", "#8993A4"];

type LinkedPerformance = {
  id: string;
  athlete_id: string;
  performance_date: string;
  distance_m: number;
  time_seconds: number;
  overall_place: number | null;
  field_size: number | null;
  is_pb: boolean | null;
  session_id: string | null;
  race_event_access: boolean | null;
  athletes: { name: string | null; profile_image_url: string | null } | null;
};

function RaceEventDetailPage() {
  const { raceEventId } = Route.useParams();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: roster = [] } = useCoachRoster();
  const qc = useQueryClient();

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["race-event", raceEventId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("race_events").select("*").eq("id", raceEventId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ["race-event-results", raceEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, athlete_id, performance_date, distance_m, time_seconds, overall_place, field_size, is_pb, session_id, race_event_access, athletes(name, profile_image_url)")
        .eq("race_event_id", raceEventId)
        .order("time_seconds", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LinkedPerformance[];
    },
  });

  // Distances varying across linked results is unusual (an event is
  // nominally one distance) but not impossible — e.g. a wheelchair or
  // junior race timed alongside the main field. Flagging it rather than
  // silently ranking apples against oranges by finish time alone.
  const distancesVary = useMemo(() => {
    const distinct = new Set((results ?? []).map((r) => r.distance_m));
    return distinct.size > 1;
  }, [results]);

  const withGps = useMemo(() => (results ?? []).filter((r) => r.session_id), [results]);

  // Gated behind a toggle rather than fetched automatically — this is
  // several athletes' full GPS traces at once (each already paginated
  // individually), no reason to pull all of it before the coach actually
  // asks to see the group flyover.
  const [showFlyover, setShowFlyover] = useState(false);
  const { data: tracks, isLoading: tracksLoading } = useQuery({
    queryKey: ["race-event-tracks", raceEventId, withGps.map((r) => r.session_id).join(",")],
    enabled: showFlyover && withGps.length >= 2,
    queryFn: async () => {
      const built: AthleteTrack[] = [];
      await Promise.all(
        withGps.map(async (r, i) => {
          // Same pagination + elapsed/distance rebasing as the single-
          // athlete Race Analysis page (app.races.$raceId.analysis.tsx) —
          // required here for a different reason: every athlete's clock
          // needs to actually start at 0 for the "synced by elapsed time"
          // group flyover to line them up correctly. Without rebasing, a
          // session with e.g. a warm-up recorded before the race work
          // segment would carry that warm-up's duration as an offset, and
          // that athlete would appear to start the race late (or early)
          // relative to everyone else for no real reason.
          const PAGE_SIZE = 1000;
          const all: any[] = [];
          let from = 0;
          while (true) {
            const { data, error } = await supabase
              .from("raw_session_points")
              .select("elapsed_s, distance_m, lat, lng, hr")
              .eq("session_id", r.session_id as string)
              .eq("segment_type", "work")
              .order("elapsed_s")
              .range(from, from + PAGE_SIZE - 1);
            if (error || !data || data.length === 0) break;
            all.push(...data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
          }
          if (all.length === 0) return;
          const baseElapsed = Number(all[0].elapsed_s ?? 0);
          const baseDistance = Number(all[0].distance_m ?? 0);
          built.push({
            id: r.id,
            name: r.athletes?.name ?? "Athlete",
            color: TRACK_PALETTE[i % TRACK_PALETTE.length],
            avatarUrl: r.athletes?.profile_image_url ?? null,
            points: all.map((p) => ({
              lat: Number(p.lat),
              lng: Number(p.lng),
              elapsed_s: Number(p.elapsed_s ?? 0) - baseElapsed,
              distance_m: p.distance_m != null ? Number(p.distance_m) - baseDistance : undefined,
              hr: p.hr ?? null,
            })),
          });
        }),
      );
      return built;
    },
  });

  const trackColorByPerfId = useMemo(() => {
    const map = new Map<string, string>();
    withGps.forEach((r, i) => map.set(r.id, TRACK_PALETTE[i % TRACK_PALETTE.length]));
    return map;
  }, [withGps]);

  const rosterSorted = useMemo(
    () => [...roster].sort((a: any, b: any) => (a.athletes?.name ?? "").localeCompare(b.athletes?.name ?? "")),
    [roster],
  );

  async function toggleAccess(performanceId: string, next: boolean) {
    const { error } = await supabase.from("performances").update({ race_event_access: next }).eq("id", performanceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["race-event-results", raceEventId] });
  }

  // ── Add athlete to this event ──────────────────────────────────────────
  // Pick an athlete, then either link one of their existing results to
  // this event or log a brand new one straight into it — no detour to
  // that athlete's own Races page required either way. The access toggle
  // here is the coach-controlled opt-in for that athlete to actually see
  // this event (and the group flyover) in their own account afterward —
  // off by default, since linking a result shouldn't silently expose
  // other athletes' results to them.
  const [addOpen, setAddOpen] = useState(false);
  const [addAthleteId, setAddAthleteId] = useState<string>("");
  const [addTab, setAddTab] = useState<"link" | "new">("link");
  const [addGrantAccess, setAddGrantAccess] = useState(true);

  const { data: athletePerformances, isLoading: athletePerfLoading } = useQuery({
    queryKey: ["athlete-performances-for-link", addAthleteId],
    enabled: addOpen && addTab === "link" && !!addAthleteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performances")
        .select("id, performance_date, event_name, distance_m, time_seconds, race_event_id")
        .eq("athlete_id", addAthleteId)
        .order("performance_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function linkExisting(performanceId: string) {
    const { error } = await supabase
      .from("performances")
      .update({ race_event_id: raceEventId, race_event_access: addGrantAccess })
      .eq("id", performanceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Result linked to this event");
    qc.invalidateQueries({ queryKey: ["race-event-results", raceEventId] });
    qc.invalidateQueries({ queryKey: ["athlete-performances-for-link", addAthleteId] });
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
  }

  const [newDate, setNewDate] = useState("");
  const [newDistance, setNewDistance] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newPlacing, setNewPlacing] = useState("");
  const [addingNew, setAddingNew] = useState(false);

  function openAdd() {
    setAddAthleteId("");
    setAddTab("link");
    setAddGrantAccess(true);
    setNewDate(event?.event_date ?? todayISO());
    setNewDistance(event?.distance_m != null ? String(event.distance_m) : "");
    setNewTime("");
    setNewPlacing("");
    setAddOpen(true);
  }

  async function addNewResult() {
    if (!addAthleteId) {
      toast.error("Pick an athlete first");
      return;
    }
    const sec = clockToSec(newTime);
    if (sec == null || isNaN(sec)) {
      toast.error("Time required (mm:ss or h:mm:ss)");
      return;
    }
    const dist = Number(newDistance);
    if (!dist || isNaN(dist) || dist <= 0) {
      toast.error("Enter a valid distance in meters");
      return;
    }
    setAddingNew(true);
    const { error } = await supabase.from("performances").insert({
      athlete_id: addAthleteId,
      performance_date: newDate,
      distance_m: dist,
      time_seconds: sec,
      event_name: event?.name ?? null,
      race_type: event?.race_type ?? null,
      overall_place: newPlacing ? Number(newPlacing) : null,
      race_event_id: raceEventId,
      race_event_access: addGrantAccess,
      context: "race",
    });
    setAddingNew(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Result added and linked");
    qc.invalidateQueries({ queryKey: ["race-event-results", raceEventId] });
    qc.invalidateQueries({ queryKey: ["races", addAthleteId] });
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
    // Ready for the next athlete straight away — adding several athletes
    // from the same race in a row is the whole point of this dialog.
    setAddAthleteId("");
    setNewTime("");
    setNewPlacing("");
  }

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [distance, setDistance] = useState("");
  const [location, setLocation] = useState("");
  const [raceType, setRaceType] = useState("road");
  const [saving, setSaving] = useState(false);

  function openEdit() {
    if (!event) return;
    setName(event.name ?? "");
    setDate(event.event_date ?? "");
    setDistance(event.distance_m != null ? String(event.distance_m) : "");
    setLocation(event.location ?? "");
    setRaceType(event.race_type ?? "road");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!name.trim()) {
      toast.error("Name the event first");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("race_events")
      .update({
        name: name.trim(),
        event_date: date || null,
        distance_m: distance ? Number(distance) : null,
        location: location.trim() || null,
        race_type: raceType || null,
      })
      .eq("id", raceEventId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Event updated");
    setEditOpen(false);
    qc.invalidateQueries({ queryKey: ["race-event", raceEventId] });
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
  }

  async function unlink(performanceId: string) {
    const { error } = await supabase.from("performances").update({ race_event_id: null }).eq("id", performanceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Unlinked from this event");
    qc.invalidateQueries({ queryKey: ["race-event-results", raceEventId] });
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  async function deleteEvent() {
    const { error } = await (supabase as any).from("race_events").delete().eq("id", raceEventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Race event deleted");
    window.location.href = "/app/race-events";
  }

  if (eventLoading) {
    return (
      <AppShell fullWidth>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!event) {
    return (
      <AppShell fullWidth>
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground">Race event not found, or you don't have access to it.</p>
          <Link to="/app/race-events" className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">
            ← Back to Race Events
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-4xl">
        <div>
          <Link to="/app/race-events" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" /> Race Events
          </Link>
          <div className="flex items-start justify-between gap-3 mt-1 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
                <Users className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Performances</div>
                <h1 className="text-2xl font-bold leading-tight">{event.name}</h1>
              </div>
            </div>
            {isCoach && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={openAdd}>
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add athlete
                </Button>
                <Button size="sm" variant="outline" onClick={openEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2 flex-wrap">
            {event.event_date && (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> {event.event_date}
              </span>
            )}
            {event.distance_m != null && <span>{metersFmt(event.distance_m)}</span>}
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {event.location}
              </span>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Results</CardTitle>
            <CardDescription>Every result linked to this event, fastest first.</CardDescription>
            {isCoach && results && results.length > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Eye className="h-3 w-3" /> next to a result means that athlete can see this whole event and the group flyover in their own account.
              </p>
            )}
          </CardHeader>
          <CardContent>
            {distancesVary && (
              <div className="text-xs text-amber-600 bg-amber-500/10 rounded-md p-2 mb-3">
                Linked results here aren't all the same distance — ranked by finish time regardless, so treat the
                order with that in mind.
              </div>
            )}
            {resultsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !results || results.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">No results linked yet.</p>
                {isCoach && (
                  <Button size="sm" onClick={openAdd}>
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add athlete
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {results.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 py-3">
                    <div className="w-6 text-center text-sm font-bold text-muted-foreground shrink-0">{i + 1}</div>
                    <div className="relative shrink-0">
                      <UserAvatar name={r.athletes?.name} imageUrl={r.athletes?.profile_image_url} size="sm" />
                      {trackColorByPerfId.has(r.id) && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card"
                          style={{ background: trackColorByPerfId.get(r.id) }}
                          title="This athlete's color in the group flyover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-1.5">
                        {r.athletes?.name ?? "Athlete"}
                        {r.is_pb && (
                          <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 font-normal gap-1 h-5">
                            <Medal className="h-3 w-3" /> PB
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {metersFmt(r.distance_m)}
                        {r.overall_place != null && (
                          <> · {r.overall_place}{r.field_size ? ` / ${r.field_size}` : ""} place</>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display text-lg font-extrabold tabular-nums">{secToClock(r.time_seconds)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {paceFmt(r.time_seconds / (r.distance_m / 1000))}/km
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.session_id && (
                        <Button asChild size="sm" variant="ghost" className="h-8 px-2" title="View this athlete's GPS analysis">
                          <Link to="/app/races/$raceId/analysis" params={{ raceId: r.id }}>
                            <RouteIcon className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                      {isCoach && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-8 px-2 ${r.race_event_access ? "text-[var(--accent-red)]" : "text-muted-foreground"}`}
                          title={r.race_event_access ? "This athlete can see this event — click to revoke" : "This athlete can't see this event — click to grant access"}
                          onClick={() => toggleAccess(r.id, !r.race_event_access)}
                        >
                          {r.race_event_access ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      {isCoach && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-muted-foreground"
                          title="Unlink from this event"
                          onClick={() => unlink(r.id)}
                        >
                          <Link2Off className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {withGps.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="h-4 w-4 text-[var(--accent-red)]" /> Group flyover
              </CardTitle>
              <CardDescription>
                All {withGps.length} athletes with GPS data for this event, flown together on the same map, synced
                by elapsed time (everyone's clock starts together, not by real time of day).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showFlyover ? (
                <Button variant="outline" onClick={() => setShowFlyover(true)}>
                  <Video className="h-3.5 w-3.5 mr-1.5" /> Load group flyover
                </Button>
              ) : tracksLoading ? (
                <p className="text-sm text-muted-foreground">Loading GPS traces for {withGps.length} athletes…</p>
              ) : !tracks || tracks.length < 2 ? (
                <p className="text-sm text-muted-foreground">
                  Couldn't load enough GPS data to build a group flyover for this event.
                </p>
              ) : (
                <MultiRouteFlyoverMap tracks={tracks} heightPx={480} />
              )}
            </CardContent>
          </Card>
        )}

        {withGps.length > 0 && withGps.length < 2 && (
          <p className="text-xs text-muted-foreground">
            Only one linked result has GPS data — link at least one more with GPS data to unlock the group flyover.
            Use the route icon next to a result to open that athlete's own GPS analysis in the meantime.
          </p>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add athlete to {event.name}</DialogTitle>
            <DialogDescription>Pick an athlete, then either link one of their existing results or log a new one — both attach straight to this event.</DialogDescription>
          </DialogHeader>

          <div>
            <Label className="text-xs">Athlete</Label>
            <Select value={addAthleteId} onValueChange={setAddAthleteId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an athlete…" />
              </SelectTrigger>
              <SelectContent>
                {rosterSorted.map((r: any) => (
                  <SelectItem key={r.athlete_id} value={r.athlete_id}>
                    {r.athletes?.name ?? "Athlete"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label className="text-xs">Give this athlete access to the event</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lets them see this whole event (every linked athlete's result, and the group flyover) under Race
                Events in their own account — not just their own result in isolation.
              </p>
            </div>
            <Switch checked={addGrantAccess} onCheckedChange={setAddGrantAccess} className="shrink-0 ml-3" />
          </div>

          {addAthleteId && (
            <Tabs value={addTab} onValueChange={(v) => setAddTab(v as "link" | "new")}>
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="link">
                  <Link2 className="h-3.5 w-3.5 mr-1.5" /> Link existing result
                </TabsTrigger>
                <TabsTrigger value="new">
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Log a new result
                </TabsTrigger>
              </TabsList>

              <TabsContent value="link" className="space-y-2 mt-3">
                {athletePerfLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Loading their results…</p>
                ) : !athletePerformances || athletePerformances.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No results logged for this athlete yet — use "Log a new result" instead.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y border rounded-md brand-scrollbar">
                    {athletePerformances.map((p: any) => {
                      const alreadyHere = p.race_event_id === raceEventId;
                      const linkedElsewhere = p.race_event_id && !alreadyHere;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={alreadyHere}
                          onClick={() => linkExisting(p.id)}
                          className="w-full text-left px-3 py-2 hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {p.event_name || metersFmt(p.distance_m)} — {secToClock(p.time_seconds)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {p.performance_date} · {metersFmt(p.distance_m)}
                              {alreadyHere && " · Already linked here"}
                              {linkedElsewhere && " · Linked to a different event"}
                            </div>
                          </div>
                          {!alreadyHere && <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="new" className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Distance (m)</Label>
                    <Input type="number" value={newDistance} onChange={(e) => setNewDistance(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Time</Label>
                    <Input placeholder="16:32" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Placing (optional)</Label>
                    <Input type="number" value={newPlacing} onChange={(e) => setNewPlacing(e.target.value)} />
                  </div>
                </div>
                <Button onClick={addNewResult} disabled={addingNew} className="w-full">
                  {addingNew ? "Adding…" : "Add and link to this event"}
                </Button>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit race event</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Nominal distance (m)</Label>
              <Input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} />
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
              <Label className="text-xs">Location (optional)</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this race event?</DialogTitle>
            <DialogDescription>
              {results && results.length > 0
                ? `This unlinks all ${results.length} result${results.length === 1 ? "" : "s"} currently attached to it (the results themselves aren't deleted) and removes the event.`
                : "This event has no linked results — deleting it is safe."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteEvent}>
              Delete event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
