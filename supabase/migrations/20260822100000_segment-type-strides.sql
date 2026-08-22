-- ============================================================================
-- "strides" IS A SEGMENT TYPE NOW, AND THE CHECK CONSTRAINT DID NOT KNOW.
--
-- My bug, from the strides classification work.
--
-- raw_session_points.segment_type was created with
--
--     CHECK (segment_type IN ('warmup','work','recovery','cooldown'))
--
-- and the strides fix added "strides" to ParsedLap.kind. Points take their
-- segment_type straight from the lap kind via findLapKindForPoint, so the
-- moment a session containing a strides set is recomputed, every point in
-- that set violates the constraint and the whole rebuild fails.
--
-- It only fires on sessions that actually have strides — which is precisely
-- the multi-file race sessions the classification fixes were written for, so
-- the first thing anyone would try to recompute is the first thing to break.
--
-- I should have caught this when adding "strides" to the lap kind: widening a
-- TypeScript union does nothing about a database constraint holding the same
-- vocabulary, and this codebase already had two copies of that list.
--
--
-- WHY WIDEN RATHER THAN MAP STRIDES ONTO "work"
--
-- Strides are not the workout. On a race day the difference decides what the
-- race analysis page reads: it filters to segment_type = 'work', and folding
-- strides into that is what made a 10km race analyse as 93 minutes of "work"
-- spanning three files. Keeping them distinct is the point of having
-- classified them at all.
--
-- Every existing reader filters for 'work' explicitly rather than excluding
-- the other values, so nothing starts silently counting strides as something
-- else.
-- ============================================================================

ALTER TABLE public.raw_session_points
  DROP CONSTRAINT IF EXISTS raw_session_points_segment_type_check;

ALTER TABLE public.raw_session_points
  ADD CONSTRAINT raw_session_points_segment_type_check
    CHECK (segment_type IS NULL OR segment_type = ANY (ARRAY[
      'warmup','work','recovery','cooldown','strides'
    ]::text[]));

COMMENT ON COLUMN public.raw_session_points.segment_type IS
  'Which part of the session this point belongs to. Mirrors ParsedLap.kind in session-files.functions.ts — the two lists must be changed together.';

-- ---------------------------------------------------------------------------
-- The same list, a third time.
--
-- get_athlete_biomechanics_trend validates its _segment_type argument against
-- a hand-written copy of the vocabulary and raises on anything else. It would
-- reject 'strides' outright, so once strides points exist, asking for them
-- would error rather than return nothing.
--
-- Found by grepping for the list rather than by hitting it. There were four
-- copies in all: ParsedLap.kind in TypeScript, the step_kind enum (which
-- already gained 'strides' back in June), the CHECK above, and this.
--
-- Rewrites the LIVE definition via pg_get_functiondef rather than restating
-- the function body from a migration file — the body has been replaced five
-- times across five migrations, and copying the wrong one would quietly
-- revert whichever changes came after it.
-- ---------------------------------------------------------------------------
DO $rewrite$
DECLARE
  body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_athlete_biomechanics_trend'
   LIMIT 1;

  IF body IS NULL THEN
    RAISE NOTICE 'get_athlete_biomechanics_trend not found - nothing to widen.';
    RETURN;
  END IF;

  IF position('''warmup'', ''work'', ''recovery'', ''cooldown''' in body) = 0 THEN
    RAISE NOTICE 'Guard not in the expected form - left alone, check it by hand.';
    RETURN;
  END IF;

  body := replace(
    body,
    '''warmup'', ''work'', ''recovery'', ''cooldown''',
    '''warmup'', ''work'', ''recovery'', ''cooldown'', ''strides'''
  );
  EXECUTE body;
  RAISE NOTICE 'Widened get_athlete_biomechanics_trend to accept strides.';
END
$rewrite$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- The constraint should now name five values:
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'public.raw_session_points'::regclass
--    AND conname = 'raw_session_points_segment_type_check';
--
-- After recomputing a session with a strides set, they should appear:
-- SELECT segment_type, COUNT(*) FROM public.raw_session_points
--  WHERE session_id = '<session>' GROUP BY segment_type;
