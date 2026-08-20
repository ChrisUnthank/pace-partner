-- ============================================================================
-- DUPLICATE RACE RESULTS — cleanup only. No unique constraint.
--
-- WHY THE UNIQUE INDEX WAS DROPPED FROM THIS MIGRATION
--
-- The first draft added UNIQUE (athlete_id, performance_date, distance_m).
-- That would have been wrong, and the question that exposed it was simply
-- "what about double days at the same distance".
--
-- Middle-distance athletes race the same distance twice in one day as a
-- matter of routine — 1500m heats in the morning, final in the afternoon.
-- Under a unique constraint the final would have been REJECTED, at a
-- championship, with a hard database error and no way to record the result
-- that mattered most. Preventing a rare duplicate is not worth blocking an
-- ordinary race day.
--
-- The diagnostic settles it on real data: across the entire database there is
-- exactly ONE duplicate pair. A constraint carrying that failure mode to stop
-- one bad row is a poor trade, and the row in question is a symptom of a
-- cause now fixed elsewhere rather than of a missing constraint.
--
--
-- WHAT THAT ONE DUPLICATE ACTUALLY IS
--
--   Josh, 2026-05-10, 5000m:  881s  (14:41 — the real race)
--                             9066s (2:31:06 — 30:13/km)
--
-- The second is not a race result. It is the whole 20km Lakeside day, which
-- the upload matcher turned into a single session because a planned race is
-- source 'manual' and was never a match candidate, and which was then marked
-- as a race — so the day's entire elapsed time was recorded as a 5km
-- performance. Both rows are flagged as touching a PB.
--
-- The matching fix in session-files.functions.ts stops that happening again.
-- This migration removes the row it already produced.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Remove duplicates, keeping the FASTEST time per athlete/date/distance.
--
-- Safe for the case in hand — 14:41 against 2:31:06 is not a close call. It
-- is also the right rule generally: where two rows describe one race, the
-- slower is either a gun-vs-chip discrepancy or, as here, a whole session
-- mistaken for a result.
--
-- A DO block rather than a stored function: a one-time cleanup should not
-- outlive its own migration. It reports what it removed rather than working
-- silently, so the number can be checked against the diagnostic beforehand.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  removed integer;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY athlete_id, performance_date, distance_m
        ORDER BY time_seconds ASC, created_at ASC
      ) AS rn
    FROM public.performances
  )
  DELETE FROM public.performances p
  USING ranked r
  WHERE p.id = r.id AND r.rn > 1;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'Removed % duplicate performance row(s). Expected 1 based on the diagnostic.', removed;
END $$;


-- ---------------------------------------------------------------------------
-- A plain index, not a unique one.
--
-- Every duplicate check in the app looks up an athlete's results around a
-- date. This makes that cheap without forbidding a legitimate second race.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS performances_athlete_date_idx
  ON public.performances (athlete_id, performance_date);

COMMENT ON INDEX public.performances_athlete_date_idx IS
  'Lookup index for finding an athlete''s results near a date. Deliberately NOT unique: heats and a final at the same distance on the same day are a normal race day, and a unique constraint would reject the final.';

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- Should now return no rows:
-- SELECT athlete_id, performance_date, distance_m, COUNT(*)
--   FROM public.performances
--  GROUP BY athlete_id, performance_date, distance_m
-- HAVING COUNT(*) > 1;
--
-- Josh's 10 May 5000m should be the 881s row alone:
-- SELECT a.name, p.performance_date, p.distance_m, p.time_seconds, p.is_pb
--   FROM public.performances p JOIN public.athletes a ON a.id = p.athlete_id
--  WHERE p.performance_date = '2026-05-10' AND p.distance_m = 5000;
--
-- PB flags are recomputed by the existing triggers on any performances
-- change, so removing the 2:31:06 row re-evaluates that distance on its own.
-- Worth confirming the 14:41 is still flagged correctly afterwards.
