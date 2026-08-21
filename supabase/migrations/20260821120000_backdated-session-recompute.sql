-- ============================================================================
-- BACKDATED UPLOADS — recompute FORWARD, not just that day.
--
-- trg_recompute_readiness_from_session recomputes a single date:
--
--     PERFORM public.recompute_readiness(NEW.athlete_id, NEW.session_date);
--
-- CTL and ATL are cumulative — each day is computed from the previous day's
-- value — so a session added for a past date fixes that date and leaves every
-- day after it still computed as though the training never happened. Upload a
-- fitfile for three weeks ago and readiness stays wrong for three weeks.
--
-- The gap only shows on BACKDATED uploads. A session logged for today has no
-- following days to correct, which is why this has gone unnoticed: the normal
-- case is already right.
--
-- Now: a session dated today or later recomputes that day alone, exactly as
-- before. A session dated in the past recomputes from its date through to
-- today, in order.
--
-- COST. A backdated upload does one recompute per day between then and now.
-- Filling in three weeks is 21 calls; a bulk import of fifty files spanning
-- months is genuinely slow. That is the right trade — a slow correct import
-- beats a fast import that silently leaves months of readiness wrong, and
-- bulk imports are rare and deliberate.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_recompute_readiness_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ath uuid := COALESCE(NEW.athlete_id, OLD.athlete_id);
  sdate date := COALESCE(NEW.session_date, OLD.session_date);
BEGIN
  IF sdate < CURRENT_DATE THEN
    -- Backdated: everything downstream of it is now wrong too.
    PERFORM public.recompute_readiness_range(ath, sdate, CURRENT_DATE);
  ELSE
    PERFORM public.recompute_readiness(ath, sdate);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM public.recompute_session_zones(NEW.id);
  END IF;
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- Confirm the trigger still points at this function:
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.sessions'::regclass AND NOT tgisinternal;
--
-- Then upload a fitfile for a past date and check that the days AFTER it
-- moved, not just the day itself:
-- SELECT load_date, ctl, atl, readiness_score
--   FROM public.athlete_load_daily
--  WHERE athlete_id = '<athlete>' AND load_date >= '<the backdated date>'
--  ORDER BY load_date LIMIT 30;
