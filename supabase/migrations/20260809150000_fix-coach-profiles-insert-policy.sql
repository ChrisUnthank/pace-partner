-- ============================================================================
-- Security fix — remove wide-open coach_profiles insert policy
-- ============================================================================
--
-- THIS IS A REAL FIX, NOT PURE CAPTURE — unlike every other migration in
-- today's catch-up batch, this one changes live behavior.
--
-- THE PROBLEM
-- coach_profiles currently has TWO permissive INSERT policies:
--   "Coaches can create their own profile"  — WITH CHECK (auth.uid() = coach_user_id)
--   "Allow insert coach (dev only)"          — WITH CHECK (true)
-- Permissive RLS policies OR together. The unconditional "dev only" one
-- means any authenticated user can currently insert a coach_profiles row
-- for ANY coach_user_id, not just their own — the properly-scoped policy
-- sitting right next to it provides no actual protection while this one
-- exists.
--
-- THE FIX
-- Drop the dev-only policy. The properly-scoped "Coaches can create their
-- own profile" policy already exists and is untouched — legitimate coach
-- profile creation keeps working exactly as it should; only the
-- impersonation path closes.
--
-- SAFE TO RE-RUN.
-- ============================================================================

DROP POLICY IF EXISTS "Allow insert coach (dev only)" ON public.coach_profiles;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION — run after deploying. Should show exactly ONE INSERT
-- policy on coach_profiles, correctly scoped to auth.uid() = coach_user_id:
--
-- SELECT policyname, cmd, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'coach_profiles' AND cmd = 'INSERT';
-- ============================================================================
