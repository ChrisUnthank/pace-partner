import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui/button";
import { secToClock, metersFmt, paceFmt } from "@/lib/format";
import { smoothSeries } from "@/lib/gps-reconstruction";

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
              paint: { "hillshade-exaggeration": 0.08 },
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
    // The free AWS terrain tiles are SRTM/GMTED2010-derived, with real
    // vertical accuracy of only a few meters globally. At the close chase-cam
    // zoom used here, that noise reads as visible waviness on genuinely flat
    // courses — a limitation of the free data source, not this rendering
    // setup. A lower exaggeration meaningfully softens it (at some cost to
    // how dramatic real elevation looks on genuinely hilly courses).
    ...(enableTerrain ? { terrain: { source: "terrain-dem", exaggeration: 0.15 } } : {}),
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

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const FLYOVER_ZOOM = 15.6; // one zoom level out from the original 16.6 — roughly a quarter as many tile requests to cover the same ground while the chase-cam is moving fast, which was outrunning tile loads and flashing the fallback background color
const FLYOVER_PITCH = 40; // was 66, then 45 — confirmed improvement each step down, pushing further in the same direction rather than a different mechanism
// Opening "establishing shot": starts wide/high and swoops down into the
// close chase angle over the first few seconds, matching how Strava's own
// flyover opens (confirmed by direct comparison) rather than snapping
// straight to the close angle. This isn't just cosmetic — a wide, high
// view needs far fewer, much lower-detail tiles to render, so it's cheap
// and reliable even if a couple of tiles are still marginal right as
// playback starts; the background prefetch gets a few more seconds of real
// time to finish before the camera actually descends to the zoom level
// that demands full detail.
const DESCENT_MS = 4000;
const DESCENT_START_ZOOM = 12.6;
const DESCENT_START_PITCH = 18;
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
const LOOK_AHEAD_POINTS = 10; // ~10 samples ahead sets the direction of travel for camera bearing
// Bounding-box diagonal below this is treated as a track/tight-loop session
// rather than a point-to-point route — a standard 400m track's bounding
// diagonal is roughly 150-170m, so this comfortably covers ovals up to a
// small park loop while staying well clear of any real point-to-point route.
const LOOP_TRACK_DIAGONAL_M = 350;
// "Infield spectator" camera for loop tracks: parked over the centroid,
// fixed bearing, never rotating — the chase-cam's per-frame bearing changes
// are what caused the dizzying spin on tight turns, so loop mode skips that
// entirely and just watches the marker go around from a stable vantage
// point, the way someone standing infield would.
const LOOP_ZOOM = 17.3;
const LOOP_PITCH = 48;
const HEADING_SMOOTHING = 0.12; // per-frame EMA factor — keeps bearing from whipping on noisy GPS
const FULL_FLIGHT_MS = 30000; // full route flyover takes ~30s regardless of actual session/race duration

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
  // Real recorded GPS traces have small jitter (satellite bounce, tree
  // cover, urban canyon) that's invisible on the static drawn line but
  // reads as a jerky, wobbly camera when used directly to drive a moving
  // close-up shot. Smoothing only the camera/marker's own path — not the
  // "route-full-line" background layer, which stays on the raw, precise
  // trace — keeps the drawn route geometrically accurate while making the
  // flight itself feel smooth.
  const smoothedPoints = useMemo(() => {
    if (safePoints.length < 3) return safePoints;
    const lats = smoothSeries(
      safePoints.map((p) => p.lat),
      7,
    );
    const lngs = smoothSeries(
      safePoints.map((p) => p.lng),
      7,
    );
    return safePoints.map((p, i) => ({ ...p, lat: lats[i], lng: lngs[i] }));
  }, [safePoints]);
  const smoothedCoords = useMemo<[number, number][]>(
    () => smoothedPoints.map((p) => [p.lng, p.lat]),
    [smoothedPoints],
  );
  const colorFn = pointColor ?? (() => BRAND_RED);
  // Computed once per mount — WebGL2 support doesn't change mid-session.
  const hasTerrain = useMemo(() => supportsWebGL2(), []);

  const { isLoopTrack, loopCenter } = useMemo(() => {
    if (safePoints.length < 2) return { isLoopTrack: false, loopCenter: null as [number, number] | null };

    // A raw min/max bounding box breaks the moment there's a warm-up or
    // cool-down straight before/after the actual loop (e.g. jogging out to
    // the track and back) — that alone stretches the box across the whole
    // route and makes real track laps look like a big point-to-point route.
    // Instead: measure every point's distance from a rough centroid, and
    // only require the bulk of them (80th percentile) to sit within a tight
    // radius — tolerating up to ~20% of points being an outlier tail
    // without that tail alone defeating loop detection.
    let sumLat = 0;
    let sumLng = 0;
    for (const p of safePoints) {
      sumLat += p.lat;
      sumLng += p.lng;
    }
    const roughCenter = { lat: sumLat / safePoints.length, lng: sumLng / safePoints.length };
    const dists = safePoints.map((p) => haversineMeters(roughCenter, p));
    const sortedDists = [...dists].sort((a, b) => a - b);
    const coreRadius = sortedDists[Math.floor(sortedDists.length * 0.8)];

    if (!(coreRadius > 0 && coreRadius < LOOP_TRACK_DIAGONAL_M / 2)) {
      return { isLoopTrack: false, loopCenter: null as [number, number] | null };
    }

    // Recenter using only the core cluster (excludes the warm-up/cool-down
    // tail) so the fixed camera actually frames the loop itself, rather
    // than a centroid dragged out toward wherever the warm-up happened.
    let coreSumLat = 0;
    let coreSumLng = 0;
    let coreCount = 0;
    for (let i = 0; i < safePoints.length; i++) {
      if (dists[i] <= coreRadius) {
        coreSumLat += safePoints[i].lat;
        coreSumLng += safePoints[i].lng;
        coreCount++;
      }
    }
    const center: [number, number] = [coreSumLng / coreCount, coreSumLat / coreCount];
    return { isLoopTrack: true, loopCenter: center };
  }, [safePoints]);

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
      attributionControl: false,
      // Default cache sizing is based on current viewport only, which keeps
      // evicting/re-fetching tiles as the chase-cam sweeps across a whole
      // route — holding more tiles in memory reduces those visible reloads.
      // Per-source, not shared — satellite, terrain, and hillshade each get
      // their own 800-tile budget. Raised from 300 after confirming (via a
      // recorded flight) the blue-square moments cluster in the back half
      // of the route, consistent with earlier-prefetched tiles being
      // evicted to make room before the flight actually reaches them.
      maxTileCacheSize: 800,
      // Uncapped, this defaults to the device's real devicePixelRatio —
      // commonly 2-3x on phones, which pushes MapLibre to select a sharper
      // (and much larger) set of tiles just to stay "retina crisp," on top
      // of the extra tiles a rotated/tilted turning view already needs.
      // That compounding is exactly why mobile and turns were the worst
      // combination for the loading lag. 1.5 is a deliberate compromise —
      // noticeably fewer tile requests than an uncapped 3x phone, while
      // still sharper than a flat 1x.
      pixelRatio: Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5),
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

    let cancelled = false;

    // Fetches tiles for the whole route up front, before the visible flight
    // starts, instead of only ever fetching a tile the instant the chase-cam
    // reaches it — that live-fetch-while-flying approach is what caused the
    // fallback-color "blue square" flashes when the network couldn't keep
    // up with the camera. Sampling ~60 points across the route is enough to
    // touch every tile along the way without literally visiting every GPS
    // sample (neighboring samples usually share a tile at this zoom anyway).
    // Slippy maps normally show an already-cached low-zoom tile scaled up
    // (blurry but present) while the sharp tile for the current view loads
    // in — that graceful fallback is WHY a loading tile usually looks soft
    // for a moment rather than blank. This map only ever visits one zoom
    // level (FLYOVER_ZOOM), so there's never a lower-zoom "parent" tile
    // cached to fall back to — a tile that isn't ready yet has nothing to
    // show but flat background color. Seeding a handful of wide, cheap,
    // fast-loading low-zoom tiles first gives MapLibre something to fall
    // back to automatically, without needing to eliminate every possible
    // loading gap through prefetch timing alone.
    // Genuinely waits until MapLibre reports every source's tiles for the
    // current view are loaded, instead of guessing a fixed delay was
    // "probably enough" — real network conditions vary, and a guessed
    // delay either wastes time when the network is fast or, worse, isn't
    // long enough when it's slow (which is exactly the failure mode that
    // kept showing up despite lengthening the guessed delays repeatedly).
    // Bounded by maxWaitMs so a single genuinely stuck/failed tile can't
    // hang the whole prefetch pass indefinitely.
    async function waitForTilesLoaded(maxWaitMs: number) {
      const start = Date.now();
      while (!map.areTilesLoaded()) {
        if (cancelled) return;
        if (Date.now() - start > maxWaitMs) return;
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    async function seedLowZoomFallback() {
      if (cancelled) return;
      const midIdx = Math.floor(coords.length / 2);
      map.jumpTo({ center: coords[midIdx], zoom: 11, bearing: 0, pitch: 0 });
      await waitForTilesLoaded(1500);
    }

    async function prefetchRouteTiles() {
      // Denser than the original 60 — this is the actual safety margin
      // against a sharp turn falling between two sampled points, not the
      // zoom level (tiles are zoom-level-specific: a lower-zoom tile is a
      // different image entirely, not a reusable coarser version of the
      // real one, so prefetching at any zoom other than FLYOVER_ZOOM itself
      // would just fetch tiles the real flight can't use at all).
      const step = Math.max(1, Math.floor(coords.length / 140));
      const sampleIdxs: number[] = [];
      for (let i = 0; i < coords.length; i += step) sampleIdxs.push(i);
      if (sampleIdxs[sampleIdxs.length - 1] !== coords.length - 1) sampleIdxs.push(coords.length - 1);

      const headings = sampleIdxs.map((i) => {
        const aheadIdx = Math.min(i + LOOK_AHEAD_POINTS, safePoints.length - 1);
        return aheadIdx !== i ? bearingBetween(safePoints[i], safePoints[aheadIdx]) : null;
      });
      for (let k = 1; k < headings.length; k++) if (headings[k] == null) headings[k] = headings[k - 1];
      if (headings[0] == null) headings[0] = 0;

      for (let k = 0; k < sampleIdxs.length; k++) {
        if (cancelled) return;
        const idx = sampleIdxs[k];
        const heading = headings[k] as number;
        map.jumpTo({ center: coords[idx], zoom: FLYOVER_ZOOM, bearing: heading, pitch: flyoverPitch });
        await waitForTilesLoaded(1200);

        // The live flight doesn't snap straight to a new heading at a turn —
        // HEADING_SMOOTHING sweeps through it over the next several frames,
        // and every intermediate rotation in that sweep reveals its own
        // corner tiles. Only prefetching the before/after headings (as the
        // previous version of this did) missed that whole sweep entirely,
        // which is exactly why sharp turns specifically kept showing gaps
        // no matter how dense the position-based sampling got.
        const prevHeading = k > 0 ? (headings[k - 1] as number) : heading;
        const delta = ((heading - prevHeading + 540) % 360) - 180;
        if (Math.abs(delta) > 12) {
          const extraSteps = 7;
          for (let s = 1; s <= extraSteps; s++) {
            if (cancelled) return;
            const midBearing = prevHeading + (delta * s) / (extraSteps + 1);
            map.jumpTo({ center: coords[idx], zoom: FLYOVER_ZOOM, bearing: midBearing, pitch: flyoverPitch });
            await waitForTilesLoaded(700);
          }
        }
      }
      if (cancelled) return;
      map.jumpTo({ center: coords[coords.length - 1], zoom: FLYOVER_ZOOM, pitch: flyoverPitch });
      // Bounded — a single genuinely slow/failed tile shouldn't hold the
      // whole flyover hostage waiting for it forever.
      await waitForTilesLoaded(1500);
    }

    async function onLoad() {
      if (isLoopTrack && loopCenter) {
        await seedLowZoomFallback();
        if (cancelled) return;
        // A loop track's camera never moves once framed, so there's nothing
        // to prefetch ahead of — the initial framing tiles are all it needs.
        map.jumpTo({ center: loopCenter, zoom: LOOP_ZOOM, pitch: LOOP_PITCH, bearing: 0 });
      } else {
        await seedLowZoomFallback();
        if (cancelled) return;
        await prefetchRouteTiles();
        if (cancelled) return;
        // Gentle opening move into the flyover framing rather than snapping
        // straight to the steep chase-cam angle on first paint.
        // Opens on the wide establishing shot — the animation loop eases
        // down into the close chase angle from here once playback starts,
        // rather than snapping straight to close zoom and then jumping back
        // out to wide the moment the descent animation kicks in.
        map.jumpTo({ center: coords[0], zoom: DESCENT_START_ZOOM, pitch: DESCENT_START_PITCH, bearing: 0 });
      }
      if (!cancelled) setReady(true);
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
      cancelled = true;
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

      const rawIdx = progress * (smoothedPoints.length - 1);
      const i0 = Math.floor(rawIdx);
      const i1 = Math.min(i0 + 1, smoothedPoints.length - 1);
      const frac = rawIdx - i0;
      const p0 = smoothedPoints[i0];
      const p1 = smoothedPoints[i1];
      const curLat = lerp(p0.lat, p1.lat, frac);
      const curLng = lerp(p0.lng, p1.lng, frac);

      if (!isLoopTrack) {
        const aheadIdx = Math.min(i0 + LOOK_AHEAD_POINTS, smoothedPoints.length - 1);
        const ahead = smoothedPoints[aheadIdx];
        const targetHeading =
          aheadIdx !== i0 ? bearingBetween({ lat: curLat, lng: curLng }, ahead) : (headingRef.current ?? 0);
        headingRef.current =
          headingRef.current == null ? targetHeading : lerpHeading(headingRef.current, targetHeading, HEADING_SMOOTHING);

        const descentT = easeOutCubic(Math.min(1, elapsed / DESCENT_MS));
        const liveZoom = lerp(DESCENT_START_ZOOM, FLYOVER_ZOOM, descentT);
        const livePitch = lerp(DESCENT_START_PITCH, flyoverPitch, descentT);

        mapRef.current!.jumpTo({
          center: [curLng, curLat],
          zoom: liveZoom,
          pitch: livePitch,
          bearing: headingRef.current,
        });
      }
      const map2 = mapRef.current!;

      const color = colorFn(p0);
      const travSrc = map2.getSource("route-traveled") as maplibregl.GeoJSONSource | undefined;
      travSrc?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [...smoothedCoords.slice(0, i0 + 1), [curLng, curLat]] },
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
  }, [playing, ready, safePoints, coords, smoothedPoints, smoothedCoords]);

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
    <div className="flex flex-col gap-2" style={heightPx ? undefined : { flex: 1, minHeight: 400 }}>
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={handlePlayPause} disabled={!ready}>
          {playing ? "Pause" : finished ? "▶ Replay" : "▶ Fly route"}
        </Button>
      </div>

      <div
        className="relative rounded overflow-hidden border"
        style={heightPx ? { height: heightPx } : { flex: 1, minHeight: 360 }}
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

        {/* Fixed, non-interactive attribution caption in place of MapLibre's
            built-in AttributionControl — Esri and the AWS terrain tiles both
            require attribution, but the built-in control renders as an
            expandable panel the person has to click open/closed, which is
            unnecessary friction for text nobody needs to interact with. */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-2 py-0.5 text-[10px] leading-tight text-white/70 bg-black/30 truncate">
          {SATELLITE_ATTRIBUTION} · {TERRAIN_ATTRIBUTION}
        </div>
      </div>

      <div className="flex gap-4 text-sm border rounded-md px-3 py-2 bg-card flex-wrap">
        <div>
          <span className="text-muted-foreground">Elapsed: </span>
          <span className="tabular-nums font-medium">{hud?.elapsed_s != null ? secToClock(hud.elapsed_s) : "–"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Distance: </span>
          <span className="tabular-nums font-medium">
            {hud?.distance_m != null ? metersFmt(hud.distance_m) : "–"}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Pace: </span>
          <span className="tabular-nums font-medium">{hud?.pace != null ? paceFmt(hud.pace) : "–"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">HR: </span>
          <span className="tabular-nums font-medium">{hud?.hr != null ? `${hud.hr} bpm` : "–"}</span>
        </div>
      </div>
    </div>
  );
}
