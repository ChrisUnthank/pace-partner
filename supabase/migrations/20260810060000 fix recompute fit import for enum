-- ============================================================================
-- Session ordering — Phase 4: fix recompute_fit_import_session_dates for
-- the new time_of_day enum
-- ============================================================================
--
-- THE BUG (introduced by the previous migration, 20260810050000, which
-- converted sessions.time_of_day from text to a real enum): this
-- function's `computed` CTE builds new_time_of_day from a bare CASE
-- expression — WHEN ... THEN 'morning' ... END — with no adjacent enum
-- context to force Postgres to infer anything other than text for it.
-- Once sessions.time_of_day became an enum, the WHERE clause's
-- `s.time_of_day IS DISTINCT FROM c.new_time_of_day` started comparing an
-- enum column against a text-typed CTE column, which has no default
-- equality operator — hence "operator does not exist: session_time_of_day
-- = text". The UPDATE...SET assignment on the same line would actually
-- have been fine on its own (assignments auto-cast); it's specifically
-- the comparison that broke.
--
-- THE FIX: explicit cast on the CASE expression itself, so
-- new_time_of_day is genuinely session_time_of_day-typed all the way
-- through the CTE — matching s.time_of_day's real type for both the
-- UPDATE assignment and the IS DISTINCT FROM comparison.
--
-- SAFE TO RE-RUN. Must run AFTER 20260810050000 (the enum conversion) —
-- run this again if the two ever get applied out of order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_fit_import_session_dates(_athlete_id uuid)
RETURNS TABLE(session_id uuid, old_date date, new_date date, old_title text, new_title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_timezone text;
BEGIN
  SELECT COALESCE(NULLIF(a.timezone, ''), 'UTC') INTO v_timezone
    FROM public.athletes a WHERE a.id = _athlete_id;

  IF v_timezone IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH anchors AS (
    -- The earliest attached file's start time is the true session start —
    -- matches how a multi-file session (Warm Up + Work + Cool Down) was
    -- originally anchored at upload time.
    SELECT sf.session_id AS sid, MIN(sf.started_at::timestamptz) AS anchor_at
      FROM public.session_files sf
      JOIN public.sessions s ON s.id = sf.session_id
     WHERE s.athlete_id = _athlete_id
       AND s.source = 'fit_import'
       AND sf.started_at IS NOT NULL
     GROUP BY sf.session_id
  ),
  computed AS (
    SELECT
      s.id AS sid,
      s.session_date AS old_date,
      (a.anchor_at AT TIME ZONE v_timezone)::date AS new_date,
      s.title AS old_title,
      -- Case/whitespace-tolerant: matches "Morning session", "morning  session",
      -- "  Evening Session " etc. Anything that doesn't look like an
      -- auto-generated title at all (a genuine custom name) is left alone.
      CASE
        WHEN trim(s.title) ~* '^(morning|afternoon|evening)\s+session$'
          THEN CASE
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 11 THEN 'Morning session'
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'Afternoon session'
            ELSE 'Evening session'
          END
        ELSE s.title
      END AS new_title,
      -- FIXED: explicit ::public.session_time_of_day cast — this bare CASE
      -- expression previously came out text-typed with nothing forcing it
      -- to match sessions.time_of_day's real (now-enum) type.
      (CASE
        WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 11 THEN 'morning'
        WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'afternoon'
        ELSE 'evening'
      END)::public.session_time_of_day AS new_time_of_day
    FROM anchors a
    JOIN public.sessions s ON s.id = a.sid
  ),
  updated AS (
    UPDATE public.sessions s
       SET session_date = c.new_date,
           title = c.new_title,
           time_of_day = c.new_time_of_day,
           updated_at = now()
      FROM computed c
     WHERE s.id = c.sid
       AND (
         s.session_date IS DISTINCT FROM c.new_date
         OR s.title IS DISTINCT FROM c.new_title
         OR s.time_of_day IS DISTINCT FROM c.new_time_of_day
       )
    RETURNING s.id, c.old_date, c.new_date, c.old_title, c.new_title
  )
  SELECT u.id, u.old_date, u.new_date, u.old_title, u.new_title
  FROM updated u;
END;
$function$;

NOTIFY pgrst, 'reload schema';
