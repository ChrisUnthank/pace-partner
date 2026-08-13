-- ============================================================================
-- Per-segment gear allocation.
--
-- A track session is commonly three different shoes: trainers to warm up,
-- spikes for the reps, trainers again to cool down. Until now session_gear
-- could only say "this shoe was used in this session", with two consequences:
--
--   1. No way to record which shoe did which part.
--   2. Mileage double-counted. Gear usage summed sessions.total_distance_m
--      per linked item, so linking two shoes to one 10 km session credited
--      BOTH with 10 km — inflating each shoe's total and its retirement
--      progress. The more honestly you tagged a session, the more wrong the
--      numbers got.
--
-- This adds segment_type to the link, and an RPC that apportions distance
-- properly instead of handing every linked item the whole session.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column. NULL keeps its existing meaning: the whole session.
-- ---------------------------------------------------------------------------
ALTER TABLE public.session_gear
  ADD COLUMN IF NOT EXISTS segment_type text;

COMMENT ON COLUMN public.session_gear.segment_type IS
  'Which part of the session this gear was used for: warmup, work, recovery, cooldown. NULL = the whole session (the original behaviour, and still correct for a plain easy run in one pair).';

-- ---------------------------------------------------------------------------
-- 2. Uniqueness has to include the segment now — the SAME shoe legitimately
--    appears twice on one session (warmup and cooldown in the trainers).
--
--    Written defensively: the original constraint may have been created by
--    hand with a name this migration can't predict, so anything unique on
--    exactly (session_id, gear_id) is found by shape and dropped.
--
--    Two PARTIAL unique indexes rather than one with NULLS NOT DISTINCT:
--    that clause needs Postgres 15+, and partial indexes do the same job on
--    any version. Together they say "one whole-session link per shoe" and
--    "one link per shoe per segment", which is what we want.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'session_gear'
      AND c.contype = 'u'
      AND (
        -- attname is of type `name`, so it must be cast before comparing to a
        -- text[] literal — otherwise: "operator does not exist: name[] = text[]"
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(c.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['gear_id', 'session_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.session_gear DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Same treatment for a plain unique INDEX on those two columns, which is the
-- other shape the original could have taken.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idxname
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'session_gear'
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indpred IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(i.indkey::smallint[]) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['gear_id', 'session_id']::text[]
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', split_part(r.idxname, '.', -1));
  END LOOP;
END $$;

DROP INDEX IF EXISTS session_gear_unique_link_idx;
DROP INDEX IF EXISTS session_gear_unique_whole_idx;
DROP INDEX IF EXISTS session_gear_unique_segment_idx;

CREATE UNIQUE INDEX session_gear_unique_whole_idx
  ON public.session_gear (session_id, gear_id)
  WHERE segment_type IS NULL;

CREATE UNIQUE INDEX session_gear_unique_segment_idx
  ON public.session_gear (session_id, gear_id, segment_type)
  WHERE segment_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS session_gear_segment_idx
  ON public.session_gear (segment_type);

-- ---------------------------------------------------------------------------
-- 3. Usage RPC — one row per link, with the distance that link actually
--    accounts for.
--
--    How distance is resolved, in order of trustworthiness:
--      NULL segment  -> sessions.total_distance_m        (exact)
--      'work'        -> sessions.work_distance_m         (exact, already stored)
--      other segment -> derived from raw_session_points  (exact, when points exist)
--      fallback      -> whatever's left of the session after the work portion,
--                       split evenly across the tagged non-work segments
--                       (ESTIMATED — flagged, never presented as exact)
--
--    The estimate exists because plenty of sessions have no raw points, and
--    returning 0 km for a warmup that definitely happened would be worse than
--    an honest approximation. is_estimated lets the UI say which is which
--    rather than quietly blending them.
-- ---------------------------------------------------------------------------
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
  -- Real per-segment distance, where the session has raw points to derive it.
  seg_dist AS (
    SELECT rp.session_id AS sd_session, rp.segment_type AS sd_seg,
           MAX(rp.distance_m) - MIN(rp.distance_m) AS sd_m
    FROM public.raw_session_points rp
    WHERE rp.session_id IN (SELECT l.s_id FROM links l)
      AND rp.segment_type IS NOT NULL
    GROUP BY rp.session_id, rp.segment_type
  ),
  -- How many non-work segments are tagged on each session, for splitting the
  -- remainder when raw points aren't available.
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
      WHEN l.seg IS NULL      THEN COALESCE(s.total_distance_m, 0)::numeric
      WHEN l.seg = 'work'     THEN COALESCE(s.work_distance_m, sd.sd_m, 0)::numeric
      WHEN sd.sd_m IS NOT NULL THEN sd.sd_m::numeric
      ELSE GREATEST(
             COALESCE(s.total_distance_m, 0) - COALESCE(s.work_distance_m, 0),
             0
           )::numeric / GREATEST(COALESCE(nc.nc_n, 1), 1)
    END AS distance_m,
    (l.seg IS NOT NULL AND l.seg <> 'work' AND sd.sd_m IS NULL) AS is_estimated
  FROM links l
  JOIN public.sessions s ON s.id = l.s_id
  LEFT JOIN seg_dist sd ON sd.sd_session = l.s_id AND sd.sd_seg = l.seg
  LEFT JOIN nonwork_counts nc ON nc.nc_session = l.s_id
  ORDER BY s.session_date DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_gear_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gear_usage(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately (returns rows).
-- ============================================================================
-- SELECT * FROM public.get_gear_usage('01163ee4-ede0-4a90-bff3-31c6a48df77c');
--
-- Totals per shoe, which is what the Gear page will now show:
-- SELECT gear_id, ROUND(SUM(distance_m)/1000, 1) AS km,
--        COUNT(*) AS links, bool_or(is_estimated) AS any_estimated
-- FROM public.get_gear_usage('01163ee4-ede0-4a90-bff3-31c6a48df77c')
-- GROUP BY gear_id;
