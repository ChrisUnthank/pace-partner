
-- RLS: users can insert/delete their own non-admin roles
CREATE POLICY "users can grant themselves athlete/coach/manager"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND role IN ('athlete','coach','manager'));

CREATE POLICY "users can revoke their own athlete/coach/manager"
  ON public.user_roles FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND role IN ('athlete','coach','manager'));

-- Extend is_coach_of so managers see all athletes
CREATE OR REPLACE FUNCTION public.is_coach_of(_user_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.coach_athletes WHERE coach_user_id = _user_id AND athlete_id = _athlete_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'manager')
$function$;

-- Backfill roles for existing users
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'coach'::public.app_role FROM auth.users WHERE email = 'chris@unthank.me'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'manager'::public.app_role FROM auth.users WHERE email = 'amanda@unthank.me'
ON CONFLICT (user_id, role) DO NOTHING;
