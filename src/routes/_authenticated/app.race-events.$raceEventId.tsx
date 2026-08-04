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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { Users, MapPin, CalendarDays, Pencil, Trash2, Link2Off, Route as RouteIcon, Medal, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { secToClock, paceFmt, metersFmt } from "@/lib/format";
import { useMyRoles } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/race-events/$raceEventId")({
  component: RaceEventDetailPage,
});

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
  athletes: { name: string | null; profile_image_url: string | null } | null;
};

function RaceEventDetailPage() {
  const { raceEventId } = Route.useParams();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
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
        .select("id, athlete_id, performance_date, distance_m, time_seconds, overall_place, field_size, is_pb, session_id, athletes(name, profile_image_url)")
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
            <CardDescription>
              Every result you've linked to this event, fastest first. Link a result from that athlete's edit-result
              dialog on the Races page.
            </CardDescription>
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
              <p className="text-sm text-muted-foreground py-6 text-center">
                No results linked yet. Open a result on the Races page, edit it, and pick this event under "Race
                event."
              </p>
            ) : (
              <div className="divide-y">
                {results.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 py-3">
                    <div className="w-6 text-center text-sm font-bold text-muted-foreground shrink-0">{i + 1}</div>
                    <UserAvatar name={r.athletes?.name} imageUrl={r.athletes?.profile_image_url} size="sm" />
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

        <p className="text-xs text-muted-foreground">
          A side-by-side GPS replay (all athletes on the same map, together) is coming in a follow-up — for now, use
          the route icon next to a result to open that athlete's own GPS analysis.
        </p>
      </div>

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
