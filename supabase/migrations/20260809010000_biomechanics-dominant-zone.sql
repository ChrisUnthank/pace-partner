-- ============================================================================
-- Biomechanics — Phase 1: reconnect dominant_zone to real zone data
-- ============================================================================
--
-- THE PROBLEM
-- get_athlete_biomechanics_trend's `dominant_zone` column was a hardcoded
-- lookup from the session's coded `intent` label (tempo → z3, vo2 → z5, etc)
-- — a completely different, coarser concept than the athlete's real
-- time-in-zone data in session_zone_time (the system fixed in the Zones
-- pass, Update 42). If a session's intent was ever misclassified, unset, or
-- mixed, this silently showed the wrong zone or none at all — and it never
-- reflected a coach's manually-configured zone thresholds either, since it
-- never looked at zone data at all.
--
-- THE FIX
-- dominant_zone now comes from session_zone_time: whichever zone the
-- athlete spent the most seconds in, on their own preferred basis (pace or
-- HR, from athlete_zone_profiles.preferred_zone_basis). Falls back to the
-- old intent-based label ONLY when no real zone-time data exists for that
-- session — old sessions from before zone tracking, or activities without
-- HR/pace data to classify. Real data is always preferred when available.
--
-- WHAT DIDN'T CHANGE
-- Every other part of this function — MEI, Vertical Efficiency, Rhythm,
-- Stability, Fatigue, the composite scores, the continuous-only gating —
-- is reproduced byte-for-byte from the live version. This migration's diff
-- against the previous one should show only the zone-related additions.
--
-- SAFE TO RE-RUN.
-- ============================================================================

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
  biomechanical_fatigue_score numeric, overall_economy_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_level text;
  -- NEW: the athlete's own zone-basis preference, same field the Zones
  -- system uses to decide which of pace/HR is "the" active read for real
  -- session analysis. Defaults to 'pace' if the athlete has no zone
  -- profile row at all yet (matches athlete_zone_profiles' own column
  -- default, so an unconfigured athlete behaves the same here as there).
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
      -- RENAMED from ar_zone: this is now explicitly the FALLBACK label,
      -- used only when session_zone_time has no real data for this
      -- session. Expression itself is unchanged from the live version.
      CASE s.intent
        WHEN 'easy' THEN 'z1'
        WHEN 'aerobic' THEN 'z2'
        WHEN 'tempo' THEN 'z3'
        WHEN 'threshold' THEN 'z4'
        WHEN 'vo2' THEN 'z5'
        WHEN 'anaerobic' THEN 'z6'
        ELSE NULL
      END AS ar_zone_fallback
    FROM public.sessions s
    WHERE s.athlete_id = _athlete_id
      AND s.completed_at IS NOT NULL
      AND s.day_type <> 'cross_training'
      AND (s.activity_type IS NULL OR s.activity_type IN ('run', 'track'))
      AND s.session_date >= (CURRENT_DATE - INTERVAL '365 days')
    ORDER BY s.session_date DESC
    LIMIT 400
  ),
  -- NEW: real dominant zone from the athlete's actual time-in-zone data,
  -- on whichever basis (pace/HR) they actually use. Whole-session level,
  -- same granularity session_zone_time is already stored at — it doesn't
  -- distinguish warmup/work/recovery/cooldown, so this isn't affected by
  -- _segment_type one way or the other. Ties broken deterministically by
  -- zone label (arbitrary but stable) rather than left to row order.
  zone_dominance AS (
    SELECT DISTINCT ON (zt.session_id)
      zt.session_id AS zd_session_id,
      zt.zone AS zd_zone
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
      sf.session_id AS sf_session_id,
      sf.hr_drift_bpm AS sf_hr_drift_bpm,
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
  display_runs AS (
    SELECT * FROM all_runs ar_outer ORDER BY ar_outer.session_date DESC LIMIT _limit
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
      dr.id, dr.session_date, dr.title, dr.ar_bucket,
      -- CHANGED: carry both the fallback label and the real computed zone
      -- (via the new zone_dominance join below) through to final_scores.
      dr.ar_zone_fallback, zd.zd_zone,
      dr.structure,
      ws.ws_effective_cadence, ws.ws_stride_length_m,
      pa.pa_avg_vo_cm, pa.pa_vo_stddev, pa.pa_avg_gct_ms, pa.pa_gct_stddev, pa.pa_avg_gct_balance_pct,
      pa.pa_cadence_stddev, pa.pa_point_avg_cadence, pa.pa_point_avg_stride, pa.pa_stride_stddev,
      dft.sf_hr_drift_bpm, dft.sf_pace_hr_efficiency,
      es.es_early_cadence, es.es_early_gct, es.es_early_vo, es.es_late_cadence, es.es_late_gct, es.es_late_vo,
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
    LEFT JOIN public.mechanics_workout_templates tpl ON tpl.workout_type = dr.ar_bucket AND tpl.level = v_level
    LEFT JOIN LATERAL (
      SELECT AVG(x.ws_effective_cadence) AS bl_cadence, AVG(x.ws_stride_length_m) AS bl_stride,
             AVG(x.pa_avg_vo_cm) AS bl_vo, AVG(x.pa_avg_gct_ms) AS bl_gct, COUNT(*) AS bl_n
      FROM (
        SELECT hist.ws_effective_cadence, hist.ws_stride_length_m, hist_pa.pa_avg_vo_cm, hist_pa.pa_avg_gct_ms
        FROM with_stride hist
        LEFT JOIN point_avgs hist_pa ON hist_pa.pa_session_id = hist.id
        WHERE hist.ar_bucket = dr.ar_bucket AND hist.session_date < dr.session_date
        ORDER BY hist.session_date DESC LIMIT 10
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
      CASE WHEN sc.structure = 'continuous' AND sc.pa_cadence_stddev IS NOT NULL AND sc.pa_point_avg_cadence > 0
                AND sc.pa_stride_stddev IS NOT NULL AND sc.pa_point_avg_stride > 0
           THEN GREATEST(0, LEAST(100, 100 - 200 * (sc.pa_cadence_stddev / sc.pa_point_avg_cadence) - 200 * (sc.pa_stride_stddev / sc.pa_point_avg_stride)))
           ELSE NULL END AS fs_rhythm_score,
      CASE WHEN sc.structure = 'continuous' AND sc.pa_gct_stddev IS NOT NULL AND sc.pa_avg_gct_ms > 0
                AND sc.pa_vo_stddev IS NOT NULL AND sc.pa_avg_vo_cm > 0
           THEN GREATEST(0, LEAST(100, 100 - 200 * (sc.pa_gct_stddev / sc.pa_avg_gct_ms) - 200 * (sc.pa_vo_stddev / sc.pa_avg_vo_cm)))
           ELSE NULL END AS fs_stability_score,
      CASE WHEN sc.structure = 'continuous' AND sc.es_early_cadence > 0 AND sc.es_late_cadence IS NOT NULL
                AND sc.es_early_gct > 0 AND sc.es_late_gct IS NOT NULL AND sc.es_early_vo > 0 AND sc.es_late_vo IS NOT NULL
           THEN GREATEST(0, LEAST(100, 100
                - 4 * GREATEST(0, (sc.es_late_gct - sc.es_early_gct) / sc.es_early_gct * 100)
                - 4 * GREATEST(0, (sc.es_late_vo - sc.es_early_vo) / sc.es_early_vo * 100)
                - 3 * GREATEST(0, -(sc.es_late_cadence - sc.es_early_cadence) / sc.es_early_cadence * 100)))
           ELSE NULL END AS fs_fatigue_score,
      CASE WHEN sc.es_early_vo IS NOT NULL AND sc.es_late_vo IS NOT NULL THEN ROUND(sc.es_late_vo - sc.es_early_vo, 2) ELSE NULL END AS fs_vo_drift_cm
    FROM scored sc
  )
  SELECT
    f.id, f.session_date, f.title, f.ar_bucket,
    -- CHANGED: real zone-time data wins when available; the old
    -- intent-based label is now purely a fallback for sessions with no
    -- zone-time data at all.
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
         ELSE NULL END
  FROM final_scores f
  ORDER BY f.session_date DESC;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION — run manually after deploying, on an athlete with sessions
-- both before and after the Zones backfill:
--
-- SELECT session_date, workout_type, dominant_zone
-- FROM public.get_athlete_biomechanics_trend('<ATHLETE_ID>', 20, NULL)
-- ORDER BY session_date DESC;
--
-- Sessions with real session_zone_time data should now show a zone that
-- matches what the Zones page itself reports as dominant for that session
-- — not just whatever the coded intent implied.
-- ============================================================================
