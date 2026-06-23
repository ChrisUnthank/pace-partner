
-- A. Rep-level results extensions
ALTER TABLE public.interval_results
  ADD COLUMN IF NOT EXISTS stride_length_cm numeric,
  ADD COLUMN IF NOT EXISTS rep_trace jsonb,
  ADD COLUMN IF NOT EXISTS effort smallint;

CREATE UNIQUE INDEX IF NOT EXISTS interval_results_step_rep_uniq
  ON public.interval_results(step_id, rep_number);

-- B. Within-session fatigue
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS is_ladder boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.session_fatigue (
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.steps(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  rep_count int NOT NULL,
  method text NOT NULL,
  pace_drift_pct numeric,
  hr_drift_bpm numeric,
  cadence_drift_pct numeric,
  stride_drift_pct numeric,
  efficiency_score smallint,
  duration_seconds numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, step_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_fatigue TO authenticated;
GRANT ALL ON public.session_fatigue TO service_role;
ALTER TABLE public.session_fatigue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fatigue_access" ON public.session_fatigue FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

CREATE OR REPLACE FUNCTION public.compute_session_fatigue(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ath uuid;
  st record;
  rep_rows jsonb;
  n int;
  method_v text;
  split_a int; split_b_start int;
  early jsonb; late jsonb;
  pace_a numeric; pace_b numeric;
  hr_a numeric; hr_b numeric;
  cad_a numeric; cad_b numeric;
  str_a numeric; str_b numeric;
  pace_drift numeric; hr_drift numeric; cad_drift numeric; str_drift numeric;
  weights jsonb;
  total_w numeric; penalty numeric;
  eff smallint;
  dur numeric;
BEGIN
  SELECT athlete_id INTO ath FROM public.sessions WHERE id = _session_id;
  IF ath IS NULL THEN RETURN; END IF;

  -- clear stale rows for this session
  DELETE FROM public.session_fatigue WHERE session_id = _session_id;

  FOR st IN
    SELECT s.id, s.kind, s.is_ladder, s.target_pace_sec_per_km
      FROM public.steps s
     WHERE s.session_id = _session_id
       AND s.kind = 'work'
  LOOP
    -- gather rep results
    SELECT COUNT(*),
           COALESCE(SUM(actual_time_seconds), 0),
           jsonb_agg(jsonb_build_object(
             'rep', rep_number,
             'pace', actual_pace_sec_per_km,
             'hr', hr_avg,
             'cad', cadence,
             'stride', stride_length_cm,
             'time', actual_time_seconds
           ) ORDER BY rep_number)
      INTO n, dur, rep_rows
      FROM public.interval_results
     WHERE step_id = st.id
       AND COALESCE(actual_time_seconds, 0) > 0;

    IF n IS NULL OR n < 3 THEN CONTINUE; END IF;

    -- choose split
    IF n >= 6 THEN
      method_v := 'thirds';
      split_a := GREATEST(1, n / 3);
      split_b_start := n - split_a + 1;
    ELSIF n >= 4 THEN
      method_v := 'halves';
      split_a := n / 2;
      split_b_start := n - split_a + 1;
    ELSE
      method_v := 'first_last';
      split_a := 1;
      split_b_start := n;
    END IF;

    early := (SELECT jsonb_agg(e) FROM jsonb_array_elements(rep_rows) WITH ORDINALITY t(e, ord) WHERE ord <= split_a);
    late  := (SELECT jsonb_agg(e) FROM jsonb_array_elements(rep_rows) WITH ORDINALITY t(e, ord) WHERE ord >= split_b_start);

    SELECT AVG((e->>'pace')::numeric), AVG((e->>'hr')::numeric),
           AVG((e->>'cad')::numeric), AVG((e->>'stride')::numeric)
      INTO pace_a, hr_a, cad_a, str_a
      FROM jsonb_array_elements(early) e;
    SELECT AVG((e->>'pace')::numeric), AVG((e->>'hr')::numeric),
           AVG((e->>'cad')::numeric), AVG((e->>'stride')::numeric)
      INTO pace_b, hr_b, cad_b, str_b
      FROM jsonb_array_elements(late) e;

    -- drifts
    IF pace_a IS NOT NULL AND pace_b IS NOT NULL AND pace_a > 0 THEN
      pace_drift := ROUND((pace_b - pace_a) / pace_a * 100, 2);
    ELSE pace_drift := NULL; END IF;

    IF hr_a IS NOT NULL AND hr_b IS NOT NULL THEN
      hr_drift := ROUND(hr_b - hr_a, 1);
    ELSE hr_drift := NULL; END IF;

    IF cad_a IS NOT NULL AND cad_b IS NOT NULL AND cad_a > 0 THEN
      cad_drift := ROUND((cad_a - cad_b) / cad_a * 100, 2); -- drop in cadence = fatigue
    ELSE cad_drift := NULL; END IF;

    IF str_a IS NOT NULL AND str_b IS NOT NULL AND str_a > 0 THEN
      str_drift := ROUND((str_a - str_b) / str_a * 100, 2); -- drop in stride = fatigue
    ELSE str_drift := NULL; END IF;

    -- efficiency: only compute if not a ladder; otherwise leave NULL
    IF st.is_ladder THEN
      eff := NULL;
    ELSE
      -- weighted penalty using only available metrics
      total_w := 0; penalty := 0;
      IF pace_drift IS NOT NULL THEN
        penalty := penalty + 0.40 * GREATEST(0, pace_drift) * 4; -- 1% drift = 4pt
        total_w := total_w + 0.40;
      END IF;
      IF hr_drift IS NOT NULL THEN
        penalty := penalty + 0.25 * GREATEST(0, hr_drift) * 2; -- 1bpm = 2pt
        total_w := total_w + 0.25;
      END IF;
      IF str_drift IS NOT NULL THEN
        penalty := penalty + 0.20 * GREATEST(0, str_drift) * 3;
        total_w := total_w + 0.20;
      END IF;
      IF cad_drift IS NOT NULL THEN
        penalty := penalty + 0.15 * GREATEST(0, cad_drift) * 3;
        total_w := total_w + 0.15;
      END IF;
      IF total_w > 0 THEN
        penalty := penalty / total_w; -- renormalise
        eff := GREATEST(0, LEAST(100, ROUND(100 - penalty)))::smallint;
      ELSE eff := NULL; END IF;
    END IF;

    INSERT INTO public.session_fatigue(
      session_id, step_id, athlete_id, rep_count, method,
      pace_drift_pct, hr_drift_bpm, cadence_drift_pct, stride_drift_pct,
      efficiency_score, duration_seconds, computed_at
    ) VALUES (
      _session_id, st.id, ath, n, method_v,
      pace_drift, hr_drift, cad_drift, str_drift,
      eff, dur, now()
    );
  END LOOP;
END $$;

-- Extend existing trigger function for rep changes to also recompute fatigue
CREATE OR REPLACE FUNCTION public.trg_recompute_zones_from_rep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid uuid; ath uuid; sdate date;
BEGIN
  SELECT s.id, s.athlete_id, s.session_date INTO sid, ath, sdate
    FROM public.steps st JOIN public.sessions s ON s.id = st.session_id
    WHERE st.id = COALESCE(NEW.step_id, OLD.step_id);
  IF sid IS NOT NULL THEN
    PERFORM public.recompute_session_zones(sid);
    PERFORM public.compute_session_fatigue(sid);
    PERFORM public.recompute_readiness(ath, sdate);
  END IF;
  RETURN NULL;
END $$;

-- C. HR-zone time: extend recompute_session_zones
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
  zone_key public.pace_zone;
  hr_zone text;
BEGIN
  SELECT athlete_id INTO ath_id FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;

  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;

  DELETE FROM public.session_zone_time WHERE session_id = _session_id;

  IF zp IS NULL THEN RETURN; END IF;

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
  LOOP
    -- pace zones
    IF zp.pace_5k_sec_per_km IS NOT NULL THEN
      IF r.kind = 'recovery' THEN
        zone_key := 'recovery';
      ELSE
        pace_v := r.pace_field;
        IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
          pace_v := r.secs / (r.dist / 1000.0);
        END IF;
        IF pace_v IS NOT NULL THEN
          zone_key := CASE
            WHEN zp.pace_easy_sec_per_km IS NOT NULL AND pace_v >= zp.pace_easy_sec_per_km THEN 'easy'
            WHEN zp.pace_threshold_sec_per_km IS NOT NULL AND pace_v >= zp.pace_threshold_sec_per_km THEN 'steady'
            WHEN zp.pace_5k_sec_per_km IS NOT NULL AND pace_v >= zp.pace_5k_sec_per_km THEN 'threshold'
            WHEN zp.pace_1500_sec_per_km IS NOT NULL AND pace_v >= zp.pace_1500_sec_per_km THEN 'vo2'
            WHEN zp.pace_rep_sec_per_km IS NOT NULL AND pace_v >= zp.pace_rep_sec_per_km THEN 'rep'
            ELSE 'sprint'
          END;
          INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
          VALUES (_session_id, ath_id, zone_key, r.secs, 'pace')
          ON CONFLICT (session_id, zone, source) DO UPDATE
            SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
                updated_at = now();
        END IF;
      END IF;
    END IF;

    -- HR zones
    IF r.hr_avg IS NOT NULL AND zp.hr_z1_max IS NOT NULL THEN
      hr_zone := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 'easy'
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 'steady'
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 'threshold'
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 'vo2'
        ELSE 'rep'
      END;
      INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
      VALUES (_session_id, ath_id, hr_zone::public.pace_zone, r.secs, 'hr')
      ON CONFLICT (session_id, zone, source) DO UPDATE
        SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds,
            updated_at = now();
    END IF;
  END LOOP;
END $$;

-- D. Physiological profile
CREATE TABLE IF NOT EXISTS public.athlete_physio_profile (
  athlete_id uuid PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  aerobic_pct numeric,
  anaerobic_pct numeric,
  speed_reserve_pct numeric,
  speed_reserve_bucket text,
  archetype text,
  coaching_note text,
  inputs jsonb,
  status text NOT NULL DEFAULT 'ok',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_physio_profile TO authenticated;
GRANT ALL ON public.athlete_physio_profile TO service_role;
ALTER TABLE public.athlete_physio_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "physio_access" ON public.athlete_physio_profile FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

CREATE OR REPLACE FUNCTION public.recompute_physio_profile(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ath record;
  age_years numeric;
  best_for record;
  pb_1500 numeric; pb_5000 numeric; pb_3000 numeric; pb_800 numeric; pb_10k numeric;
  pb_200 numeric; pb_400 numeric;
  pace_1500 numeric; pace_5000 numeric;
  ratio_r numeric; raw_an numeric;
  age_shift numeric := 0; ta_shift numeric := 0;
  net_shift numeric;
  aerobic numeric; anaerobic numeric;
  sr numeric; sr_bucket text;
  axis text; archetype_v text; note_v text;
  inputs_v jsonb;
  status_v text := 'ok';
BEGIN
  SELECT * INTO ath FROM public.athletes WHERE id = _athlete_id;
  IF ath IS NULL THEN RETURN; END IF;

  IF ath.dob IS NOT NULL THEN
    age_years := EXTRACT(EPOCH FROM age(ath.dob)) / (365.25 * 86400);
  END IF;

  -- Pull bests
  SELECT MIN(time_seconds) INTO pb_200 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 200;
  SELECT MIN(time_seconds) INTO pb_400 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 400;
  SELECT MIN(time_seconds) INTO pb_800 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 800;
  SELECT MIN(time_seconds) INTO pb_1500 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 1500;
  SELECT MIN(time_seconds) INTO pb_3000 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 3000;
  SELECT MIN(time_seconds) INTO pb_5000 FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 5000;
  SELECT MIN(time_seconds) INTO pb_10k  FROM public.performances WHERE athlete_id = _athlete_id AND distance_m = 10000;

  -- Choose pair: prefer 1500/5000, then 800/3000, then 800/5000, then 1500/10k
  IF pb_1500 IS NOT NULL AND pb_5000 IS NOT NULL THEN
    pace_1500 := pb_1500 / 1.5; pace_5000 := pb_5000 / 5.0;
    ratio_r := pace_5000 / pace_1500; -- pace_5000 slower so ratio > 1
  ELSIF pb_800 IS NOT NULL AND pb_3000 IS NOT NULL THEN
    pace_1500 := pb_800 / 0.8; pace_5000 := pb_3000 / 3.0;
    ratio_r := pace_5000 / pace_1500;
  ELSIF pb_800 IS NOT NULL AND pb_5000 IS NOT NULL THEN
    pace_1500 := pb_800 / 0.8; pace_5000 := pb_5000 / 5.0;
    ratio_r := pace_5000 / pace_1500;
  ELSIF pb_1500 IS NOT NULL AND pb_10k IS NOT NULL THEN
    pace_1500 := pb_1500 / 1.5; pace_5000 := pb_10k / 10.0;
    ratio_r := pace_5000 / pace_1500;
  ELSE
    status_v := 'insufficient_pbs';
  END IF;

  IF status_v = 'ok' THEN
    -- Map ratio 1.06..1.22 -> 0..100 anaerobic
    raw_an := GREATEST(0, LEAST(100, (ratio_r - 1.06) / (1.22 - 1.06) * 100));

    -- Age shift
    IF age_years IS NOT NULL THEN
      age_shift := CASE
        WHEN age_years <= 14 THEN 6
        WHEN age_years < 18 THEN 3
        WHEN age_years < 23 THEN 0
        WHEN age_years < 35 THEN -2
        WHEN age_years < 50 THEN -4
        ELSE -6
      END;
    END IF;

    -- Training age shift
    IF ath.training_age_years IS NOT NULL THEN
      ta_shift := CASE
        WHEN ath.training_age_years < 1 THEN 5
        WHEN ath.training_age_years < 3 THEN 2
        WHEN ath.training_age_years <= 5 THEN 0
        WHEN ath.training_age_years <= 10 THEN -2
        ELSE -4
      END;
    END IF;

    net_shift := GREATEST(-8, LEAST(8, age_shift + ta_shift));
    anaerobic := ROUND(GREATEST(0, LEAST(100, raw_an + net_shift)), 1);
    aerobic := ROUND(100 - anaerobic, 1);
  END IF;

  -- Speed reserve
  IF pb_200 IS NOT NULL AND pb_800 IS NOT NULL THEN
    sr := ROUND(((pb_800 / 0.8) - (pb_200 / 0.2)) / (pb_800 / 0.8) * 100, 1);
  ELSIF pb_400 IS NOT NULL AND pb_800 IS NOT NULL THEN
    sr := ROUND(((pb_800 / 0.8) - (pb_400 / 0.4)) / (pb_800 / 0.8) * 100, 1);
  END IF;

  IF sr IS NOT NULL THEN
    sr_bucket := CASE
      WHEN sr < 18 THEN 'Low'
      WHEN sr <= 28 THEN 'Moderate'
      ELSE 'High'
    END;
  END IF;

  IF status_v = 'ok' THEN
    axis := CASE
      WHEN aerobic >= 65 THEN 'Aerobic Engine'
      WHEN aerobic >= 45 THEN 'Balanced'
      ELSE 'Speed-Dominant'
    END;
    archetype_v := axis || COALESCE(', ' || sr_bucket || ' Speed Reserve', '');
    note_v := CASE axis
      WHEN 'Aerobic Engine' THEN 'Strength is sustained pace. Build race sharpness with VO2 and rep work in the final 6-8 weeks; race tactic favours an honest pace from the front.'
      WHEN 'Balanced' THEN 'Responds well to mixed stimulus. Alternate threshold/VO2 weeks and protect a weekly speed touch; race tactic flexible.'
      ELSE 'Strength is top-end speed. Anchor weekly aerobic volume and one threshold session; race tactic favours sit-and-kick.'
    END;
    IF sr_bucket = 'High' THEN
      note_v := note_v || ' High speed reserve means a finishing kick is a weapon — preserve it in training and races.';
    ELSIF sr_bucket = 'Low' THEN
      note_v := note_v || ' Low speed reserve — add weekly short hill sprints or strides to lift top-end without heavy anaerobic cost.';
    END IF;
  ELSE
    note_v := 'Log PBs at two or more distances (ideally 1500m and 5000m) to generate a physiological profile.';
  END IF;

  inputs_v := jsonb_build_object(
    'pb_200', pb_200, 'pb_400', pb_400, 'pb_800', pb_800,
    'pb_1500', pb_1500, 'pb_3000', pb_3000, 'pb_5000', pb_5000, 'pb_10k', pb_10k,
    'age_years', age_years, 'training_age_years', ath.training_age_years,
    'ratio_r', ratio_r, 'age_shift', age_shift, 'ta_shift', ta_shift
  );

  INSERT INTO public.athlete_physio_profile(
    athlete_id, aerobic_pct, anaerobic_pct, speed_reserve_pct, speed_reserve_bucket,
    archetype, coaching_note, inputs, status, updated_at
  ) VALUES (
    _athlete_id, aerobic, anaerobic, sr, sr_bucket, archetype_v, note_v, inputs_v, status_v, now()
  )
  ON CONFLICT (athlete_id) DO UPDATE SET
    aerobic_pct = EXCLUDED.aerobic_pct,
    anaerobic_pct = EXCLUDED.anaerobic_pct,
    speed_reserve_pct = EXCLUDED.speed_reserve_pct,
    speed_reserve_bucket = EXCLUDED.speed_reserve_bucket,
    archetype = EXCLUDED.archetype,
    coaching_note = EXCLUDED.coaching_note,
    inputs = EXCLUDED.inputs,
    status = EXCLUDED.status,
    updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_physio_from_perf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_physio_profile(COALESCE(NEW.athlete_id, OLD.athlete_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS perf_recompute_physio ON public.performances;
CREATE TRIGGER perf_recompute_physio
AFTER INSERT OR UPDATE OR DELETE ON public.performances
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_physio_from_perf();

-- E. Fueling
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS fueling_notes text;

CREATE TABLE IF NOT EXISTS public.session_fuel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.steps(id) ON DELETE SET NULL,
  rep_number int,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_fuel_events TO authenticated;
GRANT ALL ON public.session_fuel_events TO service_role;
ALTER TABLE public.session_fuel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fuel_events_access" ON public.session_fuel_events FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));
