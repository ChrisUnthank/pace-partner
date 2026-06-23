
-- 1) Unique constraint for safe upserts on interval_results
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interval_results_step_set_rep_unique'
  ) THEN
    -- de-dupe first (keep newest by created_at, fallback id)
    DELETE FROM public.interval_results a
     USING public.interval_results b
     WHERE a.step_id = b.step_id
       AND COALESCE(a.set_number,1) = COALESCE(b.set_number,1)
       AND a.rep_number = b.rep_number
       AND a.id < b.id;
    ALTER TABLE public.interval_results
      ADD CONSTRAINT interval_results_step_set_rep_unique
      UNIQUE (step_id, set_number, rep_number);
  END IF;
END $$;

-- 2) recompute_session_totals: clear values when no logged rows remain
CREATE OR REPLACE FUNCTION public.recompute_session_totals(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- No logged data: clear derived totals (single source of truth)
    UPDATE public.sessions
       SET total_distance_m = NULL,
           total_time_seconds = NULL,
           avg_hr = NULL,
           max_hr = NULL,
           updated_at = now()
     WHERE id = _session_id;
    RETURN;
  END IF;

  UPDATE public.sessions
     SET total_distance_m   = NULLIF(v_dist, 0),
         total_time_seconds = NULLIF(v_time, 0),
         avg_hr             = CASE WHEN v_avg_hr IS NULL THEN NULL ELSE ROUND(v_avg_hr)::int END,
         max_hr             = v_max_hr,
         updated_at         = now()
   WHERE id = _session_id;
END;
$function$;

-- 3) Weekly distance view: use sessions.total_distance_m as truth for completed sessions
DROP VIEW IF EXISTS public.athlete_weekly_distance;
CREATE VIEW public.athlete_weekly_distance AS
WITH completed AS (
  SELECT
    s.athlete_id,
    (date_trunc('week', s.session_date::timestamptz))::date AS week_start,
    COALESCE(
      s.total_distance_m,
      (SELECT SUM(COALESCE(ir.actual_distance_m, 0))
         FROM public.interval_results ir
         JOIN public.steps st ON st.id = ir.step_id
        WHERE st.session_id = s.id
          AND COALESCE(st.counts_toward_distance, true) = true),
      0
    ) AS distance_m
  FROM public.sessions s
  WHERE s.completed_at IS NOT NULL
)
SELECT athlete_id, week_start, SUM(distance_m) AS distance_m
FROM completed
GROUP BY athlete_id, week_start;

GRANT SELECT ON public.athlete_weekly_distance TO authenticated;
GRANT SELECT ON public.athlete_weekly_distance TO service_role;

-- 4) Backfill: recompute totals and completion for every existing session
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sessions LOOP
    PERFORM public.recompute_session_totals(r.id);
    PERFORM public.compute_session_completion(r.id);
  END LOOP;
END $$;
