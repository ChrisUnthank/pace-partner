-- ============================================================================
-- Per-step terrain.
--
-- A session is often one continuous run across more than one surface:
--
--   * 31 Jul: 7.00 km outdoors (sub_sport = generic) straight into 7.77 km on
--     a treadmill (sub_sport = treadmill), auto-merged into one session — as
--     it should be, since it was one run.
--   * A track session whose warm up and cool down are on road or grass and
--     whose reps are on the track.
--
-- sessions.terrain is a single value for the whole session, so either case
-- forces a wrong answer: call the whole thing "track" and the warm up is
-- misfiled; call it "mixed" and nothing downstream can use it.
--
-- This adds terrain to the STEP, which is the level the surface actually
-- changes at. sessions.terrain stays as the session-level summary — the
-- Compare page's surface filter and the mechanics work both read it, so it
-- keeps working untouched.
--
-- NULL means "inherit the session's terrain", which is the correct reading
-- for every existing row and for any session genuinely run on one surface.
-- Vocabulary matches TERRAIN_VALUES in src/lib/session-categories.ts
-- (track/road/trail/path/grass/treadmill/mixed) and is deliberately not
-- constrained here, so adding a surface later is a front-end change.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS terrain text;

COMMENT ON COLUMN public.steps.terrain IS
  'Surface for this step specifically (track/road/trail/path/grass/treadmill/mixed). NULL = inherit sessions.terrain. Lets one continuous run span surfaces — e.g. road warm up into track reps, or outdoor into treadmill.';

CREATE INDEX IF NOT EXISTS steps_terrain_idx ON public.steps (terrain) WHERE terrain IS NOT NULL;


-- ============================================================================
-- Effective terrain for a step — the value to actually use anywhere.
--
-- Kept as a function rather than repeated COALESCEs so the fallback rule
-- lives in one place.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.step_effective_terrain(_step_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(st.terrain, s.terrain)
  FROM public.steps st
  JOIN public.sessions s ON s.id = st.session_id
  WHERE st.id = _step_id;
$function$;

REVOKE ALL ON FUNCTION public.step_effective_terrain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.step_effective_terrain(uuid) TO authenticated;


-- ============================================================================
-- BACKFILL — set step terrain from the FIT file each step came from, where
-- that can be established.
--
-- session_files.parse_summary carries the FIT sub_sport. `treadmill` is the
-- one that matters here: it's unambiguous, and it's exactly the case that
-- prompted this. Everything else is left NULL to inherit the session, rather
-- than guessing a surface from a generic run.
--
-- Only runs where a step can be tied to a file. Sessions built by hand are
-- untouched.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'steps' AND column_name = 'source_file_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.steps st
         SET terrain = 'treadmill'
        FROM public.session_files sf
       WHERE sf.id = st.source_file_id
         AND st.terrain IS NULL
         AND lower(COALESCE(sf.parse_summary::jsonb ->> 'sub_sport', '')) = 'treadmill'
    $sql$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT s.session_date, s.title, s.terrain AS session_terrain,
--        st.kind, st.step_order, st.terrain AS step_terrain,
--        COALESCE(st.terrain, s.terrain) AS effective_terrain
-- FROM public.steps st
-- JOIN public.sessions s ON s.id = st.session_id
-- WHERE s.athlete_id = '01163ee4-ede0-4a90-bff3-31c6a48df77c'
--   AND s.session_date >= CURRENT_DATE - INTERVAL '30 days'
-- ORDER BY s.session_date DESC, st.step_order;
