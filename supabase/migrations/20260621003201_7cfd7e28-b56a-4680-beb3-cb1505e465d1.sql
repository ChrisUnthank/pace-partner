
REVOKE EXECUTE ON FUNCTION public.session_training_load(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.external_load_score(uuid, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_readiness(uuid, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_readiness_all(date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_session_zones(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_checkin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_external() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_readiness_from_session() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_zones_from_rep() FROM authenticated;
