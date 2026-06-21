ALTER TABLE public.sessions ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.sessions ALTER COLUMN category TYPE text USING category::text;
ALTER TABLE public.sessions ALTER COLUMN category SET DEFAULT 'easy';
ALTER TABLE public.session_adjustment_rules ALTER COLUMN category TYPE text USING category::text;

DROP TYPE public.session_category;

ALTER TABLE public.sessions ADD CONSTRAINT sessions_category_check
  CHECK (category IN ('easy','long','tempo','threshold','intervals','reps','race','recovery','cross_training','rest','fartlek','steady'));

ALTER TABLE public.session_adjustment_rules ADD CONSTRAINT session_adjustment_rules_category_check
  CHECK (category IN ('easy','long','tempo','threshold','intervals','reps','race','recovery','cross_training','rest','fartlek','steady'));

CREATE OR REPLACE FUNCTION public.session_training_load(_session_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  duration_min numeric;
  rpe_eff numeric;
BEGIN
  SELECT rpe, category, total_time_seconds INTO s
    FROM public.sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  duration_min := COALESCE(s.total_time_seconds, 0) / 60.0;
  IF duration_min = 0 THEN
    SELECT COALESCE(SUM(ir.actual_time_seconds),0)/60.0 INTO duration_min
      FROM public.interval_results ir
      JOIN public.steps st ON st.id = ir.step_id
      WHERE st.session_id = _session_id;
  END IF;

  IF s.rpe IS NOT NULL THEN
    rpe_eff := s.rpe;
  ELSE
    rpe_eff := CASE s.category
      WHEN 'recovery' THEN 2
      WHEN 'easy' THEN 3
      WHEN 'long' THEN 5
      WHEN 'steady' THEN 6
      WHEN 'tempo' THEN 6
      WHEN 'threshold' THEN 7
      WHEN 'fartlek' THEN 7
      WHEN 'intervals' THEN 8
      WHEN 'reps' THEN 8
      WHEN 'race' THEN 9
      WHEN 'cross_training' THEN 4
      WHEN 'rest' THEN 0
      ELSE 4
    END;
  END IF;

  RETURN ROUND(rpe_eff * duration_min, 2);
END $function$;

INSERT INTO public.session_adjustment_rules (category, readiness_status, adjustment_type, adjusted_summary, reason)
VALUES
  ('steady', 'amber', 'reduce_intensity_and_volume',
    'Hold the easy end of steady — drop pace by ~10–15 sec/km and shorten by 15–20%.',
    'Amber readiness — protect aerobic stimulus while reducing total stress.'),
  ('steady', 'red', 'swap_to_easy',
    'Swap to easy Z2 run, 30–40 min, conversational.',
    'Red readiness — prioritize recovery, no moderate-intensity work today.'),
  ('fartlek', 'amber', 'reduce_intensity',
    'Cut surges to ~60–70% of planned (fewer or shorter), hold easy effort between. Total time unchanged.',
    'Amber readiness — keep aerobic time, dial back the high-intensity surges.'),
  ('fartlek', 'red', 'swap_to_easy',
    'Drop the surges entirely — easy Z2 continuous run for the planned duration, or 30 min, whichever is shorter.',
    'Red readiness — no surges today, easy aerobic only.')
ON CONFLICT (category, readiness_status) DO NOTHING;