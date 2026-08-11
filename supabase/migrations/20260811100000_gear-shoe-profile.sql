-- ============================================================================
-- Shoe profile — separating three questions that were previously tangled.
--
-- BEFORE:
--   shoe_category  track / road / everyday / off_road
--                  ...three of those are SURFACES, "everyday" is a usage
--                  level. The field couldn't answer either question cleanly.
--   is_spike       a boolean carrying one value of what is really a
--                  multi-value axis — race flat, tempo trainer and daily
--                  trainer all collapsed to `false`.
--
-- AFTER, three independent axes:
--   shoe_type      what the shoe IS          (spike / racing_flat / ...)
--   shoe_surface   where it's FOR            (track / road / trail / ...)
--   shoe_traits    what it's BUILT WITH      (carbon_plate, superfoam, ...)
--   used_for       what YOU use it for       (already added, unchanged)
--
-- Note what is deliberately NOT here: an is_super_shoe column. Supershoe
-- status is derived in the app from shoe_type plus traits, so it can never
-- contradict the fields it's supposed to summarise. A manual boolean would
-- eventually disagree with a shoe ticked as carbon-plated + superfoam, and
-- then neither value could be trusted.
--
-- shoe_category and is_spike are KEPT, not dropped: the session detail page
-- (GearPanel in app.sessions.$sessionId.index.tsx) still reads them. The app
-- now writes them derived from the new fields on every save, so they stay
-- correct without that page needing to change. They can be dropped later
-- once nothing reads them.
--
-- Vocabulary lives in app.gear.tsx rather than in CHECK constraints or
-- enums, same reasoning as used_for: adding a shoe type later should be a
-- front-end change, not a migration.
-- ============================================================================

ALTER TABLE public.gear_items
  ADD COLUMN IF NOT EXISTS shoe_type       text,
  ADD COLUMN IF NOT EXISTS shoe_surface    text,
  ADD COLUMN IF NOT EXISTS shoe_traits     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stack_height_mm numeric,
  ADD COLUMN IF NOT EXISTS drop_mm         numeric,
  ADD COLUMN IF NOT EXISTS weight_g        numeric,
  ADD COLUMN IF NOT EXISTS description     text;

COMMENT ON COLUMN public.gear_items.shoe_type IS
  'What the shoe is: spike, racing_flat, super_racer, super_trainer, tempo_trainer, daily_trainer, max_cushion, trail, gym. Vocabulary in app.gear.tsx.';
COMMENT ON COLUMN public.gear_items.shoe_surface IS
  'Surface the shoe is intended for: track, road, trail, treadmill, gym, mixed.';
COMMENT ON COLUMN public.gear_items.shoe_traits IS
  'Construction features (carbon_plate, superfoam_peba, max_cushion, wide_fit, ...). Multi-select.';
COMMENT ON COLUMN public.gear_items.description IS
  'What the shoe is designed for, in plain words. Distinct from notes, which is the athlete''s own commentary.';

CREATE INDEX IF NOT EXISTS gear_items_shoe_type_idx ON public.gear_items (shoe_type);
CREATE INDEX IF NOT EXISTS gear_items_shoe_traits_idx ON public.gear_items USING GIN (shoe_traits);

-- ============================================================================
-- BACKFILL — one-time, written as a DO block rather than a stored function
-- because it should run once and never be callable again.
--
-- Only fills rows where the new fields are still null, so re-running it is
-- safe and it will never overwrite something set by hand afterwards.
-- ============================================================================
DO $$
BEGIN
  -- Spikes are unambiguous: type AND surface both follow from the flag.
  UPDATE public.gear_items
     SET shoe_type    = COALESCE(shoe_type, 'spike'),
         shoe_surface = COALESCE(shoe_surface, 'track')
   WHERE gear_type = 'shoe' AND is_spike IS TRUE;

  -- "everyday" was the usage-level value hiding among the surfaces — it maps
  -- to a daily trainer on the road, which is what it always meant.
  UPDATE public.gear_items
     SET shoe_type    = COALESCE(shoe_type, 'daily_trainer'),
         shoe_surface = COALESCE(shoe_surface, 'road')
   WHERE gear_type = 'shoe' AND shoe_category = 'everyday';

  -- off_road implies a trail shoe; the surface name changes to match the new
  -- vocabulary.
  UPDATE public.gear_items
     SET shoe_type    = COALESCE(shoe_type, 'trail'),
         shoe_surface = COALESCE(shoe_surface, 'trail')
   WHERE gear_type = 'shoe' AND shoe_category = 'off_road';

  -- track / road were genuine surfaces already. Type is left NULL on
  -- purpose: a road shoe could be any of five types and guessing would put
  -- unverified data in front of the athlete as though it were known.
  UPDATE public.gear_items
     SET shoe_surface = COALESCE(shoe_surface, shoe_category)
   WHERE gear_type = 'shoe' AND shoe_category IN ('track', 'road');
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — expect every shoe to have a surface, and every previously-spiked
-- or previously-"everyday" shoe to have a type. Shoes that were plain
-- track/road will show type = null until someone sets one, which is correct.
-- ============================================================================
-- SELECT brand, model, shoe_category, is_spike, shoe_type, shoe_surface, shoe_traits
-- FROM public.gear_items
-- WHERE gear_type = 'shoe'
-- ORDER BY shoe_type NULLS LAST, brand;
