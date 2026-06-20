
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_coach_of(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_access_athlete(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
