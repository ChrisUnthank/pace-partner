-- ============================================================================
-- WHAT SHOULD WE CALL YOU?
--
-- The Home page greeting takes the first word of profiles.full_name, which is
-- a guess dressed as a fact. It gets Michael when someone goes by Mike,
-- surnames-first for names that are written that way, and the wrong half of a
-- double-barrelled first name. Nobody could correct it, because full_name is
-- not editable anywhere in the app — it arrives from sign-up metadata and
-- stays.
--
-- NULL MEANS "DERIVE IT", NOT "NO NAME"
--
-- The column is nullable on purpose and is not backfilled. A stored value
-- means someone chose it; null means fall back to the first word of
-- full_name, which is what happens today and is right often enough.
--
-- Backfilling every row with the derived first name would erase that
-- distinction — every profile would then look as though its owner had
-- explicitly chosen a name, and a later improvement to the derivation could
-- never reach the people who never expressed a preference.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_name text;

COMMENT ON COLUMN public.profiles.preferred_name IS
  'What this person wants to be called in greetings. NULL means nobody has set one — derive from full_name instead. Deliberately not backfilled, so a stored value always means a deliberate choice.';

-- A name nobody can see is not a name. Blank strings are rejected rather than
-- silently treated as unset, so the app has one representation of "not set"
-- instead of two that behave differently.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_preferred_name_not_blank
      CHECK (preferred_name IS NULL OR length(btrim(preferred_name)) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, is_nullable FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='profiles' AND column_name='preferred_name';
-- Expect one row, nullable YES.
--
-- SELECT COUNT(*) FROM public.profiles WHERE preferred_name IS NOT NULL;
-- Expect 0 — nobody has set one yet.
