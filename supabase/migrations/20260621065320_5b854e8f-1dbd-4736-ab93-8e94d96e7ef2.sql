CREATE OR REPLACE VIEW public.athlete_weekly_distance AS
SELECT
  s.athlete_id,
  date_trunc('week', s.session_date)::date AS week_start,
  SUM(
    CASE
      WHEN s.completed_at IS NOT NULL
        THEN COALESCE(ir.actual_distance_m, 0)
      ELSE COALESCE(
        ir.actual_distance_m,
        CASE WHEN st.target_kind = 'distance' AND st.target_distance_m IS NOT NULL
             THEN st.target_distance_m ELSE 0 END
      )
    END
  )::numeric AS distance_m
FROM public.sessions s
JOIN public.steps st ON st.session_id = s.id
LEFT JOIN public.interval_results ir ON ir.step_id = st.id
WHERE COALESCE(st.counts_toward_distance, true) = true
GROUP BY s.athlete_id, date_trunc('week', s.session_date);

ALTER VIEW public.athlete_weekly_distance SET (security_invoker = true);
GRANT SELECT ON public.athlete_weekly_distance TO authenticated;