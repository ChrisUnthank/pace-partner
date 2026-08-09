-- ============================================================================
-- Migration tracking catch-up — Batch 1: Athlete DNA / Physio / Strengths
-- ============================================================================
--
-- PURE CAPTURE. Every statement below reproduces exactly what's already
-- live, verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef, so the constraint definitions are copied verbatim
-- from Postgres itself, not hand-reconstructed), and pg_policies on 9 Aug
-- 2026. Zero behavioural change — this closes a source-control gap, it
-- doesn't fix anything.
--
-- Five of these six tables had NO CREATE TABLE anywhere in GitHub history
-- at all. The sixth, athlete_physio_profile, IS tracked (see migration
-- 20260621013310) but two columns were added to it live at some point with
-- no matching migration — caught and closed here too.
--
-- WORTH KNOWING: this pull confirms, precisely, something flagged earlier
-- today — athlete_dna_ratings.mechanical_efficiency_status,
-- running_economy_status, durability_status, race_intelligence_status, and
-- tactical_awareness_status all default to 'insufficient_data' and are
-- never written by recompute_athlete_dna. Every athlete's DNA rating shows
-- these five as literally, permanently 'insufficient_data' — not a runtime
-- bug, just dead schema nobody's finished wiring up.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. athlete_physio_profile: catch-up columns only (base table already tracked) ──
ALTER TABLE public.athlete_physio_profile
  ADD COLUMN IF NOT EXISTS archetype_override text,
  ADD COLUMN IF NOT EXISTS archetype_override_note text;

COMMENT ON COLUMN public.athlete_physio_profile.archetype_override IS
  'Coach-set label that replaces the auto-computed archetype in the UI when present. Added live with no original migration — captured here.';


-- ── 2. athlete_dna_ratings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_dna_ratings (
  athlete_id                     uuid PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  endurance_score                numeric,
  endurance_bucket               text,
  speed_score                    numeric,
  speed_bucket                   text,
  aerobic_capacity_score         numeric,
  aerobic_capacity_bucket        text,
  anaerobic_capacity_score       numeric,
  anaerobic_capacity_bucket      text,
  consistency_score              numeric,
  consistency_bucket             text,
  consistency_sessions_completed integer,
  consistency_sessions_planned   integer,
  -- The five dead columns — see header note. Reproduced exactly as live,
  -- including the default, not "fixed" here (that's a product decision on
  -- whether to finish building these out or drop them, not this file's job).
  running_economy_status         text NOT NULL DEFAULT 'insufficient_data',
  durability_status              text NOT NULL DEFAULT 'insufficient_data',
  race_intelligence_status       text NOT NULL DEFAULT 'insufficient_data',
  tactical_awareness_status      text NOT NULL DEFAULT 'insufficient_data',
  mechanical_efficiency_status   text NOT NULL DEFAULT 'insufficient_data',
  status                         text NOT NULL DEFAULT 'ok',
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.athlete_dna_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dna_ratings_access" ON public.athlete_dna_ratings;
CREATE POLICY "dna_ratings_access" ON public.athlete_dna_ratings
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 3. athlete_physiological_tests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_physiological_tests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  metric              text NOT NULL,
  value               numeric NOT NULL,
  unit                text,
  test_date           date NOT NULL DEFAULT CURRENT_DATE,
  source              text NOT NULL,
  measurement_type    text NOT NULL,
  method              text,
  confidence          text NOT NULL DEFAULT 'moderate',
  notes               text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  previous_value      numeric,
  previous_test_date  date
);

DO $$ BEGIN
  ALTER TABLE public.athlete_physiological_tests
    ADD CONSTRAINT physio_tests_metric_check
      CHECK (metric = ANY (ARRAY[
        'resting_hr','max_hr','threshold_hr','threshold_pace','threshold_power',
        'vo2max','critical_speed','critical_power','lactate_threshold',
        'running_economy','anaerobic_speed_reserve','hr_recovery','hrv'
      ]::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_physiological_tests
    ADD CONSTRAINT physio_tests_source_check
      CHECK (source = ANY (ARRAY[
        'laboratory','coach_entered','athlete_entered','garmin','coros','polar',
        'apple_health','other_device','platform_calculated','platform_estimated'
      ]::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_physiological_tests
    ADD CONSTRAINT physio_tests_type_check
      CHECK (measurement_type = ANY (ARRAY['measured','device_derived','estimated','coach_entered']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_physiological_tests
    ADD CONSTRAINT physio_tests_confidence_check
      CHECK (confidence = ANY (ARRAY['high','moderate','low']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_physiological_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "physio_tests_read" ON public.athlete_physiological_tests;
CREATE POLICY "physio_tests_read" ON public.athlete_physiological_tests
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "physio_tests_write_coach" ON public.athlete_physiological_tests;
CREATE POLICY "physio_tests_write_coach" ON public.athlete_physiological_tests
  FOR INSERT WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "physio_tests_update_coach" ON public.athlete_physiological_tests;
CREATE POLICY "physio_tests_update_coach" ON public.athlete_physiological_tests
  FOR UPDATE USING (public.is_coach_of(auth.uid(), athlete_id))
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "physio_tests_delete_coach" ON public.athlete_physiological_tests;
CREATE POLICY "physio_tests_delete_coach" ON public.athlete_physiological_tests
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id));


-- ── 4. athlete_strengths_ratings ────────────────────────────────────────────
-- The "4 auto-suggested, 6 coach-set-only" system referenced in
-- strengths-development-card.tsx — see that file's own comment for why only
-- some categories get an algorithmic suggestion.
CREATE TABLE IF NOT EXISTS public.athlete_strengths_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id  uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  category    text NOT NULL,
  rating      text NOT NULL DEFAULT 'not_assessed',
  source      text NOT NULL DEFAULT 'coach_set',
  note        text,
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athlete_strengths_ratings_athlete_id_category_key UNIQUE (athlete_id, category)
);

DO $$ BEGIN
  ALTER TABLE public.athlete_strengths_ratings
    ADD CONSTRAINT strengths_category_check
      CHECK (category = ANY (ARRAY[
        'speed','speed_endurance','aerobic_capacity','aerobic_endurance','threshold',
        'finishing_ability','recovery','race_execution','race_positioning','pacing_consistency'
      ]::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_strengths_ratings
    ADD CONSTRAINT strengths_rating_check
      CHECK (rating = ANY (ARRAY['relative_strength','developing','development_opportunity','not_assessed']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_strengths_ratings
    ADD CONSTRAINT strengths_source_check
      CHECK (source = ANY (ARRAY['auto_suggested','coach_set']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_strengths_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strengths_read" ON public.athlete_strengths_ratings;
CREATE POLICY "strengths_read" ON public.athlete_strengths_ratings
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "strengths_write_coach" ON public.athlete_strengths_ratings;
CREATE POLICY "strengths_write_coach" ON public.athlete_strengths_ratings
  FOR INSERT WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "strengths_update_coach" ON public.athlete_strengths_ratings;
CREATE POLICY "strengths_update_coach" ON public.athlete_strengths_ratings
  FOR UPDATE USING (public.is_coach_of(auth.uid(), athlete_id))
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "strengths_delete_coach" ON public.athlete_strengths_ratings;
CREATE POLICY "strengths_delete_coach" ON public.athlete_strengths_ratings
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id));


-- ── 5. athlete_training_response_notes ──────────────────────────────────────
-- Free-text coach notes. No UPDATE policy exists live — reproduced exactly
-- as found, not added: notes are write-once/delete, not editable in place.
CREATE TABLE IF NOT EXISTS public.athlete_training_response_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id  uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  note        text NOT NULL,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.athlete_training_response_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_response_notes_read" ON public.athlete_training_response_notes;
CREATE POLICY "training_response_notes_read" ON public.athlete_training_response_notes
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "training_response_notes_write_coach" ON public.athlete_training_response_notes;
CREATE POLICY "training_response_notes_write_coach" ON public.athlete_training_response_notes
  FOR INSERT WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "training_response_notes_delete_coach" ON public.athlete_training_response_notes;
CREATE POLICY "training_response_notes_delete_coach" ON public.athlete_training_response_notes
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id));


-- ── 6. athlete_training_response_overrides ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_training_response_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  observation_key   text NOT NULL,
  dismissed         boolean NOT NULL DEFAULT false,
  coach_note        text,
  updated_by        uuid REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athlete_training_response_overri_athlete_id_observation_key_key UNIQUE (athlete_id, observation_key)
);

ALTER TABLE public.athlete_training_response_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_response_overrides_read" ON public.athlete_training_response_overrides;
CREATE POLICY "training_response_overrides_read" ON public.athlete_training_response_overrides
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "training_response_overrides_write_coach" ON public.athlete_training_response_overrides;
CREATE POLICY "training_response_overrides_write_coach" ON public.athlete_training_response_overrides
  FOR INSERT WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "training_response_overrides_update_coach" ON public.athlete_training_response_overrides;
CREATE POLICY "training_response_overrides_update_coach" ON public.athlete_training_response_overrides
  FOR UPDATE USING (public.is_coach_of(auth.uid(), athlete_id))
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "training_response_overrides_delete_coach" ON public.athlete_training_response_overrides;
CREATE POLICY "training_response_overrides_delete_coach" ON public.athlete_training_response_overrides
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id));


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- FUNCTIONS in this same feature area were already captured earlier today —
-- no new migration needed for them:
--   dna_bucket_from_score, recompute_athlete_dna, trg_recompute_dna_from_physio,
--   trg_recompute_dna_from_session (see 20260809020000_physio-profile-triggers.sql)
--   recompute_physio_profile (already tracked, live body pulled and verified
--   today, see conversation history — was already correct, just needed the
--   new trigger, not a redefinition)
-- ============================================================================
