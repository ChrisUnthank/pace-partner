
-- 1. Rename enum pace_zone -> zone_band with values z1..z5
DROP VIEW IF EXISTS public.athlete_zone_time_weekly;

-- Wipe existing zone-time rows; will be recomputed under the new bands.
TRUNCATE TABLE public.session_zone_time;

CREATE TYPE public.zone_band AS ENUM ('z1','z2','z3','z4','z5');

ALTER TABLE public.session_zone_time
  ALTER COLUMN zone TYPE public.zone_band
  USING (CASE zone::text
    WHEN 'recovery'  THEN 'z1'
    WHEN 'easy'      THEN 'z1'
    WHEN 'steady'    THEN 'z2'
    WHEN 'threshold' THEN 'z3'
    WHEN 'vo2'       THEN 'z4'
    WHEN 'rep'       THEN 'z5'
    WHEN 'sprint'    THEN 'z5'
  END)::public.zone_band;

DROP TYPE public.pace_zone;

-- Rebuild weekly rollup view on the new enum.
CREATE OR REPLACE VIEW public.athlete_zone_time_weekly AS
  SELECT szt.athlete_id,
         date_trunc('week', s.session_date)::date AS week_start,
         szt.zone,
         szt.source,
         SUM(szt.seconds) AS seconds
  FROM public.session_zone_time szt
  JOIN public.sessions s ON s.id = szt.session_id
  GROUP BY szt.athlete_id, date_trunc('week', s.session_date), szt.zone, szt.source;

GRANT SELECT ON public.athlete_zone_time_weekly TO authenticated;

-- 2. Rebuild recompute_session_zones to:
--    - Bucket pace into z1..z5 anchored to pace_5k_sec_per_km (offset bands).
--    - Bucket HR into z1..z5 using existing hr_z1_max..hr_z4_max thresholds.
--    Leave existing pace_easy/pace_threshold/pace_1500/pace_rep columns
--    in place (deprecated but not yet dropped).
CREATE OR REPLACE FUNCTION public.recompute_session_zones(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ath_id uuid;
  zp record;
  r record;
  pace_v numeric;
  p5k numeric;
  pace_band public.zone_band;
  hr_band public.zone_band;
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
    -- Pace bucketing, anchored to 5K pace.
    IF p5k IS NOT NULL THEN
      pace_v := r.pace_field;
      IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
        pace_v := r.secs / (r.dist / 1000.0);
      END IF;
      IF pace_v IS NOT NULL THEN
        -- sec/km: bigger = slower
        pace_band := CASE
          WHEN pace_v >= p5k + 90 THEN 'z1'
          WHEN pace_v >= p5k + 45 THEN 'z2'
          WHEN pace_v >= p5k + 15 THEN 'z3'
          WHEN pace_v >= p5k - 14 THEN 'z4'
          ELSE 'z5'
        END;
        INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
        VALUES (_session_id, ath_id, pace_band, r.secs, 'pace')
        ON CONFLICT (session_id, zone, source) DO UPDATE
          SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
              updated_at = now();
      END IF;
    END IF;

    -- HR bucketing onto z1..z5 (existing thresholds, just renamed values).
    IF r.hr_avg IS NOT NULL AND zp.hr_z1_max IS NOT NULL THEN
      hr_band := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 'z1'
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 'z2'
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 'z3'
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 'z4'
        ELSE 'z5'
      END;
      INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
      VALUES (_session_id, ath_id, hr_band, r.secs, 'hr')
      ON CONFLICT (session_id, zone, source) DO UPDATE
        SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
            updated_at = now();
    END IF;
  END LOOP;
END $$;

-- 3. Recompute zone-time for every existing session under the new bands.
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id FROM public.sessions LOOP
    PERFORM public.recompute_session_zones(s.id);
  END LOOP;
END $$;
