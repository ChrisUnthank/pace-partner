
ALTER TYPE public.step_kind ADD VALUE IF NOT EXISTS 'strides';

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS set_count smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recovery_between_reps_seconds integer,
  ADD COLUMN IF NOT EXISTS recovery_between_reps_mode text,
  ADD COLUMN IF NOT EXISTS recovery_between_sets_seconds integer,
  ADD COLUMN IF NOT EXISTS recovery_between_sets_mode text,
  ADD COLUMN IF NOT EXISTS counts_toward_distance boolean NOT NULL DEFAULT true;

ALTER TABLE public.interval_results
  ADD COLUMN IF NOT EXISTS set_number smallint NOT NULL DEFAULT 1;

ALTER TABLE public.interval_results
  DROP CONSTRAINT IF EXISTS interval_results_step_id_rep_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS interval_results_step_set_rep_uniq
  ON public.interval_results(step_id, set_number, rep_number);

-- compute_session_fatigue: order by (set, rep)
CREATE OR REPLACE FUNCTION public.compute_session_fatigue(_session_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ath uuid; st record; rep_rows jsonb; n int; method_v text;
  split_a int; split_b_start int; early jsonb; late jsonb;
  pace_a numeric; pace_b numeric; hr_a numeric; hr_b numeric;
  cad_a numeric; cad_b numeric; str_a numeric; str_b numeric;
  pace_drift numeric; hr_drift numeric; cad_drift numeric; str_drift numeric;
  total_w numeric; penalty numeric; eff smallint; dur numeric;
BEGIN
  SELECT athlete_id INTO ath FROM public.sessions WHERE id = _session_id;
  IF ath IS NULL THEN RETURN; END IF;
  DELETE FROM public.session_fatigue WHERE session_id = _session_id;

  FOR st IN
    SELECT s.id, s.kind, s.is_ladder FROM public.steps s
     WHERE s.session_id = _session_id AND s.kind = 'work'
  LOOP
    SELECT COUNT(*), COALESCE(SUM(actual_time_seconds), 0),
           jsonb_agg(jsonb_build_object(
             'set', set_number, 'rep', rep_number,
             'pace', actual_pace_sec_per_km, 'hr', hr_avg,
             'cad', cadence, 'stride', stride_length_cm,
             'time', actual_time_seconds
           ) ORDER BY set_number, rep_number)
      INTO n, dur, rep_rows
      FROM public.interval_results
     WHERE step_id = st.id AND COALESCE(actual_time_seconds, 0) > 0;

    IF n IS NULL OR n < 3 THEN CONTINUE; END IF;

    IF n >= 6 THEN method_v := 'thirds'; split_a := GREATEST(1, n / 3); split_b_start := n - split_a + 1;
    ELSIF n >= 4 THEN method_v := 'halves'; split_a := n / 2; split_b_start := n - split_a + 1;
    ELSE method_v := 'first_last'; split_a := 1; split_b_start := n;
    END IF;

    early := (SELECT jsonb_agg(e) FROM jsonb_array_elements(rep_rows) WITH ORDINALITY t(e, ord) WHERE ord <= split_a);
    late  := (SELECT jsonb_agg(e) FROM jsonb_array_elements(rep_rows) WITH ORDINALITY t(e, ord) WHERE ord >= split_b_start);

    SELECT AVG((e->>'pace')::numeric), AVG((e->>'hr')::numeric),
           AVG((e->>'cad')::numeric), AVG((e->>'stride')::numeric)
      INTO pace_a, hr_a, cad_a, str_a FROM jsonb_array_elements(early) e;
    SELECT AVG((e->>'pace')::numeric), AVG((e->>'hr')::numeric),
           AVG((e->>'cad')::numeric), AVG((e->>'stride')::numeric)
      INTO pace_b, hr_b, cad_b, str_b FROM jsonb_array_elements(late) e;

    IF pace_a IS NOT NULL AND pace_b IS NOT NULL AND pace_a > 0 THEN pace_drift := ROUND((pace_b - pace_a) / pace_a * 100, 2); ELSE pace_drift := NULL; END IF;
    IF hr_a IS NOT NULL AND hr_b IS NOT NULL THEN hr_drift := ROUND(hr_b - hr_a, 1); ELSE hr_drift := NULL; END IF;
    IF cad_a IS NOT NULL AND cad_b IS NOT NULL AND cad_a > 0 THEN cad_drift := ROUND((cad_a - cad_b) / cad_a * 100, 2); ELSE cad_drift := NULL; END IF;
    IF str_a IS NOT NULL AND str_b IS NOT NULL AND str_a > 0 THEN str_drift := ROUND((str_a - str_b) / str_a * 100, 2); ELSE str_drift := NULL; END IF;

    IF st.is_ladder THEN eff := NULL;
    ELSE
      total_w := 0; penalty := 0;
      IF pace_drift IS NOT NULL THEN penalty := penalty + 0.40 * GREATEST(0, pace_drift) * 4; total_w := total_w + 0.40; END IF;
      IF hr_drift IS NOT NULL THEN penalty := penalty + 0.25 * GREATEST(0, hr_drift) * 2; total_w := total_w + 0.25; END IF;
      IF str_drift IS NOT NULL THEN penalty := penalty + 0.20 * GREATEST(0, str_drift) * 3; total_w := total_w + 0.20; END IF;
      IF cad_drift IS NOT NULL THEN penalty := penalty + 0.15 * GREATEST(0, cad_drift) * 3; total_w := total_w + 0.15; END IF;
      IF total_w > 0 THEN penalty := penalty / total_w; eff := GREATEST(0, LEAST(100, ROUND(100 - penalty)))::smallint;
      ELSE eff := NULL; END IF;
    END IF;

    INSERT INTO public.session_fatigue(
      session_id, step_id, athlete_id, rep_count, method,
      pace_drift_pct, hr_drift_bpm, cadence_drift_pct, stride_drift_pct,
      efficiency_score, duration_seconds, computed_at
    ) VALUES (_session_id, st.id, ath, n, method_v, pace_drift, hr_drift, cad_drift, str_drift, eff, dur, now());
  END LOOP;
END $function$;

-- recompute_session_zones: skip steps with counts_toward_distance = false
CREATE OR REPLACE FUNCTION public.recompute_session_zones(_session_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ath_id uuid; zp record; r record; pace_v numeric;
  zone_key public.pace_zone; hr_zone text;
BEGIN
  SELECT athlete_id INTO ath_id FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;
  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;
  DELETE FROM public.session_zone_time WHERE session_id = _session_id;
  IF zp IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT ir.actual_time_seconds AS secs, ir.actual_pace_sec_per_km AS pace_field,
           ir.actual_distance_m AS dist, ir.hr_avg AS hr_avg, st.kind AS kind
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id = _session_id
      AND COALESCE(ir.actual_time_seconds, 0) > 0
      AND COALESCE(st.counts_toward_distance, true) = true
  LOOP
    IF zp.pace_5k_sec_per_km IS NOT NULL THEN
      IF r.kind = 'recovery' THEN zone_key := 'recovery';
      ELSE
        pace_v := r.pace_field;
        IF pace_v IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN pace_v := r.secs / (r.dist / 1000.0); END IF;
        IF pace_v IS NOT NULL THEN
          zone_key := CASE
            WHEN zp.pace_easy_sec_per_km IS NOT NULL AND pace_v >= zp.pace_easy_sec_per_km THEN 'easy'
            WHEN zp.pace_threshold_sec_per_km IS NOT NULL AND pace_v >= zp.pace_threshold_sec_per_km THEN 'steady'
            WHEN zp.pace_5k_sec_per_km IS NOT NULL AND pace_v >= zp.pace_5k_sec_per_km THEN 'threshold'
            WHEN zp.pace_1500_sec_per_km IS NOT NULL AND pace_v >= zp.pace_1500_sec_per_km THEN 'vo2'
            WHEN zp.pace_rep_sec_per_km IS NOT NULL AND pace_v >= zp.pace_rep_sec_per_km THEN 'rep'
            ELSE 'sprint' END;
          INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
          VALUES (_session_id, ath_id, zone_key, r.secs, 'pace')
          ON CONFLICT (session_id, zone, source) DO UPDATE
            SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds, updated_at = now();
        END IF;
      END IF;
    END IF;

    IF r.hr_avg IS NOT NULL AND zp.hr_z1_max IS NOT NULL THEN
      hr_zone := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 'easy'
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 'steady'
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 'threshold'
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 'vo2'
        ELSE 'rep' END;
      INSERT INTO public.session_zone_time(session_id, athlete_id, zone, seconds, source)
      VALUES (_session_id, ath_id, hr_zone::public.pace_zone, r.secs, 'hr')
      ON CONFLICT (session_id, zone, source) DO UPDATE
        SET seconds = public.session_zone_time.seconds + EXCLUDED.seconds, updated_at = now();
    END IF;
  END LOOP;
END $function$;

-- Weekly distance view
CREATE OR REPLACE VIEW public.athlete_weekly_distance AS
SELECT
  s.athlete_id,
  date_trunc('week', s.session_date)::date AS week_start,
  SUM(
    COALESCE(
      ir.actual_distance_m,
      CASE WHEN st.target_kind = 'distance' AND st.target_distance_m IS NOT NULL
           THEN st.target_distance_m ELSE 0 END
    )
  )::numeric AS distance_m
FROM public.sessions s
JOIN public.steps st ON st.session_id = s.id
LEFT JOIN public.interval_results ir ON ir.step_id = st.id
WHERE COALESCE(st.counts_toward_distance, true) = true
GROUP BY s.athlete_id, date_trunc('week', s.session_date);

ALTER VIEW public.athlete_weekly_distance SET (security_invoker = true);
GRANT SELECT ON public.athlete_weekly_distance TO authenticated;
