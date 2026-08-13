-- ============================================================================
-- steps.terrain_source — was this surface set by a human, or guessed?
--
-- WHY THIS COLUMN HAS TO EXIST BEFORE ANY "LEARNING" CAN WORK
--
-- The obvious way to learn a pattern is: look at past sessions at this
-- location, see what the warm-up steps were set to, and reuse it. That
-- doesn't work without knowing WHO set them, because the importer has been
-- setting step terrain automatically all along. Learning from those values
-- means reading back the app's own guesses and treating them as evidence —
-- a feedback loop, not learning. One wrong auto-assignment would harden into
-- a permanent "pattern" that looks increasingly confirmed the more sessions
-- it silently applied to.
--
-- So: every automatic assignment is marked 'auto', every human change is
-- marked 'manual', and the pattern matching below only ever counts 'manual'
-- rows. A coach correcting the same thing twice teaches it something; the
-- app agreeing with itself a hundred times teaches it nothing.
--
-- NULL is left as "unknown" rather than backfilled to 'auto'. Existing rows
-- are a mix — mostly importer-set, but some set by hand through the step
-- dropdown in the last few days — and there's no way to tell them apart
-- retrospectively. Treating unknown as not-evidence is the conservative
-- reading: learning simply starts from the next manual change onward, which
-- is also the behaviour that was asked for.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS terrain_source text;

COMMENT ON COLUMN public.steps.terrain_source IS
  '''manual'' = a person chose this surface; ''auto'' = the importer derived it; NULL = unknown (pre-dates this column). Only ''manual'' rows are used to learn per-location patterns, so the app never treats its own guesses as evidence.';

-- Partial index: pattern lookups only ever ask for manual rows with a value,
-- so there's no reason to index the far larger auto/null population.
CREATE INDEX IF NOT EXISTS steps_terrain_manual_idx
  ON public.steps (session_id, kind, terrain)
  WHERE terrain_source = 'manual' AND terrain IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT COALESCE(terrain_source, '(unknown)') AS source, COUNT(*)
-- FROM public.steps
-- GROUP BY 1 ORDER BY 2 DESC;

-- What has been taught so far, per location and step kind. Two or more
-- distinct sessions agreeing is what the importer acts on:
-- SELECT tl.name AS location, st.kind, st.terrain,
--        COUNT(DISTINCT s.id) AS sessions_agreeing
-- FROM public.steps st
-- JOIN public.sessions s ON s.id = st.session_id
-- JOIN public.training_locations tl ON tl.id = s.location_id
-- WHERE st.terrain_source = 'manual' AND st.terrain IS NOT NULL
-- GROUP BY tl.name, st.kind, st.terrain
-- ORDER BY tl.name, st.kind, sessions_agreeing DESC;
