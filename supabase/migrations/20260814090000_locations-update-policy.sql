-- ============================================================================
-- FIX: the UPDATE policy on training_locations is missing.
--
-- Diagnostics showed only three policies live — DELETE, INSERT, SELECT. With
-- RLS enabled and no UPDATE policy at all, Postgres denies EVERY update to
-- every user. That single gap explains both edit symptoms at once:
--
--   * the athlete can't edit the location they just created
--   * the coach can't save either — and because an RLS-blocked UPDATE
--     matches zero rows rather than raising, the app reported success
--
-- Inserts were fine throughout, which the data confirms: Jackson's "Moriac"
-- saved correctly as a personal location, and Chris's "TIC" as a squad one.
--
-- Why it's missing: the UPDATE statement in 20260813150000 evidently didn't
-- apply while the others did — most likely an error part-way through the
-- file that was scrolled past, since the SQL Editor reports only the last
-- statement's result. This recreates just that one policy.
--
-- SAFE TO RE-RUN.
-- ============================================================================

DROP POLICY IF EXISTS "locations update" ON public.training_locations;

CREATE POLICY "locations update" ON public.training_locations
  FOR UPDATE TO authenticated
  USING (
    CASE
      WHEN owner_athlete_id IS NOT NULL THEN public.owns_athlete_profile(auth.uid(), owner_athlete_id)
      ELSE public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager')
    END
  )
  WITH CHECK (
    CASE
      WHEN owner_athlete_id IS NOT NULL THEN public.owns_athlete_profile(auth.uid(), owner_athlete_id)
      ELSE public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager')
    END
  );

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately. Expect FOUR rows now: delete, insert, select, update.
-- ============================================================================
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'training_locations'
-- ORDER BY cmd, policyname;

-- And confirm owns_athlete_profile actually exists — the UPDATE policy calls
-- it, so if this returns nothing the policy above will fail to create:
-- SELECT proname, prosecdef FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'owns_athlete_profile';
