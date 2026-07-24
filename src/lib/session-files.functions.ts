import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function fetchWeather(lat: number, lon: number, timestamp: string) {
  try {
    const date = new Date(timestamp);
    const target = date.getTime();
    const day = date.toISOString().slice(0, 10);

    const daysAgo = (Date.now() - target) / 86_400_000;
    const base =
      daysAgo > 5 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";

    const url = `${base}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,wind_speed_10m&start_date=${day}&end_date=${day}&timezone=UTC`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error("Weather fetch failed:", res.status);
      return { temp: null, wind: null };
    }
    const data = await res.json();

    const times: string[] = data?.hourly?.time ?? [];
    const temps: (number | null)[] = data?.hourly?.temperature_2m ?? [];
    const winds: (number | null)[] = data?.hourly?.wind_speed_10m ?? [];
    if (!times.length) return { temp: null, wind: null };

    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(times[i] + "Z").getTime() - target); // <-- append Z
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }

    // Some hours in the archive/forecast data can have a gap in one
    // variable but not the other (rare, but seen in practice — e.g. temp
    // present, wind null for that exact hour). Rather than silently
    // returning null for that one field, check adjacent hours for a usable
    // reading — close enough for a session summary, and better than a
    // blank field when the info was available a few hours either side.
    // Wind fields in particular tend to have wider gaps than temperature
    // in both the archive and forecast datasets, so give wind a longer
    // leash (up to 6h either side) rather than the 2h used for temp.
    const nearestNonNull = (arr: (number | null)[], maxOffset: number): number | null => {
      for (let offset = 0; offset <= maxOffset; offset++) {
        if (arr[bestIdx + offset] != null) return arr[bestIdx + offset];
        if (offset > 0 && arr[bestIdx - offset] != null) return arr[bestIdx - offset];
      }
      return null;
    };

    const resolvedTemp = nearestNonNull(temps, 2);
    let resolvedWind = nearestNonNull(winds, 6);

    if (resolvedWind == null) {
      // Wind still unresolved even with the wider window - log the raw
      // window we searched so a real provider gap (vs. a bug here) can be
      // confirmed from server logs instead of guessing after the fact.
      console.error(
        "fetchWeather: no usable wind_speed_10m reading",
        JSON.stringify({
          lat,
          lon,
          day,
          bestIdx,
          nearbyWinds: winds.slice(Math.max(0, bestIdx - 6), bestIdx + 7),
        }),
      );
    }

    return { temp: resolvedTemp, wind: resolvedWind };
  } catch (err) {
    console.error("Weather fetch failed", err);
    return { temp: null, wind: null };
  }
}

async function fetchLocationName(lat: number, lon: number) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires a real identifying User-Agent - no key needed, just this.
        "User-Agent": "PacePartner/1.0 (chris@unthank.me)",
      },
    });

    if (!res.ok) {
      console.error("Location fetch failed:", res.status);
      return null;
    }

    const data = await res.json();

    return (
      data?.address?.city ||
      data?.address?.town ||
      data?.address?.suburb ||
      data?.address?.village ||
      data?.address?.county ||
      data?.address?.state ||
      (data?.display_name ? data.display_name.split(",")[0] : "Unknown location")
    );
  } catch (err) {
    console.error("Location fetch failed", err);
    return null;
  }
}

function mapFitSport(sport: string | null | undefined): string {
  const s = (sport ?? "").toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("cycling") || s.includes("biking") || s.includes("bike") || s.includes("cycle")) return "ride";
  if (s.includes("training") || s.includes("gym") || s.includes("strength")) return "gym";
  if (s.includes("track")) return "track";
  return "run";
}

function normalizeCadence(cad?: number): number | null {
  if (!cad || cad <= 0) return null;
  if (cad > 260) return null;
  if (cad < 120) return cad * 2;
  return cad;
}

function safeParseJson(value: any) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stepIsLadder(step: any): boolean {
  const meta = safeParseJson(step?.metadata);
  return Boolean(
    step?.is_ladder ?? step?.ladder ?? step?.variable_reps ?? meta?.is_ladder ?? meta?.ladder ?? meta?.variable_reps,
  );
}

// Planned "effort" blocks that get matched against classified work/recovery
// lap pairs from an uploaded file. Includes both "work" and "strides" —
// both represent a real effort block the athlete ran, just at different
// intensities/distances; only "warmup"/"cooldown"/"recovery" are structural
// rather than effort blocks. Excluding "strides" here left any planned
// Strides block (e.g. "4×75m") with zero interval_results after a real FIT
// upload — its target showed correctly (it came straight from the plan),
// but nothing ever matched laps to it, so every rep row stayed empty.
function getPlannedWorkSteps(plannedSteps: any[]) {
  return [...plannedSteps]
    .filter((s) => s.kind === "work" || s.kind === "strides")
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0));
}

function getPlannedBlockRecoverySteps(plannedSteps: any[]) {
  return [...plannedSteps]
    .filter((s) => s.kind === "recovery")
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0));
}

type ParsedPoint = {
  timestamp: string | null;
  elapsed_s: number;
  distance_m?: number | null;
  lat?: number | null;
  lng?: number | null;
  elevation_m?: number | null;
  hr?: number | null;
  cadence?: number | null;
  pace_sec_per_km?: number | null;
  stride_length_m?: number | null;
  vertical_oscillation_cm?: number | null;
  ground_contact_time_ms?: number | null;
  temperature_c?: number | null;
};

type ParsedLap = {
  index: number;
  startMs: number | null;
  endMs: number | null;
  intensity: string | null;
  total_distance: number;
  total_elapsed_time: number;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  kind?: "warmup" | "work" | "recovery" | "cooldown";
  sourceFileIndex?: number;
};

type ParsedFile = {
  points: ParsedPoint[];
  laps: ParsedLap[];
  totalDistanceM: number;
  totalTimeS: number;
  startedAt: string | null;
  sport: string | null;
};

type WorkRecoveryPair = {
  work: ParsedLap;
  recovery: ParsedLap | null;
};

type MergedPoint = ParsedPoint & {
  file_id: string;
};

/** Parse a GPX XML string into normalized samples. */
function parseGPX(xml: string): ParsedFile {
  const trkpts: {
    lat: number;
    lng: number;
    ele?: number;
    time?: string;
    hr?: number;
    cad?: number;
  }[] = [];

  const ptRe = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = ptRe.exec(xml))) {
    const inner = m[3];
    const ele = /<ele>([^<]+)<\/ele>/.exec(inner);
    const time = /<time>([^<]+)<\/time>/.exec(inner);
    const hr = /<(?:gpxtpx:)?hr>([^<]+)<\/(?:gpxtpx:)?hr>/.exec(inner);
    const cad = /<(?:gpxtpx:)?cad>([^<]+)<\/(?:gpxtpx:)?cad>/.exec(inner);

    trkpts.push({
      lat: parseFloat(m[1]),
      lng: parseFloat(m[2]),
      ele: ele ? parseFloat(ele[1]) : undefined,
      time: time?.[1],
      hr: hr ? parseInt(hr[1], 10) : undefined,
      cad: cad ? parseInt(cad[1], 10) : undefined,
    });
  }

  if (trkpts.length === 0) {
    return { points: [], laps: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
  }

  const t0 = trkpts[0].time ? new Date(trkpts[0].time).getTime() : 0;
  let totalDist = 0;

  const points: ParsedPoint[] = trkpts.map((p, i) => {
    if (i > 0) {
      const prev = trkpts[i - 1];
      const R = 6371000;
      const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      totalDist += 2 * R * Math.asin(Math.sqrt(a));
    }

    const elapsed = p.time ? (new Date(p.time).getTime() - t0) / 1000 : i;
    const prev = i > 0 ? trkpts[i - 1] : null;

    let pace: number | undefined;
    if (prev?.time && p.time) {
      const R = 6371000;
      const dLat = ((p.lat - prev.lat) * Math.PI) / 180;
      const dLng = ((p.lng - prev.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((prev.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      const dt = (new Date(p.time).getTime() - new Date(prev.time).getTime()) / 1000;
      if (d > 1 && dt > 0) pace = (dt / d) * 1000;
    }

    return {
      timestamp: p.time ?? null,
      elapsed_s: elapsed,
      distance_m: totalDist,
      lat: p.lat,
      lng: p.lng,
      elevation_m: p.ele ?? null,
      hr: p.hr ?? null,
      cadence: normalizeCadence(p.cad),
      pace_sec_per_km: pace ?? null,
      vertical_oscillation_cm: null,
      ground_contact_time_ms: null,
      temperature_c: null,
    };
  });

  const totalTime =
    trkpts[trkpts.length - 1].time && trkpts[0].time
      ? (new Date(trkpts[trkpts.length - 1].time!).getTime() - t0) / 1000
      : 0;

  return {
    points,
    laps: [],
    totalDistanceM: totalDist,
    totalTimeS: totalTime,
    startedAt: trkpts[0].time ?? null,
    sport: null,
  };
}

async function parseFIT(buffer: ArrayBuffer): Promise<ParsedFile> {
  const FitParser = (await import("fit-file-parser")).default as any;
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    elapsedRecordField: true,
  });

  return await new Promise<ParsedFile>((resolve, reject) => {
    parser.parse(new Uint8Array(buffer), (err: any, data: any) => {
      if (err) return reject(err);

      const records: any[] = data?.records ?? [];
      const laps: any[] = data?.laps ?? [];

      if (!records.length) {
        return resolve({
          points: [],
          laps: [],
          totalDistanceM: 0,
          totalTimeS: 0,
          startedAt: null,
          sport: data?.sport?.sport ?? null,
        });
      }

      const t0 = records[0].timestamp ? new Date(records[0].timestamp).getTime() : 0;

      const points: ParsedPoint[] = records.map((r: any) => {
        const speed = r.enhanced_speed ?? r.speed ?? null;
        const cadence = normalizeCadence(r.cadence);

        return {
          timestamp: r.timestamp ?? null,
          elapsed_s: r.elapsed_time ?? (r.timestamp ? (new Date(r.timestamp).getTime() - t0) / 1000 : 0),
          distance_m: r.distance ?? null,

          lat: r.position_lat != null ? Number(r.position_lat) : null,
          lng: r.position_long != null ? Number(r.position_long) : null,

          elevation_m: r.enhanced_altitude ?? r.altitude ?? null,
          hr: r.heart_rate ?? null,
          cadence,
          pace_sec_per_km: speed && speed > 0.1 ? 1000 / speed : null,
          stride_length_m: speed && cadence ? speed / (cadence / 60) : null,
          vertical_oscillation_cm: r.vertical_oscillation ?? r.vertical_oscillation_mm ?? null,
          ground_contact_time_ms: r.stance_time ?? r.ground_contact_time ?? null,
          temperature_c: r.temperature ?? null,
        };
      });

      const normalizedLaps: ParsedLap[] = laps.map((lap: any, i: number, arr: any[]) => {
        const start = lap.start_time ? new Date(lap.start_time).getTime() : null;
        let end = lap.timestamp ? new Date(lap.timestamp).getTime() : null;

        if (!end && start && lap.total_elapsed_time) {
          end = start + Number(lap.total_elapsed_time) * 1000;
        }

        if (!end && arr[i + 1]?.start_time) {
          end = new Date(arr[i + 1].start_time).getTime();
        }

        return {
          index: i,
          startMs: start,
          endMs: end,
          intensity: lap.intensity ?? null,
          total_distance: Number(lap.total_distance ?? 0),
          total_elapsed_time: Number(lap.total_elapsed_time ?? 0),
          avg_heart_rate: lap.avg_heart_rate ?? null,
          max_heart_rate: lap.max_heart_rate ?? null,
          avg_cadence: normalizeCadence(lap.avg_running_cadence ?? lap.avg_cadence) ?? null,
        };
      });

      const sess = data?.sessions?.[0];
      resolve({
        points,
        laps: normalizedLaps,
        totalDistanceM: Number(sess?.total_distance ?? 0),
        totalTimeS: Number(sess?.total_timer_time ?? 0),
        startedAt: records[0].timestamp ?? null,
        sport: sess?.sport ?? data?.sport?.sport ?? null,
      });
    });
  });
}

function paceSecPerKm(lap: ParsedLap) {
  return lap.total_distance > 0 ? (lap.total_elapsed_time / lap.total_distance) * 1000 : null;
}
function median(nums: number[]) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A gap between consecutive recorded points beyond a normal GPS sampling
// interval means the athlete actually stopped (road crossing, grabbing a
// gel, a toilet break, etc) rather than just kept running slowly. 20s
// matches the threshold already used elsewhere in this codebase's own
// gap-handling reasoning for "this is a real stop, not just slow running".
const STOP_GAP_THRESHOLD_S = 20;

// Attributes each detected stop's duration to whichever lap's time window
// it falls inside (by the gap's midpoint, so a gap that happens to straddle
// a lap boundary isn't double-counted or misattributed to the wrong side).
// This is ONLY used to correct a lap's pace for classification purposes —
// a lap that absorbed a real stop has an inflated total_elapsed_time
// relative to how far it actually covers, which otherwise makes it look
// like a deliberate slow recovery lap and can flip an entire continuous
// run into "intervals" (e.g. a 574s stop baked into one auto-lap producing
// a lap that "paced" at 9:37/km, when the athlete was simply stationary
// for most of it). Stored/displayed durations elsewhere are untouched —
// this never changes what a lap's real total_elapsed_time actually was.
function computeStoppedSecondsPerLap(laps: ParsedLap[], points: MergedPoint[]): Map<number, number> {
  const stopped = new Map<number, number>();
  if (points.length < 2 || laps.length === 0) return stopped;

  const windows = laps
    .map((l) => ({ index: l.index, start: l.startMs ?? null, end: getLapEndMs(l) }))
    .filter((w): w is { index: number; start: number; end: number } => w.start != null && w.end != null);
  if (windows.length === 0) return stopped;

  const sorted = [...points].sort((a, b) => a.elapsed_s - b.elapsed_s);

  let prev: MergedPoint | null = null;
  for (const p of sorted) {
    if (prev && p.timestamp && prev.timestamp) {
      const prevMs = new Date(prev.timestamp).getTime();
      const curMs = new Date(p.timestamp).getTime();
      const gapS = (curMs - prevMs) / 1000;

      if (gapS >= STOP_GAP_THRESHOLD_S) {
        const midMs = (prevMs + curMs) / 2;
        const win = windows.find((w) => midMs >= w.start && midMs <= w.end);
        if (win) {
          stopped.set(win.index, (stopped.get(win.index) ?? 0) + gapS);
        }
      }
    }
    prev = p;
  }
  return stopped;
}

// Same gap detection as computeStoppedSecondsPerLap, but summed across the
// whole session rather than attributed to individual laps — used for the
// session-level "moving time" that Total Avg Pace is based on. A session's
// raw elapsed time (last point's timestamp minus first) always includes
// every real-world stop by definition; moving time is what a coach
// actually means by "pace" when scanning the calendar.
function computeTotalStoppedSeconds(points: MergedPoint[]): number {
  if (points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.elapsed_s - b.elapsed_s);
  let total = 0;
  let prev: MergedPoint | null = null;
  for (const p of sorted) {
    if (prev && p.timestamp && prev.timestamp) {
      const gapS = (new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
      if (gapS >= STOP_GAP_THRESHOLD_S) total += gapS;
    }
    prev = p;
  }
  return total;
}

// Pace used specifically for work/recovery classification — subtracts any
// known stopped time from this lap before computing sec/km, so a lap that
// merely absorbed a real-world pause doesn't read as a slow recovery jog.
// Falls back to the lap's raw pace when no stopped-time map is available
// (e.g. callers that haven't been updated to pass one), which matches the
// previous unconditional behavior exactly.
function classificationPaceSecPerKm(lap: ParsedLap, stoppedSecondsByLapIndex?: Map<number, number>): number | null {
  const stopped = stoppedSecondsByLapIndex?.get(lap.index) ?? 0;
  const movingTime = Math.max(0, lap.total_elapsed_time - stopped);
  return lap.total_distance > 0 && movingTime > 0 ? (movingTime / lap.total_distance) * 1000 : null;
}

function classifyLaps(
  laps: ParsedLap[],
  plannedSteps: any[] = [],
  numFiles: number = 1,
  isRace: boolean = false,
  stoppedSecondsByLapIndex?: Map<number, number>,
): ParsedLap[] {
  if (!Array.isArray(laps) || laps.length === 0) return [];

  const valid = laps.filter((l) => l.total_distance > 0 && l.total_elapsed_time > 0);
  if (valid.length === 0) {
    return laps.map((l) => ({ ...l, kind: "work" as const }));
  }

  const workSteps = getPlannedWorkSteps(plannedSteps);
  const hasPlannedWork = workSteps.length > 0;
  const hasLadderPlan = workSteps.some(stepIsLadder);

  // For a session marked as a race, protect the race distance/time from ever
  // including warmup or cooldown. Distance alone isn't reliable here — a
  // short race (e.g. 1500m) can easily be shorter than its own warmup or
  // cooldown jog. Pace is what's actually reliable: race effort is always
  // dramatically faster than warmup/cooldown jogging, regardless of how far
  // the race itself covers. Whichever file has the fastest median pace is
  // "the race" — anything recorded chronologically before it is warmup,
  // anything after is cooldown.
  //
  // One wrinkle: a warmup file that includes strides (short fast pickups)
  // can easily be *faster per-km* than sustained race effort, despite being
  // a totally different kind of effort. So pace alone isn't quite enough —
  // a candidate also needs a substantial distance to be eligible, ruling out
  // a brief burst of strides from ever outranking the real race.
  if (isRace && numFiles >= 2) {
    const fileDistances = new Map<number, number>();
    const filePaces = new Map<number, number>();
    const fileIndexes = new Set(laps.map((l) => l.sourceFileIndex ?? 0));

    for (const idx of fileIndexes) {
      const fileLaps = laps.filter(
        (l) => (l.sourceFileIndex ?? 0) === idx && l.total_distance > 50 && l.total_elapsed_time > 10,
      );
      const totalDist = fileLaps.reduce((sum, l) => sum + (l.total_distance ?? 0), 0);
      const pace = median(fileLaps.map(paceSecPerKm).filter((p): p is number => p != null));
      fileDistances.set(idx, totalDist);
      if (pace != null) filePaces.set(idx, pace);
    }

    const maxDistance = Math.max(0, ...fileDistances.values());
    // A candidate needs at least 1km, and at least a third of the longest
    // file's distance — enough to rule out a short stride set, without
    // requiring it to literally be the longest file (a short race can still
    // be shorter than its own warmup/cooldown).
    const minCandidateDistance = Math.max(1000, maxDistance * 0.3);

    const eligibleIndexes = [...filePaces.keys()].filter(
      (idx) => (fileDistances.get(idx) ?? 0) >= minCandidateDistance,
    );

    if (eligibleIndexes.length > 0) {
      let raceFileIndex = eligibleIndexes[0];
      let fastestPace = filePaces.get(raceFileIndex) ?? Infinity;
      for (const idx of eligibleIndexes) {
        const pace = filePaces.get(idx)!;
        if (pace < fastestPace) {
          fastestPace = pace;
          raceFileIndex = idx;
        }
      }
      return laps.map((lap) => {
        const idx = lap.sourceFileIndex ?? 0;
        if (idx === raceFileIndex) return { ...lap, kind: "work" as const };
        if (idx < raceFileIndex) return { ...lap, kind: "warmup" as const };
        return { ...lap, kind: "cooldown" as const };
      });
    }
  }

  if (hasPlannedWork) {
    // The loose "distance >= 150m OR time >= 60s" floor below was meant to
    // just weed out obvious lap-button blips, but real recovery jogs
    // between reps routinely run 150-300m over 60-165s — comfortably past
    // both thresholds — so they were getting swept into "work" wholesale.
    // Use the same pace-contrast split as the no-plan path first; only fall
    // back to the loose floor if there's no genuine work/recovery pace
    // contrast to find (e.g. a single continuous planned tempo effort with
    // no recovery laps at all, where "contrast" is meaningless).
    const nonRestCandidates = laps.filter(
      (l) => l.intensity !== "rest" && l.total_distance > 50 && l.total_elapsed_time > 10,
    );
    const { workIndices, isGenuine } = splitLapsByPaceContrast(nonRestCandidates, stoppedSecondsByLapIndex);

    let classified: ParsedLap[] = laps.map((lap) => {
      if (lap.intensity === "rest") {
        return { ...lap, kind: "recovery" as const };
      }

      const isWork = isGenuine ? workIndices.has(lap.index) : lap.total_distance >= 150 || lap.total_elapsed_time >= 60;

      return { ...lap, kind: isWork ? ("work" as const) : ("recovery" as const) };
    });

    const workIdxs = classified.map((l, i) => (l.kind === "work" ? i : -1)).filter((i) => i >= 0);

    if (workIdxs.length > 0) {
      const firstWork = workIdxs[0];
      const lastWork = workIdxs[workIdxs.length - 1];

      classified = classified.map((lap, idx) => {
        if (lap.kind === "work") return lap;
        if (idx < firstWork) return { ...lap, kind: "warmup" as const };
        if (idx > lastWork) return { ...lap, kind: "cooldown" as const };
        return lap;
      });
    }

    // hasLadderPlan doesn't change classification behavior today — flagged
    // here for whenever per-rep targets ship (see is_ladder checkbox in
    // sessions.new.tsx), at which point a ladder plan should probably match
    // each rep's recorded lap against its own planned distance instead of
    // relying on pace contrast alone.
    void hasLadderPlan;

    return classified;
  }

  // When the athlete/coach uploaded multiple SEPARATE files (e.g. distinct
  // Warm Up / Work / Cool Down / Strides recordings), the file boundary
  // itself is a far more reliable signal than lap distance — a warmup jog
  // can easily be a similar distance to a recovery jog between reps, which
  // is exactly what caused a warmup lap to be misclassified as "recovery"
  // and left stranded between work reps instead of tagged as "warmup".
  // So: the earliest file's laps are always warmup, the latest file's laps
  // are always cooldown, and only laps from files in between (or the single
  // file, if there's only one) go through the distance-based heuristic.
  if (numFiles >= 3) {
    const firstFileLaps = laps.filter((l) => l.sourceFileIndex === 0);
    const lastFileLaps = laps.filter((l) => l.sourceFileIndex === numFiles - 1);
    const middleLaps = laps.filter((l) => l.sourceFileIndex !== 0 && l.sourceFileIndex !== numFiles - 1);

    const classifiedMiddle = classifyLapsByDistance(middleLaps, stoppedSecondsByLapIndex);

    return laps.map((lap) => {
      if (lap.sourceFileIndex === 0) return { ...lap, kind: "warmup" as const };
      if (lap.sourceFileIndex === numFiles - 1) return { ...lap, kind: "cooldown" as const };
      const match = classifiedMiddle.find((c) => c.index === lap.index);
      return match ?? { ...lap, kind: "work" as const };
    });
  }

  // Exactly 2 files is genuinely ambiguous by file-position alone — it could
  // be Work + Cool Down (no warmup ever uploaded) or Warm Up + Work (no
  // cooldown uploaded), and those need opposite labeling. Pace resolves it:
  // a cooldown is always meaningfully slower than the work that preceded it,
  // and a warmup is always meaningfully slower than the work that follows
  // it. If neither file is clearly slower than the other, don't force a
  // label — fall through to the normal distance-based classification.
  if (numFiles === 2) {
    const file0Laps = laps.filter((l) => l.sourceFileIndex === 0 && l.total_distance > 50 && l.total_elapsed_time > 10);
    const file1Laps = laps.filter((l) => l.sourceFileIndex === 1 && l.total_distance > 50 && l.total_elapsed_time > 10);

    const pace0 = median(file0Laps.map(paceSecPerKm).filter((p): p is number => p != null));
    const pace1 = median(file1Laps.map(paceSecPerKm).filter((p): p is number => p != null));

    if (pace0 != null && pace1 != null) {
      // Second file clearly slower (higher sec/km) than the first -> cooldown.
      // The "work" file (file0) can still have its own internal work/recovery
      // structure (e.g. "1 x 2km then 5 x 1km" with jogs between reps) — it
      // still needs to go through classifyLapsByDistance rather than being
      // blanket-tagged "work", or every recovery jog inside it silently gets
      // folded into the work total.
      if (pace1 >= pace0 * 1.15) {
        const workFileClassified = classifyLapsByDistance(
          laps.filter((l) => l.sourceFileIndex === 0),
          stoppedSecondsByLapIndex,
        );
        return laps.map((lap) => {
          if (lap.sourceFileIndex === 1) return { ...lap, kind: "cooldown" as const };
          const match = workFileClassified.find((c) => c.index === lap.index);
          return match ?? { ...lap, kind: "work" as const };
        });
      }
      // First file clearly slower than the second -> warmup. Same reasoning
      // applied to file1 (the actual work file) here.
      if (pace0 >= pace1 * 1.15) {
        const workFileClassified = classifyLapsByDistance(
          laps.filter((l) => l.sourceFileIndex === 1),
          stoppedSecondsByLapIndex,
        );
        return laps.map((lap) => {
          if (lap.sourceFileIndex === 0) return { ...lap, kind: "warmup" as const };
          const match = workFileClassified.find((c) => c.index === lap.index);
          return match ?? { ...lap, kind: "work" as const };
        });
      }
    }
  }

  return classifyLapsByDistance(laps, stoppedSecondsByLapIndex);
}

// Splits a set of laps into a "fast" (work) cluster vs a "slow" (recovery)
// cluster using pace contrast, not distance matching. A distance-matching
// heuristic breaks down the moment a session mixes rep distances within one
// recording — e.g. "1 x 2km then 5 x 1km" — because the 2km rep doesn't
// match the "dominant" 1km bucket even though it's clearly real work.
// Recovery laps are dramatically slower (sec/km) than work laps regardless
// of how far either one covers, so pace is what actually distinguishes them.
// Returns the set of lap indices judged to be "work", plus whether a
// genuine two-cluster contrast was found at all (a real continuous run with
// a couple of incidental pauses shouldn't be fragmented into fake reps).
function splitLapsByPaceContrast(
  candidates: ParsedLap[],
  stoppedSecondsByLapIndex?: Map<number, number>,
): { workIndices: Set<number>; isGenuine: boolean } {
  // A lap whose distance dwarfs the rest of the candidate set — e.g. a
  // multi-km continuous run merged into the same session as a short
  // strides set uploaded afterward — isn't part of the same "which of
  // these laps are the real reps" comparison. Left in, its in-between pace
  // (faster than a recovery walk, slower than a genuine short rep) can
  // become the anchor for the "biggest gap" split instead of the boundary
  // that actually separates work from recovery, pulling the run itself
  // into the work cluster while pushing genuine short reps out. Excluded
  // from THIS clustering step only — 5x the candidate set's median
  // distance comfortably separates "one dominant continuous effort" from
  // legitimate rep-length variation (even a 2km rep among 1km reps is
  // nowhere near 5x a ~1km median).
  const candidateDistances = candidates
    .map((l) => Number(l.total_distance ?? 0))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const medianDistance =
    candidateDistances.length > 0 ? candidateDistances[Math.floor(candidateDistances.length / 2)] : 0;
  const outlierLaps =
    medianDistance > 0 ? candidates.filter((l) => Number(l.total_distance ?? 0) > medianDistance * 5) : [];
  const clusteringCandidates =
    medianDistance > 0 ? candidates.filter((l) => Number(l.total_distance ?? 0) <= medianDistance * 5) : candidates;

  const withPace = clusteringCandidates
    .map((l) => ({ lap: l, pace: classificationPaceSecPerKm(l, stoppedSecondsByLapIndex) }))
    .filter((x): x is { lap: ParsedLap; pace: number } => x.pace != null)
    .sort((a, b) => a.pace - b.pace);

  // Too few remaining candidates for a real contrast comparison (e.g. the
  // whole set WAS the outlier, with nothing short left to compare it
  // against). Falls through to isGenuine=false, whose caller already
  // defaults every non-rest lap — outlier included — to "work", so the
  // outlier lap is never lost here even without special-casing it.
  if (withPace.length < 2) return { workIndices: new Set(), isGenuine: false };

  // Find the largest proportional jump between consecutive paces (sorted
  // fastest to slowest) — the natural boundary between a "work effort"
  // cluster and a "recovery effort" cluster, if one exists.
  let bestGapRatio = 1;
  let splitAt = -1; // laps [0..splitAt] (inclusive) are the fast/work cluster

  for (let i = 0; i < withPace.length - 1; i++) {
    const ratio = withPace[i + 1].pace / withPace[i].pace;
    if (ratio > bestGapRatio) {
      bestGapRatio = ratio;
      splitAt = i;
    }
  }

  // Require genuine contrast (recovery clearly slower than work) — same
  // 15% threshold used elsewhere in this file for the same judgment.
  if (splitAt < 0 || bestGapRatio < 1.15) return { workIndices: new Set(), isGenuine: false };

  // A genuine split WAS found among the clustering candidates — the
  // outlier lap(s) excluded above need to be added back in explicitly here.
  // Unlike the withPace.length < 2 case above, the caller checks
  // workIndices.has(index) directly rather than defaulting everything to
  // "work" — an outlier lap absent from workIndices would otherwise fall
  // through to "recovery", misclassifying a genuine 45-minute continuous
  // run as a rest period simply because it was excluded from a pace
  // clustering it was never really part of.
  const workIndices = new Set([
    ...withPace
      .slice(0, splitAt + 1)
      // Guard against a brief lap-button blip computing a fluky fast pace
      // over a couple of seconds — a real work rep is sustained. This was
      // previously 20s, which is nowhere close to "a couple of seconds" and
      // ended up excluding entirely genuine short reps — a fast 85-90m
      // stride commonly finishes in 14-15s, well under 20 but nothing like
      // an accidental blip. That left the actual stride laps thrown out of
      // the work cluster while a much longer recovery-walk lap survived the
      // filter and got miscategorized as the work instead (a 4-rep strides
      // session showing as "1 x 150" — the one surviving recovery lap's
      // own distance, not the strides at all). 5s comfortably still catches
      // a genuine accidental double-tap of the lap button.
      .filter((x) => x.lap.total_elapsed_time >= 5)
      .map((x) => x.lap.index),
    ...outlierLaps.map((l) => l.index),
  ]);

  return { workIndices, isGenuine: true };
}

// The original distance-bucket heuristic, used for a single continuous
// recording (or the "work" portion once explicit warmup/cooldown files have
// already been pulled out above) where there's no other signal available to
// tell warmup/recovery/cooldown apart besides pace and distance patterns.
function classifyLapsByDistance(laps: ParsedLap[], stoppedSecondsByLapIndex?: Map<number, number>): ParsedLap[] {
  if (laps.length === 0) return [];

  if (laps.length < 4) {
    return laps.map((l) => ({ ...l, kind: "work" as const }));
  }

  const nonRestCandidates = laps.filter(
    (l) => l.intensity !== "rest" && l.total_distance > 50 && l.total_elapsed_time > 10,
  );

  const { workIndices, isGenuine } = splitLapsByPaceContrast(nonRestCandidates, stoppedSecondsByLapIndex);

  if (!isGenuine) {
    return laps.map((l) => ({ ...l, kind: l.intensity === "rest" ? ("recovery" as const) : ("work" as const) }));
  }

  let classified: ParsedLap[] = laps.map((lap) => {
    if (lap.intensity === "rest") {
      return { ...lap, kind: "recovery" as const };
    }
    return { ...lap, kind: workIndices.has(lap.index) ? ("work" as const) : ("recovery" as const) };
  });

  const workIdxs = classified.map((l, i) => (l.kind === "work" ? i : -1)).filter((i) => i >= 0);

  if (workIdxs.length > 0) {
    const firstWork = workIdxs[0];
    const lastWork = workIdxs[workIdxs.length - 1];

    classified = classified.map((lap, idx) => {
      if (lap.kind === "work") return lap;
      if (idx < firstWork) return { ...lap, kind: "warmup" as const };
      if (idx > lastWork) return { ...lap, kind: "cooldown" as const };
      return lap;
    });
  }

  return classified;
}

function findLapKindForPoint(timestamp: Date | string | null, laps: ParsedLap[]): string {
  if (!timestamp) return "work";
  const t = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime();
  for (const lap of laps) {
    const start = lap.startMs ?? null;
    const end = getLapEndMs(lap);
    if (start != null && end != null && t >= start && t <= end) {
      return lap.kind ?? "work";
    }
  }
  return "work";
}

function buildWorkRecoveryPairs(classifiedLaps: ParsedLap[]): WorkRecoveryPair[] {
  const pairs: WorkRecoveryPair[] = [];

  for (let i = 0; i < classifiedLaps.length; i++) {
    const lap = classifiedLaps[i];
    if (lap.kind !== "work") continue;

    let recovery: ParsedLap | null = null;

    if (i + 1 < classifiedLaps.length) {
      const next = classifiedLaps[i + 1];
      if (next.kind === "recovery") {
        recovery = next;
      }
    }

    pairs.push({
      work: lap,
      recovery,
    });
  }

  return pairs;
}

// Splits a work block into consecutive groups of similar-distance reps —
// e.g. a "1 x 2km then 5 x 1km" workout — so each group can become its own
// accurate step instead of one step whose target_distance_m is a flat
// average across every rep regardless of length (which turned "1 x 2km,
// 5 x 1km" into a meaningless "6 x 1.2km"). Grouping is sequential (in the
// order reps actually happened), not a global sort — real structured
// workouts run same-length reps back to back, so this also naturally
// handles pyramids/ladders (e.g. 400/800/1200/1200/800/400) as multiple
// groups without needing to assume there are only two distinct lengths.
function splitBlockIntoDistanceGroups(blockPairs: WorkRecoveryPair[]): WorkRecoveryPair[][] {
  if (blockPairs.length <= 1) return [blockPairs];

  const DISTANCE_GROUP_TOLERANCE = 0.2; // reps within a group should be within ~20% of each other

  const groups: WorkRecoveryPair[][] = [];
  let current: WorkRecoveryPair[] = [blockPairs[0]];
  let currentAvgDist = Number(blockPairs[0].work.total_distance ?? 0);

  for (let i = 1; i < blockPairs.length; i++) {
    const dist = Number(blockPairs[i].work.total_distance ?? 0);
    const diffRatio = currentAvgDist > 0 ? Math.abs(dist - currentAvgDist) / currentAvgDist : 0;

    if (diffRatio <= DISTANCE_GROUP_TOLERANCE) {
      current.push(blockPairs[i]);
      // Rolling average so the group's reference distance stays stable as
      // more same-length reps join it, rather than drifting rep-to-rep.
      currentAvgDist = current.reduce((s, p) => s + Number(p.work.total_distance ?? 0), 0) / current.length;
    } else {
      groups.push(current);
      current = [blockPairs[i]];
      currentAvgDist = dist;
    }
  }
  groups.push(current);

  return groups;
}

function splitWorkPairsIntoBlocks(pairs: WorkRecoveryPair[], plannedSteps: any[]) {
  const recoverySteps = getPlannedBlockRecoverySteps(plannedSteps);

  if (recoverySteps.length === 0) {
    return [pairs];
  }

  const recoveryStep = recoverySteps[0];
  const plannedBlockRecoverySeconds = Number(
    recoveryStep?.recovery_target_seconds ?? recoveryStep?.target_time_seconds ?? 0,
  );

  const recoveryDurations = pairs
    .map((p) => Number(p.recovery?.total_elapsed_time ?? 0))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);

  const medianRecovery = recoveryDurations.length > 0 ? recoveryDurations[Math.floor(recoveryDurations.length / 2)] : 0;

  const longRecoveryThreshold =
    plannedBlockRecoverySeconds > 0
      ? plannedBlockRecoverySeconds * 0.7
      : medianRecovery > 0
        ? medianRecovery * 1.75
        : Infinity;

  const blocks: WorkRecoveryPair[][] = [];
  let currentBlock: WorkRecoveryPair[] = [];

  for (const pair of pairs) {
    currentBlock.push(pair);

    const recDur = Number(pair.recovery?.total_elapsed_time ?? 0);
    const isLongRecovery = recDur > 0 && recDur >= longRecoveryThreshold;

    if (isLongRecovery) {
      blocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length > 0) blocks.push(currentBlock);

  return blocks.length > 0 ? blocks : [pairs];
}

// Furthest any recorded point during this lap strayed from the lap's own
// centroid, in metres — i.e. how far the runner actually *ranged* from a
// single spot, independent of how much cumulative GPS distance or cadence
// was recorded getting there. A runner pacing/shuffling near the start
// line between reps can rack up real distance and walk-range cadence
// without ever actually going anywhere; a genuine "walk to a recovery
// point" moves the centroid meaningfully. Returns null when there aren't
// enough located points during the lap window to make the call, so the
// caller can fall back to the distance/cadence heuristic.
function computeRecoverySpatialExtentM(points: MergedPoint[], lap: ParsedLap): number | null {
  if (!lap.startMs) return null;
  const endMs = getLapEndMs(lap);
  if (endMs == null) return null;

  const lapPoints = points.filter((p) => {
    if (!p.timestamp || typeof p.lat !== "number" || typeof p.lng !== "number") return false;
    const t = new Date(p.timestamp).getTime();
    return t >= lap.startMs! && t <= endMs;
  });

  if (lapPoints.length < 3) return null;

  const centroidLat = lapPoints.reduce((s, p) => s + (p.lat as number), 0) / lapPoints.length;
  const centroidLng = lapPoints.reduce((s, p) => s + (p.lng as number), 0) / lapPoints.length;

  return lapPoints.reduce(
    (max, p) => Math.max(max, haversineMeters(centroidLat, centroidLng, p.lat as number, p.lng as number)),
    0,
  );
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function inferRecoveryMode(recoveryLap: ParsedLap | null, points: MergedPoint[] = []): string | null {
  if (!recoveryLap) return null;

  const dist = Number(recoveryLap.total_distance ?? 0);
  const dur = Number(recoveryLap.total_elapsed_time ?? 0);

  if (dur <= 0) return null;

  if (dist < 10) return "rest";

  // Spatial-extent check first: distance/cadence alone can't tell a
  // deliberate "walk 100m" recovery from a runner pacing/shuffling in a
  // tight area near the start line, waiting for the next rep — both can
  // post real GPS distance and walk-range (or even higher, noisy) cadence.
  // If every located point during this recovery stays within a small
  // radius of the group's own centroid, the runner never actually left
  // the spot, whatever the odometer says — that's standing, not a walk.
  const spatialExtentM = computeRecoverySpatialExtentM(points, recoveryLap);
  const STATIONARY_RADIUS_M = 15;
  if (spatialExtentM != null && spatialExtentM <= STATIONARY_RADIUS_M) {
    return "standing";
  }

  // A genuine "walk" recovery involves real ambulation — at least 100m
  // covered over at least 30s. Below that (a brief shuffle, GPS jitter,
  // or someone barely moving), calling it a "walk" overstates what
  // actually happened; "standing" is the honest label.
  const MIN_WALK_DISTANCE_M = 100;
  const MIN_WALK_DURATION_S = 30;
  const movedEnoughToCount = dist >= MIN_WALK_DISTANCE_M && dur >= MIN_WALK_DURATION_S;

  // Cadence is a far more reliable jog-vs-walk signal than pace: genuine
  // recovery jogging (especially straight after a hard rep) is very
  // commonly just as slow as brisk walking pace-wise, but running gait
  // keeps a flight phase and essentially never drops below ~140 total
  // steps/min, while walking gait — however brisk — essentially never
  // reaches it. Prefer cadence whenever the device recorded it; only fall
  // back to the pace-based guess for files with no cadence sensor data.
  const cadence = recoveryLap.avg_cadence;
  if (cadence != null && cadence > 0) {
    const JOG_CADENCE_FLOOR_SPM = 140;
    if (cadence >= JOG_CADENCE_FLOOR_SPM) return "jog";
    return movedEnoughToCount ? "walk" : "standing";
  }

  const paceSecPerKm = dist > 0 ? (dur / dist) * 1000 : null;

  if (paceSecPerKm != null && paceSecPerKm > 700) {
    return movedEnoughToCount ? "walk" : "standing";
  }

  return "jog";
}

function getLapEndMs(lap: ParsedLap | null): number | null {
  if (!lap) return null;
  if (lap.endMs != null) return lap.endMs;
  if (lap.startMs != null && lap.total_elapsed_time > 0) {
    return lap.startMs + lap.total_elapsed_time * 1000;
  }
  return null;
}

function getEndHrForLap(points: MergedPoint[], lap: ParsedLap | null): number | null {
  if (!lap) return null;

  if (!lap.startMs || !getLapEndMs(lap)) {
    return lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
  }

  const endMs = getLapEndMs(lap)!;

  const candidates = points
    .filter((p) => {
      if (!p.timestamp || p.hr == null) return false;
      const t = new Date(p.timestamp).getTime();
      return t >= lap.startMs! && t <= endMs;
    })
    .sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

  if (candidates.length === 0) {
    return lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
  }

  return candidates[candidates.length - 1].hr ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null;
}

function summarizeImportedPoints(points: ParsedPoint[]) {
  const hrs = points.map((p) => p.hr).filter((x): x is number => typeof x === "number");
  const paces = points
    .map((p) => p.pace_sec_per_km)
    .filter((x): x is number => typeof x === "number" && x > 0 && x <= 600);
  const cads = points.map((p) => p.cadence).filter((x): x is number => typeof x === "number" && x > 0);
  const temps = points.map((p) => p.temperature_c).filter((x): x is number => typeof x === "number");

  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const avgPace = paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null;
  const avgCad = cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;
  const avgTemp = temps.length ? Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)) : null;

  return { avgHr, maxHr, avgPace, avgCad, avgTemp };
}

function summarizeLapsMetrics(
  laps: ParsedLap[],
  points: MergedPoint[],
  stoppedSecondsByLapIndex?: Map<number, number>,
) {
  const totalDistance = laps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0);
  // Subtract any real-world stop time (traffic, a gel, a toilet break)
  // that a lap absorbed into its own total_elapsed_time — otherwise a
  // session's "work pace" (and everything downstream of it, including
  // intent classification) reads as much slower than the athlete actually
  // ran, purely because a stop happened to land inside a work-classified
  // lap. This is the same stoppedSecondsByLapIndex map already computed
  // once for classification purposes (computeStoppedSecondsPerLap) — reused
  // here rather than detecting gaps a second time.
  const totalTime = laps.reduce((s, l) => {
    const stopped = stoppedSecondsByLapIndex?.get(l.index) ?? 0;
    return s + Math.max(0, Number(l.total_elapsed_time ?? 0) - stopped);
  }, 0);

  const hrWeighted = laps.reduce((s, l) => {
    if (l.avg_heart_rate == null) return s;
    return s + Number(l.avg_heart_rate) * Number(l.total_elapsed_time ?? 0);
  }, 0);

  const hrTime = laps.reduce((s, l) => {
    if (l.avg_heart_rate == null) return s;
    return s + Number(l.total_elapsed_time ?? 0);
  }, 0);

  const avgHr = hrTime > 0 ? Math.round(hrWeighted / hrTime) : null;
  const maxHr = laps.reduce((m, l) => Math.max(m, Number(l.max_heart_rate ?? 0)), 0) || null;

  const cadWeighted = laps.reduce((s, l) => {
    if (l.avg_cadence == null) return s;
    return s + Number(l.avg_cadence) * Number(l.total_elapsed_time ?? 0);
  }, 0);

  const cadTime = laps.reduce((s, l) => {
    if (l.avg_cadence == null) return s;
    return s + Number(l.total_elapsed_time ?? 0);
  }, 0);

  const avgCad = cadTime > 0 ? Math.round(cadWeighted / cadTime) : null;
  const endHr = laps.length > 0 ? getEndHrForLap(points, laps[laps.length - 1]) : null;

  return {
    distance: totalDistance || null,
    time: totalTime || null,
    avgHr,
    maxHr,
    avgCad,
    endHr,
  };
}

function sortFilesForRebuild(files: any[]) {
  return [...files].sort((a, b) => {
    const ta = a.started_at ? new Date(a.started_at).getTime() : a.created_at ? new Date(a.created_at).getTime() : 0;

    const tb = b.started_at ? new Date(b.started_at).getTime() : b.created_at ? new Date(b.created_at).getTime() : 0;

    return ta - tb;
  });
}

async function parseStoredFile(sb: any, file: { storage_path: string; file_kind: string }): Promise<ParsedFile | null> {
  const { data: blob, error } = await sb.storage.from("session-files").download(file.storage_path);
  if (error || !blob) return null;
  const buf = await blob.arrayBuffer();

  try {
    if (file.file_kind === "gpx") {
      return parseGPX(new TextDecoder().decode(new Uint8Array(buf)));
    }
    return await parseFIT(buf);
  } catch {
    return null;
  }
}

function buildIntervalRowsFromPlan(
  workBlocks: WorkRecoveryPair[][],
  plannedSteps: any[],
  mergedPoints: MergedPoint[] = [],
) {
  const workSteps = getPlannedWorkSteps(plannedSteps);
  const rows: any[] = [];
  // Track rep/set counters per step_id so that when multiple work blocks
  // fall back to the same planned step (blockIdx >= workSteps.length), we
  // don't restart at set=1/rep=1 and collide with the earlier block's rows
  // — the (step_id, set_number, rep_number) unique constraint would reject
  // the whole insert.
  const counters = new Map<string, { setNumber: number; repNumber: number; ladderIndex: number }>();

  for (let blockIdx = 0; blockIdx < workBlocks.length; blockIdx++) {
    const pairs = workBlocks[blockIdx] ?? [];
    const workStep = workSteps[blockIdx] ?? workSteps[workSteps.length - 1];

    if (!workStep || pairs.length === 0) continue;

    const repsPerSet = Math.max(1, Number(workStep.reps ?? pairs.length));
    const setCount = Math.max(1, Number(workStep.set_count ?? 1));
    const ladder = stepIsLadder(workStep);

    const c = counters.get(workStep.id) ?? { setNumber: 1, repNumber: 0, ladderIndex: 0 };

    for (let i = 0; i < pairs.length; i++) {
      c.repNumber += 1;
      c.ladderIndex += 1;

      if (!ladder && c.repNumber > repsPerSet) {
        c.setNumber += 1;
        c.repNumber = 1;
      }

      const pair = pairs[i];
      const lap = pair.work;
      const recovery = pair.recovery;

      rows.push({
        step_id: workStep.id,
        set_number: Math.min(c.setNumber, setCount),
        rep_number: ladder ? c.ladderIndex : c.repNumber,
        actual_time_seconds: lap.total_elapsed_time || null,
        actual_distance_m: lap.total_distance || null,
        actual_pace_sec_per_km:
          lap.total_distance > 0 && lap.total_elapsed_time > 0
            ? (lap.total_elapsed_time / lap.total_distance) * 1000
            : null,
        hr_avg: lap.avg_heart_rate ?? null,
        hr_max: lap.max_heart_rate ?? null,
        hr_end: getEndHrForLap(mergedPoints, lap) ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null,
        hr_end_recovery: getEndHrForLap(mergedPoints, recovery) ?? recovery?.avg_heart_rate ?? null,
        cadence: lap.avg_cadence ?? null,
      });
    }

    counters.set(workStep.id, c);
  }

  // Final safety net: if any duplicate (step_id, set_number, rep_number)
  // survives — e.g. clamping to setCount collapsed two rows to the same
  // slot — keep the last one so the insert doesn't hit the unique
  // constraint.
  const dedup = new Map<string, any>();
  for (const r of rows) {
    dedup.set(`${r.step_id}|${r.set_number}|${r.rep_number}`, r);
  }
  return Array.from(dedup.values());
}

/**
 * Rebuild entire FIT/GPX-derived session from all attached files.
 * This is the single source of truth for raw_session_points / steps / interval_results.
 */
async function rebuildSessionFromAllFiles(sb: any, sessionId: string): Promise<void> {
  const { data: sess, error: sessErr } = await sb.from("sessions").select("*").eq("id", sessionId).single();

  if (sessErr || !sess) throw sessErr ?? new Error("Session not found for rebuild");

  const { data: files } = await sb
    .from("session_files")
    .select("id, storage_path, file_kind, started_at, total_distance_m, total_time_s, created_at")
    .eq("session_id", sessionId);

  const safeFiles = sortFilesForRebuild(files ?? []);

  await sb.from("session_zone_time").delete().eq("session_id", sessionId);
  await sb.from("session_fatigue").delete().eq("session_id", sessionId);
  await sb.from("raw_session_points").delete().eq("session_id", sessionId);

  const { data: existingSteps } = await sb.from("steps").select("id").eq("session_id", sessionId);

  const existingStepIds = (existingSteps ?? []).map((s: any) => s.id);

  const { data: plannedStepsAll } = await sb.from("steps").select("*").eq("session_id", sessionId).order("step_order");

  const safePlannedSteps = plannedStepsAll ?? [];
  const hasManualPlan = Boolean(sess.is_planned) && safePlannedSteps.length > 0;

  if (existingStepIds.length > 0) {
    await sb.from("interval_results").delete().in("step_id", existingStepIds);
  }

  if (!hasManualPlan && existingStepIds.length > 0) {
    await sb.from("steps").delete().eq("session_id", sessionId);
  }

  if (safeFiles.length === 0) {
    await sb
      .from("sessions")
      .update({
        total_distance_m: null,
        total_time_seconds: null,
        work_distance_m: null,
        work_time_s: null,
        avg_hr: null,
        max_hr: null,
        average_temp_c: null,
        work_avg_hr: null,
        work_avg_pace_sec_per_km: null,
        work_avg_cadence: null,
        completion_pct: null,
        structure: hasManualPlan ? sess.structure : "continuous",
        needs_review: true,
      } as any)
      .eq("id", sessionId);

    return;
  }

  const parsedFiles: { file: any; parsed: ParsedFile }[] = [];
  for (const f of safeFiles) {
    const parsed = await parseStoredFile(sb, f);
    if (parsed) parsedFiles.push({ file: f, parsed });
  }

  if (parsedFiles.length === 0) {
    throw new Error("Rebuild failed: no attached file could be parsed");
  }

  const anchorMsList = parsedFiles
    .map((p) => {
      const rawStart = p.parsed.startedAt ?? p.file.started_at ?? p.file.created_at ?? null;
      return rawStart ? new Date(rawStart).getTime() : null;
    })
    .filter((x): x is number => x !== null);

  const anchorMs = anchorMsList.length > 0 ? Math.min(...anchorMsList) : 0;

  const mergedPoints: MergedPoint[] = [];
  let cumulativeDistanceOffset = 0;

  for (const { file, parsed } of parsedFiles) {
    const rawStart = parsed.startedAt ?? file.started_at ?? file.created_at ?? null;
    const fileStartMs = rawStart ? new Date(rawStart).getTime() : anchorMs;
    const offsetS = anchorMs > 0 ? (fileStartMs - anchorMs) / 1000 : 0;

    let fileMaxDistance = 0;

    for (const p of parsed.points) {
      const pointDistance = Number(p.distance_m ?? 0);
      if (pointDistance > fileMaxDistance) fileMaxDistance = pointDistance;

      mergedPoints.push({
        ...p,
        elapsed_s: Number(p.elapsed_s ?? 0) + offsetS,
        distance_m: p.distance_m != null ? Number(p.distance_m) + cumulativeDistanceOffset : null,
        file_id: file.id,
      });
    }

    cumulativeDistanceOffset += fileMaxDistance;
  }

  mergedPoints.sort((a, b) => a.elapsed_s - b.elapsed_s);

  const mergedLaps: ParsedLap[] = [];
  parsedFiles.forEach(({ parsed }, fileIdx) => {
    for (const lap of parsed.laps) {
      mergedLaps.push({ ...lap, sourceFileIndex: fileIdx });
    }
  });

  mergedLaps.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  mergedLaps.forEach((l, i) => {
    l.index = i;
  });

  // Cross-training FIT/GPX uploads (currently just 'ride' — swim FIT
  // parsing isn't built yet, and gym has no file-upload path at all) skip
  // the running-specific classification pipeline entirely from here on:
  // lap classification, warmup/work/cooldown splitting, and pace-zone
  // intent scoring are all calibrated to running and would produce
  // nonsense against a bike ride (e.g. scoring a hard bike interval as a
  // running "VO2" effort, or splitting a ride into "warmup"/"work" laps
  // based on running pace contrast). Instead: keep the merged raw points
  // (so the map/trace still renders on the analysis page), write simple
  // whole-session totals, and skip laps/steps/interval_results entirely.
  // HR zone time still gets populated separately, via
  // recompute_session_zones()'s whole-session HR fallback for sessions
  // with no interval_results to bucket (see
  // migration_02_cross_training_hr_zones.sql) — triggered automatically
  // by the sessions UPDATE below, same as it always has been.
  if (sess.activity_type && sess.activity_type !== "run" && sess.activity_type !== "track") {
    const totalStoppedS = computeTotalStoppedSeconds(mergedPoints);
    const totalDistanceM =
      mergedPoints.length > 0
        ? Number(mergedPoints[mergedPoints.length - 1].distance_m ?? 0)
        : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalDistanceM ?? 0), 0);
    const totalTimeS =
      mergedPoints.length > 0
        ? Number(mergedPoints[mergedPoints.length - 1].elapsed_s ?? 0)
        : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalTimeS ?? 0), 0);
    const totalMovingTimeS = Math.max(0, totalTimeS - totalStoppedS);
    const { avgHr, maxHr, avgTemp } = summarizeImportedPoints(mergedPoints);

    if (mergedPoints.length > 0) {
      const rows = mergedPoints.map((p) => ({
        session_id: sessionId,
        file_id: p.file_id,
        segment_type: "work",
        elapsed_s: p.elapsed_s,
        distance_m: p.distance_m ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        hr: p.hr ?? null,
        pace_sec_per_km: p.pace_sec_per_km ?? null,
        cadence: p.cadence ?? null,
        elevation_m: p.elevation_m ?? null,
        vertical_oscillation_cm: p.vertical_oscillation_cm ?? null,
        ground_contact_time_ms: p.ground_contact_time_ms ?? null,
        temperature_c: p.temperature_c ?? null,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("raw_session_points").insert(rows.slice(i, i + 500) as any);
        if (error) throw error;
      }
    }

    await sb
      .from("sessions")
      .update({
        total_distance_m: totalDistanceM || null,
        total_time_seconds: totalTimeS || null,
        total_moving_time_seconds: totalMovingTimeS || null,
        work_distance_m: null,
        work_time_s: null,
        avg_hr: avgHr,
        max_hr: maxHr,
        average_temp_c: avgTemp,
        work_avg_hr: null,
        work_avg_pace_sec_per_km: null,
        work_avg_cadence: null,
        completion_pct: 100,
        structure: "continuous",
        needs_review: false,
      } as any)
      .eq("id", sessionId);

    return;
  }

  // Real-world stops (traffic, a gel, a toilet break) get baked into
  // whichever lap's total_elapsed_time they fell inside, inflating that
  // lap's apparent pace enough to look like a deliberate slow recovery jog
  // — this corrects for that before classification runs, without touching
  // any stored/displayed duration.
  const stoppedSecondsByLapIndex = computeStoppedSecondsPerLap(mergedLaps, mergedPoints);

  const classifiedLaps = classifyLaps(
    mergedLaps,
    hasManualPlan ? safePlannedSteps : [],
    parsedFiles.length,
    sess.day_type === "race",
    stoppedSecondsByLapIndex,
  );
  const pairs = buildWorkRecoveryPairs(classifiedLaps);

  const workLaps = classifiedLaps.filter((l) => l.kind === "work");
  const warmupLaps = classifiedLaps.filter((l) => l.kind === "warmup");
  const cooldownLaps = classifiedLaps.filter((l) => l.kind === "cooldown");

  // Computed once here (not inside the hasManualPlan branch below) so these
  // are in scope for the final sessions.update() — previously work_avg_pace_
  // sec_per_km etc. fell back to the whole-session blended average because
  // work-specific metrics were never computed outside that branch.
  const warmupMetrics = summarizeLapsMetrics(warmupLaps, mergedPoints, stoppedSecondsByLapIndex);
  const cooldownMetrics = summarizeLapsMetrics(cooldownLaps, mergedPoints, stoppedSecondsByLapIndex);
  const workMetrics = summarizeLapsMetrics(workLaps, mergedPoints, stoppedSecondsByLapIndex);

  // Same fix as isContinuous below: "intervals" means genuine recovery
  // breaks occurred, not "more than one work lap exists". A watch
  // auto-lapping a plain continuous run every ~1km produces many pairs
  // with zero real recovery between them — `pairs.length > 1` alone can't
  // tell that apart from an actual interval session, which is exactly what
  // was mislabeling ordinary continuous runs as "intervals" (and flagging
  // them needs_review) whenever a stop for traffic/a gel/etc happened to
  // land on an auto-lap boundary.
  const isIntervals = pairs.some((p) => p.recovery != null);

  const totalDistanceM =
    mergedPoints.length > 0
      ? Number(mergedPoints[mergedPoints.length - 1].distance_m ?? 0)
      : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalDistanceM ?? 0), 0);

  const totalTimeS =
    mergedPoints.length > 0
      ? Number(mergedPoints[mergedPoints.length - 1].elapsed_s ?? 0)
      : parsedFiles.reduce((s, p) => s + Number(p.parsed.totalTimeS ?? 0), 0);

  // "Total Time" (totalTimeS above) intentionally stays as true elapsed
  // duration — how long the athlete was actually out there, stops
  // included, which is its own useful number. "Total Avg Pace" on the
  // Overview divides distance by time with no separate moving-time concept
  // to fall back on, so a 574s stop for a mid-run break inflated the whole
  // session's average pace by nearly a minute per km. total_moving_time_s
  // gives that calculation something better to divide by, without changing
  // what total_time_seconds itself means.
  const totalStoppedS = computeTotalStoppedSeconds(mergedPoints);
  const totalMovingTimeS = Math.max(0, totalTimeS - totalStoppedS);

  const { avgHr, maxHr, avgPace, avgCad, avgTemp } = summarizeImportedPoints(mergedPoints);

  if (mergedPoints.length > 0) {
    const rows = mergedPoints.map((p) => ({
      session_id: sessionId,
      file_id: p.file_id,
      segment_type: findLapKindForPoint(p.timestamp ?? null, classifiedLaps),
      elapsed_s: p.elapsed_s,
      distance_m: p.distance_m ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      hr: p.hr ?? null,
      pace_sec_per_km: p.pace_sec_per_km ?? null,
      cadence: p.cadence ?? null,
      elevation_m: p.elevation_m ?? null,
      vertical_oscillation_cm: p.vertical_oscillation_cm ?? null,
      ground_contact_time_ms: p.ground_contact_time_ms ?? null,
      temperature_c: p.temperature_c ?? null,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("raw_session_points").insert(rows.slice(i, i + 500) as any);
      if (error) throw error;
    }
  }

  if (hasManualPlan) {
    const workBlocks = splitWorkPairsIntoBlocks(pairs, safePlannedSteps);
    const intervalRows = buildIntervalRowsFromPlan(workBlocks, safePlannedSteps, mergedPoints);

    if (intervalRows.length > 0) {
      const { error } = await sb.from("interval_results").insert(intervalRows as any);
      if (error) throw error;
    }
  } else {
    const stepsToInsert: any[] = [];
    let stepOrder = 1;

    const hasWarmup = Number(warmupMetrics.time ?? 0) >= 120 || Number(warmupMetrics.distance ?? 0) >= 200;

    const hasCooldown = Number(cooldownMetrics.time ?? 0) >= 120 || Number(cooldownMetrics.distance ?? 0) >= 200;

    const recoveryDurations = pairs.map((p) => Number(p.recovery?.total_elapsed_time ?? 0)).filter((x) => x > 0);

    const sortedRec = [...recoveryDurations].sort((a, b) => a - b);
    const medianRec = sortedRec.length > 0 ? sortedRec[Math.floor(sortedRec.length / 2)] : 0;
    const betweenSetThreshold = medianRec > 0 ? medianRec * 1.75 : Infinity;

    const shortRecoveries = recoveryDurations.filter((x) => x > 0 && x < betweenSetThreshold);
    const recoveryForAvg = shortRecoveries.length > 0 ? shortRecoveries : recoveryDurations;

    const avgRecovery =
      recoveryForAvg.length > 0 ? Math.round(recoveryForAvg.reduce((a, b) => a + b, 0) / recoveryForAvg.length) : null;

    const recoveryMode = inferRecoveryMode(
      pairs.find(
        (p) =>
          Number(p.recovery?.total_elapsed_time ?? 0) > 0 &&
          Number(p.recovery?.total_elapsed_time ?? 0) < betweenSetThreshold,
      )?.recovery ??
        pairs[0]?.recovery ??
        null,
      mergedPoints,
    );

    const workBlocks: WorkRecoveryPair[][] = [];
    let currentBlock: WorkRecoveryPair[] = [];

    for (const pair of pairs) {
      currentBlock.push(pair);
      const recDur = Number(pair.recovery?.total_elapsed_time ?? 0);

      if (recDur >= betweenSetThreshold) {
        workBlocks.push(currentBlock);
        currentBlock = [];
      }
    }
    if (currentBlock.length > 0) workBlocks.push(currentBlock);

    const haveBetweenSet = workBlocks.length > 1;

    // "Continuous" means no genuine recovery break ever occurred — NOT "the
    // file only had one lap". buildWorkRecoveryPairs() creates one pair per
    // work-classified lap, so a normal watch auto-lapping every ~1km on a
    // plain easy run produces many pairs even when every lap is "work" with
    // zero real recovery between them (e.g. after classifyLapsByDistance
    // correctly found no genuine work/recovery pace contrast at all). The
    // old `pairs.length <= 1` check only caught a file with a single lap
    // total, so a multi-auto-lap continuous run fell through to the
    // block-splitting branch below and got fragmented into fake "N x
    // distance" reps around ordinary GPS/lap-timing noise (e.g. a short lap
    // left over from a brief real-world stop for traffic, a gel, etc).
    // Reuses isIntervals (same underlying test, computed above) rather than
    // a second copy of the same check, so the two can't drift apart again.
    const isContinuous = !isIntervals && !hasWarmup && !hasCooldown;

    if (isContinuous) {
      stepsToInsert.push({
        session_id: sessionId,
        step_order: stepOrder++,
        kind: "work",
        reps: 1,
        set_count: 1,
        target_kind: totalDistanceM > 0 ? "distance" : "time",
        target_distance_m: totalDistanceM > 0 ? totalDistanceM : null,
        target_time_seconds: totalDistanceM > 0 ? null : totalTimeS > 0 ? totalTimeS : null,
        counts_toward_distance: true,
      });
    } else {
      if (hasWarmup) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "warmup",
          reps: 1,
          set_count: 1,
          target_kind: warmupMetrics.distance && warmupMetrics.distance > 0 ? "distance" : "time",
          target_distance_m: warmupMetrics.distance && warmupMetrics.distance > 0 ? warmupMetrics.distance : null,
          target_time_seconds: warmupMetrics.time && warmupMetrics.time > 0 ? warmupMetrics.time : null,
          counts_toward_distance: true,
        });
      }

      const pushWorkStep = (blockPairs: WorkRecoveryPair[]) => {
        const distanceGroups = splitBlockIntoDistanceGroups(blockPairs);

        for (const groupPairs of distanceGroups) {
          const groupWorkLaps = groupPairs.map((p) => p.work);
          const groupDist = groupWorkLaps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0);
          const groupTime = groupWorkLaps.reduce((s, l) => s + Number(l.total_elapsed_time ?? 0), 0);

          // Recovery stats scoped to THIS group's own reps — a group only
          // has "between rep" recovery among its own members, not whatever
          // recovery happened to come first across the whole block. A
          // group's last member's `.recovery` is the transition into the
          // NEXT group (or into cooldown) rather than a same-distance
          // internal recovery, so it's naturally excluded here since only
          // reps before the last one within a group have a same-group
          // "next rep" to recover into.
          const groupRecoveryPairs = groupPairs.slice(0, -1);
          const groupRecoveryDurations = groupRecoveryPairs
            .map((p) => Number(p.recovery?.total_elapsed_time ?? 0))
            .filter((x) => x > 0);

          const groupAvgRecovery =
            groupRecoveryDurations.length > 0
              ? Math.round(groupRecoveryDurations.reduce((a, b) => a + b, 0) / groupRecoveryDurations.length)
              : null;

          const groupRecoveryMode =
            groupRecoveryPairs.length > 0
              ? inferRecoveryMode(groupRecoveryPairs[0]?.recovery ?? null, mergedPoints)
              : null;

          stepsToInsert.push({
            session_id: sessionId,
            step_order: stepOrder++,
            kind: "work",
            reps: groupPairs.length,
            set_count: 1,
            target_kind: groupDist > 0 ? "distance" : "time",
            target_distance_m: groupDist > 0 ? Math.round(groupDist / Math.max(1, groupPairs.length)) : null,
            target_time_seconds: groupDist > 0 ? null : Math.round(groupTime / Math.max(1, groupPairs.length)),
            counts_toward_distance: true,
            recovery_between_reps_seconds: groupAvgRecovery ?? avgRecovery,
            recovery_between_reps_target_kind: (groupAvgRecovery ?? avgRecovery) != null ? "time" : null,
            recovery_between_reps_mode: groupRecoveryMode ?? recoveryMode,
          });
        }
      };

      if (pairs.length > 0) {
        if (haveBetweenSet) {
          for (let bi = 0; bi < workBlocks.length; bi++) {
            pushWorkStep(workBlocks[bi]);

            if (bi < workBlocks.length - 1) {
              const blk = workBlocks[bi];
              const recLap = blk[blk.length - 1]?.recovery;
              const recDur = Number(recLap?.total_elapsed_time ?? 0);
              const recDist = Number(recLap?.total_distance ?? 0);

              stepsToInsert.push({
                session_id: sessionId,
                step_order: stepOrder++,
                kind: "recovery",
                reps: 1,
                set_count: 1,
                target_kind: recDist > 0 ? "distance" : "time",
                target_distance_m: recDist > 0 ? recDist : null,
                target_time_seconds: recDur > 0 ? recDur : null,
                counts_toward_distance: false,
              });
            }
          }
        } else {
          pushWorkStep(pairs);
        }
      } else if (workLaps.length > 0 || totalDistanceM > 0 || totalTimeS > 0) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "work",
          reps: 1,
          set_count: 1,
          target_kind: totalDistanceM > 0 ? "distance" : "time",
          target_distance_m: totalDistanceM > 0 ? totalDistanceM : null,
          target_time_seconds: totalDistanceM > 0 ? null : totalTimeS > 0 ? totalTimeS : null,
          counts_toward_distance: true,
        });
      }

      if (hasCooldown) {
        stepsToInsert.push({
          session_id: sessionId,
          step_order: stepOrder++,
          kind: "cooldown",
          reps: 1,
          set_count: 1,
          target_kind: cooldownMetrics.distance && cooldownMetrics.distance > 0 ? "distance" : "time",
          target_distance_m: cooldownMetrics.distance && cooldownMetrics.distance > 0 ? cooldownMetrics.distance : null,
          target_time_seconds: cooldownMetrics.time && cooldownMetrics.time > 0 ? cooldownMetrics.time : null,
          counts_toward_distance: true,
        });
      }
    }

    if (stepsToInsert.length === 0) {
      throw new Error("Rebuild produced no steps from attached files");
    }

    const { data: insertedSteps, error: stepsErr } = await sb
      .from("steps")
      .insert(stepsToInsert as any)
      .select();

    if (stepsErr) throw stepsErr;
    if (!insertedSteps?.length) {
      throw new Error("No steps were inserted for uploaded session");
    }

    const workSteps = insertedSteps
      .filter((s: any) => s.kind === "work")
      .sort((a: any, b: any) => Number(a.step_order) - Number(b.step_order));

    const warmupStep = insertedSteps.find((s: any) => s.kind === "warmup");
    const cooldownStep = insertedSteps.find((s: any) => s.kind === "cooldown");
    const recoverySteps = insertedSteps
      .filter((s: any) => s.kind === "recovery")
      .sort((a: any, b: any) => Number(a.step_order) - Number(b.step_order));

    const intervalRows: any[] = [];

    if (hasWarmup && warmupStep) {
      intervalRows.push({
        step_id: warmupStep.id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: warmupMetrics.time,
        actual_distance_m: warmupMetrics.distance,
        actual_pace_sec_per_km:
          warmupMetrics.distance && warmupMetrics.time
            ? (Number(warmupMetrics.time) / Number(warmupMetrics.distance)) * 1000
            : null,
        hr_avg: warmupMetrics.avgHr,
        hr_max: warmupMetrics.maxHr,
        hr_end: warmupMetrics.endHr,
        hr_end_recovery: null,
        cadence: warmupMetrics.avgCad,
      });
    }

    // Must mirror the isContinuous gate used for the steps insert above,
    // not just "were there any work-classified pairs" — isContinuous=true
    // inserts exactly ONE work step (reps: 1) regardless of how many raw
    // laps/pairs the watch recorded, but splitBlockIntoDistanceGroups()
    // below has no idea isContinuous exists and will still happily carve
    // those same laps into several distance groups. That produces more
    // "groups" than there were actual inserted work steps, so groups past
    // the first one fall back to reusing workSteps[0], stamping
    // duplicate/overlapping (step_id, rep_number) rows for a single
    // continuous run and leaving the session with no coherent rep data —
    // empty Time/Distance/HR fields in the UI. A continuous session takes
    // the single-row fallback below instead, the same one already used
    // when there are zero pairs at all.
    if (!isContinuous && pairs.length > 0) {
      if (workSteps.length === 0) {
        throw new Error("Uploaded session did not create a work step");
      }

      const blocksForReps = haveBetweenSet ? workBlocks : [pairs];

      // `workSteps` is a flat list with one entry per distance group, in
      // the exact order pushWorkStep created them: for each between-set
      // block, one step per distance group inside it (see
      // splitBlockIntoDistanceGroups). Previously this loop assigned reps
      // using only the between-set block index (`workSteps[bi]`), which is
      // correct when a block contains a single distance group but silently
      // dumped every rep from a multi-distance-group block (e.g. a 2km
      // opener + 5×1km reps with no long recovery between them, so
      // haveBetweenSet is false and blocksForReps is just one block) onto
      // workSteps[0] — the block's *first* step got every rep's results,
      // and every subsequent distance-group step (the "5×1km" one) was
      // created with the right target/reps but zero interval_results.
      // Walking the same per-block distance-group split here keeps the
      // step assignment and rep numbering in lockstep with how the steps
      // themselves were created.
      let workStepCursor = 0;

      for (let bi = 0; bi < blocksForReps.length; bi++) {
        const blk = blocksForReps[bi];
        const distanceGroupsForBlock = splitBlockIntoDistanceGroups(blk);

        for (const groupPairs of distanceGroupsForBlock) {
          const ws = workSteps[workStepCursor] ?? workSteps[workSteps.length - 1];
          workStepCursor++;

          groupPairs.forEach((pair, idx) => {
            const lap = pair.work;
            const recovery = pair.recovery;

            intervalRows.push({
              step_id: ws.id,
              set_number: 1,
              rep_number: idx + 1,
              actual_time_seconds: lap.total_elapsed_time || null,
              actual_distance_m: lap.total_distance || null,
              actual_pace_sec_per_km:
                lap.total_distance > 0 && lap.total_elapsed_time > 0
                  ? (lap.total_elapsed_time / lap.total_distance) * 1000
                  : null,
              hr_avg: lap.avg_heart_rate ?? null,
              hr_max: lap.max_heart_rate ?? null,
              hr_end: getEndHrForLap(mergedPoints, lap) ?? lap.max_heart_rate ?? lap.avg_heart_rate ?? null,
              hr_end_recovery: getEndHrForLap(mergedPoints, recovery) ?? recovery?.avg_heart_rate ?? null,
              cadence: lap.avg_cadence ?? null,
            });
          });
        }

        if (haveBetweenSet && bi < recoverySteps.length) {
          const recLap = blk[blk.length - 1]?.recovery;
          if (recLap) {
            intervalRows.push({
              step_id: recoverySteps[bi].id,
              set_number: 1,
              rep_number: 1,
              actual_time_seconds: recLap.total_elapsed_time || null,
              actual_distance_m: recLap.total_distance || null,
              actual_pace_sec_per_km:
                recLap.total_distance > 0 && recLap.total_elapsed_time > 0
                  ? (recLap.total_elapsed_time / recLap.total_distance) * 1000
                  : null,
              hr_avg: recLap.avg_heart_rate ?? null,
              hr_max: recLap.max_heart_rate ?? null,
              hr_end: getEndHrForLap(mergedPoints, recLap) ?? recLap.max_heart_rate ?? recLap.avg_heart_rate ?? null,
              hr_end_recovery: null,
              cadence: recLap.avg_cadence ?? null,
            });
          }
        }
      }
    } else if (workSteps.length > 0 && (totalDistanceM > 0 || totalTimeS > 0)) {
      const actualPace = totalDistanceM > 0 && totalTimeS > 0 ? (totalTimeS / totalDistanceM) * 1000 : null;

      intervalRows.push({
        step_id: workSteps[0].id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: totalTimeS || null,
        actual_distance_m: totalDistanceM || null,
        actual_pace_sec_per_km: actualPace,
        hr_avg: avgHr,
        hr_max: maxHr,
        hr_end: maxHr ?? avgHr,
        hr_end_recovery: null,
        cadence: avgCad,
      });
    }

    if (hasCooldown && cooldownStep) {
      intervalRows.push({
        step_id: cooldownStep.id,
        set_number: 1,
        rep_number: 1,
        actual_time_seconds: cooldownMetrics.time,
        actual_distance_m: cooldownMetrics.distance,
        actual_pace_sec_per_km:
          cooldownMetrics.distance && cooldownMetrics.time
            ? (Number(cooldownMetrics.time) / Number(cooldownMetrics.distance)) * 1000
            : null,
        hr_avg: cooldownMetrics.avgHr,
        hr_max: cooldownMetrics.maxHr,
        hr_end: cooldownMetrics.endHr,
        hr_end_recovery: null,
        cadence: cooldownMetrics.avgCad,
      });
    }

    if (intervalRows.length > 0) {
      const { error } = await sb.from("interval_results").insert(intervalRows as any);
      if (error) throw error;
    }
  }

  const workDistance = isIntervals ? workLaps.reduce((s, l) => s + Number(l.total_distance ?? 0), 0) : totalDistanceM;

  const workTime = isIntervals ? workLaps.reduce((s, l) => s + Number(l.total_elapsed_time ?? 0), 0) : totalTimeS;
  let weatherTemp: number | null = null;
  let weatherWind: number | null = null;
  let locationName: string | null = null;

  if (mergedPoints.length > 0) {
    const withGps = mergedPoints.filter(
      (p) =>
        typeof p.lat === "number" &&
        typeof p.lng === "number" &&
        Math.abs(p.lat) > 0.001 && // reject null-island noise, not just exact 0
        Math.abs(p.lng) > 0.001 &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180,
    );

    // prefer a fix from early in the activity, but fall back to anywhere
    const earlyWindow = withGps.filter((p) => p.elapsed_s <= 300);
    const candidates = earlyWindow.length > 0 ? earlyWindow : withGps;
    const firstPoint = candidates.length > 0 ? candidates[Math.floor(candidates.length / 2)] : null;

    // Use this point's OWN timestamp, not parsedFiles[0]'s start time — if
    // the early window came up empty and we fell back to "anywhere in the
    // merged session", that point could be from a much later file (e.g.
    // the cooldown), and pairing its location with a much-earlier file's
    // start time would ask the weather API for the wrong hour entirely.
    if (firstPoint?.timestamp) {
      const weather = await fetchWeather(firstPoint.lat!, firstPoint.lng!, firstPoint.timestamp);
      weatherTemp = weather.temp;
      weatherWind = weather.wind;
      locationName = await fetchLocationName(firstPoint.lat!, firstPoint.lng!);
    }
  }

  const workPaceSecPerKm =
    workMetrics.distance && workMetrics.time ? (Number(workMetrics.time) / Number(workMetrics.distance)) * 1000 : null;

  const easyDistance = (warmupMetrics.distance ?? 0) + (cooldownMetrics.distance ?? 0);
  const easyTime = (warmupMetrics.time ?? 0) + (cooldownMetrics.time ?? 0);
  const easyPaceSecPerKm = easyDistance > 0 && easyTime > 0 ? (easyTime / easyDistance) * 1000 : null;

  // Derive the session's intent (easy/aerobic/tempo/threshold/vo2) from the
  // WORK-ONLY pace against the athlete's own pace zones — the same
  // threshold-first model the Zones page and recompute_session_zones (DB)
  // already use, rather than a second copy of zone-percentage math living
  // here. `intent` previously had no real classification at all: every
  // FIT-derived session was hardcoded to "aerobic" at creation and nothing
  // ever revisited it afterward, regardless of how fast the actual work
  // was — an interval or threshold session on the calendar showed
  // "Aerobic" purely because that placeholder was never replaced, not
  // because of any warmup/cooldown dilution.
  //
  // Always applied when we have a derived value — this whole function
  // (rebuildSessionFromAllFiles) only ever reaches this point when real
  // recorded laps exist (it returns early above when a session has no
  // files at all), so by the time derivedIntent is computed we already
  // have actual pace data, not a guess. A previous version gated this on
  // `is_planned === false`, intending to protect a coach's deliberately
  // chosen intent on a file-less manual session — but a file-less session
  // never reaches this code path in the first place, so that guard only
  // ever did one thing in practice: permanently freezing intent at
  // whatever a plan template's generic per-day effort_type happened to be
  // (e.g. "threshold") even after real uploaded laps showed the athlete's
  // actual hardest effort was faster (e.g. 5×1km reps at VO2 pace within
  // a session whose planned label was just "threshold"). Real data should
  // always win once it exists.
  //
  // Classifies by the FASTEST work lap, not a time-weighted average across
  // every work lap — a session with a 2km tempo opener followed by 5×1km
  // at VO2 pace is a VO2 session with a tempo opener, not "Tempo overall".
  // Averaging blended those two genuinely different efforts into one
  // misleading middle number that didn't represent either block's actual
  // character. A coach describing this session by its hardest work is the
  // same convention needs_review/structure already lean on elsewhere in
  // this file (e.g. a race is whichever file has the fastest pace, not an
  // average across warmup+race+cooldown).
  // Which basis actually drives classification is per-athlete
  // (preferred_zone_basis, set on the Zones card) — both HR and pace
  // thresholds are always computed/stored regardless of which one is
  // preferred, this just decides which one this session's intent is
  // derived from. Defaults to pace if the profile predates this column or
  // was never explicitly set (matches the column's own DB default).
  let derivedIntent: string | null = null;
  if (workLaps.length > 0) {
    const { data: zoneProfile } = await sb
      .from("athlete_zone_profiles")
      .select(
        "preferred_zone_basis, pace_z1_max_sec_per_km, pace_z2_max_sec_per_km, pace_z3_max_sec_per_km, pace_z4_max_sec_per_km, pace_z5_max_sec_per_km, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max",
      )
      .eq("athlete_id", sess.athlete_id)
      .maybeSingle();

    const ZONE_RANK: Record<"z1" | "z2" | "z3" | "z4" | "z5" | "z6", number> = {
      z1: 1,
      z2: 2,
      z3: 3,
      z4: 4,
      z5: 5,
      z6: 6,
    };
    const RANK_TO_INTENT: Record<number, string> = {
      1: "easy",
      2: "aerobic",
      3: "tempo",
      4: "threshold",
      5: "vo2",
      6: "anaerobic",
    };

    const useHr = zoneProfile?.preferred_zone_basis === "hr";

    if (useHr && zoneProfile?.hr_z1_max != null) {
      let fastestRank = 0;
      for (const lap of workLaps) {
        const lapHr = lap.avg_heart_rate != null ? Number(lap.avg_heart_rate) : null;
        if (lapHr == null) continue;

        // Ascending "higher bpm = harder zone" bucketing, opposite
        // direction from pace (where slower sec/km = easier) since HR and
        // pace naturally run in opposite numeric directions — same
        // convention recompute_session_zones uses in the DB for HR.
        const zone: "z1" | "z2" | "z3" | "z4" | "z5" | "z6" =
          lapHr <= zoneProfile.hr_z1_max
            ? "z1"
            : zoneProfile.hr_z2_max != null && lapHr <= zoneProfile.hr_z2_max
              ? "z2"
              : zoneProfile.hr_z3_max != null && lapHr <= zoneProfile.hr_z3_max
                ? "z3"
                : zoneProfile.hr_z4_max != null && lapHr <= zoneProfile.hr_z4_max
                  ? "z4"
                  : zoneProfile.hr_z5_max != null && lapHr <= zoneProfile.hr_z5_max
                    ? "z5"
                    : "z6";

        fastestRank = Math.max(fastestRank, ZONE_RANK[zone]);
      }
      if (fastestRank > 0) {
        derivedIntent = RANK_TO_INTENT[fastestRank];
      }
    } else if (!useHr && zoneProfile?.pace_z1_max_sec_per_km != null) {
      let fastestRank = 0;
      for (const lap of workLaps) {
        const stopped = stoppedSecondsByLapIndex.get(lap.index) ?? 0;
        const movingTime = Math.max(0, Number(lap.total_elapsed_time ?? 0) - stopped);
        const lapDistance = Number(lap.total_distance ?? 0);
        const lapPace = lapDistance > 0 && movingTime > 0 ? (movingTime / lapDistance) * 1000 : null;
        if (lapPace == null) continue;

        // Same ascending "slower sec/km = easier zone" bucketing as
        // recompute_session_zones in the DB.
        const zone: "z1" | "z2" | "z3" | "z4" | "z5" | "z6" =
          lapPace >= zoneProfile.pace_z1_max_sec_per_km
            ? "z1"
            : zoneProfile.pace_z2_max_sec_per_km != null && lapPace >= zoneProfile.pace_z2_max_sec_per_km
              ? "z2"
              : zoneProfile.pace_z3_max_sec_per_km != null && lapPace >= zoneProfile.pace_z3_max_sec_per_km
                ? "z3"
                : zoneProfile.pace_z4_max_sec_per_km != null && lapPace >= zoneProfile.pace_z4_max_sec_per_km
                  ? "z4"
                  : zoneProfile.pace_z5_max_sec_per_km != null && lapPace >= zoneProfile.pace_z5_max_sec_per_km
                    ? "z5"
                    : "z6";

        fastestRank = Math.max(fastestRank, ZONE_RANK[zone]);
      }

      if (fastestRank > 0) {
        derivedIntent = RANK_TO_INTENT[fastestRank];
      }
    }
  }
  const shouldUpdateIntent = derivedIntent != null;

  // Recompute the Morning/Afternoon/Evening title using the athlete's actual
  // timezone. This runs on every rebuild (not just initial creation) since a
  // session that started life as just a Warm Up file gets its title merged
  // with Work/Cool Down files later — the original title-generation moment
  // may have used the wrong hour, or predate the timezone fix entirely.
  // Only touches titles that still match the auto-generated pattern, so a
  // coach's manual rename is never overwritten.
  const isAutoGeneratedTitle = /^(Morning|Afternoon|Evening) session$/.test(String(sess.title ?? ""));
  let recomputedTitle: string | null = null;

  if (isAutoGeneratedTitle && anchorMs > 0) {
    const { data: athleteRow } = await sb.from("athletes").select("timezone").eq("id", sess.athlete_id).maybeSingle();
    const athleteTimezone = athleteRow?.timezone || "UTC";
    const { hour: localHour } = getLocalDateAndHour(new Date(anchorMs), athleteTimezone);
    const timeLabel = localHour < 11 ? "Morning" : localHour < 16 ? "Afternoon" : "Evening";
    recomputedTitle = `${timeLabel} session`;
  }

  const { error: updErr } = await sb
    .from("sessions")
    .update({
      total_distance_m: totalDistanceM || null,
      total_time_seconds: totalTimeS || null,
      total_moving_time_seconds: totalMovingTimeS || null,
      avg_hr: avgHr,
      max_hr: maxHr,
      average_temp_c: weatherTemp ?? avgTemp,
      wind_kph: weatherWind ?? null,
      location: locationName ?? null,
      completion_pct: 100,
      work_distance_m: workDistance || null,
      work_time_s: workTime || null,
      work_avg_hr: workMetrics.avgHr ?? avgHr,
      work_avg_pace_sec_per_km: workPaceSecPerKm ?? avgPace,
      work_avg_cadence: workMetrics.avgCad ?? avgCad,
      easy_avg_pace_sec_per_km: easyPaceSecPerKm,
      structure: isIntervals ? "intervals" : "continuous",
      needs_review: isIntervals,
      ...(shouldUpdateIntent ? { intent: derivedIntent } : {}),
      ...(recomputedTitle ? { title: recomputedTitle } : {}),
    } as any)
    .eq("id", sessionId);

  if (updErr) throw updErr;
}

// Max gap (in ms) between one file's estimated end and the next file's start
// for them to be treated as parts of the SAME session (e.g. separate Warm Up /
// Work / Cool Down / Strides files, or a device that paused/restarted
// recording mid-session). Kept well under a typical between-session gap —
// some athletes only have 1-2 hours between AM/PM doubles — so genuinely
// separate sessions never get merged.
const SAME_SESSION_MAX_GAP_MS = 90 * 60 * 1000; // 90 minutes

// A much looser window once a session is already marked as a race — post-race
// medal ceremony, food, results checking, and queues (for a toilet or
// anything else) can easily create gaps far longer than a normal training
// double, and a second genuine race the same day is exceedingly rare.
const RACE_DAY_MAX_GAP_MS = 6 * 60 * 60 * 1000; // 6 hours

// Finds an existing same-day fit_import session whose most recent attached
// file ends within SAME_SESSION_MAX_GAP_MS of the new file's start time.
// Falls back to creating a new session if no candidate is close enough in
// time — this is what correctly keeps AM/PM doubles as separate sessions
// while still merging split files (warmup/work/cooldown/strides) that were
// recorded back-to-back.
async function findMatchingSameDaySession(
  sb: any,
  athleteId: string,
  sessionDate: string,
  newFileStartMs: number | null,
): Promise<any | null> {
  const { data: candidates } = await sb
    .from("sessions")
    .select("id, session_date, day_type")
    .eq("athlete_id", athleteId)
    .eq("session_date", sessionDate)
    .eq("source", "fit_import");

  if (!candidates || candidates.length === 0) return null;

  // If the new file has no parseable start time, fall back to the previous
  // (looser) behavior of just using the first same-day session — we can't
  // do a time-gap comparison without a timestamp.
  if (newFileStartMs === null) return candidates[0];

  let bestMatch: any = null;
  let bestGap = Infinity;

  for (const candidate of candidates) {
    const { data: files } = await sb
      .from("session_files")
      .select("started_at, total_time_s")
      .eq("session_id", candidate.id);

    if (!files || files.length === 0) continue;

    for (const f of files) {
      if (!f.started_at) continue;
      const fileStartMs = new Date(f.started_at).getTime();
      const fileEndMs = fileStartMs + (Number(f.total_time_s) || 0) * 1000;

      // Gap is measured from whichever file boundary is closer to the new
      // file's start — handles both "new file comes after" and "new file
      // comes before" (e.g. uploading Warm Up after Work was already added).
      const gap = Math.min(Math.abs(newFileStartMs - fileEndMs), Math.abs(newFileStartMs - fileStartMs));

      if (gap < bestGap) {
        bestGap = gap;
        bestMatch = candidate;
      }
    }
  }

  if (!bestMatch) return null;

  // Race days routinely have long real-world gaps that aren't a sign of a
  // separate activity — post-race medal collection, food, results, toilet
  // queues can easily push a cooldown recording past the normal 90-minute
  // same-session window. A second genuine race on the same day is
  // exceedingly rare, so once a session is already marked as a race, treat
  // anything else recorded that day as part of it.
  const maxGap = bestMatch.day_type === "race" ? RACE_DAY_MAX_GAP_MS : SAME_SESSION_MAX_GAP_MS;

  return bestGap <= maxGap ? bestMatch : null;
}

// Converts a UTC instant into the athlete's local calendar date and hour-of-day.
// Using .toISOString()/.getHours() directly would resolve in the SERVER's
// timezone (typically UTC in cloud environments) — for an athlete outside
// UTC, an evening session can come out as "morning" and even land on the
// wrong calendar date. This fixes both by resolving in the athlete's own
// stored timezone (athletes.timezone).
function getLocalDateAndHour(utcInstant: string | Date, timeZone: string): { date: string; hour: number } {
  const d = typeof utcInstant === "string" ? new Date(utcInstant) : utcInstant;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    // "24" from hour12:false at midnight should read as 0
    const hour = Number(get("hour")) % 24;
    return { date, hour };
  } catch {
    // Invalid/unknown timezone string — fall back to UTC rather than throwing
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }
}

export const uploadAndParseSessionFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { athleteId: string; sessionId?: string; filename: string; kind: "fit" | "gpx"; fileBase64: string }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const buf = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    let parsed: ParsedFile;
    let parseError: string | null = null;

    try {
      parsed = data.kind === "gpx" ? parseGPX(new TextDecoder().decode(buf)) : await parseFIT(arrayBuffer);
    } catch (e: any) {
      parseError = String(e?.message ?? e);
      parsed = { points: [], laps: [], totalDistanceM: 0, totalTimeS: 0, startedAt: null, sport: null };
    }

    const activityType = mapFitSport(parsed.sport ?? undefined);

    const { data: athleteRow } = await sb.from("athletes").select("timezone").eq("id", data.athleteId).maybeSingle();
    const athleteTimezone = athleteRow?.timezone || "UTC";

    const { date: sessionDate, hour: localHour } = parsed.startedAt
      ? getLocalDateAndHour(parsed.startedAt, athleteTimezone)
      : getLocalDateAndHour(new Date(), athleteTimezone);

    let sess: any;

    if (data.sessionId) {
      const { data: existing, error: fetchErr } = await sb
        .from("sessions")
        .select("*")
        .eq("id", data.sessionId)
        .single();

      if (fetchErr || !existing) {
        throw fetchErr ?? new Error("Session not found");
      }

      sess = existing;
    } else {
      const newFileStartMs = parsed.startedAt ? new Date(parsed.startedAt).getTime() : null;
      const existingSameDay = await findMatchingSameDaySession(sb, data.athleteId, sessionDate, newFileStartMs);

      if (existingSameDay) {
        sess = existingSameDay;
      } else {
        const { data: inserted, error: sessError } = await sb
          .from("sessions")
          .insert({
            athlete_id: data.athleteId,
            created_by: context.userId,
            session_date: sessionDate,
            title: (() => {
              const timeLabel = localHour < 11 ? "Morning" : localHour < 16 ? "Afternoon" : "Evening";
              return `${timeLabel} session`;
            })(),
            day_type: "training",
            intent: "aerobic",
            structure: "continuous",
            is_planned: false,
            completed_at: new Date().toISOString(),
            source: "fit_import",
            data_source: data.kind === "fit" ? "fit_upload" : "gpx_upload",
            activity_type: activityType,
            needs_review: true,
          } as any)
          .select()
          .single();

        if (sessError || !inserted) {
          throw sessError ?? new Error("Failed to create session");
        }

        sess = inserted;
      }
    }

    // Detect duplicates by what was actually recorded, not the filename —
    // a renamed/re-exported copy of the same activity (e.g. "file.1" vs
    // "file.2") has a different filename but identical start time, distance,
    // and duration, and should still be caught.
    const { data: candidateFiles } = await sb
      .from("session_files")
      .select("id, started_at, total_distance_m, total_time_s, original_filename")
      .eq("session_id", sess.id);

    const newStartMs = parsed.startedAt ? new Date(parsed.startedAt).getTime() : null;
    const duplicate = (candidateFiles ?? []).find((f: any) => {
      if (!f.started_at || newStartMs == null) return false;
      const startDiffS = Math.abs(new Date(f.started_at).getTime() - newStartMs) / 1000;
      if (startDiffS > 5) return false; // different recordings won't start within 5s of each other

      const distanceMatch =
        parsed.totalDistanceM > 0 &&
        Math.abs(Number(f.total_distance_m ?? 0) - parsed.totalDistanceM) <= Math.max(5, parsed.totalDistanceM * 0.01);
      const timeMatch =
        parsed.totalTimeS > 0 &&
        Math.abs(Number(f.total_time_s ?? 0) - parsed.totalTimeS) <= Math.max(2, parsed.totalTimeS * 0.01);

      return distanceMatch && timeMatch;
    });

    if (duplicate) {
      throw new Error(
        `This file appears to be a duplicate of "${duplicate.original_filename}" already attached to this session (same start time, distance, and duration) — skipped to avoid double-counting.`,
      );
    }

    const storagePath = `${data.athleteId}/${Date.now()}-${data.filename}`;
    const { error: upErr } = await sb.storage.from("session-files").upload(storagePath, buf, {
      contentType: data.kind === "fit" ? "application/octet-stream" : "application/gpx+xml",
    });

    if (upErr) throw upErr;

    const { data: fileRow, error: insErr } = await sb
      .from("session_files")
      .insert({
        athlete_id: data.athleteId,
        session_id: sess.id,
        file_kind: data.kind,
        storage_path: storagePath,
        original_filename: data.filename,
        started_at: parsed.startedAt,
        total_distance_m: parsed.totalDistanceM,
        total_time_s: parsed.totalTimeS,
        parsed_at: parseError ? null : new Date().toISOString(),
        parse_error: parseError,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    if (parseError) {
      return { file: fileRow, points: 0, error: parseError };
    }

    try {
      await rebuildSessionFromAllFiles(sb, sess.id);
    } catch (rebuildErr) {
      // Roll back the file row just inserted above — otherwise it sits
      // there as an orphan that never actually finished attaching, and the
      // duplicate-detection check further up (same start time, distance,
      // duration) permanently flags any retry of this exact file as
      // "already attached to this session", blocking re-upload until
      // someone manually finds and deletes the stray row. Also clears any
      // raw_session_points this file contributed before the failure, so a
      // retry starts genuinely clean rather than layering on partial data.
      await sb.from("raw_session_points").delete().eq("file_id", fileRow.id);
      await sb.from("session_files").delete().eq("id", fileRow.id);
      throw rebuildErr;
    }

    return {
      file: fileRow,
      points: parsed.points.length,
      lapCount: parsed.laps.length,
    };
  });

export const deleteSessionFileBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionFileId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    const { data: fileRow, error: fileErr } = await sb
      .from("session_files")
      .select("*")
      .eq("id", data.sessionFileId)
      .single();

    if (fileErr || !fileRow) {
      throw fileErr ?? new Error("Session file not found");
    }

    const sessionId = fileRow.session_id;
    if (!sessionId) throw new Error("Session file has no session_id");

    await sb.from("raw_session_points").delete().eq("file_id", fileRow.id);

    if (fileRow.storage_path) {
      await sb.storage.from("session-files").remove([fileRow.storage_path]);
    }

    const { error: delErr } = await sb.from("session_files").delete().eq("id", fileRow.id);
    if (delErr) throw delErr;

    await rebuildSessionFromAllFiles(sb, sessionId);

    const { count } = await sb
      .from("session_files")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    return { ok: true, sessionId, remainingFiles: count ?? 0 };
  });

// Merges an orphaned session (e.g. a cooldown that split into its own
// session because it was uploaded before the race was marked, so the
// tighter same-session gap threshold applied) into another session for the
// same athlete. Moves the actual files across, cleans up all derived data
// on the source (steps/results/points/etc — these get regenerated fresh for
// the target), then rebuilds the target from its now-combined file set.
// Re-runs classification/rebuild on a session's already-attached files, with
// no new upload needed. Useful after marking a session as a race (or fixing
// its day_type), or after merging another session in — either of those
// changes what the classification logic should produce, but only a rebuild
// actually regroups the steps correctly from the source lap data.
export const rebuildSessionClassification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await rebuildSessionFromAllFiles(sb, data.sessionId);
    return { ok: true };
  });

export const mergeSessionIntoAnother = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sourceSessionId: string; targetSessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sourceSessionId, targetSessionId } = data;

    if (sourceSessionId === targetSessionId) {
      throw new Error("Cannot merge a session into itself.");
    }

    const { data: sourceSession, error: sourceErr } = await sb
      .from("sessions")
      .select("id, athlete_id, session_date")
      .eq("id", sourceSessionId)
      .single();
    if (sourceErr || !sourceSession) throw sourceErr ?? new Error("Source session not found");

    const { data: targetSession, error: targetErr } = await sb
      .from("sessions")
      .select("id, athlete_id, session_date")
      .eq("id", targetSessionId)
      .single();
    if (targetErr || !targetSession) throw targetErr ?? new Error("Target session not found");

    if (sourceSession.athlete_id !== targetSession.athlete_id) {
      throw new Error("Both sessions must belong to the same athlete.");
    }

    // Move the actual recorded files across — these are the only thing worth
    // keeping from the source session. Everything else on the source is
    // derived data that gets regenerated fresh for the target below.
    const { error: moveErr } = await sb
      .from("session_files")
      .update({ session_id: targetSessionId })
      .eq("session_id", sourceSessionId);
    if (moveErr) throw moveErr;

    // Clean up the source session's derived data before deleting it, same
    // set of tables deleteSession clears.
    const { data: sourceSteps } = await sb.from("steps").select("id").eq("session_id", sourceSessionId);
    const sourceStepIds = (sourceSteps ?? []).map((s: any) => s.id);
    if (sourceStepIds.length > 0) {
      await sb.from("interval_results").delete().in("step_id", sourceStepIds);
    }
    await sb.from("steps").delete().eq("session_id", sourceSessionId);
    await sb.from("raw_session_points").delete().eq("session_id", sourceSessionId);
    await sb.from("session_fatigue").delete().eq("session_id", sourceSessionId);
    await sb.from("session_zone_time").delete().eq("session_id", sourceSessionId);
    await sb.from("session_insights").delete().eq("session_id", sourceSessionId);
    await sb.from("performances").delete().eq("session_id", sourceSessionId);

    const { error: delErr } = await sb.from("sessions").delete().eq("id", sourceSessionId);
    if (delErr) throw delErr;

    // Rebuild the target from its now-combined set of files — this is what
    // actually re-classifies warmup/work/cooldown correctly across all of
    // them, including the newly-merged-in file.
    await rebuildSessionFromAllFiles(sb, targetSessionId);

    return { ok: true };
  });

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sessionId } = data;

    const { data: steps } = await sb.from("steps").select("id").eq("session_id", sessionId);
    const stepIds = (steps ?? []).map((s: any) => s.id);

    if (stepIds.length > 0) {
      await sb.from("interval_results").delete().in("step_id", stepIds);
    }

    await sb.from("steps").delete().eq("session_id", sessionId);
    await sb.from("raw_session_points").delete().eq("session_id", sessionId);
    await sb.from("session_fatigue").delete().eq("session_id", sessionId);
    await sb.from("session_zone_time").delete().eq("session_id", sessionId);

    const { data: files } = await sb.from("session_files").select("storage_path").eq("session_id", sessionId);
    const paths = (files ?? []).map((f: any) => f.storage_path).filter(Boolean);

    if (paths.length > 0) {
      await sb.storage.from("session-files").remove(paths);
    }

    await sb.from("session_files").delete().eq("session_id", sessionId);
    await sb.from("session_insights").delete().eq("session_id", sessionId);

    const { error } = await sb.from("sessions").delete().eq("id", sessionId);
    if (error) throw error;

    return { ok: true };
  });

// Encodes an ArrayBuffer to base64 without relying on Node's Buffer —
// matches the atob() used to decode uploads elsewhere in this file, so
// both directions stay on the same browser-safe API rather than mixing
// Buffer and atob/btoa depending on which function you're reading.
// Chunked to avoid blowing the call stack on String.fromCharCode for a
// large FIT file.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Bulk (or single) export — downloads every original FIT/GPX file
// attached to the given sessions and returns them base64-encoded for the
// client to zip and download. RLS on session_files (athlete self / coach
// read) already scopes which files a given caller can actually pull back,
// same as every other read in this file — no extra authorization check
// needed here.
export const getSessionFilesForExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionIds: string[] }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { sessionIds } = data;
    if (!sessionIds.length) return { files: [] };

    const { data: fileRows, error } = await sb
      .from("session_files")
      .select("id, session_id, storage_path, original_filename, file_kind")
      .in("session_id", sessionIds);
    if (error) throw error;

    const out: { name: string; base64: string }[] = [];
    for (const f of fileRows ?? []) {
      const { data: blob, error: dlErr } = await sb.storage.from("session-files").download(f.storage_path);
      // Skip individual files that fail to download rather than failing
      // the whole export — one missing/corrupt storage object shouldn't
      // block everything else that was selected.
      if (dlErr || !blob) continue;
      const buf = await blob.arrayBuffer();
      const name = f.original_filename || f.storage_path.split("/").pop() || `${f.id}.${f.file_kind}`;
      out.push({ name, base64: arrayBufferToBase64(buf) });
    }

    return { files: out };
  });

export const submitCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      athleteId: string;
      sessionInsights: {
        sessionId: string;
        feel: number;
        wentWell?: string;
        wasDifficult?: string;
        niggles?: string;
      }[];
      endOfDayNote?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;

    for (const ins of data.sessionInsights) {
      await sb.from("session_insights").upsert(
        {
          session_id: ins.sessionId,
          athlete_id: data.athleteId,
          feel_score: ins.feel,
          went_well: ins.wentWell,
          was_difficult: ins.wasDifficult,
          niggles: ins.niggles,
        } as any,
        { onConflict: "session_id" } as any,
      );
    }

    if (data.endOfDayNote) {
      const today = new Date().toISOString().slice(0, 10);
      await sb.from("daily_checkins").upsert(
        {
          athlete_id: data.athleteId,
          date: today,
          end_of_day_note: data.endOfDayNote,
        } as any,
        { onConflict: "athlete_id,date" } as any,
      );
    }

    await sb.from("athletes").update({ last_checkout_at: new Date().toISOString() }).eq("id", data.athleteId);

    return { ok: true };
  });

export const sendReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { athleteId: string; kind: string; message?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("pending_reminders")
      .insert({
        athlete_id: data.athleteId,
        coach_id: context.userId,
        kind: data.kind,
        message: data.message,
      })
      .select()
      .single();

    if (error) throw error;
    return row;
  });
