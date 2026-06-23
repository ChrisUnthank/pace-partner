
-- 1) Add activity_type column
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS activity_type text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_activity_type_check'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_activity_type_check
      CHECK (activity_type IS NULL OR activity_type = ANY (ARRAY['run','track','gym','ride','swim','time_trial']));
  END IF;
END $$;

-- 2) Add max_hr column
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS max_hr integer;

-- 3) Aggregation function: recompute session totals from interval_results
CREATE OR REPLACE FUNCTION public.recompute_session_totals(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dist numeric;
  v_time numeric;
  v_avg_hr numeric;
  v_max_hr integer;
  v_logged_count int;
BEGIN
  SELECT
    SUM(COALESCE(ir.actual_distance_m, 0)),
    SUM(COALESCE(ir.actual_time_seconds, 0)),
    -- duration-weighted average HR
    CASE
      WHEN SUM(CASE WHEN ir.hr_avg IS NOT NULL THEN COALESCE(ir.actual_time_seconds,0) ELSE 0 END) > 0
      THEN SUM(COALESCE(ir.hr_avg,0) * COALESCE(ir.actual_time_seconds,0))
           / NULLIF(SUM(CASE WHEN ir.hr_avg IS NOT NULL THEN COALESCE(ir.actual_time_seconds,0) ELSE 0 END), 0)
      ELSE NULL
    END,
    GREATEST(MAX(ir.hr_max), MAX(ir.hr_end)),
    COUNT(*) FILTER (WHERE COALESCE(ir.actual_time_seconds,0) > 0 OR COALESCE(ir.actual_distance_m,0) > 0)
  INTO v_dist, v_time, v_avg_hr, v_max_hr, v_logged_count
  FROM public.interval_results ir
  JOIN public.steps st ON st.id = ir.step_id
  WHERE st.session_id = _session_id;

  IF v_logged_count = 0 THEN
    -- nothing logged; leave existing values alone
    RETURN;
  END IF;

  UPDATE public.sessions
     SET total_distance_m   = COALESCE(NULLIF(v_dist, 0), total_distance_m),
         total_time_seconds = COALESCE(NULLIF(v_time, 0), total_time_seconds),
         avg_hr             = COALESCE(ROUND(v_avg_hr)::int, avg_hr),
         max_hr             = COALESCE(v_max_hr, max_hr),
         updated_at         = now()
   WHERE id = _session_id;
END;
$$;

-- 4) Trigger on interval_results -> recompute totals
CREATE OR REPLACE FUNCTION public.trg_recompute_totals_from_rep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid uuid;
BEGIN
  SELECT s.id INTO sid
    FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
   WHERE st.id = COALESCE(NEW.step_id, OLD.step_id);
  IF sid IS NOT NULL THEN
    PERFORM public.recompute_session_totals(sid);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS interval_results_totals ON public.interval_results;
CREATE TRIGGER interval_results_totals
AFTER INSERT OR UPDATE OR DELETE ON public.interval_results
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_totals_from_rep();

-- 5) Backfill existing sessions that have rep data
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.id
      FROM public.sessions s
      JOIN public.steps st ON st.session_id = s.id
      JOIN public.interval_results ir ON ir.step_id = st.id
     WHERE COALESCE(ir.actual_time_seconds,0) > 0 OR COALESCE(ir.actual_distance_m,0) > 0
  LOOP
    PERFORM public.recompute_session_totals(r.id);
  END LOOP;
END $$;
