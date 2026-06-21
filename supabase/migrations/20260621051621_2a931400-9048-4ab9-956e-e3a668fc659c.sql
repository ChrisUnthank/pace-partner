
-- Restore Data API grants on roster-related public tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athletes TO authenticated;
GRANT ALL ON public.athletes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_athletes TO authenticated;
GRANT ALL ON public.coach_athletes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_invites TO authenticated;
GRANT ALL ON public.athlete_invites TO service_role;
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Grant EXECUTE on helper functions used inside RLS expressions
GRANT EXECUTE ON FUNCTION public.is_coach_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_athlete(uuid, uuid) TO authenticated;

-- Rewrite invitee policy to avoid querying auth.users from RLS (causes 403 on embedded reads)
DROP POLICY IF EXISTS "invitee reads by email" ON public.athlete_invites;
CREATE POLICY "invitee reads by email"
  ON public.athlete_invites
  FOR SELECT
  TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));
