import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, useMyRoles } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Map, Search, Trash2, MapPinned, Mountain, Pencil, MapPin, Plus, Settings2 } from "lucide-react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export const Route = createFileRoute("/_authenticated/app/maps")({
  component: MapsRoutesPage,
});

// Same tile source Session Analysis uses, kept simple here — no
// satellite/light toggle for v1, just one clean default street map.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

type TrainingRoute = {
  id: string;
  created_by: string;
  athlete_id: string | null;
  source_session_id: string | null;
  name: string;
  location_name: string | null;
  location_id: string | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  start_lat: number;
  start_lng: number;
  path: [number, number][];
  created_at: string;
};

type TrainingLocation = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  surface: string | null;
  altitude_m: number | null;
  notes: string | null;
};

function FitToPath({ path }: { path: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (path.length < 2) return;
    const lats = path.map((p) => p[0]);
    const lngs = path.map((p) => p[1]);
    map.fitBounds([
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return null;
}

function MapsRoutesPage() {
  const { user } = useAuthUser();
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingRoute, setEditingRoute] = useState<TrainingRoute | null>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);

  const { data: routes, isLoading } = useQuery({
    queryKey: ["training-routes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_routes" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrainingRoute[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["maps-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_locations")
        .select("id, name, address, lat, lng, surface, altitude_m, notes")
        .order("name");
      if (error) throw error;
      return (data ?? []) as TrainingLocation[];
    },
  });
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q
      ? routes ?? []
      : (routes ?? []).filter(
          (r) => r.name.toLowerCase().includes(q) || r.location_name?.toLowerCase().includes(q),
        );
    return list;
  }, [routes, search]);

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  // Groups the (already-filtered) list by location — this is the actual
  // answer to "a location can have several different routes": Deakin
  // Track's warm up loop and cool down loop both land in the same
  // "Deakin Track" group even though they're two separate saved routes,
  // and Rail Trail's several different distance/start-point variants
  // group the same way. Routes saved with only free-text (no saved
  // location picked) group by that text; routes with neither fall into
  // "No location".
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; routes: TrainingRoute[] }>();
    for (const r of filtered) {
      const key = r.location_id ? `loc:${r.location_id}` : r.location_name ? `text:${r.location_name}` : "none";
      const label = r.location_id ? locationById.get(r.location_id)?.name ?? "Unknown location" : r.location_name ?? "No location";
      if (!map.has(key)) map.set(key, { label, routes: [] });
      map.get(key)!.routes.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, locationById]);

  async function remove(id: string) {
    if (!confirm("Delete this route?")) return;
    const { error } = await supabase.from("training_routes" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Route deleted");
    qc.invalidateQueries({ queryKey: ["training-routes"] });
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
              style={{ background: "var(--accent-red)" }}
            >
              <Map className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Training</div>
              <h1 className="text-2xl font-bold leading-tight">Maps & Routes</h1>
              <p className="text-sm text-muted-foreground mt-1">
                A shared library of the routes and locations your squad actually runs — save one straight from a
                session's GPS trace on Session Analysis.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name or location…" className="pl-8 h-9" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setLocationsOpen(true)}>
              <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Manage locations
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !routes || routes.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <MapPinned className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No routes saved yet. Open a completed session with GPS data on Session Analysis and use{" "}
                <span className="font-medium text-foreground">Save as Route</span> to add one here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Routes</CardTitle>
                <CardDescription>{filtered.length} of {routes.length}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[600px] overflow-y-auto brand-scrollbar">
                  {filtered.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No routes match "{search}".</p>
                  ) : (
                    groups.map((g) => (
                      <div key={g.label} className="border-b last:border-b-0">
                        <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {g.label}
                        </div>
                        <div className="divide-y">
                          {g.routes.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setSelectedId(r.id)}
                              className={`w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors ${selected?.id === r.id ? "bg-accent/60" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm truncate">{r.name}</span>
                                {r.created_by === user?.id && (
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingRoute(r);
                                      }}
                                      className="text-muted-foreground hover:text-foreground"
                                      aria-label="Edit route"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </span>
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        remove(r.id);
                                      }}
                                      className="text-muted-foreground hover:text-destructive"
                                      aria-label="Delete route"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                                {r.distance_m != null && <span>{(r.distance_m / 1000).toFixed(2)} km</span>}
                                {r.elevation_gain_m != null && (
                                  <span className="flex items-center gap-0.5">
                                    <Mountain className="h-3 w-3" /> {Math.round(r.elevation_gain_m)}m
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{selected?.name ?? "Select a route"}</CardTitle>
                  {selected && (
                    <CardDescription>
                      {selected.location_name ? `${selected.location_name} · ` : ""}
                      {selected.distance_m != null ? `${(selected.distance_m / 1000).toFixed(2)} km` : "Distance unknown"}
                      {selected.elevation_gain_m != null ? ` · ${Math.round(selected.elevation_gain_m)}m elevation gain` : ""}
                      {selected.source_session_id && (
                        <>
                          {" · "}
                          <Link
                            to="/app/sessions/$sessionId/analysis"
                            params={{ sessionId: selected.source_session_id }}
                            className="underline hover:text-foreground"
                          >
                            View source session
                          </Link>
                        </>
                      )}
                    </CardDescription>
                  )}
                </div>
                {selected && selected.created_by === user?.id && (
                  <Button variant="outline" size="sm" onClick={() => setEditingRoute(selected)} className="shrink-0">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {selected ? (
                  <div className="h-[500px] rounded overflow-hidden border">
                    <MapContainer center={selected.path[0] ?? [selected.start_lat, selected.start_lng]} zoom={14} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
                      <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
                      <FitToPath path={selected.path} />
                      <Polyline positions={selected.path} pathOptions={{ color: "#ef4444", weight: 4 }} />
                      <CircleMarker center={selected.path[0]} radius={6} pathOptions={{ color: "#10b981", fillColor: "#10b981", fillOpacity: 1 }} />
                      <CircleMarker center={selected.path[selected.path.length - 1]} radius={6} pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }} />
                    </MapContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground p-8 text-center">Pick a route from the list to see it on the map.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {editingRoute && (
        <EditRouteDialog
          route={editingRoute}
          locations={locations}
          onClose={() => setEditingRoute(null)}
          onSaved={() => {
            setEditingRoute(null);
            qc.invalidateQueries({ queryKey: ["training-routes"] });
          }}
        />
      )}

      <LocationsManagerDialog
        open={locationsOpen}
        onOpenChange={setLocationsOpen}
        locations={locations}
        routes={routes ?? []}
        isCoach={isCoach}
        onChanged={() => qc.invalidateQueries({ queryKey: ["maps-locations"] })}
      />
    </AppShell>
  );
}

// Metadata-only editor — name, which location this route belongs to (or
// free text, or none), and distance/elevation overrides. Deliberately
// does NOT let you redraw the actual GPS path/start point: the path is
// what was actually recorded on a run, and hand-editing coordinates in a
// text field is a much bigger (and riskier) feature than what was asked
// for here. If you want the ability to draw or adjust the path itself,
// that's a separate follow-up.
function EditRouteDialog({
  route,
  locations,
  onClose,
  onSaved,
}: {
  route: TrainingRoute;
  locations: TrainingLocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(route.name);
  const [locationMode, setLocationMode] = useState<"none" | "saved" | "custom">(
    route.location_id ? "saved" : route.location_name ? "custom" : "none",
  );
  const [locationId, setLocationId] = useState(route.location_id ?? "");
  const [locationText, setLocationText] = useState(route.location_name ?? "");
  const [distanceKm, setDistanceKm] = useState(route.distance_m != null ? (route.distance_m / 1000).toFixed(2) : "");
  const [elevationM, setElevationM] = useState(route.elevation_gain_m != null ? String(Math.round(route.elevation_gain_m)) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Give the route a name");
      return;
    }
    setSaving(true);
    const patch: any = {
      name: name.trim(),
      distance_m: distanceKm.trim() === "" ? null : Math.round(Number(distanceKm) * 1000),
      elevation_gain_m: elevationM.trim() === "" ? null : Math.round(Number(elevationM)),
    };
    if (locationMode === "saved") {
      const loc = locations.find((l) => l.id === locationId);
      if (!loc) {
        toast.error("Pick a saved location, or switch to custom text");
        setSaving(false);
        return;
      }
      patch.location_id = loc.id;
      patch.location_name = loc.name;
    } else if (locationMode === "custom") {
      patch.location_id = null;
      patch.location_name = locationText.trim() || null;
    } else {
      patch.location_id = null;
      patch.location_name = null;
    }

    const { error } = await supabase.from("training_routes" as any).update(patch).eq("id", route.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Route updated");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit route</DialogTitle>
          <DialogDescription>Name, location, and distance/elevation — the GPS path itself isn't editable here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Route name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Location</Label>
            <Select value={locationMode} onValueChange={(v) => setLocationMode(v as typeof locationMode)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No location</SelectItem>
                <SelectItem value="saved">Saved location</SelectItem>
                <SelectItem value="custom">Custom text</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {locationMode === "saved" && (
            locations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No saved locations yet — use "Manage locations" on the Maps & Routes page to add one, or switch to custom text.
              </p>
            ) : (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Pick a location…" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          )}

          {locationMode === "custom" && (
            <Input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="e.g. Hyde Park, London" />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance (km)</Label>
              <Input type="number" step="0.01" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Elevation gain (m)</Label>
              <Input type="number" step="1" value={elevationM} onChange={(e) => setElevationM(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The missing piece for "how do we manage a location vs a route" —
// training_locations previously had no create/edit UI anywhere in the
// app at all (only a read-only picker on the training schedule). This
// gives locations a real home: one location (e.g. "Deakin Track" or
// "Rail Trail") can now have several routes attached to it via the
// location picker in Save Route / Edit Route, while a location on its
// own (no route needed) still works fine for a plain "session was at
// this venue" reference elsewhere in the app.
//
// Matches training_locations' existing RLS ("coaches can manage
// locations" — everyone can read, only coach/manager can write), so
// create/edit/delete are hidden for athletes rather than left to fail
// silently against the database.
function LocationsManagerDialog({
  open,
  onOpenChange,
  locations,
  routes,
  isCoach,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locations: TrainingLocation[];
  routes: TrainingRoute[];
  isCoach: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<TrainingLocation | "new" | null>(null);

  const routeCountByLocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of routes) {
      if (!r.location_id) continue;
      m.set(r.location_id, (m.get(r.location_id) ?? 0) + 1);
    }
    return m;
  }, [routes]);

  async function remove(loc: TrainingLocation) {
    const count = routeCountByLocation.get(loc.id) ?? 0;
    const warning = count > 0
      ? `Delete "${loc.name}"? ${count} route${count === 1 ? "" : "s"} linked to it will keep their name/distance but lose the location link.`
      : `Delete "${loc.name}"?`;
    if (!confirm(warning)) return;
    const { error } = await supabase.from("training_locations").delete().eq("id", loc.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Location deleted");
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Locations</DialogTitle>
          <DialogDescription>
            A location is a venue (a track, a trail, a park) — routes are the specific paths run there. One
            location can have several routes (e.g. Deakin Track's warm up loop and cool down loop are two
            separate routes both linked to the one "Deakin Track" location).
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <LocationEditForm
            location={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        ) : (
          <div className="space-y-3">
            {isCoach && (
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add location
              </Button>
            )}
            <div className="divide-y max-h-80 overflow-y-auto brand-scrollbar border rounded">
              {locations.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No locations saved yet.</p>
              ) : (
                locations.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[l.address, l.surface].filter(Boolean).join(" · ") || "—"}
                        {" · "}
                        {(routeCountByLocation.get(l.id) ?? 0)} route{(routeCountByLocation.get(l.id) ?? 0) === 1 ? "" : "s"}
                      </div>
                    </div>
                    {isCoach && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={() => setEditing(l)} className="text-muted-foreground hover:text-foreground" aria-label="Edit location">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => remove(l)} className="text-muted-foreground hover:text-destructive" aria-label="Delete location">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {!isCoach && (
              <p className="text-xs text-muted-foreground">Only coaches can add or edit locations — everyone can see and pick from the list.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LocationEditForm({
  location,
  onClose,
  onSaved,
}: {
  location: TrainingLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuthUser();
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [surface, setSurface] = useState(location?.surface ?? "");
  const [altitude, setAltitude] = useState(location?.altitude_m != null ? String(location.altitude_m) : "");
  const [notes, setNotes] = useState(location?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Give the location a name");
      return;
    }
    setSaving(true);
    const patch = {
      name: name.trim(),
      address: address.trim() || null,
      surface: surface.trim() || null,
      altitude_m: altitude.trim() === "" ? null : Math.round(Number(altitude)),
      notes: notes.trim() || null,
    };
    const { error } = location
      ? await supabase.from("training_locations").update(patch).eq("id", location.id)
      : await supabase.from("training_locations").insert({ ...patch, created_by: user?.id ?? null });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(location ? "Location updated" : "Location added");
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deakin Track" />
      </div>
      <div>
        <Label className="text-xs">Address (optional)</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 221 Burwood Hwy, Burwood VIC" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Surface (optional)</Label>
          <Input value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="e.g. Synthetic track" />
        </div>
        <div>
          <Label className="text-xs">Altitude (m, optional)</Label>
          <Input type="number" value={altitude} onChange={(e) => setAltitude(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Parking, access, anything worth knowing" rows={2} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : location ? "Save changes" : "Add location"}</Button>
      </div>
    </div>
  );
}
