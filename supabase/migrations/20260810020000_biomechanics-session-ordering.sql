-- ============================================================================
-- Biomechanics — Phase 3: same-day session ordering (time_of_day tiebreak)
-- ============================================================================
--
-- SELF-CONTAINED: this file is Phase 2 (interval scoring + pace-banded
-- baseline) plus one further change layered on top — every ORDER BY
-- session_date in this function now has a same-day tiebreak. Deploying
-- this supersedes Phase 2 entirely; no need to have run it separately
-- first.
--
-- THE CHANGE: same root cause as the session-ordering fix shipped
-- alongside this migration (session-files.functions.ts + a ~20-file sweep
-- across the app's session-list queries) — session_date alone can't
-- distinguish two sessions on the same day, so every ORDER BY session_date
-- fell back to arbitrary row order. Four places affected here:
--   1. The 400-session recency window this function pulls from.
--   2. The _limit-row display window shown to the coach.
--   3. The personal-history baseline (last 10 same-pace-band sessions) —
--      the one with the most real scoring impact, since a wrong same-day
--      tiebreak here could pull in the wrong session as part of an
--      athlete's MEI/VE comparison baseline.
--   4. The final output order — what the Biomechanics trend view and
--      Speed Economy Curve actually render.
-- All four now break same-day ties on time_of_day, matching the
-- direction (most-recent-first → time_of_day DESC) already used
-- throughout the rest of this function.
--
-- NO BACKFILL NEEDED for this specific change — time_of_day itself is
-- backfilled separately (see the session-ordering migration). This
-- function just needs that column populated, which it will be once that
-- migration's backfill runs.
--
-- ============================================================================
--
-- SELF-CONTAINED: includes the dominant_zone fix from
-- 20260809010000_biomechanics-dominant-zone.sql as well as everything new
-- below, so this migration doesn't depend on whether that one was already
-- applied. Safe to run either way.
--
-- NO BACKFILL NEEDED: unlike the Zones/Physio Profile fixes, this function
-- computes everything fresh on every call — nothing is stored ahead of
-- time. The moment this deploys, every session (past and future) is scored
-- with the corrected logic the next time the Biomechanics page loads. No
-- separate recompute step required.
--
-- ============================================================================
-- WHAT THIS CHANGES
-- ============================================================================
--
-- 1. INTERVAL-SESSION SCORING (previously null for every interval/tempo/
--    VO2 session — see Phase 2 scoping doc for the full "why"). Rather than
--    reconstructing per-rep ground contact time / vertical oscillation from
--    raw GPS points (genuinely complex — bends were investigated and
--    deliberately avoided, see below), this uses fields interval_results
--    already stores directly per rep: cadence, stride_length_cm, hr_avg,
--    actual_pace_sec_per_km. No raw-point reconstruction needed at all.
--
--    - Fatigue: first 20% of WORK reps vs last 20% (min 1 rep each side),
--      comparing cadence and stride length — same asymmetric "only penalize
--      degradation" shape as the continuous version, same total penalty
--      budget (~11 points per % change), just fed by rep-level data instead
--      of a time-window split.
--    - Rhythm: rep-to-rep coefficient of variation of cadence + stride —
--      structurally the exact same formula as continuous Rhythm (100 -
--      200*CV - 200*CV), just sampled once per rep instead of continuously.
--    - Stability: REDEFINED for intervals, not approximated. Continuous
--      Stability is GCT/VO consistency, which isn't available per-rep
--      without the raw-point reconstruction this migration deliberately
--      avoids. Interval Stability instead measures rep-to-rep HR
--      consistency — a genuine, different but meaningful signal (did your
--      heart-rate response stay stable across repeated efforts of similar
--      intended intensity). This is NOT the same underlying phenomenon as
--      continuous Stability, which is exactly why the basis tag below
--      matters.
--    - Minimum 4 work reps required to attempt any of this — fewer than
--      that isn't enough for a meaningful early-vs-late or rep-to-rep read.
--    - MEI and Vertical Efficiency are unchanged — they already worked
--      correctly for interval sessions.
--    - Weighting stays 35/25/20/20 (MEI/Stability/Fatigue/Rhythm) for both
--      continuous and interval sessions, per direct decision — no
--      interval-specific reweighting.
--
-- 2. COMPARABILITY TAG ("basis" column, new). Every row now reports
--    whether its Fatigue/Stability/Rhythm/Biomechanical Score came from
--    the continuous (time-window) or interval (rep-based) methodology, or
--    NULL if neither could be computed. Per direct decision: same field,
--    same 0-100 scale, same name — but always visibly tagged, since
--    Stability specifically measures a genuinely different thing between
--    the two bases and silently treating the numbers as interchangeable
--    would be misleading.
--
-- 3. PACE-BANDED PERSONAL BASELINE (replaces workout-type grouping). The
--    40%-weighted personal-history side of the MEI/VE target now compares
--    each session against the athlete's own past sessions at a SIMILAR
--    REALIZED PACE (15 sec/km bands, the same bucketing already used by
--    get_athlete_speed_economy_curve) instead of the same workout-type
--    label. This directly surfaces something workout-type bucketing
--    couldn't: whether an individual athlete's mechanics genuinely improve,
--    hold, or decline as their own pace increases — rather than assuming
--    every "vo2" session is mechanically comparable regardless of the
--    actual pace run.
--
-- ============================================================================
-- ASSUMPTION FLAGGED FOR VERIFICATION
-- ============================================================================
-- This migration filters work reps via `st.kind = 'work'`. That value is
-- inferred from the existing recompute_session_zones function (which
-- compares kind <> 'recovery'), not directly confirmed against the live
-- step_kind enum. Worth running this once before trusting the interval
-- scores, and telling me if 'work' isn't actually a value:
--
--   SELECT enum_range(NULL::public.step_kind);
--
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_athlete_biomechanics_trend(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.get_athlete_biomechanics_trend(
  _athlete_id uuid,
  _limit integer DEFAULT 40,
  _segment_type text DEFAULT NULL::text
)
RETURNS TABLE(
  session_id uuid, session_date date, session_title text, workout_type text,
  dominant_zone text, avg_cadence numeric, stride_length_m numeric,
  avg_vo_cm numeric, vo_drift_cm numeric, avg_gct_ms numeric,
  gct_balance_pct numeric, hr_drift_bpm numeric, pace_hr_efficiency_score numeric,
  mei_score numeric, vertical_efficiency_score numeric, rhythm_score numeric,
  mechanical_stability_score numeric, biomechanical_score numeric,
  biomechanical_fatigue_score numeric, overall_economy_score numeric,
  -- NEW: 'continuous' | 'interval' | NULL (neither methodology produced a
  -- score — insufficient data either way).
  score_basis text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_level text;
  v_pref_basis text;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  IF _segment_type IS NOT NULL AND _segment_type NOT IN ('warmup', 'work', 'recovery', 'cooldown') THEN
    RAISE EXCEPTION 'invalid segment_type: %', _segment_type;
  END IF;

  SELECT a.mechanics_level INTO v_level FROM public.athletes a WHERE a.id = _athlete_id;
  v_level := COALESCE(v_level, 'competitive');

  SELECT azp.preferred_zone_basis INTO v_pref_basis
  FROM public.athlete_zone_profiles azp WHERE azp.athlete_id = _athlete_id;
  v_pref_basis := COALESCE(v_pref_basis, 'pace');

  RETURN QUERY
  WITH all_runs AS (
    SELECT
      s.id, s.session_date, s.title, s.structure, s.total_distance_m,
      COALESCE(s.total_moving_time_seconds, s.total_time_seconds) AS ar_moving_time_s,
      s.work_avg_cadence, s.work_distance_m, s.work_time_s,
      -- NEW: realized pace, drives the pace-banded personal baseline below.
      s.work_avg_pace_sec_per_km AS ar_pace,
      -- NEW: same-day tiebreak for every ORDER BY session_date below — see
      -- the session-ordering fix (session-files.functions.ts + the ~20-file
      -- sweep) for why session_date alone can't distinguish same-day
      -- sessions correctly.
      s.time_of_day AS ar_time_of_day,
      CASE
        WHEN s.day_type = 'race' THEN 'race'
        WHEN s.day_type = 'recovery' THEN 'recovery'
        WHEN s.intent = 'time_trial' THEN 'time_trial'
        WHEN s.intent = 'vo2' THEN 'vo2'
        WHEN s.intent = 'threshold' THEN 'threshold'
        WHEN s.intent = 'tempo' THEN 'tempo'
        WHEN s.intent = 'aerobic' THEN 'aerobic'
        WHEN s.intent = 'anaerobic' THEN 'anaerobic'
        WHEN s.intent = 'speed' THEN 'speed'
        WHEN s.intent = 'easy' AND s.is_long_run THEN 'long_run'
        WHEN s.intent = 'easy' THEN 'easy'
        ELSE NULL
      END AS ar_bucket,
      CASE s.intent
        WHEN 'easy' THEN 'z1' WHEN 'aerobic' THEN 'z2' WHEN 'tempo' THEN 'z3'
        WHEN 'threshold' THEN 'z4' WHEN 'vo2' THEN 'z5' WHEN 'anaerobic' THEN 'z6'
        ELSE NULL
      END AS ar_zone_fallback
    FROM public.sessions s
    WHERE s.athlete_id = _athlete_id
      AND s.completed_at IS NOT NULL
      AND s.day_type <> 'cross_training'
      AND (s.activity_type IS NULL OR s.activity_type IN ('run', 'track'))
      AND s.session_date >= (CURRENT_DATE - INTERVAL '365 days')
    ORDER BY s.session_date DESC, s.time_of_day DESC
    LIMIT 400
  ),
  zone_dominance AS (
    SELECT DISTINCT ON (zt.session_id)
      zt.session_id AS zd_session_id, zt.zone AS zd_zone
    FROM public.session_zone_time zt
    WHERE zt.session_id IN (SELECT ar.id FROM all_runs ar)
      AND zt.source = v_pref_basis::public.zone_source
    ORDER BY zt.session_id, zt.seconds DESC, zt.zone ASC
  ),
  trimmed_points AS (
    SELECT w.*
    FROM (
      SELECT
        rp.*,
        MIN(rp.elapsed_s) OVER (PARTITION BY rp.session_id, rp.step_id) AS tp_step_lo,
        MAX(rp.elapsed_s) OVER (PARTITION BY rp.session_id, rp.step_id) AS tp_step_hi
      FROM public.raw_session_points rp
      WHERE rp.session_id IN (SELECT ar.id FROM all_runs ar)
    ) w
    WHERE w.step_id IS NULL OR (w.elapsed_s >= w.tp_step_lo + 3 AND w.elapsed_s <= w.tp_step_hi - 3)
  ),
  point_avgs AS (
    SELECT
      tp.session_id AS pa_session_id,
      AVG(CASE WHEN tp.vertical_oscillation_cm > 30 THEN tp.vertical_oscillation_cm / 10 ELSE tp.vertical_oscillation_cm END) AS pa_avg_vo_cm,
      STDDEV(CASE WHEN tp.vertical_oscillation_cm > 30 THEN tp.vertical_oscillation_cm / 10 ELSE tp.vertical_oscillation_cm END) AS pa_vo_stddev,
      AVG(tp.ground_contact_time_ms) AS pa_avg_gct_ms,
      STDDEV(tp.ground_contact_time_ms) AS pa_gct_stddev,
      AVG(tp.gct_balance_pct) AS pa_avg_gct_balance_pct,
      AVG(tp.cadence) AS pa_point_avg_cadence,
      STDDEV(tp.cadence) AS pa_cadence_stddev,
      AVG(CASE WHEN tp.pace_sec_per_km > 0 AND tp.cadence > 0 AND (1000.0 / tp.pace_sec_per_km) * (60.0 / tp.cadence) <= 5
               THEN (1000.0 / tp.pace_sec_per_km) * (60.0 / tp.cadence) ELSE NULL END) AS pa_point_avg_stride,
      STDDEV(CASE WHEN tp.pace_sec_per_km > 0 AND tp.cadence > 0 AND (1000.0 / tp.pace_sec_per_km) * (60.0 / tp.cadence) <= 5
                  THEN (1000.0 / tp.pace_sec_per_km) * (60.0 / tp.cadence) ELSE NULL END) AS pa_stride_stddev
    FROM trimmed_points tp
    WHERE (_segment_type IS NULL OR tp.segment_type = _segment_type)
    GROUP BY tp.session_id
  ),
  segment_bounds AS (
    SELECT
      tp.session_id AS sb_session_id,
      MAX(tp.distance_m) - MIN(tp.distance_m) AS sb_distance_m,
      MAX(tp.elapsed_s) - MIN(tp.elapsed_s) AS sb_duration_s
    FROM trimmed_points tp
    WHERE _segment_type IS NOT NULL AND tp.segment_type = _segment_type
    GROUP BY tp.session_id
  ),
  drift AS (
    SELECT DISTINCT ON (sf.session_id)
      sf.session_id AS sf_session_id, sf.hr_drift_bpm AS sf_hr_drift_bpm,
      sf.efficiency_score AS sf_pace_hr_efficiency
    FROM public.session_fatigue sf
    WHERE sf.session_id IN (SELECT ar.id FROM all_runs ar) AND sf.method = 'continuous_drift'
    ORDER BY sf.session_id, sf.computed_at DESC
  ),
  edge_split AS (
    SELECT
      ar.id AS es_session_id,
      early.avg_cadence AS es_early_cadence, early.avg_gct AS es_early_gct, early.avg_vo AS es_early_vo,
      late.avg_cadence AS es_late_cadence, late.avg_gct AS es_late_gct, late.avg_vo AS es_late_vo
    FROM all_runs ar
    LEFT JOIN LATERAL (
      SELECT MIN(rp.elapsed_s) AS lo, MAX(rp.elapsed_s) AS hi
      FROM public.raw_session_points rp WHERE rp.session_id = ar.id
    ) bounds ON true
    LEFT JOIN LATERAL (
      SELECT AVG(rp.cadence) AS avg_cadence, AVG(rp.ground_contact_time_ms) AS avg_gct,
             AVG(CASE WHEN rp.vertical_oscillation_cm > 30 THEN rp.vertical_oscillation_cm / 10 ELSE rp.vertical_oscillation_cm END) AS avg_vo
      FROM public.raw_session_points rp
      WHERE rp.session_id = ar.id AND rp.elapsed_s <= bounds.lo + (bounds.hi - bounds.lo) * 0.20
    ) early ON true
    LEFT JOIN LATERAL (
      SELECT AVG(rp.cadence) AS avg_cadence, AVG(rp.ground_contact_time_ms) AS avg_gct,
             AVG(CASE WHEN rp.vertical_oscillation_cm > 30 THEN rp.vertical_oscillation_cm / 10 ELSE rp.vertical_oscillation_cm END) AS avg_vo
      FROM public.raw_session_points rp
      WHERE rp.session_id = ar.id AND rp.elapsed_s >= bounds.lo + (bounds.hi - bounds.lo) * 0.80
    ) late ON true
  ),

  -- ── NEW: per-rep data for interval sessions, straight from interval_results ──
  -- No raw-point reconstruction: cadence, stride, HR, and pace are already
  -- stored per rep. Only work reps (st.kind = 'work') count — recovery reps
  -- are deliberately excluded, consistent with how the continuous Fatigue
  -- score already excludes non-work content.
  work_reps AS (
    SELECT
      st.session_id AS wr_session_id,
      ir.id AS wr_id,
      ROW_NUMBER() OVER (
        PARTITION BY st.session_id
        ORDER BY st.step_order, ir.set_number, ir.rep_number
      ) AS wr_seq,
      COUNT(*) OVER (PARTITION BY st.session_id) AS wr_total,
      ir.cadence AS wr_cadence,
      (ir.stride_length_cm / 100.0) AS wr_stride_m,
      ir.hr_avg AS wr_hr,
      ir.actual_pace_sec_per_km AS wr_pace
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id IN (SELECT ar.id FROM all_runs ar)
      AND st.kind = 'work'
  ),
  -- Early/late 20% windows (min 1 rep each side) + rep-to-rep CV across ALL
  -- work reps. Only produced when a session has >= 4 work reps — fewer than
  -- that isn't enough for a meaningful read either way.
  rep_windows AS (
    SELECT
      wr_session_id AS rw_session_id,
      MAX(wr_total) AS rw_rep_count,
      AVG(wr_cadence) FILTER (WHERE wr_seq <= GREATEST(1, CEIL(wr_total * 0.2))) AS rw_early_cadence,
      AVG(wr_cadence) FILTER (WHERE wr_seq > wr_total - GREATEST(1, CEIL(wr_total * 0.2))) AS rw_late_cadence,
      AVG(wr_stride_m) FILTER (WHERE wr_seq <= GREATEST(1, CEIL(wr_total * 0.2))) AS rw_early_stride,
      AVG(wr_stride_m) FILTER (WHERE wr_seq > wr_total - GREATEST(1, CEIL(wr_total * 0.2))) AS rw_late_stride,
      AVG(wr_cadence) AS rw_avg_cadence, STDDEV(wr_cadence) AS rw_cadence_stddev,
      AVG(wr_stride_m) AS rw_avg_stride, STDDEV(wr_stride_m) AS rw_stride_stddev,
      AVG(wr_hr) AS rw_avg_hr, STDDEV(wr_hr) AS rw_hr_stddev
    FROM work_reps
    GROUP BY wr_session_id
    HAVING MAX(wr_total) >= 4
  ),

  display_runs AS (
    SELECT * FROM all_runs ar_outer ORDER BY ar_outer.session_date DESC, ar_outer.ar_time_of_day DESC LIMIT _limit
  ),
  with_stride AS (
    SELECT
      ar.*,
      CASE WHEN _segment_type IS NOT NULL THEN pa.pa_point_avg_cadence ELSE ar.work_avg_cadence::numeric END AS ws_effective_cadence,
      CASE
        WHEN _segment_type IS NOT NULL THEN
          CASE WHEN sb.sb_distance_m > 0 AND sb.sb_duration_s > 0 AND pa.pa_point_avg_cadence > 0
                    AND (sb.sb_distance_m / sb.sb_duration_s) * (60.0 / pa.pa_point_avg_cadence) <= 5
               THEN (sb.sb_distance_m / sb.sb_duration_s) * (60.0 / pa.pa_point_avg_cadence) ELSE NULL END
        ELSE
          CASE WHEN ar.work_distance_m > 0 AND ar.work_time_s > 0 AND ar.work_avg_cadence > 0
                    AND (ar.work_distance_m / ar.work_time_s) * (60.0 / ar.work_avg_cadence) <= 5
               THEN (ar.work_distance_m / ar.work_time_s) * (60.0 / ar.work_avg_cadence) ELSE NULL END
      END AS ws_stride_length_m
    FROM all_runs ar
    LEFT JOIN point_avgs pa ON pa.pa_session_id = ar.id
    LEFT JOIN segment_bounds sb ON sb.sb_session_id = ar.id
  ),
  scored AS (
    SELECT
      dr.id, dr.session_date, dr.title, dr.ar_bucket, dr.ar_pace, dr.ar_time_of_day,
      dr.ar_zone_fallback, zd.zd_zone, dr.structure,
      ws.ws_effective_cadence, ws.ws_stride_length_m,
      pa.pa_avg_vo_cm, pa.pa_vo_stddev, pa.pa_avg_gct_ms, pa.pa_gct_stddev, pa.pa_avg_gct_balance_pct,
      pa.pa_cadence_stddev, pa.pa_point_avg_cadence, pa.pa_point_avg_stride, pa.pa_stride_stddev,
      dft.sf_hr_drift_bpm, dft.sf_pace_hr_efficiency,
      es.es_early_cadence, es.es_early_gct, es.es_early_vo, es.es_late_cadence, es.es_late_gct, es.es_late_vo,
      rw.rw_rep_count, rw.rw_early_cadence, rw.rw_late_cadence, rw.rw_early_stride, rw.rw_late_stride,
      rw.rw_avg_cadence, rw.rw_cadence_stddev, rw.rw_avg_stride, rw.rw_stride_stddev,
      rw.rw_avg_hr, rw.rw_hr_stddev,
      tpl.cadence_min, tpl.cadence_max, tpl.stride_min_m, tpl.stride_max_m, tpl.gct_min_ms, tpl.gct_max_ms, tpl.vo_min_cm, tpl.vo_max_cm,
      bl.bl_cadence, bl.bl_stride, bl.bl_vo, bl.bl_gct, bl.bl_n,
      CASE WHEN ws.ws_stride_length_m IS NOT NULL AND pa.pa_avg_gct_ms > 0 AND pa.pa_avg_vo_cm > 0
           THEN ws.ws_stride_length_m / ((pa.pa_avg_gct_ms / 1000.0) * (pa.pa_avg_vo_cm / 100.0)) ELSE NULL END AS mei_actual,
      CASE WHEN tpl.stride_min_m IS NOT NULL AND tpl.gct_min_ms IS NOT NULL AND tpl.vo_min_cm IS NOT NULL
           THEN ((tpl.stride_min_m + tpl.stride_max_m) / 2) / ((((tpl.gct_min_ms + tpl.gct_max_ms) / 2) / 1000.0) * (((tpl.vo_min_cm + tpl.vo_max_cm) / 2) / 100.0))
           ELSE NULL END AS mei_tpl_center,
      CASE WHEN ws.ws_stride_length_m IS NOT NULL AND pa.pa_avg_vo_cm > 0
           THEN (ws.ws_stride_length_m * 100) / pa.pa_avg_vo_cm ELSE NULL END AS ve_actual,
      CASE WHEN tpl.stride_min_m IS NOT NULL AND tpl.vo_min_cm IS NOT NULL
           THEN ((tpl.stride_min_m + tpl.stride_max_m) / 2 * 100) / ((tpl.vo_min_cm + tpl.vo_max_cm) / 2) ELSE NULL END AS ve_tpl_center,
      CASE WHEN bl.bl_n >= 3 AND bl.bl_stride IS NOT NULL AND bl.bl_vo > 0
           THEN (bl.bl_stride * 100) / bl.bl_vo ELSE NULL END AS ve_bl_ratio,
      CASE WHEN bl.bl_n >= 3 AND bl.bl_stride IS NOT NULL AND bl.bl_gct IS NOT NULL AND bl.bl_vo > 0
           THEN bl.bl_stride / ((bl.bl_gct / 1000.0) * (bl.bl_vo / 100.0)) ELSE NULL END AS mei_bl_ratio
    FROM display_runs dr
    LEFT JOIN with_stride ws ON ws.id = dr.id
    LEFT JOIN point_avgs pa ON pa.pa_session_id = dr.id
    LEFT JOIN drift dft ON dft.sf_session_id = dr.id
    LEFT JOIN edge_split es ON es.es_session_id = dr.id
    LEFT JOIN zone_dominance zd ON zd.zd_session_id = dr.id
    LEFT JOIN rep_windows rw ON rw.rw_session_id = dr.id
    LEFT JOIN public.mechanics_workout_templates tpl ON tpl.workout_type = dr.ar_bucket AND tpl.level = v_level
    -- CHANGED: personal-history baseline now matches by REALIZED PACE BAND
    -- (15 sec/km, same bucketing as get_athlete_speed_economy_curve)
    -- instead of workout-type label. Replaces the grouping key entirely,
    -- per direct decision — this is what lets a genuinely improving-at-pace
    -- athlete be compared against their own improved-at-speed numbers,
    -- rather than a flat per-workout-type target.
    LEFT JOIN LATERAL (
      SELECT AVG(x.ws_effective_cadence) AS bl_cadence, AVG(x.ws_stride_length_m) AS bl_stride,
             AVG(x.pa_avg_vo_cm) AS bl_vo, AVG(x.pa_avg_gct_ms) AS bl_gct, COUNT(*) AS bl_n
      FROM (
        SELECT hist.ws_effective_cadence, hist.ws_stride_length_m, hist_pa.pa_avg_vo_cm, hist_pa.pa_avg_gct_ms
        FROM with_stride hist
        LEFT JOIN point_avgs hist_pa ON hist_pa.pa_session_id = hist.id
        WHERE hist.ar_pace IS NOT NULL AND dr.ar_pace IS NOT NULL
          AND ROUND(hist.ar_pace / 15) = ROUND(dr.ar_pace / 15)
          AND hist.session_date < dr.session_date
        ORDER BY hist.session_date DESC, hist.ar_time_of_day DESC LIMIT 10
      ) x
    ) bl ON true
  ),
  final_scores AS (
    SELECT
      sc.*,
      CASE WHEN sc.mei_actual IS NOT NULL AND sc.mei_tpl_center IS NOT NULL THEN
        (CASE WHEN sc.mei_actual >= (CASE WHEN sc.mei_bl_ratio IS NOT NULL THEN 0.6 * sc.mei_tpl_center + 0.4 * sc.mei_bl_ratio ELSE sc.mei_tpl_center END)
              THEN 100
              ELSE GREATEST(0, LEAST(100, 100 - 60 * ((CASE WHEN sc.mei_bl_ratio IS NOT NULL THEN 0.6 * sc.mei_tpl_center + 0.4 * sc.mei_bl_ratio ELSE sc.mei_tpl_center END) - sc.mei_actual)
                                            / ((CASE WHEN sc.mei_bl_ratio IS NOT NULL THEN 0.6 * sc.mei_tpl_center + 0.4 * sc.mei_bl_ratio ELSE sc.mei_tpl_center END) * 0.2)))
         END)
      ELSE NULL END AS fs_mei_score,
      CASE WHEN sc.ve_actual IS NOT NULL AND sc.ve_tpl_center IS NOT NULL THEN
        (CASE WHEN sc.ve_actual >= (CASE WHEN sc.ve_bl_ratio IS NOT NULL THEN 0.6 * sc.ve_tpl_center + 0.4 * sc.ve_bl_ratio ELSE sc.ve_tpl_center END)
              THEN 100
              ELSE GREATEST(0, LEAST(100, 100 - 60 * ((CASE WHEN sc.ve_bl_ratio IS NOT NULL THEN 0.6 * sc.ve_tpl_center + 0.4 * sc.ve_bl_ratio ELSE sc.ve_tpl_center END) - sc.ve_actual)
                                            / ((CASE WHEN sc.ve_bl_ratio IS NOT NULL THEN 0.6 * sc.ve_tpl_center + 0.4 * sc.ve_bl_ratio ELSE sc.ve_tpl_center END) * 0.2)))
         END)
      ELSE NULL END AS fs_ve_score,

      -- Rhythm: continuous (unchanged) OR interval (new — rep-to-rep CV,
      -- same formula shape and coefficients, different sampling granularity).
      CASE
        WHEN sc.structure = 'continuous' AND sc.pa_cadence_stddev IS NOT NULL AND sc.pa_point_avg_cadence > 0
             AND sc.pa_stride_stddev IS NOT NULL AND sc.pa_point_avg_stride > 0
        THEN GREATEST(0, LEAST(100, 100 - 200 * (sc.pa_cadence_stddev / sc.pa_point_avg_cadence) - 200 * (sc.pa_stride_stddev / sc.pa_point_avg_stride)))
        WHEN sc.structure <> 'continuous' AND sc.rw_rep_count >= 4
             AND sc.rw_cadence_stddev IS NOT NULL AND sc.rw_avg_cadence > 0
             AND sc.rw_stride_stddev IS NOT NULL AND sc.rw_avg_stride > 0
        THEN GREATEST(0, LEAST(100, 100 - 200 * (sc.rw_cadence_stddev / sc.rw_avg_cadence) - 200 * (sc.rw_stride_stddev / sc.rw_avg_stride)))
        ELSE NULL
      END AS fs_rhythm_score,

      -- Stability: continuous (unchanged, GCT/VO-based) OR interval
      -- (NEW — HR consistency, a genuinely different signal, see header).
      CASE
        WHEN sc.structure = 'continuous' AND sc.pa_gct_stddev IS NOT NULL AND sc.pa_avg_gct_ms > 0
             AND sc.pa_vo_stddev IS NOT NULL AND sc.pa_avg_vo_cm > 0
        THEN GREATEST(0, LEAST(100, 100 - 200 * (sc.pa_gct_stddev / sc.pa_avg_gct_ms) - 200 * (sc.pa_vo_stddev / sc.pa_avg_vo_cm)))
        WHEN sc.structure <> 'continuous' AND sc.rw_rep_count >= 4
             AND sc.rw_hr_stddev IS NOT NULL AND sc.rw_avg_hr > 0
        THEN GREATEST(0, LEAST(100, 100 - 300 * (sc.rw_hr_stddev / sc.rw_avg_hr)))
        ELSE NULL
      END AS fs_stability_score,

      -- Fatigue: continuous (unchanged, GCT/VO/cadence early-vs-late) OR
      -- interval (NEW — cadence + stride early-vs-late across reps).
      CASE
        WHEN sc.structure = 'continuous' AND sc.es_early_cadence > 0 AND sc.es_late_cadence IS NOT NULL
             AND sc.es_early_gct > 0 AND sc.es_late_gct IS NOT NULL AND sc.es_early_vo > 0 AND sc.es_late_vo IS NOT NULL
        THEN GREATEST(0, LEAST(100, 100
             - 4 * GREATEST(0, (sc.es_late_gct - sc.es_early_gct) / sc.es_early_gct * 100)
             - 4 * GREATEST(0, (sc.es_late_vo - sc.es_early_vo) / sc.es_early_vo * 100)
             - 3 * GREATEST(0, -(sc.es_late_cadence - sc.es_early_cadence) / sc.es_early_cadence * 100)))
        WHEN sc.structure <> 'continuous' AND sc.rw_rep_count >= 4
             AND sc.rw_early_cadence > 0 AND sc.rw_late_cadence IS NOT NULL
             AND sc.rw_early_stride > 0 AND sc.rw_late_stride IS NOT NULL
        THEN GREATEST(0, LEAST(100, 100
             - 5 * GREATEST(0, -(sc.rw_late_cadence - sc.rw_early_cadence) / sc.rw_early_cadence * 100)
             - 6 * GREATEST(0, -(sc.rw_late_stride - sc.rw_early_stride) / sc.rw_early_stride * 100)))
        ELSE NULL
      END AS fs_fatigue_score,

      CASE WHEN sc.es_early_vo IS NOT NULL AND sc.es_late_vo IS NOT NULL THEN ROUND(sc.es_late_vo - sc.es_early_vo, 2) ELSE NULL END AS fs_vo_drift_cm,

      -- NEW: which methodology actually produced (or attempted to produce)
      -- this session's Fatigue/Stability/Rhythm/composite.
      CASE
        WHEN sc.structure = 'continuous' THEN 'continuous'
        WHEN sc.structure <> 'continuous' AND sc.rw_rep_count >= 4 THEN 'interval'
        ELSE NULL
      END AS fs_basis
    FROM scored sc
  )
  SELECT
    f.id, f.session_date, f.title, f.ar_bucket,
    COALESCE(f.zd_zone::text, f.ar_zone_fallback),
    f.ws_effective_cadence, f.ws_stride_length_m, f.pa_avg_vo_cm, f.fs_vo_drift_cm,
    f.pa_avg_gct_ms, f.pa_avg_gct_balance_pct, f.sf_hr_drift_bpm,
    ROUND(f.sf_pace_hr_efficiency, 1), ROUND(f.fs_mei_score, 1), ROUND(f.fs_ve_score, 1),
    ROUND(f.fs_rhythm_score, 1), ROUND(f.fs_stability_score, 1),
    CASE WHEN f.fs_mei_score IS NOT NULL AND f.fs_stability_score IS NOT NULL AND f.fs_fatigue_score IS NOT NULL AND f.fs_rhythm_score IS NOT NULL
         THEN ROUND(0.35 * f.fs_mei_score + 0.25 * f.fs_stability_score + 0.20 * f.fs_fatigue_score + 0.20 * f.fs_rhythm_score, 1)
         ELSE NULL END,
    ROUND(f.fs_fatigue_score, 1),
    CASE WHEN f.fs_mei_score IS NOT NULL AND f.sf_pace_hr_efficiency IS NOT NULL AND f.fs_fatigue_score IS NOT NULL AND f.fs_stability_score IS NOT NULL
         THEN ROUND(0.40 * f.fs_mei_score + 0.25 * f.sf_pace_hr_efficiency + 0.20 * f.fs_fatigue_score + 0.15 * f.fs_stability_score, 1)
         ELSE NULL END,
    f.fs_basis
  FROM final_scores f
  ORDER BY f.session_date DESC, f.ar_time_of_day DESC;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- get_athlete_speed_economy_curve needs NO changes — it already just reads
-- bt.biomechanical_score from this function. Now that interval sessions can
-- populate that field, Z3-Z6 points should start appearing on the curve
-- automatically the next time it's called, with no separate deployment step.
-- ============================================================================

-- ============================================================================
-- VERIFICATION — run after deploying, on Josh (or any 1500m-type specialist
-- with real interval training history):
--
-- SELECT session_date, workout_type, structure, score_basis,
--        mechanical_stability_score, biomechanical_fatigue_score,
--        rhythm_score, biomechanical_score
-- FROM public.get_athlete_biomechanics_trend('<ATHLETE_ID>', 30, NULL)
-- ORDER BY session_date DESC;
--
-- Interval-structured sessions (VO2/threshold/speed workout types) should
-- now show score_basis = 'interval' and a populated biomechanical_score,
-- where before they'd have shown NULL across the board.
--
-- Then check the curve itself:
-- SELECT * FROM public.get_athlete_speed_economy_curve('<ATHLETE_ID>', 200, NULL)
-- ORDER BY pace_bucket_center_sec_per_km;
-- ============================================================================
