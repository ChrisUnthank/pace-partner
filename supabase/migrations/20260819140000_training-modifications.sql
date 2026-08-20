-- ============================================================================
-- WHAT "TRAINED AROUND IT" ACTUALLY MEANT.
--
-- training_impact records that something changed. It does not record what,
-- and the what is the part worth having six months later: "reduced volume for
-- a fortnight" and "kept the mileage but cut all the speed work" are different
-- training histories and they explain different things about whatever
-- followed. Reading back a season, "modified" on its own says almost nothing.
--
-- AN ARRAY, NOT A SECOND ENUM
--
-- These combine in practice. A coach cutting volume usually also drops the
-- session intensity; someone off the track is often in the pool as well.
-- Forcing a single choice would throw away half of what happened, and a
-- child table for what is always a short fixed list would be three joins to
-- render one line of text.
--
-- The CHECK uses <@ so the array is constrained to known values while still
-- allowing any combination of them, including none.
-- ============================================================================

ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS training_modifications text[] NOT NULL DEFAULT '{}'::text[];

DO $$ BEGIN
  ALTER TABLE public.injuries
    ADD CONSTRAINT injuries_training_modifications_check
      CHECK (training_modifications <@ ARRAY[
        'reduced_volume','reduced_intensity','shorter_sessions','easy_only',
        'no_speed_work','no_hills','extra_rest_days','cross_training',
        'pool_running','gym_only','surface_changed','no_racing'
      ]::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.injuries.training_modifications IS
  'The specific adjustments made while this was going on. Empty is meaningful — it says nothing specific was recorded, not that nothing changed.';


-- ---------------------------------------------------------------------------
-- Finding what was live on a given date.
--
-- The calendar overlay asks "which records covered this day" for a month at a
-- time, which is an onset <= day AND (resolved IS NULL OR resolved >= day)
-- range test per athlete. This index is what stops that being a full scan of
-- the athlete's entire health history on every calendar render.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS injuries_athlete_dates_idx
  ON public.injuries (athlete_id, onset_date, resolved_date)
  WHERE archived = false;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='injuries'
--    AND column_name='training_modifications';
-- Expect: ARRAY, default '{}'::text[].
--
-- A rejection is the constraint working:
--   UPDATE public.injuries SET training_modifications = ARRAY['nonsense'] WHERE false;
