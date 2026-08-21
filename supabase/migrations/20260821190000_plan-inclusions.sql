-- ============================================================================
-- WHAT A COACHING PLAN ACTUALLY INCLUDES.
--
-- A plan currently carries a name and a price and nothing about what is being
-- bought. "Squad — AUD 80 / monthly" does not say whether that is squad
-- sessions only, or squad plus a written weekly plan, or everything including
-- one-to-one time. The coach knows; the app does not, and neither does anyone
-- reading it back in six months.
--
-- AN ARRAY, AND DELIBERATELY NOT CONSTRAINED
--
-- training_modifications on injuries uses a CHECK against a fixed vocabulary,
-- because that vocabulary IS fixed — there are only so many ways to modify
-- training. This list is explicitly open-ended: the brief for it ended in
-- "etc", and a coach adding "strength programming" or "video analysis" in a
-- year should not need a migration to do it.
--
-- So the values are curated in TypeScript, where the UI offers them, and the
-- column accepts whatever it is given. The cost is that a typo becomes a new
-- value rather than an error; the benefit is that the list can grow at the
-- speed the coaching does.
-- ============================================================================

ALTER TABLE public.coaching_plans
  ADD COLUMN IF NOT EXISTS inclusions text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.coaching_plans.inclusions IS
  'What the plan covers — weekly squad sessions, one-to-one time, written plans, and so on. Curated in src/lib/coaching-plan-inclusions.ts rather than constrained here, so the list can grow without a migration.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='coaching_plans' AND column_name='inclusions';
-- Expect ARRAY, default '{}'::text[].
--
-- SELECT name, inclusions FROM public.coaching_plans ORDER BY name;
-- Existing plans come back with an empty array, which is accurate — nothing
-- has been recorded for them yet.
