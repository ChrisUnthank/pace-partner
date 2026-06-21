
-- 1. Snapshot columns on session_zone_time (nullable; legacy rows stay null = historical)
ALTER TABLE public.session_zone_time
  ADD COLUMN IF NOT EXISTS pace_5k_sec_per_km numeric,
  ADD COLUMN IF NOT EXISTS hr_z1_max integer,
  ADD COLUMN IF NOT EXISTS hr_z2_max integer,
  ADD COLUMN IF NOT EXISTS hr_z3_max integer,
  ADD COLUMN IF NOT EXISTS hr_z4_max integer,
  ADD COLUMN IF NOT EXISTS boundaries_computed_at timestamptz;

-- 2. Manual override flag
ALTER TABLE public.athlete_zone_profiles
  ADD COLUMN IF NOT EXISTS hr_zones_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pace_zones_manual boolean NOT NULL DEFAULT false;

-- 3. Auto-derive athlete zone profile
CREATE OR REPLACE FUNCTION public.recompute_athlete_zone_profile(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ath           record;
  zp            record;
  pace_5k_v     numeric;
  best_5k       numeric;
  best_3k       numeric;
  best_10k      numeric;
  hr_max_v      integer;
BEGIN
  SELECT * INTO ath FROM public.athletes WHERE id = _athlete_id;
  IF ath IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = _athlete_id;

  -- Pace anchor: fastest 5K in last 12 months
  SELECT MIN(time_seconds) INTO best_5k
    FROM public.performances
    WHERE athlete_id = _athlete_id
      AND distance_m = 5000
      AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
  IF best_5k IS NOT NULL THEN
    pace_5k_v := best_5k / 5.0;
  ELSE
    -- Fallback: fastest 3K * (5/3) * 1.06
    SELECT MIN(time_seconds) INTO best_3k
      FROM public.performances
      WHERE athlete_id = _athlete_id
        AND distance_m = 3000
        AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
    IF best_3k IS NOT NULL THEN
      pace_5k_v := (best_3k / 3.0) * 1.06;
    ELSE
      -- Fallback: fastest 10K * 0.96
      SELECT MIN(time_seconds) INTO best_10k
        FROM public.performances
        WHERE athlete_id = _athlete_id
          AND distance_m = 10000
          AND performance_date >= CURRENT_DATE - INTERVAL '12 months';
      IF best_10k IS NOT NULL THEN
        pace_5k_v := (best_10k / 10.0) * 0.96;
      END IF;
    END IF;
  END IF;

  hr_max_v := ath.hr_max;

  IF zp IS NULL THEN
    INSERT INTO public.athlete_zone_profiles(
      athlete_id, hr_max, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max, hr_z5_max,
      pace_5k_sec_per_km, auto_derived, updated_at
    ) VALUES (
      _athlete_id,
      hr_max_v,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.60)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.70)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.80)::int END,
      CASE WHEN hr_max_v IS NOT NULL THEN ROUND(hr_max_v * 0.90)::int END,
      hr_max_v,
      pace_5k_v,
      true,
      now()
    );
  ELSE
    UPDATE public.athlete_zone_profiles SET
      hr_max     = CASE WHEN hr_zones_manual THEN hr_max     ELSE hr_max_v END,
      hr_z1_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z1_max ELSE ROUND(hr_max_v * 0.60)::int END,
      hr_z2_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z2_max ELSE ROUND(hr_max_v * 0.70)::int END,
      hr_z3_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z3_max ELSE ROUND(hr_max_v * 0.80)::int END,
      hr_z4_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z4_max ELSE ROUND(hr_max_v * 0.90)::int END,
      hr_z5_max  = CASE WHEN hr_zones_manual OR hr_max_v IS NULL THEN hr_z5_max ELSE hr_max_v END,
      pace_5k_sec_per_km = CASE WHEN pace_zones_manual OR pace_5k_v IS NULL THEN pace_5k_sec_per_km ELSE pace_5k_v END,
      updated_at = now();
  END IF;
END $$;

-- 4. Triggers on performances and athletes.hr_max
CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_perf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_athlete_zone_profile(COALESCE(NEW.athlete_id, OLD.athlete_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS recompute_zones_after_perf ON public.performances;
CREATE TRIGGER recompute_zones_after_perf
  AFTER INSERT OR UPDATE OR DELETE ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_perf();

CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_athlete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hr_max IS DISTINCT FROM OLD.hr_max THEN
    PERFORM public.recompute_athlete_zone_profile(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS recompute_zones_after_athlete_hrmax ON public.athletes;
CREATE TRIGGER recompute_zones_after_athlete_hrmax
  AFTER UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_athlete();

-- 5. Update recompute_session_zones to write snapshot columns
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
  dist_v numeric;
  now_ts timestamptz := now();
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
        INSERT INTO public.session_zone_time(
          session_id, athlete_id, zone, seconds, meters, source,
          pace_5k_sec_per_km, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max,
          boundaries_computed_at
        )
        VALUES (_session_id, ath_id, pace_band, r.secs, dist_v, 'pace',
                p5k, zp.hr_z1_max, zp.hr_z2_max, zp.hr_z3_max, zp.hr_z4_max, now_ts)
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
      INSERT INTO public.session_zone_time(
        session_id, athlete_id, zone, seconds, meters, source,
        pace_5k_sec_per_km, hr_z1_max, hr_z2_max, hr_z3_max, hr_z4_max,
        boundaries_computed_at
      )
      VALUES (_session_id, ath_id, hr_band, r.secs, dist_v, 'hr',
              p5k, zp.hr_z1_max, zp.hr_z2_max, zp.hr_z3_max, zp.hr_z4_max, now_ts)
      ON CONFLICT (session_id, zone, source) DO UPDATE
        SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
            meters  = public.session_zone_time.meters  + EXCLUDED.meters,
            updated_at = now();
    END IF;
  END LOOP;
END $$;

-- 6. Correct every existing athlete_zone_profiles row under the 60/70/80/90% standard.
--    Past session_zone_time rows are NOT touched (snapshot columns stay null = historical).
UPDATE public.athlete_zone_profiles zp
SET
  hr_max    = a.hr_max,
  hr_z1_max = ROUND(a.hr_max * 0.60)::int,
  hr_z2_max = ROUND(a.hr_max * 0.70)::int,
  hr_z3_max = ROUND(a.hr_max * 0.80)::int,
  hr_z4_max = ROUND(a.hr_max * 0.90)::int,
  hr_z5_max = a.hr_max,
  updated_at = now()
FROM public.athletes a
WHERE a.id = zp.athlete_id
  AND a.hr_max IS NOT NULL
  AND zp.hr_zones_manual = false;
