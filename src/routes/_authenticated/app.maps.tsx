import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Map, Search, Trash2, MapPinned, Mountain } from "lucide-react";
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
  distance_m: number | null;
  elevation_gain_m: number | null;
  start_lat: number;
  start_lng: number;
  path: [number, number][];
  created_at: string;
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
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name or location…" className="pl-8 h-9" />
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
                <div className="divide-y max-h-[600px] overflow-y-auto brand-scrollbar">
                  {filtered.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No routes match "{search}".</p>
                  ) : (
                    filtered.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={`w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors ${selected?.id === r.id ? "bg-accent/60" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{r.name}</span>
                          {r.created_by === user?.id && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                remove(r.id);
                              }}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              aria-label="Delete route"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                        {r.location_name && (
                          <div className="text-xs text-muted-foreground truncate">{r.location_name}</div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          {r.distance_m != null && <span>{(r.distance_m / 1000).toFixed(2)} km</span>}
                          {r.elevation_gain_m != null && (
                            <span className="flex items-center gap-0.5">
                              <Mountain className="h-3 w-3" /> {Math.round(r.elevation_gain_m)}m
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
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
    </AppShell>
  );
}
