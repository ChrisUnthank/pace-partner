
ALTER VIEW public.athlete_zone_time_weekly SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.session_training_load(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.external_load_score(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_readiness(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_readiness_all(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_session_zones(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_checkin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_external() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_zones_from_rep() FROM PUBLIC, anon;
