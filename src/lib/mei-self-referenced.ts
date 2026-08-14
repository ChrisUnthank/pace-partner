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
}

export interface MeiScored {
  sessionId: string;
  mei: number | null;
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
export function scoreAgainstOwnHistory(samples: MeiSample[], windowSize = 20): MeiScored[] {
  const chronological = samples
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const history = new Map<string, number[]>();
  const out: MeiScored[] = [];

  for (const s of chronological) {
    const mei = computeMei(s);
    // Sessions with no usable mechanics are returned unscored rather than
    // dropped, so the caller can still show the row and say why it's blank.
    const bucket = s.workoutType ?? "unknown";
    const prior = history.get(bucket) ?? [];
    const windowed = prior.slice(-windowSize);
    const baseline = median(windowed);

    if (mei == null) {
      out.push({
        sessionId: s.sessionId,
        mei: null,
        score: null,
        vsBaselinePct: null,
        baseline,
        baselineN: windowed.length,
        hasEnoughHistory: windowed.length >= MIN_BASELINE_SESSIONS,
      });
      continue;
    }

    let score: number | null = null;
    let vsBaselinePct: number | null = null;

    if (baseline != null && baseline > 0 && windowed.length >= MIN_BASELINE_SESSIONS) {
      vsBaselinePct = ((mei - baseline) / baseline) * 100;
      // Linear either side of 50, clamped. Linear rather than curved because
      // the reader needs to be able to reason about it: "10 points is roughly
      // 3% off your norm" is a sentence a coach can hold in their head.
      score = Math.max(0, Math.min(100, 50 + (vsBaselinePct / FULL_SCALE_PCT) * 50));
    }

    out.push({
      sessionId: s.sessionId,
      mei,
      score,
      vsBaselinePct,
      baseline,
      baselineN: windowed.length,
      hasEnoughHistory: windowed.length >= MIN_BASELINE_SESSIONS,
    });

    // Added AFTER scoring, so this session contributes to future baselines
    // but never to its own.
    history.set(bucket, [...prior, mei]);
  }

  // Restore the caller's original ordering.
  const byId = new Map(out.map((r) => [r.sessionId, r]));
  return samples.map((s) => byId.get(s.sessionId)!).filter(Boolean);
}

/** Plain-language reading of a self-referenced score. */
export function describeSelfScore(r: MeiScored): string {
  if (!r.hasEnoughHistory) {
    const need = MIN_BASELINE_SESSIONS - r.baselineN;
    return `Building baseline — ${need} more session${need === 1 ? "" : "s"} of this type needed before scoring.`;
  }
  if (r.mei == null) return "No usable mechanics data for this session.";
  if (r.vsBaselinePct == null) return "No baseline yet.";
  const pct = Math.abs(r.vsBaselinePct).toFixed(1);
  if (Math.abs(r.vsBaselinePct) < 2) return `In line with this athlete's own norm for this session type.`;
  return r.vsBaselinePct > 0
    ? `${pct}% more efficient than this athlete's own norm for this session type.`
    : `${pct}% below this athlete's own norm for this session type.`;
}
