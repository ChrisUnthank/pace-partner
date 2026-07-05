// GPS track reconstruction utilities.
// Detects dropouts / spikes / jitter in raw GPS points, produces a corrected
// cumulative-distance series, optionally reconciles to an official distance,
// and builds evenly-spaced splits from the corrected series.

export type RawPoint = {
  elapsed_s: number;
  distance_m?: number | null;
  lat?: number | null;
  lng?: number | null;
  heart_rate?: number | null;
  hr?: number | null;
};

export type CorrectedPoint = {
  elapsedS: number;
  distanceM: number;
  hr: number | null;
  anomaly: boolean;
};

export type Anomaly = {
  startElapsed: number;
  endElapsed: number;
  type: "dropout" | "spike" | "jitter";
  rawDeltaM: number;
  correctedDeltaM: number;
  adjustmentM: number;
};

export type Reconstruction = {
  points: CorrectedPoint[];
  anomalies: Anomaly[];
  rawTotalDistanceM: number;
  reconstructedTotalDistanceM: number;
  finalTotalDistanceM: number;
  anchor: "official" | "reconstructed" | "raw" | "none";
  genericSmoothingM: number;
};

export type Split = {
  index: number;
  durationS: number;
  avgHr: number | null;
  hrSeries: number[];
  isPartial: boolean;
  hasAnomaly: boolean;
  startDistanceM: number;
  endDistanceM: number;
};

function getHr(p: RawPoint): number | null {
  const v = p.heart_rate ?? p.hr ?? null;
  return typeof v === "number" && v > 0 ? v : null;
}

export function reconstructTrack(
  raw: RawPoint[],
  officialDistanceM: number | null,
): Reconstruction {
  if (!raw || raw.length === 0) {
    return {
      points: [],
      anomalies: [],
      rawTotalDistanceM: 0,
      reconstructedTotalDistanceM: 0,
      finalTotalDistanceM: officialDistanceM ?? 0,
      anchor: "none",
      genericSmoothingM: 0,
    };
  }

  // Build a raw distance/elapsed series (assume distance_m is cumulative).
  const sorted = [...raw].sort((a, b) => (a.elapsed_s ?? 0) - (b.elapsed_s ?? 0));
  const points: CorrectedPoint[] = sorted.map((p) => ({
    elapsedS: p.elapsed_s ?? 0,
    distanceM: typeof p.distance_m === "number" ? p.distance_m : 0,
    hr: getHr(p),
    anomaly: false,
  }));

  const rawTotal = points[points.length - 1].distanceM || 0;

  // Detect per-step anomalies from speed (m/s).
  const anomalies: Anomaly[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].elapsedS - points[i - 1].elapsedS;
    const dd = points[i].distanceM - points[i - 1].distanceM;
    if (dt <= 0) continue;
    const speed = dd / dt;
    // Flag obvious dropouts (>3s gap with implausible distance) or spikes (>12 m/s ~ sub-1:24/km).
    if (dt > 5 && dd < 0.5) {
      const corrected = dt * 3.5; // assume ~3:00/km-ish jog through the dropout
      anomalies.push({
        startElapsed: points[i - 1].elapsedS,
        endElapsed: points[i].elapsedS,
        type: "dropout",
        rawDeltaM: dd,
        correctedDeltaM: corrected,
        adjustmentM: corrected - dd,
      });
      points[i].anomaly = true;
      points[i - 1].anomaly = true;
    } else if (speed > 12) {
      const corrected = dt * 5;
      anomalies.push({
        startElapsed: points[i - 1].elapsedS,
        endElapsed: points[i].elapsedS,
        type: "spike",
        rawDeltaM: dd,
        correctedDeltaM: corrected,
        adjustmentM: corrected - dd,
      });
      points[i].anomaly = true;
    }
  }

  // Apply anomaly adjustments to produce a corrected cumulative series.
  const adjustmentTotal = anomalies.reduce((s, a) => s + a.adjustmentM, 0);
  const reconstructedTotal = rawTotal + adjustmentTotal;

  // Rebuild cumulative distances with per-step corrections.
  const corrections = new Map<number, number>();
  for (const a of anomalies) {
    corrections.set(a.endElapsed, (corrections.get(a.endElapsed) ?? 0) + (a.correctedDeltaM - a.rawDeltaM));
  }
  let running = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      running = points[0].distanceM;
    } else {
      const dd = points[i].distanceM - points[i - 1].distanceM;
      running += dd + (corrections.get(points[i].elapsedS) ?? 0);
    }
    points[i].distanceM = running;
  }

  // Reconcile to official distance if provided (distribute remaining diff evenly).
  let anchor: Reconstruction["anchor"] = officialDistanceM ? "official" : "reconstructed";
  let genericSmoothing = 0;
  let finalTotal = reconstructedTotal;
  if (officialDistanceM && reconstructedTotal > 0) {
    genericSmoothing = officialDistanceM - reconstructedTotal;
    const scale = officialDistanceM / reconstructedTotal;
    for (let i = 0; i < points.length; i++) points[i].distanceM *= scale;
    finalTotal = officialDistanceM;
  } else if (!officialDistanceM && reconstructedTotal === 0) {
    anchor = rawTotal > 0 ? "raw" : "none";
    finalTotal = rawTotal;
  }

  return {
    points,
    anomalies,
    rawTotalDistanceM: rawTotal,
    reconstructedTotalDistanceM: reconstructedTotal,
    finalTotalDistanceM: finalTotal,
    anchor,
    genericSmoothingM: genericSmoothing,
  };
}

export function buildSplitsFromCorrectedPoints(
  points: CorrectedPoint[],
  splitDistanceM: number,
): Split[] {
  if (!points.length || splitDistanceM <= 0) return [];
  const total = points[points.length - 1].distanceM;
  const splits: Split[] = [];
  let idx = 1;
  let cursor = 0;
  let boundary = splitDistanceM;
  let startElapsed = points[0].elapsedS;
  let startDistance = 0;
  let hrs: number[] = [];
  let anomaly = false;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.hr != null) hrs.push(p.hr);
    if (p.anomaly) anomaly = true;

    while (p.distanceM >= boundary && boundary <= total) {
      // interpolate elapsed at boundary
      const prev = points[i - 1];
      const dd = p.distanceM - prev.distanceM;
      const frac = dd > 0 ? (boundary - prev.distanceM) / dd : 0;
      const elapsedAtBoundary = prev.elapsedS + frac * (p.elapsedS - prev.elapsedS);
      const durationS = elapsedAtBoundary - startElapsed;
      splits.push({
        index: idx,
        durationS,
        avgHr: hrs.length ? hrs.reduce((s, x) => s + x, 0) / hrs.length : null,
        hrSeries: hrs.slice(),
        isPartial: false,
        hasAnomaly: anomaly,
        startDistanceM: startDistance,
        endDistanceM: boundary,
      });
      idx++;
      startElapsed = elapsedAtBoundary;
      startDistance = boundary;
      boundary += splitDistanceM;
      hrs = [];
      anomaly = false;
      cursor = boundary;
    }
  }

  // Trailing partial split
  const last = points[points.length - 1];
  if (last.distanceM > startDistance + 1) {
    splits.push({
      index: idx,
      durationS: last.elapsedS - startElapsed,
      avgHr: hrs.length ? hrs.reduce((s, x) => s + x, 0) / hrs.length : null,
      hrSeries: hrs.slice(),
      isPartial: true,
      hasAnomaly: anomaly,
      startDistanceM: startDistance,
      endDistanceM: last.distanceM,
    });
  }

  void cursor;
  return splits;
}

export function smoothSeries(series: number[], window = 3): number[] {
  if (!series?.length) return [];
  if (window <= 1) return series.slice();
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(series.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += series[j];
    out.push(sum / (end - start));
  }
  return out;
}