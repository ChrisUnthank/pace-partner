-- ============================================================================
-- Default location on a gear item.
--
-- Treadmill sessions have no GPS, so the importer's location matching — which
-- works by finding the nearest training_location to the session's first
-- recorded point — can never fire for them. The result is that indoor
-- sessions arrive with no location at all, and no amount of improving the
-- matching helps, because there's nothing to match against.
--
-- A treadmill, though, doesn't move. Its location is a property of the
-- machine, not of the session. So it's recorded once on the gear item and
-- applied whenever that item is auto-linked to a session.
--
-- Deliberately on gear_items generally rather than treadmills specifically:
-- the same reasoning covers a home gym or a stationary bike on a turbo. It's
-- simply meaningless for shoes, which is why nothing populates it for them.
--
-- ON DELETE SET NULL: deleting a training location shouldn't cascade into
-- deleting a treadmill. Losing the association is the correct outcome.
-- ============================================================================

ALTER TABLE public.gear_items
  ADD COLUMN IF NOT EXISTS default_location_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gear_items_default_location_id_fkey'
  ) THEN
    ALTER TABLE public.gear_items
      ADD CONSTRAINT gear_items_default_location_id_fkey
      FOREIGN KEY (default_location_id)
      REFERENCES public.training_locations (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.gear_items.default_location_id IS
  'Where this item lives — used to give GPS-less sessions (treadmill, indoor trainer, gym) a location, since the importer cannot infer one without a start point. Meaningless for shoes.';

CREATE INDEX IF NOT EXISTS gear_items_default_location_idx
  ON public.gear_items (default_location_id) WHERE default_location_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT g.brand, g.model, g.gear_type, tl.name AS default_location
-- FROM public.gear_items g
-- LEFT JOIN public.training_locations tl ON tl.id = g.default_location_id
-- WHERE g.gear_type <> 'shoe'
-- ORDER BY g.gear_type, g.brand;
