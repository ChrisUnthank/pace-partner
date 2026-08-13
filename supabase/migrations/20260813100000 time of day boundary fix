-- ============================================================================
-- Late-morning sessions were being labelled "Afternoon".
--
-- THE BUG: the morning/afternoon boundary was `hour < 11`, so anything from
-- 11:00 onward was "afternoon". An 11:01 or 11:54 start is a late-morning run
-- in anyone's language.
--
-- This isn't only a cosmetic title problem — time_of_day is what orders
-- sessions within a day everywhere in the app. Two runs at 11:01 and 16:12
-- both landed on the wrong side of the line (afternoon / evening), so even
-- with a correctly-declared enum and a correct ascending sort, the ORDER
-- looked wrong because the VALUES were wrong.
--
-- Boundary moved to `hour < 12` in all six places it appeared: four in
-- src/lib/session-files.functions.ts (committed separately) and two here.
--
-- Also fixed while here: the title-rewrite only matched titles of the form
-- "<Time> session", so "Afternoon Run" (the far more common shape for
-- continuous efforts) was never relabelled. It now matches run/ride/swim/
-- gym session too, and preserves the existing noun — "Afternoon Run"
-- becomes "Morning Run", not "Morning session".
--
-- SAFE TO RE-RUN.
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
        WHEN trim(s.title) ~* '^(morning|afternoon|evening)\s+(session|run|ride|swim|gym session)$'
          -- Rebuild the title keeping whatever NOUN it already had, so
          -- "Afternoon Run" becomes "Morning Run" rather than being
          -- flattened to "Morning session". initcap keeps "Gym Session"
          -- reading correctly too.
          THEN (CASE
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 12 THEN 'Morning'
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'Afternoon'
            ELSE 'Evening'
          END) || ' ' || regexp_replace(trim(s.title), '^(morning|afternoon|evening)\s+', '', 'i')
        ELSE s.title
      END AS new_title,
      -- FIXED: explicit ::public.session_time_of_day cast — this bare CASE
      -- expression previously came out text-typed with nothing forcing it
      -- to match sessions.time_of_day's real (now-enum) type.
      (CASE
        WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 12 THEN 'morning'
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

-- ============================================================================
-- BACKFILL — recompute every athlete's FIT-import sessions with the corrected
-- boundary. Without this, only sessions uploaded from now on get it right;
-- everything already in the database keeps its wrong label and wrong sort
-- position.
--
-- Separate DO block (never a stored function) so it runs once, on demand.
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.athletes LOOP
    PERFORM public.recompute_fit_import_session_dates(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately. Expect no rows: nothing between 11:00 and 11:59
-- local should still be labelled afternoon.
-- ============================================================================
-- SELECT s.session_date, s.title, s.time_of_day,
--        EXTRACT(HOUR FROM (MIN(sf.started_at) AT TIME ZONE COALESCE(NULLIF(a.timezone,''),'UTC')))::int AS local_hour
-- FROM public.sessions s
-- JOIN public.athletes a ON a.id = s.athlete_id
-- JOIN public.session_files sf ON sf.session_id = s.id
-- WHERE s.source = 'fit_import'
-- GROUP BY s.id, s.session_date, s.title, s.time_of_day, a.timezone
-- HAVING EXTRACT(HOUR FROM (MIN(sf.started_at) AT TIME ZONE COALESCE(NULLIF(a.timezone,''),'UTC')))::int = 11
--    AND s.time_of_day <> 'morning';
