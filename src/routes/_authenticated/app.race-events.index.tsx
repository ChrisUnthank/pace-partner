import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, Plus, MapPin, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { metersFmt, todayISO } from "@/lib/format";
import { useMyRoles } from "@/lib/use-auth";

export const Route = createFileRoute("/_authenticated/app/race-events/")({
  component: RaceEventsPage,
});

type RaceEventRow = {
  id: string;
  name: string;
  event_date: string | null;
  distance_m: number | null;
  location: string | null;
  race_type: string | null;
  linked_count: number;
};

function RaceEventsPage() {
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const qc = useQueryClient();

  const { data: events, isLoading } = useQuery({
    queryKey: ["race-events-list"],
    queryFn: async () => {
      // Two-step rather than a single nested-count query — Supabase's
      // embedded-resource count syntax needs a foreign key PostgREST can
      // see reliably, and performances.race_event_id is nullable/opt-in,
      // so counting client-side over a plain select of both tables is the
      // more robust path here.
      const { data: eventRows, error: eventErr } = await (supabase as any)
        .from("race_events")
        .select("id, name, event_date, distance_m, location, race_type")
        .order("event_date", { ascending: false });
      if (eventErr) throw eventErr;

      const ids = (eventRows ?? []).map((e: any) => e.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: perfRows } = await (supabase as any)
          .from("performances")
          .select("race_event_id")
          .in("race_event_id", ids);
        for (const p of perfRows ?? []) {
          counts.set(p.race_event_id, (counts.get(p.race_event_id) ?? 0) + 1);
        }
      }
      return (eventRows ?? []).map((e: any) => ({ ...e, linked_count: counts.get(e.id) ?? 0 })) as RaceEventRow[];
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [distance, setDistance] = useState("5000");
  const [location, setLocation] = useState("");
  const [raceType, setRaceType] = useState("road");
  const [saving, setSaving] = useState(false);

  async function createEvent() {
    if (!name.trim()) {
      toast.error("Name the event first");
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as any)
      .from("race_events")
      .insert({
        name: name.trim(),
        event_date: date || null,
        distance_m: distance ? Number(distance) : null,
        location: location.trim() || null,
        race_type: raceType || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't create event");
      return;
    }
    toast.success("Race event created");
    setCreateOpen(false);
    setName("");
    setLocation("");
    qc.invalidateQueries({ queryKey: ["race-events-list"] });
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-lg grid place-items-center" style={{ background: "var(--accent-red)" }}>
            <Users className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Performances</div>
            <h1 className="text-2xl font-bold leading-tight">Race Events</h1>
          </div>
          {isCoach && (
            <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New event
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground -mt-3">
          When more than one of your athletes runs the same real race, link each of their results to a shared event
          here to see them side by side — instead of only ever viewing one athlete's result at a time.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !events || events.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No race events yet.</p>
              <p className="text-xs text-muted-foreground">
                Create one here, or link a result to a new event straight from that result's edit dialog on the
                Races page.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {events.map((e) => (
              <Link key={e.id} to="/app/race-events/$raceEventId" params={{ raceEventId: e.id }}>
                <Card className="hover:border-primary/50 transition-colors h-full">
                  <CardContent className="pt-5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm leading-tight">{e.name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Users className="h-3.5 w-3.5" />
                        {e.linked_count}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {e.event_date && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> {e.event_date}
                        </span>
                      )}
                      {e.distance_m != null && <span>{metersFmt(e.distance_m)}</span>}
                      {e.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {e.location}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New race event</DialogTitle>
            <DialogDescription>
              Link results to it afterward from each athlete's result on the Races page — or from here once it
              exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. London Champs 5000m" />
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
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Battersea Park" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createEvent} disabled={saving}>
              {saving ? "Creating…" : "Create event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
