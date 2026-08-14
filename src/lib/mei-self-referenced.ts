// mei-self-referenced.ts
//
// Mechanical Efficiency scored against the athlete's OWN history rather than
// against population template bands.
//
// WHY THIS REPLACES BAND SCORING
//
// MEI = stride / (GCT_seconds × VO_metres). The old score compared that ratio
// to mechanics_workout_templates and scored 100 at the centre of the expected
// range, falling 60 points across the next 20% below it.
//
// Two problems, both established from real data rather than argued from
// principle:
//
//   1. The curve is inverted. Everything from the range centre upward
//      flattens to 100 — no headroom for a genuinely excellent session — while
//      the bottom half of the range the template ITSELF calls acceptable
//      scores 47 (threshold), 36 (vo2), and 0 (speed).
//
//   2. The athletes don't fit the bands. Across 218 sessions, Josh and Jack
//      recorded vertical oscillation of 10.1–12.5 cm. Every VO band in the
//      template table, for every workout type at every level, tops out at
//      9.5 cm. Their BEST single session is above the most generous ceiling.
//      Since VO is a divisor, that alone costs ~28% of MEI before anything
//      else is considered.
//
// Three explanations remain live and we cannot currently separate them:
// the bands are wrong for this population, the athletes genuinely bounce
// more, or the chest strap's accelerometer over-reads VO. (HR quality was
// ruled out: VO averaged 11.63 across 217 HR-clean sessions, so it is not an
// artefact of a noisy heart-rate signal.)
//
// Self-referenced scoring is correct under ALL THREE. A constant offset —
// whatever its cause — cancels out when an athlete is compared to themselves.
// Refitting the bands would only be correct under the first, and would
// silently be wrong under the other two.
//
// WHAT THE SCORE MEANS
//   50  = this athlete's own typical MEI for this kind of session
//   >50 = better than their norm
//   <50 = below it
//
// It deliberately carries NO absolute meaning. A weaker athlete running
// consistently also scores 50, and that's the honest answer: this metric
// answers "is this athlete improving", not "is this athlete good". The
// population comparison is kept alongside as a clearly-labelled secondary
// readout so that information isn't lost — it just stops driving the number.

export interface MeiSample {
  sessionId: string;
  date: string;
  /** Bucket the session belongs to — workout_type. Compared like with like. */
  workoutType: string | null;
  strideM: number | null;
  gctMs: number | null;
  voCm: number | null;
  /** Steps per minute. Used with stride to derive pace — see paceFromSample. */
  cadence?: number | null;
}

/**
 * Pace in seconds per km, derived from stride length and cadence.
 *
 * The biomechanics RPC doesn't return pace, but speed is just
 * stride x cadence, so it can be recovered exactly rather than fetched
 * separately.
 */
export function paceFromSample(s: MeiSample): number | null {
  const stride = Number(s.strideM);
  const cad = Number(s.cadence);
  if (!(stride > 0) || !(cad > 0)) return null;
  const mps = (stride * cad) / 60;
  if (!(mps > 0)) return null;
  const pace = 1000 / mps;
  // Rails: anything outside this is a bad cadence or stride reading, and
  // letting it into the regression would tilt the whole model.
  return pace >= 120 && pace <= 480 ? pace : null;
}

export interface MeiScored {
  sessionId: string;
  mei: number | null;
  /** MEI the pace model predicts for this session. Null when unmodellable. */
  meiExpectedForPace: number | null;
  /** How far above/below that prediction, as a %. This is what gets scored. */
  paceAdjustedPct: number | null;
  score: number | null;
  /** Percent above/below the athlete's own baseline for this bucket. */
  vsBaselinePct: number | null;
  baseline: number | null;
  /** How many past sessions the baseline was computed from. */
  baselineN: number;
  /** Below MIN_BASELINE_SESSIONS: shown as "building baseline", not scored. */
  hasEnoughHistory: boolean;
}

/**
 * Sessions needed before a baseline is trusted.
 *
 * Five is a compromise. Fewer and one unusual session sets the norm; more and
 * a new athlete waits months for any score at all. Below this the UI should
 * say "building baseline" rather than showing a number — a score computed
 * from two sessions looks identical to one computed from fifty, and that
 * false confidence is worse than an honest gap.
 */
export const MIN_BASELINE_SESSIONS = 5;

/**
 * Sessions of the same type that must exist in total before ANY of them is
 * scored. With leave-one-out (below) each session's baseline is the other
 * n-1, so this is the total needed, not a count of prior sessions.
 */
export const MIN_BUCKET_SESSIONS = MIN_BASELINE_SESSIONS + 1;

/**
 * Percentage difference from baseline that maps to the top/bottom of the
 * scale. ±15% is wide enough that normal session-to-session variation doesn't
 * peg the score, and narrow enough that a real change is visible.
 *
 * Derived from the data rather than picked: within a single workout type,
 * MEI typically varies a few percent between sessions. A 15% swing is a
 * genuine change in how the athlete is moving.
 */
const FULL_SCALE_PCT = 15;

export function computeMei(s: MeiSample): number | null {
  const stride = Number(s.strideM);
  const gct = Number(s.gctMs);
  const vo = Number(s.voCm);
  if (!(stride > 0) || !(gct > 0) || !(vo > 0)) return null;

  // Physical plausibility. A computed stride of 0.64 m appeared in real data
  // (walking, or a bad cadence reading) — letting that into a baseline would
  // drag it down permanently, and every later session would then score as an
  // improvement against a corrupted norm.
  if (stride < 0.8 || stride > 2.6) return null;
  if (gct < 100 || gct > 400) return null;
  if (vo < 3 || vo > 20) return null;

  return stride / ((gct / 1000) * (vo / 100));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Scores every sample against the athlete's own rolling history.
 *
 * Baseline is the MEDIAN of prior sessions in the same workout bucket, not the
 * mean: one session with a mis-parsed cadence would move a mean noticeably and
 * a median barely. It's also strictly PRIOR sessions — including the session
 * being scored would let a single outlier partly define the norm it's being
 * judged against, which flattens exactly the signal this is meant to surface.
 *
 * `windowSize` caps how far back the baseline looks, so a genuine improvement
 * eventually becomes the new normal rather than being measured forever against
 * a first season.
 */
/**
 * Fits MEI as a power function of pace: ln(MEI) = a + b·ln(pace).
 *
 * WHY PACE HAS TO BE REMOVED FIRST
 *
 * Measured on real data, pace explains 97% of MEI's variance (r² = 0.970).
 * That is not a coincidence — run faster and stride lengthens while ground
 * contact shortens, and both push MEI up before economy is involved at all.
 *
 * Left unadjusted, a "mechanical efficiency" score is mostly a pace readout
 * wearing a different label. Bucketing by workout type only partly helps:
 * within threshold alone, pace spans 180-210 s/km and MEI moves 96 to 82, so
 * a session still scores largely on how fast it was.
 *
 * Log-log rather than straight linear because the relationship is curved. A
 * linear fit leaves residuals positive at BOTH ends of the pace range and
 * negative in the middle — an artefact of forcing a line through a curve,
 * which would read as "fast and slow sessions are both efficient". On the
 * same data: linear r² 0.947, log-log r² 0.970, and the end-curvature
 * disappears.
 *
 * The fitted exponent lands near -1.5, i.e. MEI scales roughly with speed^1.5.
 */
export interface PaceModel {
  a: number;
  b: number;
  r2: number;
  n: number;
}

export function fitPaceModel(points: { pace: number; mei: number }[]): PaceModel | null {
  const pts = points.filter((p) => p.pace > 0 && p.mei > 0);
  // Below this the fit is driven by whichever sessions happen to be present,
  // and a bad model is worse than none: it would inject error into every
  // score rather than blanking a few.
  if (pts.length < 8) return null;

  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const x = Math.log(p.pace);
    const y = Math.log(p.mei);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;

  let ssRes = 0, ssTot = 0;
  const meanY = sy / n;
  for (const p of pts) {
    const y = Math.log(p.mei);
    const pred = a + b * Math.log(p.pace);
    ssRes += (y - pred) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  return { a, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, n };
}

export function predictMei(model: PaceModel, pace: number): number | null {
  if (!(pace > 0)) return null;
  const v = Math.exp(model.a + model.b * Math.log(pace));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function scoreAgainstOwnHistory(samples: MeiSample[], windowSize = 20): MeiScored[] {
  const chronological = samples.slice().sort((a, b) => a.date.localeCompare(b.date));

  // Valid MEI per session, then the pace model, then the pace-adjusted value.
  const meiById = new Map<string, number | null>();
  const paceById = new Map<string, number | null>();

  for (const s of chronological) {
    meiById.set(s.sessionId, computeMei(s));
    paceById.set(s.sessionId, paceFromSample(s));
  }

  // ONE model across all session types, not one per bucket. The whole point
  // is to describe how MEI moves with pace, and that relationship needs the
  // full pace range to be estimated well — fitting it inside a single bucket
  // would use a narrow slice of pace and produce a far shakier line.
  const model = fitPaceModel(
    chronological
      .map((s) => ({ pace: paceById.get(s.sessionId), mei: meiById.get(s.sessionId) }))
      .filter((p): p is { pace: number; mei: number } => p.pace != null && p.mei != null),
  );

  // Pools now hold the PACE-ADJUSTED value — how far above or below the pace
  // prediction a session sat — rather than raw MEI. Baselining that is what
  // separates "moved better than usual" from "ran faster than usual".
  //
  // Falls back to raw MEI when no model could be fitted (a new athlete, or
  // too few sessions), so scoring still works; it's just less pace-controlled,
  // which the caller can see from paceAdjustedPct being null.
  const adjById = new Map<string, number | null>();
  const pools = new Map<string, { id: string; value: number; date: string }[]>();

  for (const s of chronological) {
    const mei = meiById.get(s.sessionId) ?? null;
    if (mei == null) { adjById.set(s.sessionId, null); continue; }
    const pace = paceById.get(s.sessionId) ?? null;
    const expected = model && pace != null ? predictMei(model, pace) : null;
    const value = expected != null && expected > 0 ? (mei / expected) * 100 : mei;
    adjById.set(s.sessionId, value);
    const bucket = s.workoutType ?? "unknown";
    const pool = pools.get(bucket) ?? [];
    pool.push({ id: s.sessionId, value, date: s.date });
    pools.set(bucket, pool);
  }

  const out: MeiScored[] = [];

  for (const s of chronological) {
    const bucket = s.workoutType ?? "unknown";
    const pool = pools.get(bucket) ?? [];
    const mei = meiById.get(s.sessionId) ?? null;

    // LEAVE-ONE-OUT rather than prior-sessions-only.
    //
    // The original version built the baseline from earlier sessions alone, to
    // stop a session influencing the norm it was judged against. That goal is
    // right, but the implementation was too strict: with 7 VO2 sessions and a
    // minimum of 5 priors, only the last two ever scored — the other five
    // showed "not enough data" despite the data existing. And a single
    // session missing stride or VO would drop the count below the threshold
    // and blank the whole bucket.
    //
    // Excluding just THIS session achieves the same thing without discarding
    // the rest: every session is measured against the other n-1. The trade-off
    // is that a score can shift slightly as later sessions arrive, which is
    // honest — the athlete's norm genuinely does move.
    const others = pool.filter((p) => p.id !== s.sessionId);
    const adjusted = adjById.get(s.sessionId) ?? null;
    // Nearest-in-time first, so a long history doesn't anchor a current
    // session to a much older baseline.
    const windowed = others
      .slice()
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(s.date)) - Math.abs(Date.parse(b.date) - Date.parse(s.date)))
      .slice(0, windowSize)
      .map((p) => p.value);

    const baseline = median(windowed);
    const hasEnoughHistory = windowed.length >= MIN_BASELINE_SESSIONS;

    let score: number | null = null;
    let vsBaselinePct: number | null = null;

    if (adjusted != null && baseline != null && baseline > 0 && hasEnoughHistory) {
      vsBaselinePct = ((adjusted - baseline) / baseline) * 100;
      // Linear either side of 50, clamped. Linear rather than curved because
      // the reader needs to be able to reason about it: "10 points is roughly
      // 3% off your norm" is a sentence a coach can hold in their head.
      score = Math.max(0, Math.min(100, 50 + (vsBaselinePct / FULL_SCALE_PCT) * 50));
    }

    const pace = paceById.get(s.sessionId) ?? null;
    const expected = model && pace != null ? predictMei(model, pace) : null;

    out.push({
      sessionId: s.sessionId,
      mei,
      meiExpectedForPace: expected,
      paceAdjustedPct:
        mei != null && expected != null && expected > 0 ? ((mei - expected) / expected) * 100 : null,
      score,
      vsBaselinePct,
      baseline,
      baselineN: windowed.length,
      hasEnoughHistory,
    });
  }

  const byId = new Map(out.map((r) => [r.sessionId, r]));
  return samples.map((s) => byId.get(s.sessionId)!).filter(Boolean);
}

/** Plain-language reading of a self-referenced score. */
export function describeSelfScore(r: MeiScored): string {
  if (!r.hasEnoughHistory) {
    const need = MIN_BASELINE_SESSIONS - r.baselineN;
    return `Building baseline — ${need} more session${need === 1 ? "" : "s"} of this type with usable mechanics data needed before scoring.`;
  }
  if (r.mei == null) return "No usable mechanics data for this session.";
  if (r.vsBaselinePct == null) return "No baseline yet.";
  const pct = Math.abs(r.vsBaselinePct).toFixed(1);
  if (Math.abs(r.vsBaselinePct) < 2) return `In line with this athlete's own norm for this session type.`;
  return r.vsBaselinePct > 0
    ? `${pct}% more efficient than this athlete's own norm for this session type.`
    : `${pct}% below this athlete's own norm for this session type.`;
}
