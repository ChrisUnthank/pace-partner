-- ============================================================================
-- Security fix — scope person_contact_details' coach-read policy
-- ============================================================================
--
-- THIS IS A REAL FIX, NOT PURE CAPTURE — same category as the
-- coach_profiles insert-policy fix shipped earlier today.
--
-- THE PROBLEM
-- "coaches read contact details" only checked that the READER holds a
-- coach or manager role — it never checked whether the person whose
-- contact details are being read has any relationship to that coach at
-- all. Any coach or manager account could read any user's email, phone,
-- and address, not just people they actually coach.
--
-- THE FIX
-- Keep the original role check (defense in depth — costs nothing, and
-- guards against is_coach_of()'s own definition ever changing), and add
-- the scoping that was missing: the target user_id must belong to either
--   (a) an athlete this specific coach actually coaches (is_coach_of), or
--   (b) an active parent linked to one of this coach's athletes
--       (parent_athlete_links, status = 'active', joined through
--       coach_athletes to confirm the athlete is really this coach's).
-- Either path is legitimate — a coach reasonably needs contact details for
-- their own athletes and those athletes' parents, nobody else's.
--
-- The "own contact details full access" policy on this same table is
-- untouched — self-access was never the problem.
--
-- NOTE: this assumes is_coach_of() treats 'manager' role athletes the same
-- as 'coach' role for its own relationship check, consistent with how
-- 'coach' and 'manager' are used interchangeably in RLS policies
-- throughout the rest of this schema (e.g. plan_templates, race_entry_rules).
-- Worth a quick look at is_coach_of()'s own body if manager-role access
-- ever seems too narrow after this ships.
--
-- SAFE TO RE-RUN.
-- ============================================================================

DROP POLICY IF EXISTS "coaches read contact details" ON public.person_contact_details;
CREATE POLICY "coaches read contact details" ON public.person_contact_details
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = ANY (ARRAY['coach', 'manager']::text[])
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.user_id = person_contact_details.user_id
          AND public.is_coach_of(auth.uid(), a.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.parent_athlete_links pal
        JOIN public.coach_athletes ca ON ca.athlete_id = pal.athlete_id
        WHERE pal.parent_user_id = person_contact_details.user_id
          AND pal.status = 'active'
          AND ca.coach_user_id = auth.uid()
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION — run after deploying.
--
-- 1. Confirm the policy definition updated:
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'person_contact_details' AND cmd = 'SELECT';
--
-- 2. As a real coach account, confirm you can still see YOUR OWN athletes'
--    and their parents' contact details (should be unchanged):
-- SELECT * FROM public.person_contact_details WHERE user_id = '<A_REAL_ATHLETE_USER_ID_YOU_COACH>';
--
-- 3. As that same coach, confirm you can no longer see an unrelated
--    athlete/parent's contact details (should now return zero rows, where
--    it previously would not have):
-- SELECT * FROM public.person_contact_details WHERE user_id = '<SOME_UNRELATED_USER_ID>';
-- ============================================================================
