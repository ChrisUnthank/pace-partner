-- ============================================================================
-- equivalent_days_off COUNTED ORDINARY REST DAYS AS ABSENCE.
--
-- My error, and the reason Josh has 43 red days after the backfill when his
-- recent days all read a correct green 100.
--
-- The function compared each SINGLE DAY's combined_load against CTL — but CTL
-- is a 42-day exponential average of daily load, so a day of rest scores
--
--     1 - 0/CTL = 1.00 full day off
--
-- while a normal session scores 0. An athlete taking two rest days a week
-- therefore accrued about 51 equivalent days off per 180-day window and lost
-- roughly 43% of their fitness credit for training completely normally. Even
-- an easy day counted as a quarter of a day off.
--
-- Rest days are TRAINING. A rest WEEK is absence. The measurement has to be
-- at the granularity where that distinction lives, and a single day is below
-- it.
--
--
-- THE FIX
--
-- Each day is scored on the trailing SEVEN days of load against what seven
-- normal days would be (CTL x 7):
--
--     deficit = 1 - (sum of last 7 days' load) / (baseline CTL x 7)
--
--   normal week, 2 rest days   weekly load ~= CTL x 7   ->  0.00 days off
--   week at 30% volume                                  ->  0.70 per day
--   complete rest week                                  ->  1.00 per day
--
-- So a fortnight off still reads as ~14 equivalent days, which is what the
-- detraining curve was calibrated against — the curve is unchanged and stays
-- correct. Only the input to it was wrong.
--
-- The seven-day window also smooths a hard-easy pattern that happens to be
-- misaligned with the calendar, which the daily version punished at random.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.equivalent_days_off(_athlete_id uuid, _date date, _window_days int DEFAULT 180)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  baseline numeric;
  total numeric;
BEGIN
  SELECT ctl INTO baseline
    FROM public.athlete_load_daily
   WHERE athlete_id = _athlete_id AND load_date <= _date - _window_days
   ORDER BY load_date DESC LIMIT 1;

  IF baseline IS NULL THEN
    SELECT MAX(ctl) INTO baseline
      FROM public.athlete_load_daily
     WHERE athlete_id = _athlete_id AND load_date <= _date;
  END IF;

  -- No history, or an athlete who has never trained: nothing to detrain from.
  IF baseline IS NULL OR baseline <= 0 THEN RETURN 0; END IF;

  -- Trailing 7-day load per day, against seven normal days. The window frame
  -- does the smoothing that the old per-day comparison lacked.
  WITH per_day AS (
    SELECT
      l.load_date,
      SUM(COALESCE(l.combined_load, 0)) OVER (
        ORDER BY l.load_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
      ) AS trailing7
    FROM public.athlete_load_daily l
    WHERE l.athlete_id = _athlete_id
      AND l.load_date > _date - _window_days - 7   -- 7 extra so the earliest
      AND l.load_date <= _date                     -- day in range has a full
  )                                                -- window behind it
  SELECT COALESCE(SUM(GREATEST(0, LEAST(1, 1 - trailing7 / (baseline * 7)))), 0)
    INTO total
    FROM per_day
   WHERE load_date > _date - _window_days;

  RETURN ROUND(total, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.equivalent_days_off(uuid, date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equivalent_days_off(uuid, date, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately, BEFORE re-running the backfill.
--
-- An athlete training normally should now read close to zero equivalent days
-- off. Poppy, who genuinely has not run since 6 August, should still read
-- around a fortnight — the function must stop counting rest days without
-- also stopping counting real absence.
--
--   SELECT a.name,
--          ROUND(public.equivalent_days_off(a.id, CURRENT_DATE, 180), 1) AS eq_days,
--          ROUND(public.detraining_retention(a.id,
--                public.equivalent_days_off(a.id, CURRENT_DATE, 180)), 1) AS retained
--     FROM public.athletes a
--    WHERE a.name IN ('Josh Unthank','Jackson Unthank','Poppy Nivarovich','Chris Unthank')
--    ORDER BY a.name;
--
-- Then re-run BACKFILL_READINESS.sql — the stored scores still hold the
-- figures produced by the broken version.
-- ============================================================================
