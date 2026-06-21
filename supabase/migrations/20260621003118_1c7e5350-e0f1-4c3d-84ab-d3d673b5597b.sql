
-- 1. Schema additions
ALTER TABLE public.athlete_load_daily
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS data_days integer,
  ADD COLUMN IF NOT EXISTS checkin_score numeric,
  ADD COLUMN IF NOT EXISTS load_balance_score numeric,
  ADD COLUMN IF NOT EXISTS load_ratio numeric;

-- 2. Session pace-zone time table
DO $$ BEGIN
  CREATE TYPE public.pace_zone AS ENUM ('easy','steady','threshold','vo2','rep','sprint','recovery');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.zone_source AS ENUM ('pace','hr');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.session_zone_time (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  zone public.pace_zone NOT NULL,
  seconds numeric NOT NULL DEFAULT 0,
  source public.zone_source NOT NULL DEFAULT 'pace',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, zone, source)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_zone_time TO authenticated;
GRANT ALL ON public.session_zone_time TO service_role;
ALTER TABLE public.session_zone_time ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access session zone time via athlete access"
  ON public.session_zone_time FOR SELECT TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id));

CREATE INDEX IF NOT EXISTS idx_szt_session ON public.session_zone_time(session_id);
CREATE INDEX IF NOT EXISTS idx_szt_athlete ON public.session_zone_time(athlete_id);

-- 3. RPE-based training load with category fallback
CREATE OR REPLACE FUNCTION public.session_training_load(_session_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  duration_min numeric;
  rpe_eff numeric;
BEGIN
  SELECT rpe, category, total_time_seconds INTO s
    FROM public.sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- duration: prefer session total, else sum of rep times
  duration_min := COALESCE(s.total_time_seconds, 0) / 60.0;
  IF duration_min = 0 THEN
    SELECT COALESCE(SUM(ir.actual_time_seconds),0)/60.0 INTO duration_min
      FROM public.interval_results ir
      JOIN public.steps st ON st.id = ir.step_id
      WHERE st.session_id = _session_id;
  END IF;

  -- effective RPE
  IF s.rpe IS NOT NULL THEN
    rpe_eff := s.rpe;
  ELSE
    rpe_eff := CASE s.category
      WHEN 'recovery' THEN 2
      WHEN 'easy' THEN 3
      WHEN 'long' THEN 5
      WHEN 'tempo' THEN 6
      WHEN 'threshold' THEN 7
      WHEN 'intervals' THEN 8
      WHEN 'reps' THEN 8
      WHEN 'race' THEN 9
      WHEN 'cross_training' THEN 4
      WHEN 'rest' THEN 0
      ELSE 4
    END;
  END IF;

  RETURN ROUND(rpe_eff * duration_min, 2);
END $$;

-- 4. External load score
CREATE OR REPLACE FUNCTION public.external_load_score(_athlete_id uuid, _date date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(COALESCE(intensity,3) * 2 * COALESCE(duration_minutes,0) / 10.0), 0)
  FROM public.external_load
  WHERE athlete_id = _athlete_id AND load_date = _date;
$$;

-- 5. Core recompute
CREATE OR REPLACE FUNCTION public.recompute_readiness(_athlete_id uuid, _date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  training_load_today numeric;
  external_load_today numeric;
  combined_today numeric;
  atl_val numeric; ctl_val numeric;
  acute_days int; chronic_days int; total_days int;
  load_ratio_v numeric;
  load_balance numeric;
  checkin_score_v numeric;
  readiness numeric;
  band public.readiness_status;
  confidence_v text;
  injury_v boolean;
  c record;
BEGIN
  -- training load for the day
  SELECT COALESCE(SUM(public.session_training_load(id)),0) INTO training_load_today
    FROM public.sessions
    WHERE athlete_id = _athlete_id AND session_date = _date;

  external_load_today := public.external_load_score(_athlete_id, _date);
  combined_today := training_load_today + external_load_today;

  -- rolling windows (use combined_load from prior rows + today's combined)
  WITH win AS (
    SELECT load_date, combined_load FROM public.athlete_load_daily
      WHERE athlete_id = _athlete_id
        AND load_date BETWEEN _date - INTERVAL '27 days' AND _date - INTERVAL '1 day'
    UNION ALL
    SELECT _date, combined_today
  )
  SELECT
    AVG(combined_load) FILTER (WHERE load_date >= _date - INTERVAL '6 days'),
    AVG(combined_load),
    COUNT(*) FILTER (WHERE load_date >= _date - INTERVAL '6 days' AND combined_load IS NOT NULL),
    COUNT(*) FILTER (WHERE combined_load IS NOT NULL),
    COUNT(*) FILTER (WHERE combined_load IS NOT NULL)
  INTO atl_val, ctl_val, acute_days, chronic_days, total_days
  FROM win;

  -- load ratio + balance score
  IF ctl_val IS NULL OR ctl_val = 0 THEN
    load_ratio_v := NULL;
    load_balance := NULL;
  ELSE
    load_ratio_v := ROUND(atl_val / ctl_val, 3);
    -- peak at ratio 1.0, drop off outside 0.8-1.3 sweet spot
    load_balance := GREATEST(0, LEAST(100,
      100 - 100 * GREATEST(
        CASE WHEN load_ratio_v < 0.8 THEN (0.8 - load_ratio_v) / 0.8 ELSE 0 END,
        CASE WHEN load_ratio_v > 1.3 THEN (load_ratio_v - 1.3) / 0.7 ELSE 0 END
      )
    ));
  END IF;

  -- checkin score
  SELECT * INTO c FROM public.daily_checkins
    WHERE athlete_id = _athlete_id AND checkin_date = _date;
  injury_v := COALESCE(c.injury_flag, false);
  IF c IS NOT NULL AND (c.sleep_quality IS NOT NULL OR c.soreness IS NOT NULL OR c.stress IS NOT NULL OR c.motivation IS NOT NULL OR c.energy IS NOT NULL) THEN
    checkin_score_v := (
      COALESCE(c.sleep_quality,3)
      + (6 - COALESCE(c.soreness,3))
      + (6 - COALESCE(c.stress,3))
      + COALESCE(c.motivation,3)
      + COALESCE(c.energy,3)
    ) * 5.0; -- max = 25 * 5/... actually scale: sum max=25, *4 = 100
    checkin_score_v := LEAST(100, checkin_score_v * 4.0 / 5.0);
  END IF;

  -- combine
  IF load_balance IS NOT NULL AND checkin_score_v IS NOT NULL THEN
    readiness := ROUND(0.6 * load_balance + 0.4 * checkin_score_v, 1);
  ELSIF checkin_score_v IS NOT NULL THEN
    readiness := ROUND(checkin_score_v, 1);
  ELSIF load_balance IS NOT NULL THEN
    readiness := ROUND(load_balance, 1);
  ELSE
    readiness := NULL;
  END IF;

  -- confidence
  confidence_v := CASE
    WHEN total_days IS NULL OR total_days < 3 THEN 'insufficient'
    WHEN total_days < 7 THEN 'low'
    WHEN total_days < 21 THEN 'medium'
    ELSE 'high'
  END;

  -- band
  IF injury_v THEN
    band := 'red';
  ELSIF confidence_v = 'insufficient' OR readiness IS NULL THEN
    band := NULL;
  ELSIF readiness < 40 THEN band := 'red';
  ELSIF readiness < 65 THEN band := 'amber';
  ELSE band := 'green';
  END IF;

  INSERT INTO public.athlete_load_daily (
    athlete_id, load_date, training_load, external_load_total, combined_load,
    atl, ctl, tsb, readiness_score, readiness_status,
    confidence, data_days, checkin_score, load_balance_score, load_ratio, updated_at
  ) VALUES (
    _athlete_id, _date, training_load_today, external_load_today, combined_today,
    atl_val, ctl_val, COALESCE(ctl_val,0) - COALESCE(atl_val,0),
    readiness, band, confidence_v, total_days, checkin_score_v, load_balance, load_ratio_v, now()
  )
  ON CONFLICT (athlete_id, load_date) DO UPDATE SET
    training_load = EXCLUDED.training_load,
    external_load_total = EXCLUDED.external_load_total,
    combined_load = EXCLUDED.combined_load,
    atl = EXCLUDED.atl,
    ctl = EXCLUDED.ctl,
    tsb = EXCLUDED.tsb,
    readiness_score = EXCLUDED.readiness_score,
    readiness_status = EXCLUDED.readiness_status,
    confidence = EXCLUDED.confidence,
    data_days = EXCLUDED.data_days,
    checkin_score = EXCLUDED.checkin_score,
    load_balance_score = EXCLUDED.load_balance_score,
    load_ratio = EXCLUDED.load_ratio,
    updated_at = now();
END $$;

-- ensure uniqueness for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_athlete_load_daily ON public.athlete_load_daily(athlete_id, load_date);

CREATE OR REPLACE FUNCTION public.recompute_readiness_all(_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  FOR a IN SELECT id FROM public.athletes LOOP
    PERFORM public.recompute_readiness(a.id, _date);
  END LOOP;
END $$;

-- 6. Pace zone bucketing
CREATE OR REPLACE FUNCTION public.recompute_session_zones(_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ath_id uuid;
  zp record;
  totals jsonb := '{}'::jsonb;
  r record;
  pace_v numeric;
  zone_key public.pace_zone;
BEGIN
  SELECT athlete_id INTO ath_id FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;

  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;
  IF zp IS NULL OR zp.pace_5k_sec_per_km IS NULL THEN
    DELETE FROM public.session_zone_time WHERE session_id = _session_id;
    RETURN;
  END IF;

  DELETE FROM public.session_zone_time WHERE session_id = _session_id AND source = 'pace';

  FOR r IN
    SELECT ir.actual_time_seconds AS secs, ir.actual_pace_sec_per_km AS pace_field,
           ir.actual_distance_m AS dist, st.kind AS kind
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id = _session_id
      AND COALESCE(ir.actual_time_seconds,0) > 0
  LOOP
    IF r.kind = 'recovery' THEN
      zone_key := 'recovery';
    ELSE
      pace_v := r.pace_field;
      IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
        pace_v := r.secs / (r.dist / 1000.0);
      END IF;
      IF pace_v IS NULL THEN CONTINUE; END IF;

      -- slower (larger sec/km) = easier
      zone_key := CASE
        WHEN zp.pace_easy_sec_per_km IS NOT NULL AND pace_v >= zp.pace_easy_sec_per_km THEN 'easy'
        WHEN zp.pace_threshold_sec_per_km IS NOT NULL AND pace_v >= zp.pace_threshold_sec_per_km THEN 'steady'
        WHEN zp.pace_5k_sec_per_km IS NOT NULL AND pace_v >= zp.pace_5k_sec_per_km THEN 'threshold'
        WHEN zp.pace_1500_sec_per_km IS NOT NULL AND pace_v >= zp.pace_1500_sec_per_km THEN 'vo2'
        WHEN zp.pace_rep_sec_per_km IS NOT NULL AND pace_v >= zp.pace_rep_sec_per_km THEN 'rep'
        ELSE 'sprint'
      END;
    END IF;

    INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
    VALUES (_session_id, ath_id, zone_key, r.secs, 'pace')
    ON CONFLICT (session_id, zone, source) DO UPDATE
      SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
          updated_at = now();
  END LOOP;
END $$;

-- 7. Weekly zone rollup view
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

-- 8. Triggers
CREATE OR REPLACE FUNCTION public.trg_recompute_readiness_from_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_readiness(COALESCE(NEW.athlete_id, OLD.athlete_id), COALESCE(NEW.checkin_date, OLD.checkin_date));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_readiness_from_external()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_readiness(COALESCE(NEW.athlete_id, OLD.athlete_id), COALESCE(NEW.load_date, OLD.load_date));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_readiness_from_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_readiness(COALESCE(NEW.athlete_id, OLD.athlete_id), COALESCE(NEW.session_date, OLD.session_date));
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.recompute_session_zones(NEW.id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_rep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid; ath uuid; sdate date;
BEGIN
  SELECT s.id, s.athlete_id, s.session_date INTO sid, ath, sdate
    FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
    WHERE st.id = COALESCE(NEW.step_id, OLD.step_id);
  IF sid IS NOT NULL THEN
    PERFORM public.recompute_session_zones(sid);
    PERFORM public.recompute_readiness(ath, sdate);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS readiness_on_checkin ON public.daily_checkins;
CREATE TRIGGER readiness_on_checkin AFTER INSERT OR UPDATE OR DELETE ON public.daily_checkins
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_readiness_from_checkin();

DROP TRIGGER IF EXISTS readiness_on_external ON public.external_load;
CREATE TRIGGER readiness_on_external AFTER INSERT OR UPDATE OR DELETE ON public.external_load
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_readiness_from_external();

DROP TRIGGER IF EXISTS readiness_on_session ON public.sessions;
CREATE TRIGGER readiness_on_session AFTER INSERT OR UPDATE OR DELETE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_readiness_from_session();

DROP TRIGGER IF EXISTS zones_on_rep ON public.interval_results;
CREATE TRIGGER zones_on_rep AFTER INSERT OR UPDATE OR DELETE ON public.interval_results
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_zones_from_rep();

-- 9. pg_cron nightly recompute
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('nightly-readiness-recompute');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'nightly-readiness-recompute',
  '0 2 * * *',
  $$ SELECT public.recompute_readiness_all(CURRENT_DATE); SELECT public.recompute_readiness_all(CURRENT_DATE - 1); $$
);
