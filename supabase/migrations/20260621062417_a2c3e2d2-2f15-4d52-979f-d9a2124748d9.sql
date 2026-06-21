-- Backfill Maya Easy run a06c3f65 single rep with consistent values (target: 8km in 40:00, easy zone)
UPDATE public.interval_results
   SET actual_time_seconds = 2400,
       actual_distance_m = 8000,
       actual_pace_sec_per_km = 300,
       hr_avg = 135,
       hr_end = 140,
       cadence = 170,
       stride_length_cm = ROUND(6000000.0 / (300 * 170))
 WHERE step_id = 'eda903c2-3fca-4f62-8ca9-81949d0c15bc';

-- Backfill missing stride_length_cm for all [TEST] athlete work reps that have pace+cadence
UPDATE public.interval_results ir
   SET stride_length_cm = ROUND(6000000.0 / (ir.actual_pace_sec_per_km * ir.cadence))
  FROM public.steps st
  JOIN public.sessions s ON s.id = st.session_id
 WHERE ir.step_id = st.id
   AND st.kind = 'work'
   AND ir.stride_length_cm IS NULL
   AND ir.actual_pace_sec_per_km IS NOT NULL
   AND ir.actual_pace_sec_per_km > 0
   AND ir.cadence IS NOT NULL
   AND ir.cadence > 0
   AND s.athlete_id IN (SELECT id FROM public.athletes WHERE name LIKE '[TEST]%');

-- Recompute derived analysis for every completed [TEST] session
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, athlete_id, session_date FROM public.sessions
     WHERE completed_at IS NOT NULL
       AND athlete_id IN (SELECT id FROM public.athletes WHERE name LIKE '[TEST]%')
  LOOP
    PERFORM public.recompute_session_zones(r.id);
    PERFORM public.compute_session_fatigue(r.id);
    PERFORM public.recompute_readiness(r.athlete_id, r.session_date);
  END LOOP;
END $$;