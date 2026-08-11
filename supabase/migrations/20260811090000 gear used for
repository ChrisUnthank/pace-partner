-- ============================================================================
-- gear_items.used_for — what each piece of gear is actually FOR.
--
-- A shoe is rarely single-purpose: a pair of road threshold shoes might
-- also cover tempo runs and long-run pickups, and everyday trainers cover
-- easy runs, warmups and cooldowns. So this is an ARRAY, not a single
-- category — `shoe_category` (track/road/everyday/off_road) stays as the
-- broad "what kind of shoe is it", and used_for answers the separate
-- question "which sessions does it come out for".
--
-- Deliberately NOT constrained to a fixed enum or CHECK list: the
-- vocabulary lives in the app (PURPOSE_GROUPS in app.gear.tsx) so adding a
-- new purpose later is a front-end change, not a migration plus a data
-- backfill. The cost is that a typo'd value would be accepted, but nothing
-- writes to this column except the picker, so there's no free-text path in.
--
-- NOT NULL DEFAULT '{}' means every existing row becomes an empty array
-- rather than null — no null-handling needed anywhere in the UI.
-- ============================================================================

ALTER TABLE public.gear_items
  ADD COLUMN IF NOT EXISTS used_for text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.gear_items.used_for IS
  'Session purposes this gear is used for (e.g. easy_runs, threshold_session_track). Multi-select; vocabulary defined in app.gear.tsx.';

-- Lets "which shoes do I use for VO2 sessions" stay fast as the locker
-- grows. GIN is the right index type for array containment (@>, &&).
CREATE INDEX IF NOT EXISTS gear_items_used_for_idx
  ON public.gear_items USING GIN (used_for);

-- PostgREST caches the schema — without this the new column is invisible to
-- the client until the next restart, which reads as "column does not exist"
-- errors in the app even though the ALTER succeeded.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run after the above, should return one row showing the column
-- exists with an array type and a '{}' default.
-- ============================================================================
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'gear_items' AND column_name = 'used_for';
