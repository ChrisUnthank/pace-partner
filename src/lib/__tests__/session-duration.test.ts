import { describe, it, expect } from "vitest";

/**
 * Recorded session duration vs wall-clock span.
 *
 * These reimplement computeRecordedSeconds and computeTotalStoppedSeconds
 * exactly rather than importing them, because session-files.functions.ts is a
 * server-function module — importing it pulls in Supabase middleware and the
 * FIT parser, neither of which belongs in a unit test run. The two copies are
 * short and the behaviour they lock down is the arithmetic, not the wiring.
 *
 * If either function in session-files.functions.ts changes, these must be
 * updated alongside — the whole point is that this arithmetic was wrong in
 * production for months without anything noticing.
 */

const STOP_GAP_THRESHOLD_S = 20;

interface P {
  elapsed_s: number;
  timestamp?: string | null;
  file_id?: string | null;
}

function computeRecordedSeconds(points: P[]): number {
  if (points.length === 0) return 0;
  const spanByFile = new Map<string, { min: number; max: number }>();
  for (const p of points) {
    const key = String(p.file_id ?? "");
    const e = Number(p.elapsed_s ?? 0);
    if (!Number.isFinite(e)) continue;
    const cur = spanByFile.get(key);
    if (!cur) spanByFile.set(key, { min: e, max: e });
    else {
      if (e < cur.min) cur.min = e;
      if (e > cur.max) cur.max = e;
    }
  }
  let total = 0;
  for (const { min, max } of spanByFile.values()) total += Math.max(0, max - min);
  return total;
}

function computeTotalStoppedSeconds(points: P[]): number {
  if (points.length < 2) return 0;
  const byFile = new Map<string, P[]>();
  for (const p of points) {
    const key = String(p.file_id ?? "");
    const list = byFile.get(key) ?? [];
    list.push(p);
    byFile.set(key, list);
  }
  let total = 0;
  for (const filePoints of byFile.values()) {
    const sorted = [...filePoints].sort((a, b) => a.elapsed_s - b.elapsed_s);
    let prev: P | null = null;
    for (const p of sorted) {
      if (prev && p.timestamp && prev.timestamp) {
        const gapS = (new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
        if (gapS >= STOP_GAP_THRESHOLD_S) total += gapS;
      }
      prev = p;
    }
  }
  return total;
}

/** One point per second across a span, with timestamps, for one file. */
function file(fileId: string, startOffsetS: number, durationS: number, t0 = Date.parse("2026-08-06T06:00:00Z")): P[] {
  const out: P[] = [];
  for (let i = 0; i <= durationS; i++) {
    out.push({
      file_id: fileId,
      elapsed_s: startOffsetS + i,
      timestamp: new Date(t0 + (startOffsetS + i) * 1000).toISOString(),
    });
  }
  return out;
}

describe("computeRecordedSeconds", () => {
  it("a single file is just its span — unchanged from the old behaviour", () => {
    expect(computeRecordedSeconds(file("a", 0, 3600))).toBe(3600);
  });

  it("Jackson's 6 August VO2 session — the case that exposed this", () => {
    // Warmup 19:11, then the watch off, work 20:17, off again, cooldown 21:53.
    // Wall-clock span start-to-finish was 2:01:28; actual recording 1:01:21.
    const wu = 19 * 60 + 11;
    const wk = 20 * 60 + 17;
    const cd = 21 * 60 + 53;
    const gap1 = 30 * 60;
    const gap2 = 30 * 60 + 7;

    const points = [
      ...file("warmup", 0, wu),
      ...file("work", wu + gap1, wk),
      ...file("cooldown", wu + gap1 + wk + gap2, cd),
    ];

    // What the old code did: last merged point's elapsed_s.
    const wallClockSpan = points[points.length - 1].elapsed_s;
    expect(wallClockSpan).toBe(7288); // 2:01:28 — the figure that was stored

    // What it should be: the three segments, and nothing else.
    expect(computeRecordedSeconds(points)).toBe(wu + wk + cd);
    expect(computeRecordedSeconds(points)).toBe(3681); // 1:01:21

    // The old figure was 1.98x the real one, which is why load looked doubled.
    expect(wallClockSpan / computeRecordedSeconds(points)).toBeCloseTo(1.98, 2);
  });

  it("counts nothing for an empty or malformed set", () => {
    expect(computeRecordedSeconds([])).toBe(0);
    expect(computeRecordedSeconds([{ elapsed_s: NaN, file_id: "a" }])).toBe(0);
    expect(computeRecordedSeconds([{ elapsed_s: 100, file_id: "a" }])).toBe(0);
  });

  it("is order-independent", () => {
    const pts = [...file("a", 0, 600), ...file("b", 3000, 600)];
    const shuffled = [...pts].sort(() => Math.random() - 0.5);
    expect(computeRecordedSeconds(shuffled)).toBe(computeRecordedSeconds(pts));
  });
});

describe("computeTotalStoppedSeconds", () => {
  it("does NOT count the gap between two files as a stop", () => {
    // The between-file gap is time nothing was recorded, not time standing
    // still. Counting it would subtract it from a recorded-time total that
    // never included it in the first place.
    const points = [...file("a", 0, 600), ...file("b", 600 + 1800, 600)];
    expect(computeTotalStoppedSeconds(points)).toBe(0);
  });

  it("still counts a real pause WITHIN a file", () => {
    const t0 = Date.parse("2026-08-06T06:00:00Z");
    const points: P[] = [
      ...file("a", 0, 300, t0),
      // 574s gap inside the same recording — a genuine standing stop.
      ...file("a", 300 + 574, 300, t0),
    ];
    expect(computeTotalStoppedSeconds(points)).toBe(574);
  });

  it("a standing recovery with the watch running is not a stop", () => {
    // Points keep arriving every second through a standing recovery, so no
    // gap appears and the recovery stays inside moving time. This is why
    // switching load onto moving time does not strip interval recoveries.
    const points = file("a", 0, 1200);
    expect(computeTotalStoppedSeconds(points)).toBe(0);
  });

  it("moving time can never exceed recorded time", () => {
    const cases: P[][] = [
      file("a", 0, 3600),
      [...file("a", 0, 600), ...file("b", 5000, 600)],
      [...file("a", 0, 300), ...file("a", 900, 300)],
    ];
    for (const pts of cases) {
      const recorded = computeRecordedSeconds(pts);
      const moving = Math.max(0, recorded - computeTotalStoppedSeconds(pts));
      expect(moving).toBeLessThanOrEqual(recorded);
    }
  });
});
