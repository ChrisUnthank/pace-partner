-- ============================================================================
-- Shoe size.
--
-- Three columns rather than one free-text field, because "10.5" on its own
-- is ambiguous — UK 10.5, US 10.5 and EU 10.5 are three different shoes, and
-- brands genuinely disagree (a US 11 Nike is not a US 11 Hoka). Storing the
-- system alongside the number keeps it unambiguous later, when the athlete
-- is comparing an old pair against a new one and can't remember which scale
-- the number was in.
--
--   shoe_size         text     — the number itself. TEXT, not numeric, so
--                                "10.5", "10 1/2", "42 2/3" and "M9/W10.5"
--                                all round-trip intact. Half sizes and
--                                third sizes (EU) are common and a numeric
--                                column would either reject or silently
--                                mangle them.
--   shoe_size_system  text     — uk / us / eu / cm / au / jp
--   shoe_fit_notes    text     — "half size up", "narrow in the midfoot",
--                                the thing you actually want to remember
--                                when buying the next pair.
--
-- Vocabulary stays in app.gear.tsx rather than a CHECK constraint or enum,
-- consistent with shoe_type / shoe_surface / used_for — adding a sizing
-- system later should be a front-end change, not a migration.
-- ============================================================================

ALTER TABLE public.gear_items
  ADD COLUMN IF NOT EXISTS shoe_size        text,
  ADD COLUMN IF NOT EXISTS shoe_size_system text,
  ADD COLUMN IF NOT EXISTS shoe_fit_notes   text;

COMMENT ON COLUMN public.gear_items.shoe_size IS
  'Size as written on the shoe. Text rather than numeric so half and third sizes ("10.5", "42 2/3") survive intact.';
COMMENT ON COLUMN public.gear_items.shoe_size_system IS
  'Which scale shoe_size is in: uk, us, eu, cm, au, jp. Vocabulary in app.gear.tsx.';
COMMENT ON COLUMN public.gear_items.shoe_fit_notes IS
  'How this pair actually fits — "half size up", "narrow midfoot". Distinct from the general notes field.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'gear_items'
--   AND column_name LIKE 'shoe_size%' OR column_name = 'shoe_fit_notes';
