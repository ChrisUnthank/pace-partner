-- ============================================================================
-- Session ordering — Phase 1: recompute_fit_import_session_dates also
-- writes time_of_day (real fix, not pure capture)
-- ============================================================================
--
-- THE PROBLEM (confirmed across ~20 session-list queries app-wide): no
-- session-list query anywhere has a secondary sort key for same-day
-- ordering — every one falls back to whatever order the database happens
-- to return rows in, which in practice tracks upload/insertion order, not
-- actual time of day. Root cause: FIT-import has always computed the
-- correct Morning/Afternoon/Evening bucket, but only ever baked it into
-- the session's TITLE TEXT — never into the time_of_day COLUMN, which is
-- the only thing a query could actually sort by.
--
-- THE FIX (three parts total — this is part 1 + 2 combined)
-- 1. session-files.functions.ts (already shipped alongside this
--    migration): both the initial-upload insert and the per-rebuild title
--    recompute now also write time_of_day, using the exact same hour
--    logic already used for the title. So every FUTURE upload gets this
--    right automatically.
-- 2. THIS MIGRATION doubles as the backfill for EXISTING sessions: same
--    logic recompute_fit_import_session_dates already used to correct
--    session_date and title, extended to also set time_of_day. Running
--    this per-athlete (see backfill block at the bottom) fixes every
--    already-uploaded session in one pass — no separate backfill script
--    needed, this function already had all the right anchor-time logic.
-- 3. NOT in this migration: sweeping all ~20 session-list queries to
--    actually add `.order("time_of_day")` as a secondary sort — that's
--    the next piece, once this data is reliably populated everywhere.
--
-- DECOUPLED FROM THE TITLE-REGEX GUARD, ON PURPOSE: the title recompute
-- only touches sessions whose title still looks auto-generated (so a
-- coach's manual rename is never overwritten) — but time_of_day is DATA
-- (drives sort order), not a display label, so it updates whenever there's
-- a valid anchor time, regardless of what the session is titled. A rename
-- changes what it's called, not when it actually happened.
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
        WHEN trim(s.title) ~* '^(morning|afternoon|evening)\s+session$'
          THEN CASE
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 11 THEN 'Morning session'
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'Afternoon session'
            ELSE 'Evening session'
          END
        ELSE s.title
      END AS new_title,
      -- NEW: real data, not gated behind the title-regex match — see
      -- header note.
      CASE
        WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 11 THEN 'morning'
        WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'afternoon'
        ELSE 'evening'
      END AS new_time_of_day
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

-- ============================================================================
-- ONE-TIME BACKFILL — run manually, once, in the Supabase SQL Editor. This
-- is what actually corrects time_of_day (and re-confirms date/title) on
-- every FIT-imported session already in the database, for every athlete
-- who's ever uploaded a file. Safe to re-run — every write above is a
-- no-op if the value already matches.
-- ============================================================================
--
-- DO $$
-- DECLARE ath uuid;
-- BEGIN
--   FOR ath IN SELECT DISTINCT athlete_id FROM public.sessions WHERE source = 'fit_import'
--   LOOP
--     PERFORM public.recompute_fit_import_session_dates(ath);
--   END LOOP;
-- END $$;
--
-- Sanity check afterward — should return 0 (every fit_import session
-- should now have a time_of_day set):
-- SELECT COUNT(*) FROM public.sessions WHERE source = 'fit_import' AND time_of_day IS NULL;
-- ============================================================================
