import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, ExternalLink } from "lucide-react";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { mapLink } from "@/lib/training-schedule-helpers";

// Same tile source used on the Maps & Routes page and Session
// Analysis — one small clean default street map, no satellite toggle.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  surface: string | null;
  altitude_m: number | null;
  notes: string | null;
};

// Small pill, not a full card — meant to sit inline in a post, a
// schedule slot, a message, wherever a location is referenced.
// Clicking it is what "gives the details of the location": address,
// surface/altitude, notes, and a map pin if one's been set.
//
// Works two ways:
//  - Pass `locationId` for a real saved training_locations row (full
//    detail dialog, this is the normal case going forward).
//  - Pass just `fallbackName` (and optionally fallbackLat/fallbackLng)
//    for older free-text-only locations that were never linked to a
//    saved row — still clickable, still opens a map if coordinates
//    exist, just without the address/surface/notes fields since there's
//    no row to read them from.
export function LocationChip({
  locationId,
  fallbackName,
  fallbackLat,
  fallbackLng,
  className,
}: {
  locationId?: string | null;
  fallbackName?: string | null;
  fallbackLat?: number | null;
  fallbackLng?: number | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const { data: location } = useQuery({
    queryKey: ["location-detail", locationId],
    enabled: !!locationId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_locations")
        .select("id, name, address, lat, lng, surface, altitude_m, notes")
        .eq("id", locationId!)
        .maybeSingle();
      if (error) throw error;
      return data as LocationRow | null;
    },
  });

  const displayName = location?.name ?? fallbackName;
  if (!displayName) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline ${className ?? ""}`}
      >
        <MapPin className="h-3 w-3" /> {displayName}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--accent-red)]" /> {displayName}
            </DialogTitle>
          </DialogHeader>
          <LocationDetailBody location={location} fallbackLat={fallbackLat} fallbackLng={fallbackLng} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function LocationDetailBody({
  location,
  fallbackLat,
  fallbackLng,
}: {
  location: LocationRow | null | undefined;
  fallbackLat?: number | null;
  fallbackLng?: number | null;
}) {
  const lat = location?.lat ?? fallbackLat ?? null;
  const lng = location?.lng ?? fallbackLng ?? null;
  const hasPin = lat != null && lng != null;
  const link = mapLink({ lat, lng, text: location?.address ?? location?.name });

  return (
    <div className="space-y-3">
      {(location?.address || location?.surface || location?.altitude_m != null) && (
        <div className="text-sm space-y-1">
          {location?.address && <div className="text-muted-foreground">{location.address}</div>}
          {(location?.surface || location?.altitude_m != null) && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              {location?.surface && <span>{location.surface}</span>}
              {location?.altitude_m != null && <span>{Math.round(location.altitude_m)}m altitude</span>}
            </div>
          )}
        </div>
      )}
      {location?.notes && <p className="text-sm text-muted-foreground">{location.notes}</p>}

      {hasPin ? (
        <div className="h-56 rounded overflow-hidden border">
          <MapContainer center={[lat!, lng!]} zoom={14} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
            <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
            <CircleMarker center={[lat!, lng!]} radius={8} pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }} />
          </MapContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No map pin set for this location yet.</p>
      )}

      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground underline inline-flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> Open in Google Maps
        </a>
      )}
    </div>
  );
}
