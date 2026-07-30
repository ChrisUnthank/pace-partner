import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui/button";
import { secToClock, metersFmt, paceFmt } from "@/lib/format";

// ── Data contract ──────────────────────────────────────────────────────────
// Deliberately loose/optional beyond lat/lng: Session Analysis and Race
// Analysis each already have their own GPS sample shape (different field
// names, different optional fields depending on file type), so this accepts
// whatever each page can supply rather than forcing a shared schema change.
export type FlyoverPoint = {
  lat: number;
  lng: number;
  elapsed_s?: number;
  distance_m?: number;
  hr?: number | null;
  elev?: number | null;
};

type RouteFlyoverMapProps = {
  points: FlyoverPoint[];
  // Fixed pixel height (e.g. Race Analysis's 450px card). Omit to fill the
  // parent flex container instead (Session Analysis's flex-1 layout).
  heightPx?: number;
  // Per-point marker/trail color — e.g. HR-zone coloring on Race Analysis.
  // Defaults to the app's brand accent red.
  pointColor?: (p: FlyoverPoint) => string;
};

const BRAND_RED = "#FF004C";

// AWS Open Data "Terrain Tiles" (Terrarium-encoded elevation PNGs, aggregating
// 3DEP/SRTM/GMTED2010 and other public elevation sources) — free, no API key,
// no per-request billing. See https://registry.opendata.aws/terrain-tiles/
const TERRAIN_DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];
const TERRAIN_ATTRIBUTION = "Terrain: AWS Open Data Terrain Tiles (3DEP, SRTM, GMTED2010 et al.)";

// Esri World Imagery — free, no API key. Note for whoever revisits this:
// Esri's free/public terms are written for general public map display, not
// specifically for a paid multi-tenant commercial product at real scale —
// worth a licensing check-in with Esri if usage grows significantly.
const SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const SATELLITE_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";

// MapLibre's 3D terrain (and hillshade, which shares the same DEM-decoding
// render path) requires WebGL2. When terrain is enabled in the style,
// MapLibre also routes ordinary 2D layers (including plain satellite
// raster) through the terrain-aware render path so they drape correctly —
// so if WebGL2 isn't available, NOTHING terrain-aware paints, not just the
// elevation mesh itself, even though the plain "background" layer (which
// bypasses that path entirely) still shows. Detect it up front and fall
// back to a flat (non-terrain) style rather than an invisible one.
function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

function buildStyle(routeCoords: [number, number][], enableTerrain: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: SATELLITE_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE_ATTRIBUTION,
      },
      "terrain-dem": {
        type: "raster-dem",
        tiles: TERRAIN_DEM_TILES,
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 15,
        attribution: TERRAIN_ATTRIBUTION,
      },
      // Same tiles as "terrain-dem" above, under a separate source id —
      // MapLibre warns (harmlessly) if a hillshade layer and the 3D terrain
      // mesh share one source id, recommending two. This avoids the console
      // warning at essentially zero extra cost (same URLs, browser cache
      // dedupes the actual tile requests).
      "terrain-dem-hillshade": {
        type: "raster-dem",
        tiles: TERRAIN_DEM_TILES,
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 15,
        attribution: TERRAIN_ATTRIBUTION,
      },
      "route-full": {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoords },
        },
      },
      "route-traveled": {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoords.slice(0, 1) },
        },
      },
      marker: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { color: BRAND_RED },
          geometry: { type: "Point", coordinates: routeCoords[0] ?? [0, 0] },
        },
      },
    },
    layers: [
      // Fallback #1: if every raster source fails to load, MapLibre's raw
      // WebGL canvas clears to black by default — this guarantees a neutral
      // sky-toned background instead, so a tile failure looks like "flat
      // map" rather than "broken screen".
      { id: "background-layer", type: "background", paint: { "background-color": "#7fa8c9" } },
      // Fallback #2: shaded terrain relief from the same DEM source used for
      // the 3D mesh itself. If the satellite imagery fails to load but the
      // terrain tiles are fine, this still shows real hillshaded terrain
      // instead of a flat color. Only included when WebGL2 (and therefore
      // terrain) is actually usable — otherwise it would never paint anyway.
      ...(enableTerrain
        ? [
            {
              id: "hillshade-layer",
              type: "hillshade" as const,
              source: "terrain-dem-hillshade",
              paint: { "hillshade-exaggeration": 0.6 },
            },
          ]
        : []),
      { id: "satellite-layer", type: "raster", source: "satellite" },
      {
        id: "route-full-line",
        type: "line",
        source: "route-full",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.45 },
      },
      {
        id: "route-traveled-glow",
        type: "line",
        source: "route-traveled",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": BRAND_RED, "line-width": 12, "line-blur": 6, "line-opacity": 0.5 },
      },
      {
        id: "route-traveled-line",
        type: "line",
        source: "route-traveled",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": BRAND_RED, "line-width": 3.5, "line-opacity": 0.95 },
      },
      {
        id: "marker-glow",
        type: "circle",
        source: "marker",
        paint: {
          "circle-radius": 14,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.35,
          "circle-blur": 0.8,
        },
      },
      {
        id: "marker-dot",
        type: "circle",
        source: "marker",
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      },
    ],
    ...(enableTerrain ? { terrain: { source: "terrain-dem", exaggeration: 1.3 } } : {}),
    sky: {
      "sky-color": "#8ecdf5",
      "horizon-color": "#dceaf5",
      "fog-color": "#dceaf5",
      "fog-ground-blend": 0.6,
    },
  } as StyleSpecification;
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

// Compass bearing from a to b, in degrees (0-360).
function bearingBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Shortest-path interpolation between two compass headings (handles the
// 359deg -> 1deg wraparound correctly instead of spinning the long way).
function lerpHeading(from: number, to: number, t: number): number {
  let delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const FLYOVER_ZOOM = 16.6;
const FLYOVER_PITCH = 66; // MapLibre's documented range is 0-60; up to ~75-80 works but is "experimental" per its own docs
const LOOK_AHEAD_POINTS = 10; // ~10 samples ahead sets the direction of travel for camera bearing
const HEADING_SMOOTHING = 0.12; // per-frame EMA factor — keeps bearing from whipping on noisy GPS
const FULL_FLIGHT_MS = 22000; // full route flyover takes ~22s regardless of actual session/race duration

export function RouteFlyoverMap({ points, heightPx, pointColor }: RouteFlyoverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const elapsedMsRef = useRef(0);
  const headingRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ elapsed_s?: number; distance_m?: number; pace?: number | null; hr?: number | null } | null>(
    null,
  );

  const safePoints = useMemo(
    () => points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [points],
  );
  const coords = useMemo<[number, number][]>(() => safePoints.map((p) => [p.lng, p.lat]), [safePoints]);
  const colorFn = pointColor ?? (() => BRAND_RED);
  // Computed once per mount — WebGL2 support doesn't change mid-session.
  const hasTerrain = useMemo(() => supportsWebGL2(), []);
  // Without terrain there's no elevation to look "into" — an extreme pitch
  // just stares almost edge-on at a flat plane, so keep it within MapLibre's
  // normal (non-experimental) pitch range for a flat-map fallback.
  const flyoverPitch = hasTerrain ? FLYOVER_PITCH : 55;

  // Map is created once per mount and never rebuilt on subsequent point
  // updates — this component only ever mounts when the parent's route data
  // is already settled (it's behind a "3D Flyover" toggle), so there's no
  // case where points change out from under an already-playing flyover.
  useEffect(() => {
    if (!containerRef.current || coords.length < 2) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(coords, hasTerrain),
      center: coords[0],
      zoom: 13,
      pitch: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (hasTerrain) map.setMaxPitch(80);

    // Same class of bug as the Leaflet map elsewhere in this app: inside a
    // flex layout, the container can still be mid-layout (zero or stale
    // size) at the instant MapLibre measures it here, leaving the WebGL
    // canvas permanently sized wrong — which renders as a silent black
    // rectangle with no console errors at all, since nothing actually
    // failed, it just never got the right dimensions. A ResizeObserver
    // catches the container settling into its real size and tells MapLibre
    // to re-measure; the immediate resize() call below is a same-tick nudge
    // for the common case where it's already sized correctly by paint time.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    map.resize();

    function onLoad() {
      setReady(true);
      // Gentle opening move into the flyover framing rather than snapping
      // straight to the steep chase-cam angle on first paint.
      map.jumpTo({ center: coords[0], zoom: FLYOVER_ZOOM, pitch: flyoverPitch, bearing: 0 });
    }
    map.on("load", onLoad);

    // Tile/source failures (blocked request, CORS, bad response) otherwise
    // fail silently and just render as a black canvas — surface them so a
    // failure is visible and diagnosable instead of a mystery blank screen.
    function onError(e: any) {
      const sourceId = e?.sourceId ? ` (source: ${e.sourceId})` : "";
      const message = e?.error?.message || String(e?.error || "unknown error");
      // eslint-disable-next-line no-console
      console.error("[RouteFlyoverMap] tile/style error" + sourceId, e?.error ?? e);
      setTileError(`${message}${sourceId}`);
    }
    map.on("error", onError);

    return () => {
      resizeObserver.disconnect();
      map.off("load", onLoad);
      map.off("error", onError);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing || !ready) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startTimeRef.current = null;
      return;
    }

    const map = mapRef.current;
    if (!map) return;

    function step(timestamp: number) {
      if (startTimeRef.current === null) startTimeRef.current = timestamp - elapsedMsRef.current;
      const elapsed = timestamp - startTimeRef.current!;
      elapsedMsRef.current = elapsed;
      const progress = Math.min(1, elapsed / FULL_FLIGHT_MS);

      const rawIdx = progress * (safePoints.length - 1);
      const i0 = Math.floor(rawIdx);
      const i1 = Math.min(i0 + 1, safePoints.length - 1);
      const frac = rawIdx - i0;
      const p0 = safePoints[i0];
      const p1 = safePoints[i1];
      const curLat = lerp(p0.lat, p1.lat, frac);
      const curLng = lerp(p0.lng, p1.lng, frac);

      const aheadIdx = Math.min(i0 + LOOK_AHEAD_POINTS, safePoints.length - 1);
      const ahead = safePoints[aheadIdx];
      const targetHeading =
        aheadIdx !== i0 ? bearingBetween({ lat: curLat, lng: curLng }, ahead) : (headingRef.current ?? 0);
      headingRef.current =
        headingRef.current == null ? targetHeading : lerpHeading(headingRef.current, targetHeading, HEADING_SMOOTHING);

      const map2 = mapRef.current!;
      map2.jumpTo({
        center: [curLng, curLat],
        zoom: FLYOVER_ZOOM,
        pitch: flyoverPitch,
        bearing: headingRef.current,
      });

      const color = colorFn(p0);
      const travSrc = map2.getSource("route-traveled") as maplibregl.GeoJSONSource | undefined;
      travSrc?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [...coords.slice(0, i0 + 1), [curLng, curLat]] },
      });
      const markerSrc = map2.getSource("marker") as maplibregl.GeoJSONSource | undefined;
      markerSrc?.setData({
        type: "Feature",
        properties: { color },
        geometry: { type: "Point", coordinates: [curLng, curLat] },
      });

      // Rolling ±8-sample pace window, same spirit as the 2D replays' live
      // pace readout — raw point-to-point pace is too noisy off GPS.
      const windowN = 8;
      const wStart = safePoints[Math.max(0, i0 - windowN)];
      const wEnd = safePoints[Math.min(safePoints.length - 1, i0 + windowN)];
      let pace: number | null = null;
      if (
        wStart.distance_m != null &&
        wEnd.distance_m != null &&
        wStart.elapsed_s != null &&
        wEnd.elapsed_s != null
      ) {
        const dDist = wEnd.distance_m - wStart.distance_m;
        const dTime = wEnd.elapsed_s - wStart.elapsed_s;
        if (dDist > 0 && dTime > 0) pace = (dTime / dDist) * 1000;
      }
      setHud({ elapsed_s: p0.elapsed_s, distance_m: p0.distance_m, pace, hr: p0.hr });

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setPlaying(false);
        setFinished(true);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready, safePoints, coords]);

  function handlePlayPause() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (finished) {
      elapsedMsRef.current = 0;
      headingRef.current = null;
      setFinished(false);
    }
    setPlaying(true);
  }

  if (coords.length < 2) {
    return (
      <div className="flex-1 min-h-[400px] rounded border border-dashed flex items-center justify-center text-sm text-muted-foreground">
        No GPS data available for a 3D flyover
      </div>
    );
  }

  return (
    <div
      className="relative rounded overflow-hidden border"
      style={heightPx ? { height: heightPx } : { height: "100%", minHeight: 400, flex: 1 }}
    >
      <div
        ref={containerRef}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }}
      />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground z-10">
          Loading terrain…
        </div>
      )}

      {tileError && (
        <div className="absolute top-2 left-2 right-2 z-10 text-xs border border-destructive/40 bg-destructive/10 text-destructive rounded-md px-3 py-2">
          Map tile error: {tileError}
        </div>
      )}

      <div className="absolute top-2 right-2 z-10">
        <Button size="sm" variant="outline" onClick={handlePlayPause} disabled={!ready}>
          {playing ? "Pause" : finished ? "▶ Replay" : "▶ Fly route"}
        </Button>
      </div>

      {hud && (playing || finished) && (
        <div className="absolute bottom-2 left-2 right-2 z-10 flex gap-4 text-sm border rounded-md px-3 py-2 bg-background/85 backdrop-blur-sm flex-wrap">
          {hud.elapsed_s != null && (
            <div>
              <span className="text-muted-foreground">Elapsed: </span>
              <span className="tabular-nums font-medium">{secToClock(hud.elapsed_s)}</span>
            </div>
          )}
          {hud.distance_m != null && (
            <div>
              <span className="text-muted-foreground">Distance: </span>
              <span className="tabular-nums font-medium">{metersFmt(hud.distance_m)}</span>
            </div>
          )}
          {hud.pace != null && (
            <div>
              <span className="text-muted-foreground">Pace: </span>
              <span className="tabular-nums font-medium">{paceFmt(hud.pace)}</span>
            </div>
          )}
          {hud.hr != null && (
            <div>
              <span className="text-muted-foreground">HR: </span>
              <span className="tabular-nums font-medium">{hud.hr} bpm</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
