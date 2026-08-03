import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { MapPinned } from "lucide-react";
import { toast } from "sonner";

type RoutePoint = { lat?: number; lng?: number; elev?: number };

function elevationGainM(points: RoutePoint[]): number | null {
  const withElev = points.filter((p) => p.elev != null && Number.isFinite(Number(p.elev)));
  if (withElev.length < 2) return null;
  let gain = 0;
  for (let i = 1; i < withElev.length; i++) {
    const delta = Number(withElev[i].elev) - Number(withElev[i - 1].elev);
    if (delta > 0) gain += delta;
  }
  return Math.round(gain);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Straight-line-summed distance across the trace — same haversine
// approach used elsewhere on Session Analysis for point-to-point
// distance, not a re-derivation of the session's own recorded distance
// (which may include treadmill/indoor segments this saved route
// shouldn't count).
function routeDistanceM(points: RoutePoint[]): number | null {
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(
      Number(points[i - 1].lat),
      Number(points[i - 1].lng),
      Number(points[i].lat),
      Number(points[i].lng),
    );
  }
  return Math.round(total);
}

// Saves the currently-displayed GPS trace as a reusable route/location in
// the Maps & Routes library — this is the one add path into that library
// for now (the library itself is a plain list, no draw-on-map or GPX
// import yet). Deliberately a compact [[lat,lng], ...] path, not the
// session's full per-point detail — this is "where did we run," not a
// second copy of Session Analysis's own replay data.
export function SaveRouteDialog({
  points,
  sessionId,
  athleteId,
  defaultName,
}: {
  points: RoutePoint[];
  sessionId: string;
  athleteId?: string | null;
  defaultName?: string;
}) {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  // Free text was the only option before — now a route can instead link
  // to a saved location (see the "Manage locations" dialog on Maps &
  // Routes), so the same location can have several routes grouped
  // under it there. Defaults to custom text since that's zero-friction
  // for a one-off route; switching to "saved" is opt-in.
  const [locationMode, setLocationMode] = useState<"custom" | "saved">("custom");
  const [locationName, setLocationName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ["maps-locations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_locations").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const validPoints = points.filter(
    (p) => p.lat != null && p.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)),
  );
  const first = validPoints[0];
  const distanceM = routeDistanceM(validPoints);
  const elevGain = elevationGainM(validPoints);

  async function save() {
    if (!user) return;
    if (!name.trim()) {
      toast.error("Give the route a name");
      return;
    }
    if (validPoints.length < 2 || !first) {
      toast.error("No GPS trace to save");
      return;
    }
    setSaving(true);
    const chosenLocation = locationMode === "saved" ? locations.find((l: any) => l.id === locationId) : null;
    const { error } = await supabase.from("training_routes" as any).insert({
      created_by: user.id,
      athlete_id: athleteId ?? null,
      source_session_id: sessionId,
      name: name.trim(),
      location_id: chosenLocation?.id ?? null,
      location_name: locationMode === "saved" ? chosenLocation?.name ?? null : locationName.trim() || null,
      distance_m: distanceM,
      elevation_gain_m: elevGain,
      start_lat: Number(first.lat),
      start_lng: Number(first.lng),
      path: validPoints.map((p) => [Number(p.lat), Number(p.lng)]),
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Route saved to Maps & Routes");
    qc.invalidateQueries({ queryKey: ["training-routes"] });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MapPinned className="h-4 w-4 mr-1.5" /> Save as Route
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this route</DialogTitle>
          <DialogDescription>
            Adds this session's GPS trace to the Maps & Routes library so it can be found and reused later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Route name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside 10K Loop" />
          </div>
          <div>
            <Label className="text-xs">Location / venue (optional)</Label>
            {locations.length > 0 ? (
              <Select value={locationMode} onValueChange={(v) => setLocationMode(v as "custom" | "saved")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Type a location</SelectItem>
                  <SelectItem value="saved">Pick a saved location</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {locationMode === "saved" && locations.length > 0 ? (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Pick a location…" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Hyde Park, London"
                className="mt-2"
              />
            )}
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{distanceM != null ? `${(distanceM / 1000).toFixed(2)} km` : "Distance unavailable"}</span>
            {elevGain != null && <span>{elevGain}m elevation gain</span>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save route"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
