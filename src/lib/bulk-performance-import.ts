// Bulk performance/race-results import parser — extracted from the old
// Profile page's PBs card (now removed; this logic moved to the Races
// page's "Add race" flow instead, merged alongside the manual-entry form).
// Handles both a plain "YYYY-MM-DD | Event | Performance | Venue" pipe
// format and raw pasted Athletics Victoria–style multi-line results.

export type RaceType = "track" | "road" | "cross_country";

export type BulkImportRow = {
  athlete_id: string;
  performance_date: string;
  distance_m: number;
  time_seconds: number | null;
  is_pb: boolean;
  context: string;
  notes: string;
  event_name: string;
  age_group: string | null;
  race_type: RaceType;
  distance_adjustment_mode: string;
  source_event: string;
  source_perf: string;
  source_venue: string;
  duplicate?: boolean;
  error?: string;
  // Set during preview if a session already exists for this athlete on
  // the same date with a matching distance (see matchSessionForRow) —
  // linking it means this bulk-imported result shows up as this
  // session's race the same way a session-derived race normally would,
  // instead of sitting as a permanently orphaned standalone result.
  matchedSessionId?: string | null;
};

export function eventToDistanceM(event: string): number | null {
  const e = cleanImportCell(event).toLowerCase();

  if (/^1\s*mile$/i.test(e)) return 1609;

  const km = e.match(/^(\d+(?:\.\d+)?)\s*km/i);
  if (km) return Math.round(Number(km[1]) * 1000);

  const m = e.match(/^(\d+)\s*m/i);
  if (m) return Number(m[1]);

  return null;
}

export function cleanImportCell(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .trim();
}

export function cleanPipeCell(value: string) {
  return cleanImportCell(value).replace(/\|/g, "/").trim();
}

export function extractDate(value: string): string | null {
  const cleaned = cleanImportCell(value);
  const match = cleaned.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function looksLikePerformance(value: string) {
  const v = cleanImportCell(value);

  if (!v) return false;

  return (
    /^\d+(?::\d{1,2}(?:\.\d+)?)?$/.test(v) ||
    /^\d+(?:\.\d+)?h$/i.test(v) ||
    /^\([-+]?\d+(?:\.\d+)?\)$/.test(v) ||
    /^DNF$/i.test(v) ||
    /^SCR$/i.test(v)
  );
}

export function performanceToSeconds(perf: string): { seconds: number | null; notes: string } {
  const original = cleanImportCell(perf);
  const upper = original.toUpperCase();
  const notes: string[] = [];

  if (!original || upper === "DNF" || upper === "SCR") {
    return {
      seconds: null,
      notes: `Original result: ${original || "no performance listed"}`,
    };
  }

  if (/\(.+\)/.test(original)) {
    notes.push(`Wind/extra mark from source: ${original}`);
  }

  if (/h$/i.test(original)) {
    notes.push(`Hand timed mark from source: ${original}`);
  }

  const cleaned = original
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/h$/i, "")
    .trim();

  if (cleaned.includes(":")) {
    const [minRaw, secRaw] = cleaned.split(":");
    const min = Number(minRaw);
    const sec = Number(secRaw);

    if (Number.isNaN(min) || Number.isNaN(sec)) {
      return {
        seconds: null,
        notes: [`Could not parse original result: ${original}`, ...notes].join("; "),
      };
    }

    return {
      seconds: Math.round((min * 60 + sec) * 100) / 100,
      notes: notes.join("; "),
    };
  }

  const seconds = Number(cleaned);

  if (Number.isNaN(seconds)) {
    return {
      seconds: null,
      notes: [`Could not parse original result: ${original}`, ...notes].join("; "),
    };
  }

  return {
    seconds: Math.round(seconds * 100) / 100,
    notes: notes.join("; "),
  };
}

export function raceTypeFromEvent(event: string): RaceType {
  if (/XC/i.test(event)) return "cross_country";
  if (/Road|Tan Relay|Ten Relay/i.test(event)) return "road";
  return "track";
}

export function performanceKey(row: {
  performance_date?: string | null;
  distance_m?: number | null;
  time_seconds?: number | null;
  event_name?: string | null;
}) {
  const date = row.performance_date ?? "";
  const distance = row.distance_m ?? "";
  const seconds = row.time_seconds == null ? "NULL" : Number(row.time_seconds).toFixed(2);
  const eventName = row.event_name ?? "";
  return `${date}|${distance}|${seconds}|${eventName}`;
}

function parseAvRecordToPipe(record: string[]): string | null {
  const date = extractDate(record[0] ?? "");
  if (!date) return null;

  const body = record.slice(1).map(cleanPipeCell).filter(Boolean);

  if (body.length === 0) return null;

  const eventIndex = body.findIndex((item) => eventToDistanceM(item) !== null);

  if (eventIndex === -1) {
    return `${date} |  |  | ${body.join(" ")}`;
  }

  const event = body[eventIndex];
  const afterEvent = body.slice(eventIndex + 1);

  let venue = "";
  let perfParts: string[] = [];

  if (afterEvent.length === 0) {
    venue = "";
    perfParts = [];
  } else {
    let venueIndex = -1;

    for (let i = afterEvent.length - 1; i >= 0; i--) {
      if (!looksLikePerformance(afterEvent[i])) {
        venueIndex = i;
        break;
      }
    }

    if (venueIndex >= 0) {
      venue = afterEvent[venueIndex];
      perfParts = afterEvent.slice(0, venueIndex);
    } else {
      venue = "";
      perfParts = afterEvent;
    }
  }

  const perf = perfParts.join(" ").trim();

  return `${date} | ${event} | ${perf} | ${venue}`;
}

function normaliseBulkImportText(text: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .flatMap((line) => line.split("\t"))
    .map(cleanImportCell)
    .filter(Boolean)
    .filter((line) => !/^meet date$/i.test(line))
    .filter((line) => !/^event$/i.test(line))
    .filter((line) => !/^perf$/i.test(line))
    .filter((line) => !/^venue$/i.test(line));

  if (rawLines.length === 0) return [];

  if (rawLines.some((line) => line.includes("|"))) {
    return rawLines;
  }

  const records: string[][] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    const date = extractDate(line);

    if (date) {
      if (current.length > 0) {
        records.push(current);
      }

      current = [date];
    } else if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    records.push(current);
  }

  return records.map(parseAvRecordToPipe).filter((row): row is string => Boolean(row));
}

export function parseBulkPerformances(
  text: string,
  athleteId: string,
  existingPerformances: { distance_m: number; race_type: string | null; time_seconds: number | null }[],
): BulkImportRow[] {
  const lines = normaliseBulkImportText(text);

  const rows: BulkImportRow[] = lines.map((line) => {
    const parts = line.split("|").map(cleanImportCell);

    if (parts.length !== 4) {
      return {
        athlete_id: athleteId,
        performance_date: "",
        distance_m: 0,
        time_seconds: null,
        is_pb: false,
        context: "race",
        notes: "",
        event_name: "",
        age_group: null,
        race_type: "track",
        distance_adjustment_mode: "uniform",
        source_event: "",
        source_perf: "",
        source_venue: "",
        error: `Invalid row. Use: YYYY-MM-DD | Event | Performance | Venue`,
      };
    }

    const [performanceDateRaw, sourceEventRaw, sourcePerfRaw, sourceVenueRaw] = parts;

    const performance_date = extractDate(performanceDateRaw) ?? performanceDateRaw;
    const source_event = cleanPipeCell(sourceEventRaw);
    const source_perf = cleanPipeCell(sourcePerfRaw);
    const source_venue = cleanPipeCell(sourceVenueRaw);

    const distance_m = eventToDistanceM(source_event);
    const race_type = raceTypeFromEvent(source_event);
    const { seconds, notes } = performanceToSeconds(source_perf);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(performance_date)) {
      return {
        athlete_id: athleteId,
        performance_date,
        distance_m: distance_m ?? 0,
        time_seconds: seconds,
        is_pb: false,
        context: "race",
        notes,
        event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
        age_group: null,
        race_type,
        distance_adjustment_mode: "uniform",
        source_event,
        source_perf,
        source_venue,
        error: `Invalid date: ${performanceDateRaw}`,
      };
    }

    if (!distance_m) {
      return {
        athlete_id: athleteId,
        performance_date,
        distance_m: 0,
        time_seconds: seconds,
        is_pb: false,
        context: "race",
        notes,
        event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
        age_group: null,
        race_type,
        distance_adjustment_mode: "uniform",
        source_event,
        source_perf,
        source_venue,
        error: `Could not parse distance from event: ${source_event || "(blank)"}`,
      };
    }

    return {
      athlete_id: athleteId,
      performance_date,
      distance_m,
      time_seconds: seconds,
      is_pb: false,
      context: "race",
      notes,
      event_name: source_venue ? `${source_event} - ${source_venue}` : source_event,
      age_group: null,
      race_type,
      distance_adjustment_mode: "uniform",
      source_event,
      source_perf,
      source_venue,
    };
  });

  const bests = new Map<string, number>();

  // Seed with the athlete's real, already-saved bests first — comparing
  // pasted rows only against each other would let a whole batch slower
  // than an existing PB still flag the earliest of the batch as "PB" in
  // the preview. This is a preview estimate only (the actual insert
  // omits is_pb and lets the DB trigger determine the real, final
  // answer), but it should agree with the trigger in the common case.
  for (const p of existingPerformances) {
    if (p.time_seconds == null) continue;
    const key = `${p.distance_m}-${p.race_type}`;
    const cur = bests.get(key);
    if (cur == null || p.time_seconds < cur) {
      bests.set(key, p.time_seconds);
    }
  }

  [...rows]
    .filter((row) => !row.error)
    .sort((a, b) => {
      const byDate = a.performance_date.localeCompare(b.performance_date);
      if (byDate !== 0) return byDate;
      return a.distance_m - b.distance_m;
    })
    .forEach((row) => {
      if (row.time_seconds == null) {
        row.is_pb = false;
        return;
      }

      const key = `${row.distance_m}-${row.race_type}`;
      const previousBest = bests.get(key);

      if (previousBest == null || row.time_seconds < previousBest) {
        row.is_pb = true;
        bests.set(key, row.time_seconds);
      } else {
        row.is_pb = false;
      }
    });

  return rows;
}

// A bulk-imported row (date + distance only, no GPS trace) is considered a
// match for an existing session when both the date is identical and the
// distance is close enough to plausibly be the same race — GPS-logged
// session distance is rarely exact (e.g. a "5000m" road race might log as
// 5023m), so this needs some tolerance rather than an exact match. ±5%,
// with a 100m floor so short track races (800m, 1500m) aren't matched
// against something wildly different.
export function distanceWithinTolerance(a: number, b: number): boolean {
  const tolerance = Math.max(100, a * 0.05);
  return Math.abs(a - b) <= tolerance;
}
