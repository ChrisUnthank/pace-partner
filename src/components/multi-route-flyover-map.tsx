import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { secToClock, metersFmt, paceFmt } from "@/lib/format";
import { smoothSeries } from "@/lib/gps-reconstruction";
import type { FlyoverPoint } from "@/components/route-flyover-map";

// ── Data contract ────────────────────────────────────────────────────────
// One entry per athlete. `color` is assigned by the caller (Race Event
// page uses a fixed palette keyed by result order) rather than generated
// here, so the map's colors always match whatever legend/table the caller
// is already showing next to it. `avatarUrl` is optional — used for both
// the on-map marker and the legend/HUD when present, falling back to a
// plain colored dot per athlete when it's missing or fails to load.
export type AthleteTrack = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  points: FlyoverPoint[];
};

type MultiRouteFlyoverMapProps = {
  tracks: AthleteTrack[];
  heightPx?: number;
};

// ── Camera model — deliberately different from RouteFlyoverMap's chase-cam ──
// A single runner's flyover can chase their exact heading frame to frame.
// With several runners who are each facing their own direction (and who
// spread out or bunch up as the race unfolds), a chase-cam pinned to one
// runner's nose doesn't generalize. This uses a fixed north-up bearing and
// a camera that zooms/pans to keep the whole current field in frame — an
// aerial tracking shot over the pack, rather than a chase-cam behind any
// one of them. Simpler to reason about, and it naturally handles both a
// tight track race (zooms in close) and a spread-out road race (pulls back)
// through the same bounding-box logic, with no separate loop-track special
// case needed the way the single-runner version requires.

const TERRAIN_DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];
const TERRAIN_ATTRIBUTION = "Terrain: AWS Open Data Terrain Tiles (3DEP, SRTM, GMTED2010 et al.)";
const SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const SATELLITE_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";

function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Replaces an earlier hand-rolled "zoom from bounding-box diagonal"
// formula that computed zoom as if this were a flat top-down map — it
// never accounted for the camera's pitch (45-50°), which is exactly why
// a spread-out field could run off the top/sides of the screen: a pitched
// camera's visible ground footprint is much smaller and more
// perspective-distorted than a flat one at the same zoom, especially
// toward the horizon. MapLibre's own cameraForBounds does this correctly
// for whatever pitch/bearing you give it, so this now asks it directly
// instead of approximating.
function cameraForPack(
  map: maplibregl.Map,
  positions: { lat: number; lng: number }[],
  pitch: number,
): { center: maplibregl.LngLatLike; zoom: number } | null {
  if (positions.length === 0) return null;
  const bounds = new maplibregl.LngLatBounds();
  for (const p of positions) bounds.extend([p.lng, p.lat]);
  // A single-point bounds (everyone bunched at the exact same spot, e.g.
  // right at the gun) has zero width/height — cameraForBounds handles
  // that by returning maxZoom, which is exactly the right behavior here
  // (zoom in close rather than dividing by zero).
  const result = map.cameraForBounds(bounds, { pitch, bearing: 0, padding: 90, maxZoom: 18 });
  if (!result || !result.center || result.zoom == null) return null;
  return { center: result.center, zoom: result.zoom };
}

const PACK_PITCH_TERRAIN = 45;
const PACK_PITCH_FLAT = 50;
const FULL_FLIGHT_MS = 30000; // same convention as the single-runner flyover — fixed watch length regardless of the actual race duration

// Builds a circular, colored-ring-bordered marker image from an athlete's
// profile photo, for the on-map WebGL symbol layer. Requires the image
// host to serve proper CORS headers (crossOrigin="anonymous" is what
// triggers the browser to require them) to read pixel data back out of
// the canvas — a normal <img src="..."> tag doesn't need that (that's why
// the legend/HUD below use a plain UserAvatar <img>, not this), but
// getImageData() does. If the image is missing, slow, or the host doesn't
// send CORS headers, this resolves null and the caller falls back to the
// plain colored-dot marker already built into the base style — no photo,
// same behavior as before this feature existed.
function buildAvatarImage(url: string, color: string, size = 128): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timeout = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const r = size / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(r, r, r - 4, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const scale = Math.max(size / img.width, size / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        ctx.restore();
        // Colored identity ring, matching the athlete's legend/route color.
        ctx.beginPath();
        ctx.arc(r, r, r - 2, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.stroke();
        // Thin white separator so the ring reads clearly against busy
        // photo backgrounds and the satellite imagery behind it.
        ctx.beginPath();
        ctx.arc(r, r, r - 4.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        resolve(ctx.getImageData(0, 0, size, size));
      } catch {
        resolve(null); // canvas tainted by a cross-origin image without CORS headers
      }
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    img.src = url;
  });
}

type PreparedTrack = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  safePoints: FlyoverPoint[]; // raw (unsmoothed) — used for pace/distance math
  smoothedPoints: FlyoverPoint[]; // camera/marker path only
  maxElapsedS: number;
};

// Finds the interpolated position (and nearest raw sample index, for pace
// lookups) for one track at a given elapsed time. Points are assumed
// sorted ascending by elapsed_s — true for raw_session_points ordered by
// elapsed_s, which is how every caller of this component fetches them.
function positionAtElapsed(track: PreparedTrack, elapsedS: number) {
  const pts = track.smoothedPoints;
  if (pts.length === 0) return null;
  const first = pts[0].elapsed_s ?? 0;
  const last = pts[pts.length - 1].elapsed_s ?? first;
  if (elapsedS <= first) return { lat: pts[0].lat, lng: pts[0].lng, idx: 0, finished: false };
  if (elapsedS >= last) return { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng, idx: pts.length - 1, finished: true };

  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid].elapsed_s ?? 0) <= elapsedS) lo = mid;
    else hi = mid;
  }
  const p0 = pts[lo];
  const p1 = pts[hi];
  const t0 = p0.elapsed_s ?? 0;
  const t1 = p1.elapsed_s ?? t0 + 1;
  const frac = t1 > t0 ? (elapsedS - t0) / (t1 - t0) : 0;
  return {
    lat: lerp(p0.lat, p1.lat, frac),
    lng: lerp(p0.lng, p1.lng, frac),
    idx: lo,
    finished: false,
  };
}

function buildStyle(tracks: { id: string; color: string; coords: [number, number][] }[], enableTerrain: boolean): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    satellite: { type: "raster", tiles: SATELLITE_TILES, tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION },
    "terrain-dem": { type: "raster-dem", tiles: TERRAIN_DEM_TILES, tileSize: 256, encoding: "terrarium", maxzoom: 15, attribution: TERRAIN_ATTRIBUTION },
    "terrain-dem-hillshade": { type: "raster-dem", tiles: TERRAIN_DEM_TILES, tileSize: 256, encoding: "terrarium", maxzoom: 15, attribution: TERRAIN_ATTRIBUTION },
  };
  const layers: StyleSpecification["layers"] = [
    { id: "background-layer", type: "background", paint: { "background-color": "#8a9184" } },
    ...(enableTerrain
      ? [{ id: "hillshade-layer", type: "hillshade" as const, source: "terrain-dem-hillshade", paint: { "hillshade-exaggeration": 0.08 } }]
      : []),
    { id: "satellite-layer", type: "raster", source: "satellite" },
  ];

  for (const t of tracks) {
    sources[`route-full-${t.id}`] = {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: t.coords } },
    };
    sources[`route-traveled-${t.id}`] = {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: t.coords.slice(0, 1) } },
    };
    sources[`marker-${t.id}`] = {
      type: "geojson",
      data: { type: "Feature", properties: { name: t.id }, geometry: { type: "Point", coordinates: t.coords[0] ?? [0, 0] } },
    };
    layers.push(
      {
        id: `route-full-line-${t.id}`,
        type: "line",
        source: `route-full-${t.id}`,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": t.color, "line-width": 2.5, "line-opacity": 0.3 },
      },
      {
        id: `route-traveled-glow-${t.id}`,
        type: "line",
        source: `route-traveled-${t.id}`,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": t.color, "line-width": 10, "line-blur": 5, "line-opacity": 0.45 },
      },
      {
        id: `route-traveled-line-${t.id}`,
        type: "line",
        source: `route-traveled-${t.id}`,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": t.color, "line-width": 3, "line-opacity": 0.95 },
      },
      {
        id: `marker-glow-${t.id}`,
        type: "circle",
        source: `marker-${t.id}`,
        paint: { "circle-radius": 12, "circle-color": t.color, "circle-opacity": 0.35, "circle-blur": 0.8 },
      },
      {
        id: `marker-dot-${t.id}`,
        type: "circle",
        source: `marker-${t.id}`,
        paint: { "circle-radius": 5.5, "circle-color": t.color, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      },
    );
  }

  return {
    version: 8,
    sources,
    layers,
    ...(enableTerrain ? { terrain: { source: "terrain-dem", exaggeration: 0.15 } } : {}),
    sky: { "sky-color": "#8ecdf5", "horizon-color": "#dceaf5", "fog-color": "#dceaf5", "fog-ground-blend": 0.6 },
  } as StyleSpecification;
}

export function MultiRouteFlyoverMap({ tracks, heightPx }: MultiRouteFlyoverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const elapsedMsRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [tileError, setTileError] = useState<string | null>(null);
  const [liveElapsedS, setLiveElapsedS] = useState(0);
  const [liveRows, setLiveRows] = useState<
    { id: string; distance_m: number | null; pace: number | null; gapM: number | null; done: boolean }[]
  >([]);

  const hasTerrain = useMemo(() => supportsWebGL2(), []);

  const prepared = useMemo<PreparedTrack[]>(() => {
    return tracks
      .map((t) => {
        const safe = t.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.elapsed_s != null);
        if (safe.length < 2) return null;
        const lats = smoothSeries(safe.map((p) => p.lat), 7);
        const lngs = smoothSeries(safe.map((p) => p.lng), 7);
        const smoothed = safe.map((p, i) => ({ ...p, lat: lats[i], lng: lngs[i] }));
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          avatarUrl: t.avatarUrl,
          safePoints: safe,
          smoothedPoints: smoothed,
          maxElapsedS: safe[safe.length - 1].elapsed_s ?? 0,
        };
      })
      .filter((t): t is PreparedTrack => t !== null);
  }, [tracks]);

  const maxElapsedS = useMemo(() => prepared.reduce((max, t) => Math.max(max, t.maxElapsedS), 0), [prepared]);

  // Map is created once per mount, same rule as the single-runner flyover —
  // this only ever mounts once the caller's data is settled (behind a
  // "Group flyover" toggle), so there's no live-track-list-change case to
  // handle mid-flight.
  useEffect(() => {
    if (!containerRef.current || prepared.length === 0) return;

    const styleTracks = prepared.map((t) => ({ id: t.id, color: t.color, coords: t.smoothedPoints.map((p): [number, number] => [p.lng, p.lat]) }));
    const firstCoord = styleTracks[0]?.coords[0] ?? [0, 0];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(styleTracks, hasTerrain),
      center: firstCoord,
      zoom: 13,
      pitch: 0,
      attributionControl: false,
      maxTileCacheSize: 800,
      pixelRatio: Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5),
    });
    mapRef.current = map;
    if (hasTerrain) map.setMaxPitch(80);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    map.resize();

    let cancelled = false;
    const pitch = hasTerrain ? PACK_PITCH_TERRAIN : PACK_PITCH_FLAT;

    async function waitForTilesLoaded(maxWaitMs: number) {
      const start = Date.now();
      while (!map.areTilesLoaded()) {
        if (cancelled) return;
        if (Date.now() - start > maxWaitMs) return;
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    function packFrame(elapsedS: number) {
      const positions = prepared
        .map((t) => positionAtElapsed(t, elapsedS))
        .filter((p): p is NonNullable<typeof p> => p !== null);
      return cameraForPack(map, positions, pitch);
    }

    // Simpler than the single-runner version's prefetch — fixed north-up
    // bearing means there's no per-turn heading sweep to account for, just
    // the camera path the pack actually follows as it spreads/bunches.
    async function prefetchPackPath() {
      const samples = 24;
      for (let i = 0; i <= samples; i++) {
        if (cancelled) return;
        const t = (i / samples) * maxElapsedS;
        const frame = packFrame(t);
        if (!frame) continue;
        map.jumpTo({ center: frame.center, zoom: frame.zoom, bearing: 0, pitch });
        await waitForTilesLoaded(1000);
      }
      if (cancelled) return;
      const finalFrame = packFrame(maxElapsedS);
      if (finalFrame) map.jumpTo({ center: finalFrame.center, zoom: finalFrame.zoom, bearing: 0, pitch });
      await waitForTilesLoaded(1500);
    }

    // Loads each athlete's profile photo (where present) and swaps it in
    // as the on-map marker, on top of the plain colored-dot marker layer
    // that's already part of the base style. Runs alongside the tile
    // prefetch below rather than before/after it — image loads are a
    // separate network resource with their own bounded timeout, no reason
    // to serialize them behind tile loading.
    async function setupAvatarMarkers() {
      await Promise.all(
        prepared.map(async (t) => {
          if (!t.avatarUrl) return;
          const imgData = await buildAvatarImage(t.avatarUrl, t.color);
          if (cancelled || !imgData) return;
          const iconId = `avatar-${t.id}`;
          if (!map.hasImage(iconId)) map.addImage(iconId, imgData);
          if (!map.getLayer(`marker-photo-${t.id}`)) {
            map.addLayer({
              id: `marker-photo-${t.id}`,
              type: "symbol",
              source: `marker-${t.id}`,
              layout: {
                "icon-image": iconId,
                "icon-size": 0.28,
                "icon-allow-overlap": true,
                // Always faces the camera flat, regardless of map pitch/
                // bearing — a tilted face photo would look wrong, unlike
                // the plain circle dot it replaces.
                "icon-pitch-alignment": "viewport",
                "icon-rotation-alignment": "viewport",
              },
            });
          }
          // The flat circle-dot layer becomes redundant once the photo is
          // showing — hide it rather than leave a visible sliver behind
          // the (slightly smaller) photo. The colored glow layer stays,
          // it still reads as a nice soft halo behind the photo.
          if (map.getLayer(`marker-dot-${t.id}`)) {
            map.setLayoutProperty(`marker-dot-${t.id}`, "visibility", "none");
          }
        }),
      );
    }

    async function onLoad() {
      const initialFrame = packFrame(0);
      if (initialFrame) map.jumpTo({ center: initialFrame.center, zoom: initialFrame.zoom, bearing: 0, pitch: 0 });
      await waitForTilesLoaded(1500);
      if (cancelled) return;
      await Promise.all([prefetchPackPath(), setupAvatarMarkers()]);
      if (cancelled) return;
      const startFrame = packFrame(0);
      if (startFrame) map.jumpTo({ center: startFrame.center, zoom: startFrame.zoom, bearing: 0, pitch });
      if (!cancelled) setReady(true);
    }
    map.on("load", onLoad);

    function onError(e: any) {
      const sourceId = e?.sourceId ? ` (source: ${e.sourceId})` : "";
      const message = e?.error?.message || String(e?.error || "unknown error");
      // eslint-disable-next-line no-console
      console.error("[MultiRouteFlyoverMap] tile/style error" + sourceId, e?.error ?? e);
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
    if (!map || prepared.length === 0 || maxElapsedS <= 0) return;

    function step(timestamp: number) {
      if (startTimeRef.current === null) startTimeRef.current = timestamp - elapsedMsRef.current;
      const elapsedMs = timestamp - startTimeRef.current!;
      elapsedMsRef.current = elapsedMs;
      const progress = Math.min(1, elapsedMs / FULL_FLIGHT_MS);
      const globalElapsedS = progress * maxElapsedS;

      const map2 = mapRef.current!;
      let leaderDistance = -Infinity;
      const frameRows: { id: string; distance_m: number | null; pace: number | null; gapM: number | null; done: boolean }[] = [];
      const positions: { lat: number; lng: number }[] = [];

      for (const t of prepared) {
        const pos = positionAtElapsed(t, globalElapsedS);
        if (!pos) continue;
        positions.push({ lat: pos.lat, lng: pos.lng });

        const travSrc = map2.getSource(`route-traveled-${t.id}`) as maplibregl.GeoJSONSource | undefined;
        const coordsSoFar = t.smoothedPoints.slice(0, pos.idx + 1).map((p): [number, number] => [p.lng, p.lat]);
        travSrc?.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [...coordsSoFar, [pos.lng, pos.lat]] },
        });
        const markerSrc = map2.getSource(`marker-${t.id}`) as maplibregl.GeoJSONSource | undefined;
        markerSrc?.setData({ type: "Feature", properties: { name: t.id }, geometry: { type: "Point", coordinates: [pos.lng, pos.lat] } });

        // Rolling ±8-sample pace window over this track's own raw points,
        // same spirit as the single-runner flyover's HUD pace.
        const windowN = 8;
        const raw = t.safePoints;
        const wStart = raw[Math.max(0, pos.idx - windowN)];
        const wEnd = raw[Math.min(raw.length - 1, pos.idx + windowN)];
        let pace: number | null = null;
        if (wStart?.distance_m != null && wEnd?.distance_m != null && wStart.elapsed_s != null && wEnd.elapsed_s != null) {
          const dDist = wEnd.distance_m - wStart.distance_m;
          const dTime = wEnd.elapsed_s - wStart.elapsed_s;
          if (dDist > 0 && dTime > 0) pace = (dTime / dDist) * 1000;
        }
        const distance_m = raw[pos.idx]?.distance_m ?? null;
        if (distance_m != null) leaderDistance = Math.max(leaderDistance, distance_m);
        frameRows.push({ id: t.id, distance_m, pace, gapM: null, done: pos.finished });
      }
      // Gap is computed as a second pass once the leader's distance for
      // this instant is known — a simple, honest "meters behind" figure
      // rather than an estimated time gap (which would need assuming each
      // athlete holds their current pace, an assumption not worth making).
      for (const row of frameRows) {
        row.gapM = row.distance_m != null && leaderDistance > -Infinity ? Math.max(0, leaderDistance - row.distance_m) : null;
      }
      setLiveRows(frameRows);
      setLiveElapsedS(globalElapsedS);

      const frame = cameraForPack(map2, positions, hasTerrain ? PACK_PITCH_TERRAIN : PACK_PITCH_FLAT);
      if (frame) {
        map2.jumpTo({ center: frame.center, zoom: frame.zoom, bearing: 0, pitch: hasTerrain ? PACK_PITCH_TERRAIN : PACK_PITCH_FLAT });
      }

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
  }, [playing, ready, prepared, maxElapsedS, hasTerrain]);

  function handlePlayPause() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (finished) {
      elapsedMsRef.current = 0;
      setFinished(false);
    }
    setPlaying(true);
  }

  if (prepared.length < 2) {
    return (
      <div className="flex-1 min-h-[300px] rounded border border-dashed flex items-center justify-center text-sm text-muted-foreground">
        Need at least 2 athletes with GPS data for a group flyover
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" style={heightPx ? undefined : { flex: 1, minHeight: 400 }}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Synced by elapsed time — every athlete starts their clock together, not by real start-of-day time.
        </span>
        <Button size="sm" variant="outline" onClick={handlePlayPause} disabled={!ready}>
          {playing ? "Pause" : finished ? "▶ Replay" : "▶ Fly race"}
        </Button>
      </div>

      <div className="relative rounded overflow-hidden border" style={heightPx ? { height: heightPx } : { flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }} />

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

        {/* Legend — profile photo (or a plain colored dot when there isn't
            one / it fails to load) per athlete, doubles as identification
            since the map markers themselves carry no text label. */}
        <div className="absolute top-2 right-2 z-10 bg-black/55 backdrop-blur-sm rounded-md px-2.5 py-2 text-xs text-white space-y-1.5 max-w-[170px]">
          {prepared.map((t) => (
            <div key={t.id} className="flex items-center gap-1.5">
              {t.avatarUrl ? (
                <span className="rounded-full shrink-0" style={{ boxShadow: `0 0 0 2px ${t.color}` }}>
                  <UserAvatar name={t.name} imageUrl={t.avatarUrl} size="xs" />
                </span>
              ) : (
                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t.color }} />
              )}
              <span className="truncate">{t.name}</span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 px-2 py-0.5 text-[10px] leading-tight text-white/70 bg-black/30 truncate">
          {SATELLITE_ATTRIBUTION} · {TERRAIN_ATTRIBUTION}
        </div>
      </div>

      <div className="border rounded-md px-3 py-2 bg-card">
        <div className="text-xs text-muted-foreground mb-1.5">
          Elapsed: <span className="tabular-nums font-medium text-foreground">{secToClock(liveElapsedS)}</span>
        </div>
        <div className="space-y-1">
          {prepared.map((t) => {
            const row = liveRows.find((r) => r.id === t.id);
            return (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                {t.avatarUrl ? (
                  <span className="rounded-full shrink-0" style={{ boxShadow: `0 0 0 2px ${t.color}` }}>
                    <UserAvatar name={t.name} imageUrl={t.avatarUrl} size="xs" />
                  </span>
                ) : (
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                )}
                <span className="truncate flex-1 min-w-0">{t.name}</span>
                <span className="tabular-nums text-muted-foreground text-xs">
                  {row?.distance_m != null ? metersFmt(row.distance_m) : "–"}
                </span>
                <span className="tabular-nums text-muted-foreground text-xs w-16 text-right">
                  {row?.pace != null ? paceFmt(row.pace) : "–"}
                </span>
                <span className="tabular-nums text-xs w-16 text-right font-medium">
                  {row == null ? "–" : row.gapM === 0 ? "Leader" : row.gapM != null ? `+${Math.round(row.gapM)}m` : "–"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
