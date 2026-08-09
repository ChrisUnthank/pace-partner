-- ============================================================================
-- Migration tracking catch-up — Batch 13: core recompute engines
-- ============================================================================
--
-- PURE CAPTURE. Every function body below is reproduced verbatim from
-- pg_get_functiondef on 9 Aug 2026. Zero behavioural change. These are the
-- highest-value functions closed out in this whole catch-up effort — PBs,
-- session intent, fitness seeding, and FIT-import date correction all run
-- through these.
--
-- REAL FINDING, NOT A BUG — worth knowing: compute_continuous_fatigue's own
-- comment states "same scoring as the existing client-side version," i.e.
-- there is a parallel client-side implementation of this exact HR/pace
-- drift formula somewhere in the app. Same "two copies, keep them in sync
-- manually" pattern already seen elsewhere this session (the 30-day parent
-- invite expiry in Batch 6). Not verified against the client copy here —
-- just flagging that the duplication exists.
--
-- DEPENDENCY NOTE: compute_continuous_fatigue is the actual function behind
-- session_fatigue.efficiency_score with method='continuous_drift' — the
-- exact value get_athlete_biomechanics_trend's Overall Economy Score reads
-- via its `drift` CTE, confirmed back in the Biomechanics pass. This closes
-- that loop.
--
-- STILL OPEN, VERIFIED SEPARATELY: recompute_readiness and
-- compute_session_fatigue (the interval-session counterpart referenced by
-- name in compute_continuous_fatigue's own comment) DO have committed
-- migrations already, unlike everything else in this batch — so they're
-- deliberately NOT included here. Given how often "tracked" turned out to
-- mean "stale" elsewhere this session, their live bodies were pulled and
-- compared separately rather than assumed current on the strength of a
-- migration file existing.
--
-- SAFE TO RE-RUN.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.apply_starting_fitness(_athlete_id uuid, _seed_ctl numeric, _seed_atl numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  earliest_date date;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'Not authorized for this athlete';
  END IF;

  UPDATE public.athletes
  SET seed_ctl = _seed_ctl, seed_atl = _seed_atl, seed_set_at = now()
  WHERE id = _athlete_id;

  SELECT MIN(load_date) INTO earliest_date
    FROM public.athlete_load_daily WHERE athlete_id = _athlete_id;

  -- Brand-new athlete with no tracked days yet: nothing to recompute now —
  -- the seed just sits ready and applies naturally the first time a real
  -- session/checkin triggers a recompute for them.
  IF earliest_date IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.recompute_readiness_range(_athlete_id, earliest_date, CURRENT_DATE);
END $function$;


CREATE OR REPLACE FUNCTION public.compute_continuous_fatigue(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ath          uuid;
  struct       text;
  first_step   uuid;
  pt_count     int;
  max_elapsed  numeric;
  mid          numeric;
  hr1 numeric; hr2 numeric;
  p1  numeric; p2  numeric;
  hr_drift   numeric;
  pace_drift numeric;
  score smallint;
BEGIN
  SELECT athlete_id, structure INTO ath, struct
    FROM public.sessions WHERE id = _session_id;
  IF ath IS NULL THEN RETURN; END IF;

  -- Only continuous sessions use this method — interval sessions are
  -- handled by compute_session_fatigue() instead.
  IF struct IS DISTINCT FROM 'continuous' THEN
    DELETE FROM public.session_fatigue
     WHERE session_id = _session_id AND method = 'continuous_drift';
    RETURN;
  END IF;

  SELECT id INTO first_step
    FROM public.steps
   WHERE session_id = _session_id
   ORDER BY step_order
   LIMIT 1;
  IF first_step IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), MAX(elapsed_s) INTO pt_count, max_elapsed
    FROM public.raw_session_points
   WHERE session_id = _session_id;

  IF pt_count IS NULL OR pt_count < 60 THEN RETURN; END IF;

  mid := max_elapsed / 2.0;

  SELECT AVG(hr), AVG(pace_sec_per_km) INTO hr1, p1
    FROM public.raw_session_points
   WHERE session_id = _session_id AND elapsed_s <= mid;

  SELECT AVG(hr), AVG(pace_sec_per_km) INTO hr2, p2
    FROM public.raw_session_points
   WHERE session_id = _session_id AND elapsed_s > mid;

  IF hr1 IS NULL OR hr2 IS NULL OR p1 IS NULL OR p2 IS NULL OR p1 = 0 THEN
    RETURN;
  END IF;

  hr_drift   := hr2 - hr1;
  pace_drift := ((p2 - p1) / p1) * 100;

  -- Same scoring as the existing client-side version: 100 = no drift,
  -- +1bpm HR drift = -1pt, +1% pace decay = -3pt.
  score := GREATEST(0, LEAST(100, ROUND(100 - hr_drift - pace_drift * 3)))::smallint;

  DELETE FROM public.session_fatigue
   WHERE session_id = _session_id AND method = 'continuous_drift';

  INSERT INTO public.session_fatigue(
    session_id, step_id, athlete_id, rep_count, method,
    pace_drift_pct, hr_drift_bpm, efficiency_score, duration_seconds, computed_at
  ) VALUES (
    _session_id, first_step, ath, pt_count, 'continuous_drift',
    pace_drift, hr_drift, score, max_elapsed, now()
  );
END $function$;


CREATE OR REPLACE FUNCTION public.recompute_athlete_pbs(_athlete_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  WITH perf AS (
    SELECT
      p.id,
      p.distance_m,
      p.race_type,
      p.time_seconds,
      p.course_name,
      p.excluded_from_pb,
      EXTRACT(YEAR FROM p.performance_date)::int AS perf_year,
      -- Which of the athlete's defined seasons (if any) this result
      -- falls inside. On overlapping seasons, the most recently-created
      -- definition wins — an edge case worth knowing about, not
      -- expected to matter for sensibly-set-up seasons.
      (
        SELECT s.id
        FROM public.athlete_seasons s
        WHERE s.athlete_id = _athlete_id
          AND p.performance_date BETWEEN s.start_date AND s.end_date
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS season_id
    FROM public.performances p
    WHERE p.athlete_id = _athlete_id
  ),
  ranked AS (
    SELECT
      id,
      -- All-time PB: fastest among non-excluded rows for this distance + race_type.
      (
        NOT excluded_from_pb AND time_seconds IS NOT NULL
        AND time_seconds = MIN(time_seconds) FILTER (WHERE NOT excluded_from_pb AND time_seconds IS NOT NULL)
            OVER (PARTITION BY distance_m, race_type)
      ) AS should_be_pb,
      -- Year best: fastest among non-excluded rows for this distance + race_type + calendar year.
      (
        NOT excluded_from_pb AND time_seconds IS NOT NULL
        AND time_seconds = MIN(time_seconds) FILTER (WHERE NOT excluded_from_pb AND time_seconds IS NOT NULL)
            OVER (PARTITION BY distance_m, race_type, perf_year)
      ) AS should_be_year_best,
      -- Season best: fastest among non-excluded rows for this distance + race_type
      -- + season window — only applies when the result actually falls inside
      -- one of the athlete's defined seasons at all.
      (
        season_id IS NOT NULL AND NOT excluded_from_pb AND time_seconds IS NOT NULL
        AND time_seconds = MIN(time_seconds) FILTER (WHERE NOT excluded_from_pb AND time_seconds IS NOT NULL)
            OVER (PARTITION BY distance_m, race_type, season_id)
      ) AS should_be_season_best,
      -- Course best: fastest among ALL rows sharing the same course_name —
      -- deliberately ignores excluded_from_pb. That flag only opts a
      -- result out of the distance-based PB family; course comparisons
      -- are the whole reason excluded_from_pb exists (an odd XC distance
      -- can still be this course's best time).
      (
        course_name IS NOT NULL AND time_seconds IS NOT NULL
        AND time_seconds = MIN(time_seconds) FILTER (WHERE time_seconds IS NOT NULL)
            OVER (PARTITION BY course_name)
      ) AS should_be_course_best
    FROM perf
  )
  UPDATE public.performances p
  SET
    is_pb = ranked.should_be_pb,
    is_year_best = ranked.should_be_year_best,
    is_season_best = ranked.should_be_season_best,
    is_course_best = ranked.should_be_course_best
  FROM ranked
  WHERE p.id = ranked.id
    AND (
      p.is_pb IS DISTINCT FROM ranked.should_be_pb
      OR p.is_year_best IS DISTINCT FROM ranked.should_be_year_best
      OR p.is_season_best IS DISTINCT FROM ranked.should_be_season_best
      OR p.is_course_best IS DISTINCT FROM ranked.should_be_course_best
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.recompute_fit_import_session_dates(_athlete_id uuid)
RETURNS TABLE(session_id uuid, old_date date, new_date date, old_title text, new_title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_timezone text;
BEGIN
  SELECT COALESCE(NULLIF(a.timezone, ''), 'UTC') INTO v_timezone
    FROM public.athletes a WHERE a.id = _athlete_id;

  IF v_timezone IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH anchors AS (
    -- The earliest attached file's start time is the true session start —
    -- matches how a multi-file session (Warm Up + Work + Cool Down) was
    -- originally anchored at upload time.
    SELECT sf.session_id AS sid, MIN(sf.started_at::timestamptz) AS anchor_at
      FROM public.session_files sf
      JOIN public.sessions s ON s.id = sf.session_id
     WHERE s.athlete_id = _athlete_id
       AND s.source = 'fit_import'
       AND sf.started_at IS NOT NULL
     GROUP BY sf.session_id
  ),
  computed AS (
    SELECT
      s.id AS sid,
      s.session_date AS old_date,
      (a.anchor_at AT TIME ZONE v_timezone)::date AS new_date,
      s.title AS old_title,
      -- Case/whitespace-tolerant: matches "Morning session", "morning  session",
      -- "  Evening Session " etc. Anything that doesn't look like an
      -- auto-generated title at all (a genuine custom name) is left alone.
      CASE
        WHEN trim(s.title) ~* '^(morning|afternoon|evening)\s+session$'
          THEN CASE
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 11 THEN 'Morning session'
            WHEN EXTRACT(HOUR FROM (a.anchor_at AT TIME ZONE v_timezone))::int < 16 THEN 'Afternoon session'
            ELSE 'Evening session'
          END
        ELSE s.title
      END AS new_title
    FROM anchors a
    JOIN public.sessions s ON s.id = a.sid
  ),
  updated AS (
    UPDATE public.sessions s
       SET session_date = c.new_date,
           title = c.new_title,
           updated_at = now()
      FROM computed c
     WHERE s.id = c.sid
       AND (s.session_date IS DISTINCT FROM c.new_date OR s.title IS DISTINCT FROM c.new_title)
    RETURNING s.id, c.old_date, c.new_date, c.old_title, c.new_title
  )
  SELECT u.id, u.old_date, u.new_date, u.old_title, u.new_title
  FROM updated u;
END;
$function$;


CREATE OR REPLACE FUNCTION public.recompute_fit_import_session_dates_for_all_corrected_athletes()
RETURNS TABLE(athlete_id uuid, athlete_name text, sessions_touched bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_count bigint;
BEGIN
  FOR r IN SELECT id, name FROM public.athletes WHERE timezone IS NOT NULL AND timezone <> 'UTC' LOOP
    SELECT count(*) INTO v_count FROM public.recompute_fit_import_session_dates(r.id);
    athlete_id := r.id;
    athlete_name := r.name;
    sessions_touched := v_count;
    RETURN NEXT;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION public.recompute_readiness_range(_athlete_id uuid, _from_date date, _to_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE d date;
BEGIN
  d := _from_date;
  WHILE d <= _to_date LOOP
    PERFORM public.recompute_readiness(_athlete_id, d);
    d := d + 1;
  END LOOP;
END $function$;


CREATE OR REPLACE FUNCTION public.recompute_readiness_range_all(_from_date date, _to_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  FOR a IN SELECT id FROM public.athletes LOOP
    PERFORM public.recompute_readiness_range(a.id, _from_date, _to_date);
  END LOOP;
END $function$;


CREATE OR REPLACE FUNCTION public.recompute_session_intent(_session_id uuid)
RETURNS TABLE(old_intent text, new_intent text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ath_id uuid;
  zp record;
  r record;
  use_hr boolean;
  rank int;
  lap_seconds numeric;
  lap_pace numeric;
  work_seconds_by_rank numeric[] := ARRAY[0,0,0,0,0,0];
  best_rank int := 0;
  best_seconds numeric := -1;
  i int;
  rank_to_intent text[] := ARRAY['easy','aerobic','tempo','threshold','vo2','anaerobic'];
  computed_intent text;
  prior_intent text;
BEGIN
  SELECT athlete_id, intent INTO ath_id, prior_intent FROM public.sessions WHERE id = _session_id;
  IF ath_id IS NULL THEN RETURN; END IF;

  SELECT * INTO zp FROM public.athlete_zone_profiles WHERE athlete_id = ath_id;
  IF zp IS NULL THEN RETURN; END IF;

  use_hr := (zp.preferred_zone_basis = 'hr');

  FOR r IN
    SELECT ir.actual_time_seconds AS secs,
           ir.actual_pace_sec_per_km AS pace_field,
           ir.actual_distance_m AS dist,
           ir.hr_avg AS hr_avg
    FROM public.interval_results ir
    JOIN public.steps st ON st.id = ir.step_id
    WHERE st.session_id = _session_id
      AND st.kind = 'work'
      AND COALESCE(ir.actual_time_seconds, 0) > 0
  LOOP
    lap_seconds := r.secs;
    rank := NULL;

    IF use_hr AND zp.hr_z1_max IS NOT NULL AND r.hr_avg IS NOT NULL THEN
      rank := CASE
        WHEN r.hr_avg <= zp.hr_z1_max THEN 1
        WHEN zp.hr_z2_max IS NOT NULL AND r.hr_avg <= zp.hr_z2_max THEN 2
        WHEN zp.hr_z3_max IS NOT NULL AND r.hr_avg <= zp.hr_z3_max THEN 3
        WHEN zp.hr_z4_max IS NOT NULL AND r.hr_avg <= zp.hr_z4_max THEN 4
        WHEN zp.hr_z5_max IS NOT NULL AND r.hr_avg <= zp.hr_z5_max THEN 5
        ELSE 6
      END;
    ELSIF NOT use_hr AND zp.pace_z1_max_sec_per_km IS NOT NULL THEN
      lap_pace := r.pace_field;
      IF lap_pace IS NULL AND r.dist IS NOT NULL AND r.dist > 0 THEN
        lap_pace := r.secs / (r.dist / 1000.0);
      END IF;
      IF lap_pace IS NOT NULL THEN
        rank := CASE
          WHEN lap_pace >= zp.pace_z1_max_sec_per_km THEN 1
          WHEN zp.pace_z2_max_sec_per_km IS NOT NULL AND lap_pace >= zp.pace_z2_max_sec_per_km THEN 2
          WHEN zp.pace_z3_max_sec_per_km IS NOT NULL AND lap_pace >= zp.pace_z3_max_sec_per_km THEN 3
          WHEN zp.pace_z4_max_sec_per_km IS NOT NULL AND lap_pace >= zp.pace_z4_max_sec_per_km THEN 4
          WHEN zp.pace_z5_max_sec_per_km IS NOT NULL AND lap_pace >= zp.pace_z5_max_sec_per_km THEN 5
          ELSE 6
        END;
      END IF;
    END IF;

    IF rank IS NOT NULL THEN
      work_seconds_by_rank[rank] := work_seconds_by_rank[rank] + lap_seconds;
    END IF;
  END LOOP;

  FOR i IN 1..6 LOOP
    IF work_seconds_by_rank[i] > best_seconds THEN
      best_seconds := work_seconds_by_rank[i];
      best_rank := i;
    END IF;
  END LOOP;

  IF best_rank = 0 THEN RETURN; END IF;

  computed_intent := rank_to_intent[best_rank];

  IF computed_intent IS DISTINCT FROM prior_intent THEN
    UPDATE public.sessions SET intent = computed_intent WHERE id = _session_id;
    old_intent := prior_intent;
    new_intent := computed_intent;
    RETURN NEXT;
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_pace_auto_method(_athlete_id uuid, _method text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;
  IF _method NOT IN ('best_effort_3k_plus', 'vdot') THEN
    RAISE EXCEPTION 'invalid pace method: %', _method;
  END IF;

  UPDATE public.athlete_zone_profiles
  SET pace_threshold_source = 'auto', pace_zones_manual = false, pace_method = _method
  WHERE athlete_id = _athlete_id;

  PERFORM public.recompute_athlete_zone_profile(_athlete_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.trg_athlete_seasons_recompute_pb()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_athlete_pbs(OLD.athlete_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_athlete_pbs(NEW.athlete_id);
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.trg_performances_recompute_pb()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_athlete_pbs(OLD.athlete_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_athlete_pbs(NEW.athlete_id);

  IF TG_OP = 'UPDATE' AND OLD.athlete_id IS DISTINCT FROM NEW.athlete_id THEN
    PERFORM public.recompute_athlete_pbs(OLD.athlete_id);
  END IF;

  RETURN NEW;
END;
$function$;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- REMAINING UNTRACKED FUNCTIONS after this batch: notify_plan_delivery,
-- submit_coach_inquiry, toggle_coach_athlete_visibility,
-- purge_account_activity_log, athlete_profiles_set_updated_at,
-- coach_blog_posts_set_updated_at, get_athlete_fitness_history,
-- get_athlete_records, get_athlete_speed_economy_curve,
-- trg_notify_niggle_reported, trg_notify_session_comment,
-- ai_consume_quota, athlete_profiles_set_updated_at.
-- ============================================================================
