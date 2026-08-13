-- ============================================================================
-- get_gear_usage — derive segment distance from RECORDED REPS, not from
-- sessions.work_distance_m.
--
-- THE BUG, found on a real session (Lakeside Drive, 13 Aug):
--
--   sessions.total_distance_m  19050
--   sessions.work_distance_m   19050   <-- the WHOLE session, not the work
--
--   ...while the actual recorded steps were:
--       warmup    4.04 km
--       work     10.07 km
--       cooldown  4.94 km
--
-- The original function resolved a 'work' link as
-- COALESCE(work_distance_m, ...), so it credited the shoe 19.05 km rather
-- than 10.07 km. Warm up and cool down were also unofferable in the UI,
-- because total − work came to zero.
--
-- work_distance_m is evidently not reliably "the distance of the work steps"
-- on every session — it can hold the whole session. The Overview card on the
-- session page never used it; it sums interval_results grouped by steps.kind,
-- which is the real per-segment record. This function now does the same, so
-- the two agree by construction rather than by luck.
--
-- Resolution order for one link:
--   NULL segment  -> sessions.total_distance_m                (exact)
--   named segment -> SUM(interval_results.actual_distance_m)
--                    for steps of that kind                   (exact)
--   fallback      -> raw_session_points span for that segment (exact)
--   last resort   -> non-work remainder split evenly across
--                    the tagged non-work segments             (ESTIMATED, flagged)
--
-- SAFE TO RE-RUN.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_gear_usage(uuid);

CREATE OR REPLACE FUNCTION public.get_gear_usage(_athlete_id uuid)
RETURNS TABLE (
  link_id        uuid,
  gear_id        uuid,
  session_id     uuid,
  segment_type   text,
  session_date   date,
  session_title  text,
  distance_m     numeric,
  is_estimated   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT sg.id AS l_id, sg.gear_id AS g_id, sg.session_id AS s_id, sg.segment_type AS seg
    FROM public.session_gear sg
    WHERE sg.athlete_id = _athlete_id
  ),
  -- PRIMARY SOURCE: actual recorded reps, grouped by the step's kind. This is
  -- the same computation the session Overview card performs client-side, so
  -- the number a coach sees there and the number credited to a shoe can't
  -- disagree.
  step_dist AS (
    SELECT r.sd_session, r.sd_kind, SUM(r.sd_m) AS sd_m
    FROM (
      SELECT st.session_id AS sd_session,
             st.kind::text AS sd_kind,
             COALESCE(ir.actual_distance_m, 0)::numeric AS sd_m
      FROM public.steps st
      JOIN public.interval_results ir ON ir.step_id = st.id
      WHERE st.session_id IN (SELECT l.s_id FROM links l)
    ) r
    GROUP BY r.sd_session, r.sd_kind
  ),
  -- SECONDARY: per-point span, for sessions with GPS but no structured steps.
  point_dist AS (
    SELECT rp.session_id AS pd_session, rp.segment_type AS pd_seg,
           MAX(rp.distance_m) - MIN(rp.distance_m) AS pd_m
    FROM public.raw_session_points rp
    WHERE rp.session_id IN (SELECT l.s_id FROM links l)
      AND rp.segment_type IS NOT NULL
    GROUP BY rp.session_id, rp.segment_type
  ),
  -- How many non-work segments are tagged per session, for the last-resort
  -- even split.
  nonwork_counts AS (
    SELECT l.s_id AS nc_session, COUNT(*) AS nc_n
    FROM links l
    WHERE l.seg IS NOT NULL AND l.seg <> 'work'
    GROUP BY l.s_id
  )
  SELECT
    l.l_id,
    l.g_id,
    l.s_id,
    l.seg,
    s.session_date,
    s.title,
    CASE
      WHEN l.seg IS NULL          THEN COALESCE(s.total_distance_m, 0)::numeric
      WHEN sd.sd_m IS NOT NULL
       AND sd.sd_m > 0            THEN sd.sd_m
      WHEN pd.pd_m IS NOT NULL
       AND pd.pd_m > 0            THEN pd.pd_m::numeric
      WHEN l.seg = 'work'         THEN COALESCE(s.work_distance_m, 0)::numeric
      ELSE GREATEST(
             COALESCE(s.total_distance_m, 0) - COALESCE(s.work_distance_m, 0),
             0
           )::numeric / GREATEST(COALESCE(nc.nc_n, 1), 1)
    END AS distance_m,
    -- Only the last-resort branch is an estimate. Anything derived from
    -- recorded reps or GPS points is exact and shouldn't be labelled.
    (
      l.seg IS NOT NULL
      AND COALESCE(sd.sd_m, 0) <= 0
      AND COALESCE(pd.pd_m, 0) <= 0
      AND l.seg <> 'work'
    ) AS is_estimated
  FROM links l
  JOIN public.sessions s ON s.id = l.s_id
  LEFT JOIN step_dist  sd ON sd.sd_session = l.s_id AND sd.sd_kind = l.seg
  LEFT JOIN point_dist pd ON pd.pd_session = l.s_id AND pd.pd_seg  = l.seg
  LEFT JOIN nonwork_counts nc ON nc.nc_session = l.s_id
  ORDER BY s.session_date DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_gear_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gear_usage(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately. For Lakeside Drive, a 'work' link should now show
-- ~10.07 km rather than 19.05.
-- ============================================================================
-- SELECT session_date, session_title, segment_type,
--        ROUND((distance_m / 1000.0)::numeric, 2) AS km, is_estimated
-- FROM public.get_gear_usage('01163ee4-ede0-4a90-bff3-31c6a48df77c')
-- ORDER BY session_date DESC;

-- Cross-check against the recorded steps for one session — these two should
-- agree, and should match the Overview card's segment table exactly:
-- SELECT st.kind, ROUND((SUM(ir.actual_distance_m) / 1000.0)::numeric, 2) AS km
-- FROM public.steps st
-- JOIN public.interval_results ir ON ir.step_id = st.id
-- JOIN public.sessions s ON s.id = st.session_id
-- WHERE s.title = 'Lakeside Drive'
-- GROUP BY st.kind ORDER BY st.kind;
