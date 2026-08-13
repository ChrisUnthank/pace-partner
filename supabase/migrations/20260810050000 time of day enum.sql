-- ============================================================================
-- Session ordering — Phase 3 (v3): time_of_day enum, via new-column swap
-- ============================================================================
--
-- Replaces v2. v2 tried to DETECT whether the column was already the enum
-- type before deciding whether to run the ALTER — and that detection was
-- apparently unreliable (the ALTER still ran and failed with
-- 'session_time_of_day = text', which can only happen if the column
-- actually WAS already the enum at that point — meaning the check
-- incorrectly concluded otherwise). Rather than debug catalog
-- introspection further, this sidesteps the whole "what state is it in"
-- question entirely.
--
-- APPROACH: add a genuinely NEW column of the enum type, populate it via
-- a ::text cast first — which works identically whether the OLD column is
-- currently text or already the enum, since both types support a safe
-- ::text cast — then drop the old column and rename the new one into its
-- place. No detection logic, no assumption about starting state. Works
-- correctly no matter what happened in any previous attempt.
-- ============================================================================

DO $$
BEGIN
  CREATE TYPE public.session_time_of_day AS ENUM ('morning', 'afternoon', 'evening');
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already exists
END $$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS time_of_day_new public.session_time_of_day;

UPDATE public.sessions
   SET time_of_day_new = NULLIF(time_of_day::text, '')::public.session_time_of_day
 WHERE time_of_day_new IS NULL
   AND time_of_day IS NOT NULL;

ALTER TABLE public.sessions DROP COLUMN time_of_day;
ALTER TABLE public.sessions RENAME COLUMN time_of_day_new TO time_of_day;

COMMENT ON COLUMN public.sessions.time_of_day IS
  'Coarse same-day ordering signal (morning/afternoon/evening) — a real Postgres enum specifically so plain ORDER BY sorts chronologically, not alphabetically.';

NOTIFY pgrst, 'reload schema';

-- Sanity check — should return 'session_time_of_day':
-- SELECT format_type(a.atttypid, a.atttypmod)
--   FROM pg_attribute a
--   JOIN pg_class c ON c.oid = a.attrelid
--  WHERE c.relname = 'sessions' AND a.attname = 'time_of_day';
