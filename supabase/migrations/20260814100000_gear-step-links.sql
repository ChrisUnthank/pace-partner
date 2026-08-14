-- ============================================================================
-- Gear linked to a SPECIFIC work step, not just "the work".
--
-- session_gear.segment_type answers "which part of the session", which is
-- enough for warm up / work / cool down. It isn't enough for a session with
-- more than one work step:
--
--     1 x 2km threshold   in super flats
--     5 x 1km reps        in super spikes
--
-- Both links are segment_type = 'work', and nothing says which is which. The
-- distance apportioning then splits the work distance between them arbitrarily,
-- and any mechanics analysis attributes both sets of reps to both shoes.
--
-- THE FIX: an optional step_id on the link.
--
--   step_id IS NULL  -> applies to the whole segment_type, as now. Correct
--                       for a single-work-step session and for warm up /
--                       cool down, and it's what every existing row means, so
--                       nothing already stored changes meaning.
--   step_id set      -> applies to that step alone.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.session_gear
  ADD COLUMN IF NOT EXISTS step_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_gear_step_id_fkey') THEN
    ALTER TABLE public.session_gear
      ADD CONSTRAINT session_gear_step_id_fkey
      FOREIGN KEY (step_id) REFERENCES public.steps (id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.session_gear.step_id IS
  'Optional: pins this gear to ONE step rather than to every step of that segment_type. Needed when a session has several work steps in different shoes — e.g. a 2km threshold in flats then 5x1km in spikes.';

CREATE INDEX IF NOT EXISTS session_gear_step_idx
  ON public.session_gear (step_id) WHERE step_id IS NOT NULL;

-- Uniqueness has to include step_id now: the same shoe can legitimately be
-- linked to two different steps of the same session. Partial indexes rather
-- than NULLS NOT DISTINCT, which needs Postgres 15+.
DROP INDEX IF EXISTS session_gear_unique_whole_idx;
DROP INDEX IF EXISTS session_gear_unique_segment_idx;
DROP INDEX IF EXISTS session_gear_unique_step_idx;

CREATE UNIQUE INDEX session_gear_unique_whole_idx
  ON public.session_gear (session_id, gear_id)
  WHERE segment_type IS NULL AND step_id IS NULL;

CREATE UNIQUE INDEX session_gear_unique_segment_idx
  ON public.session_gear (session_id, gear_id, segment_type)
  WHERE segment_type IS NOT NULL AND step_id IS NULL;

CREATE UNIQUE INDEX session_gear_unique_step_idx
  ON public.session_gear (gear_id, step_id)
  WHERE step_id IS NOT NULL;


-- ============================================================================
-- get_gear_usage — resolve step-level links to that step's own distance.
--
-- Resolution order per link, most specific first:
--   step_id set   -> SUM(interval_results.actual_distance_m) for that step
--   segment named -> SUM over every step of that kind, minus any distance
--                    already claimed by step-level links on the same session
--                    and kind (otherwise a "work" link and a step link on the
--                    same session would double-count the same metres)
--   NULL segment  -> sessions.total_distance_m
--   fallbacks     -> as before
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_gear_usage(uuid);

CREATE OR REPLACE FUNCTION public.get_gear_usage(_athlete_id uuid)
RETURNS TABLE (
  link_id        uuid,
  gear_id        uuid,
  session_id     uuid,
  segment_type   text,
  step_id        uuid,
  step_label     text,
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
    SELECT sg.id AS l_id, sg.gear_id AS g_id, sg.session_id AS s_id,
           sg.segment_type AS seg, sg.step_id AS st_id
    FROM public.session_gear sg
    WHERE sg.athlete_id = _athlete_id
  ),
  -- Distance actually recorded against each individual step.
  per_step AS (
    SELECT st.id AS ps_step, st.session_id AS ps_session, st.kind::text AS ps_kind,
           st.step_order AS ps_order, st.reps AS ps_reps,
           st.target_distance_m AS ps_target,
           COALESCE(SUM(ir.actual_distance_m), 0)::numeric AS ps_m
    FROM public.steps st
    LEFT JOIN public.interval_results ir ON ir.step_id = st.id
    WHERE st.session_id IN (SELECT l.s_id FROM links l)
    GROUP BY st.id, st.session_id, st.kind, st.step_order, st.reps, st.target_distance_m
  ),
  -- Distance already claimed by step-level links, per session+kind, so a
  -- broader segment link doesn't count the same metres a second time.
  claimed AS (
    SELECT ps.ps_session AS c_session, ps.ps_kind AS c_kind, SUM(ps.ps_m) AS c_m
    FROM links l
    JOIN per_step ps ON ps.ps_step = l.st_id
    WHERE l.st_id IS NOT NULL
    GROUP BY ps.ps_session, ps.ps_kind
  ),
  seg_total AS (
    SELECT ps.ps_session AS sg_session, ps.ps_kind AS sg_kind, SUM(ps.ps_m) AS sg_m
    FROM per_step ps
    GROUP BY ps.ps_session, ps.ps_kind
  ),
  point_dist AS (
    SELECT rp.session_id AS pd_session, rp.segment_type AS pd_seg,
           MAX(rp.distance_m) - MIN(rp.distance_m) AS pd_m
    FROM public.raw_session_points rp
    WHERE rp.session_id IN (SELECT l.s_id FROM links l)
      AND rp.segment_type IS NOT NULL
    GROUP BY rp.session_id, rp.segment_type
  ),
  nonwork_counts AS (
    SELECT l.s_id AS nc_session, COUNT(*) AS nc_n
    FROM links l
    WHERE l.seg IS NOT NULL AND l.seg <> 'work' AND l.st_id IS NULL
    GROUP BY l.s_id
  )
  SELECT
    l.l_id,
    l.g_id,
    l.s_id,
    l.seg,
    l.st_id,
    CASE
      WHEN l.st_id IS NULL THEN NULL
      ELSE COALESCE(
             CASE WHEN sps.ps_reps > 1 AND sps.ps_target > 0
                  THEN sps.ps_reps || ' x ' || ROUND(sps.ps_target)::text || 'm'
                  WHEN sps.ps_target > 0
                  THEN ROUND(sps.ps_target)::text || 'm'
                  ELSE NULL END,
             'step ' || COALESCE(sps.ps_order, 0)::text)
    END AS step_label,
    s.session_date,
    s.title,
    CASE
      -- Most specific: this exact step.
      WHEN l.st_id IS NOT NULL       THEN COALESCE(sps.ps_m, 0)
      WHEN l.seg IS NULL             THEN COALESCE(s.total_distance_m, 0)::numeric
      -- A named segment gets its total less whatever step links already took.
      WHEN sgt.sg_m IS NOT NULL
       AND sgt.sg_m > 0              THEN GREATEST(sgt.sg_m - COALESCE(cl.c_m, 0), 0)
      WHEN pd.pd_m IS NOT NULL
       AND pd.pd_m > 0               THEN pd.pd_m::numeric
      WHEN l.seg = 'work'            THEN COALESCE(s.work_distance_m, 0)::numeric
      ELSE GREATEST(
             COALESCE(s.total_distance_m, 0) - COALESCE(s.work_distance_m, 0), 0
           )::numeric / GREATEST(COALESCE(nc.nc_n, 1), 1)
    END AS distance_m,
    (
      l.st_id IS NULL
      AND l.seg IS NOT NULL
      AND l.seg <> 'work'
      AND COALESCE(sgt.sg_m, 0) <= 0
      AND COALESCE(pd.pd_m, 0) <= 0
    ) AS is_estimated
  FROM links l
  JOIN public.sessions s ON s.id = l.s_id
  LEFT JOIN per_step sps ON sps.ps_step = l.st_id
  LEFT JOIN seg_total sgt ON sgt.sg_session = l.s_id AND sgt.sg_kind = l.seg
  LEFT JOIN claimed  cl  ON cl.c_session  = l.s_id AND cl.c_kind  = l.seg
  LEFT JOIN point_dist pd ON pd.pd_session = l.s_id AND pd.pd_seg = l.seg
  LEFT JOIN nonwork_counts nc ON nc.nc_session = l.s_id
  ORDER BY s.session_date DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_gear_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gear_usage(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT session_date, session_title, segment_type, step_label,
--        ROUND((distance_m/1000.0)::numeric, 2) AS km, is_estimated
-- FROM public.get_gear_usage('8b6b3720-18ac-4c49-9887-70bb7912623d')
-- ORDER BY session_date DESC;
