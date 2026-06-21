
ALTER TABLE public.session_zone_time
  ADD COLUMN IF NOT EXISTS meters numeric NOT NULL DEFAULT 0;

DROP VIEW IF EXISTS public.athlete_zone_time_weekly;
CREATE VIEW public.athlete_zone_time_weekly AS
SELECT
  szt.athlete_id,
  (date_trunc('week', s.session_date::timestamptz))::date AS week_start,
  szt.zone,
  szt.source,
  SUM(szt.seconds) AS seconds,
  SUM(szt.meters)  AS meters
FROM public.session_zone_time szt
JOIN public.sessions s ON s.id = szt.session_id
GROUP BY szt.athlete_id, date_trunc('week', s.session_date::timestamptz), szt.zone, szt.source;

GRANT SELECT ON public.athlete_zone_time_weekly TO authenticated;
GRANT ALL ON public.athlete_zone_time_weekly TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_session_zones(_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ath_id uuid;
  zp record;
  r record;
  pace_v numeric;
  p5k numeric;
  pace_band public.zone_band;
  hr_band public.zone_band;
  dist_v numeric;
BEGIN
  SELECT athlete_id INTO ath_id FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;
  DELETE FROM public.session_zone_time WHERE session_id = _session_id;
  IF zp IS NULL THEN RETURN; END IF;
  p5k := zp.pace_5k_sec_per_km;

  FOR r IN
    SELECT ir.actual_time_seconds AS secs,
           ir.actual_pace_sec_per_km AS pace_field,
           ir.actual_distance_m AS dist,
           ir.hr_avg AS hr_avg,
           st.kind AS kind
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id = _session_id
      AND COALESCE(ir.actual_time_seconds, 0) > 0
      AND COALESCE(st.counts_toward_distance, true) = true
  LOOP
    dist_v := COALESCE(r.dist, 0);

    IF p5k IS NOT NULL THEN
      pace_v := r.pace_field;
      IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
        pace_v := r.secs / (r.dist / 1000.0);
      END IF;
      IF pace_v IS NOT NULL THEN
        pace_band := CASE
          WHEN pace_v >= p5k + 90 THEN 'z1'
          WHEN pace_v >= p5k + 45 THEN 'z2'
          WHEN pace_v >= p5k + 15 THEN 'z3'
          WHEN pace_v >= p5k - 14 THEN 'z4'
          ELSE 'z5'
        END;
        INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, meters, source)
        VALUES (_session_id, ath_id, pace_band, r.secs, dist_v, 'pace')
        ON CONFLICT (session_id, zone, source) DO UPDATE
          SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
              meters  = public.session_zone_time.meters  + EXCLUDED.meters,
              updated_at = now();
      END IF;
    END IF;

    IF r.hr_avg IS NOT NULL AND zp.hr_z1_max IS NOT NULL THEN
      hr_band := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 'z1'
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 'z2'
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 'z3'
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 'z4'
        ELSE 'z5'
      END;
      INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, meters, source)
      VALUES (_session_id, ath_id, hr_band, r.secs, dist_v, 'hr')
      ON CONFLICT (session_id, zone, source) DO UPDATE
        SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
            meters  = public.session_zone_time.meters  + EXCLUDED.meters,
            updated_at = now();
    END IF;
  END LOOP;
END $function$;

DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id FROM public.sessions LOOP
    PERFORM public.recompute_session_zones(s.id);
  END LOOP;
END $$;
