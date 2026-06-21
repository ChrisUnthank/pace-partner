-- Computes sessions.completion_pct from logged rep data.
-- Denominator: total planned reps across all Work steps (reps * set_count).
-- Numerator:   rep rows on those Work steps with real data (actual_time > 0 OR actual_distance > 0).
-- Cap at 100. Pure non-work sessions with any logged actual = 100; otherwise null.
-- Only runs on completed sessions; planned sessions keep completion_pct = null.
CREATE OR REPLACE FUNCTION public.compute_session_completion(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  sess          record;
  planned_reps  numeric;
  logged_reps   numeric;
  has_any_actual boolean;
  pct           numeric;
BEGIN
  SELECT id, completed_at, total_time_seconds, total_distance_m
    INTO sess
    FROM public.sessions
   WHERE id = _session_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Planned sessions: clear completion_pct, don't compute.
  IF sess.completed_at IS NULL THEN
    UPDATE public.sessions SET completion_pct = NULL WHERE id = _session_id;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(st.reps * COALESCE(st.set_count, 1)), 0)
    INTO planned_reps
    FROM public.steps st
   WHERE st.session_id = _session_id AND st.kind = 'work';

  SELECT COUNT(*)
    INTO logged_reps
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
   WHERE st.session_id = _session_id
     AND st.kind = 'work'
     AND (COALESCE(ir.actual_time_seconds, 0) > 0 OR COALESCE(ir.actual_distance_m, 0) > 0);

  IF planned_reps > 0 THEN
    pct := LEAST(100, ROUND(100.0 * logged_reps / planned_reps, 1));
  ELSE
    -- No Work steps planned (easy run / recovery day / etc.).
    SELECT (sess.total_time_seconds IS NOT NULL AND sess.total_time_seconds > 0)
        OR (sess.total_distance_m IS NOT NULL AND sess.total_distance_m > 0)
        OR EXISTS (
          SELECT 1 FROM public.interval_results ir
          JOIN public.steps st ON st.id = ir.step_id
          WHERE st.session_id = _session_id
            AND (COALESCE(ir.actual_time_seconds, 0) > 0 OR COALESCE(ir.actual_distance_m, 0) > 0)
        )
      INTO has_any_actual;
    pct := CASE WHEN has_any_actual THEN 100 ELSE NULL END;
  END IF;

  UPDATE public.sessions SET completion_pct = pct WHERE id = _session_id;
END $function$;

-- Trigger: rep results change → recompute completion for that session.
CREATE OR REPLACE FUNCTION public.trg_recompute_completion_from_rep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE sid uuid;
BEGIN
  SELECT s.id INTO sid
    FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
   WHERE st.id = COALESCE(NEW.step_id, OLD.step_id);
  IF sid IS NOT NULL THEN
    PERFORM public.compute_session_completion(sid);
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS interval_results_completion ON public.interval_results;
CREATE TRIGGER interval_results_completion
AFTER INSERT OR UPDATE OR DELETE ON public.interval_results
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_completion_from_rep();

-- Trigger: session marked complete / uncompleted → recompute.
CREATE OR REPLACE FUNCTION public.trg_recompute_completion_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.compute_session_completion(NEW.id);
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS sessions_completion ON public.sessions;
CREATE TRIGGER sessions_completion
AFTER UPDATE OF completed_at, total_time_seconds, total_distance_m ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_completion_from_session();

-- Backfill existing completed sessions once.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sessions WHERE completed_at IS NOT NULL LOOP
    PERFORM public.compute_session_completion(r.id);
  END LOOP;
END $$;