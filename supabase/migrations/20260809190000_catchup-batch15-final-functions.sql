-- ============================================================================
-- Migration tracking catch-up — Batch 15 (FINAL): remaining functions
-- ============================================================================
--
-- PURE CAPTURE. Every function body below is reproduced verbatim from
-- pg_get_functiondef on 9 Aug 2026. Zero behavioural change. This closes
-- out the LAST of the 35 functions flagged in the original tracking audit
-- — combined with Batches 6, 13, and 14, every function AND every table
-- from that audit is now captured.
--
-- CONFIRMS AN EARLIER HYPOTHESIS: submit_coach_inquiry is exactly the
-- SECURITY DEFINER function suspected back in Batch 11 as the reason
-- coach_inquiries has no client-facing INSERT policy — it handles the
-- insert (and the coach notification) server-side. Not a gap, by design.
--
-- OBSERVATION, NOT A FIX — get_athlete_records' "Best efficiency score"
-- pulls from session_fatigue.efficiency_score across BOTH scoring methods
-- at once (continuous_drift from compute_continuous_fatigue, and the
-- interval method from compute_session_fatigue), ranking them together as
-- one "best ever" without distinguishing which produced which number. This
-- is the same comparability tension the score_basis tag was built to
-- address in the Biomechanics interval-scoring work — just present here in
-- a different feature that has no equivalent tag. Reproduced exactly as
-- live; not fixed in this pure-capture migration.
--
-- SAFE TO RE-RUN.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.ai_consume_quota(_user_id uuid, _limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE current_count int;
BEGIN
  INSERT INTO public.ai_usage_daily(user_id, used_date, call_count)
  VALUES (_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, used_date)
    DO UPDATE SET call_count = public.ai_usage_daily.call_count + 1
  RETURNING call_count INTO current_count;
  RETURN current_count <= _limit;
END $function$;


CREATE OR REPLACE FUNCTION public.athlete_profiles_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.coach_blog_posts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_athlete_fitness_history(_athlete_id uuid, _recent_weeks integer DEFAULT 8)
RETURNS TABLE(granularity text, period_start date, duration_seconds numeric, distance_m numeric, tss numeric, ctl_end numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cutoff date;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;

  cutoff := date_trunc('week', now()::date)::date - ((_recent_weeks - 1) * 7);

  RETURN QUERY
  WITH sess AS (
    SELECT s.session_date,
           COALESCE(s.total_moving_time_seconds, s.total_time_seconds) AS duration_s,
           s.total_distance_m
    FROM public.sessions s
    WHERE s.athlete_id = _athlete_id AND s.completed_at IS NOT NULL
  ),
  load AS (
    SELECT ald.load_date, ald.training_load
    FROM public.athlete_load_daily ald
    WHERE ald.athlete_id = _athlete_id
  ),
  ctl_daily AS (
    SELECT ald.load_date, ald.ctl
    FROM public.athlete_load_daily ald
    WHERE ald.athlete_id = _athlete_id AND ald.ctl IS NOT NULL
  ),
  weekly AS (
    SELECT date_trunc('week', sess.session_date)::date AS wk_start,
           SUM(sess.duration_s) AS duration_seconds,
           SUM(sess.total_distance_m) AS distance_m
    FROM sess
    WHERE sess.session_date >= cutoff
    GROUP BY 1
  ),
  weekly_load AS (
    SELECT date_trunc('week', load.load_date)::date AS wk_start, SUM(load.training_load) AS tss
    FROM load
    WHERE load.load_date >= cutoff
    GROUP BY 1
  ),
  weekly_ctl AS (
    SELECT DISTINCT ON (date_trunc('week', cd.load_date))
           date_trunc('week', cd.load_date)::date AS wk_start,
           cd.ctl AS ctl_end
    FROM ctl_daily cd
    WHERE cd.load_date >= cutoff
    ORDER BY date_trunc('week', cd.load_date), cd.load_date DESC
  ),
  monthly AS (
    SELECT date_trunc('month', sess.session_date)::date AS mo_start,
           SUM(sess.duration_s) AS duration_seconds,
           SUM(sess.total_distance_m) AS distance_m
    FROM sess
    WHERE sess.session_date < cutoff
    GROUP BY 1
  ),
  monthly_load AS (
    SELECT date_trunc('month', load.load_date)::date AS mo_start, SUM(load.training_load) AS tss
    FROM load
    WHERE load.load_date < cutoff
    GROUP BY 1
  ),
  monthly_ctl AS (
    SELECT DISTINCT ON (date_trunc('month', cd.load_date))
           date_trunc('month', cd.load_date)::date AS mo_start,
           cd.ctl AS ctl_end
    FROM ctl_daily cd
    WHERE cd.load_date < cutoff
    ORDER BY date_trunc('month', cd.load_date), cd.load_date DESC
  )
  (SELECT 'week', w.wk_start, w.duration_seconds, w.distance_m, wl.tss, wc.ctl_end
   FROM weekly w
   LEFT JOIN weekly_load wl ON wl.wk_start = w.wk_start
   LEFT JOIN weekly_ctl wc ON wc.wk_start = w.wk_start)

  UNION ALL

  (SELECT 'month', m.mo_start, m.duration_seconds, m.distance_m, ml.tss, mc.ctl_end
   FROM monthly m
   LEFT JOIN monthly_load ml ON ml.mo_start = m.mo_start
   LEFT JOIN monthly_ctl mc ON mc.mo_start = m.mo_start)

  ORDER BY 2 DESC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_athlete_records(_athlete_id uuid)
RETURNS TABLE(record_key text, label text, value numeric, unit text, session_id uuid, session_date date, session_title text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;

  RETURN QUERY
  WITH run_sessions AS (
    SELECT s.*, COALESCE(s.total_moving_time_seconds, s.total_time_seconds) AS moving_time_s
    FROM public.sessions s
    WHERE s.athlete_id = _athlete_id
      AND s.completed_at IS NOT NULL
      AND s.day_type <> 'cross_training'
      AND (s.activity_type IS NULL OR s.activity_type IN ('run', 'track'))
  ),
  cross_sessions AS (
    SELECT s.*, COALESCE(s.total_moving_time_seconds, s.total_time_seconds) AS moving_time_s
    FROM public.sessions s
    WHERE s.athlete_id = _athlete_id
      AND s.completed_at IS NOT NULL
      AND s.day_type = 'cross_training'
  ),
  weekly_run AS (
    SELECT date_trunc('week', rs.session_date)::date AS week_start, SUM(rs.total_distance_m) AS total_m
    FROM run_sessions rs
    WHERE rs.total_distance_m IS NOT NULL
    GROUP BY 1
  ),
  weekly_cross AS (
    SELECT date_trunc('week', cs.session_date)::date AS week_start, SUM(cs.moving_time_s) AS total_s
    FROM cross_sessions cs
    WHERE cs.moving_time_s IS NOT NULL
    GROUP BY 1
  )

  (SELECT 'longest_run', 'Longest run', rs.total_distance_m, 'm', rs.id, rs.session_date, rs.title
   FROM run_sessions rs
   WHERE rs.total_distance_m IS NOT NULL
   ORDER BY rs.total_distance_m DESC LIMIT 1)

  UNION ALL

  (SELECT 'highest_weekly_volume', 'Highest weekly volume', wr.total_m, 'm', NULL::uuid, wr.week_start, NULL::text
   FROM weekly_run wr
   ORDER BY wr.total_m DESC LIMIT 1)

  UNION ALL

  (SELECT 'fastest_threshold', 'Fastest threshold session', rs.work_avg_pace_sec_per_km, 'sec_per_km', rs.id, rs.session_date, rs.title
   FROM run_sessions rs
   WHERE rs.intent = 'threshold' AND rs.work_avg_pace_sec_per_km IS NOT NULL
   ORDER BY rs.work_avg_pace_sec_per_km ASC LIMIT 1)

  UNION ALL

  (SELECT 'longest_interval', 'Longest interval session', rs.work_distance_m, 'm', rs.id, rs.session_date, rs.title
   FROM run_sessions rs
   WHERE rs.structure = 'reps_intervals' AND rs.work_distance_m IS NOT NULL
   ORDER BY rs.work_distance_m DESC LIMIT 1)

  UNION ALL

  (SELECT 'highest_cadence', 'Highest cadence', rs.work_avg_cadence, 'spm', rs.id, rs.session_date, rs.title
   FROM run_sessions rs
   WHERE rs.work_avg_cadence IS NOT NULL
   ORDER BY rs.work_avg_cadence DESC LIMIT 1)

  UNION ALL

  -- See header note — mixes continuous_drift and interval-method scores
  -- into one ranking without distinguishing them.
  (SELECT 'best_efficiency', 'Best efficiency score', sf.efficiency_score, 'score', sf.session_id, s.session_date, s.title
   FROM public.session_fatigue sf
   JOIN public.sessions s ON s.id = sf.session_id
   WHERE sf.athlete_id = _athlete_id AND sf.efficiency_score IS NOT NULL
   ORDER BY sf.efficiency_score DESC LIMIT 1)

  UNION ALL

  (SELECT 'best_tempo', 'Best tempo session', rs.work_avg_pace_sec_per_km, 'sec_per_km', rs.id, rs.session_date, rs.title
   FROM run_sessions rs
   WHERE rs.intent = 'tempo' AND rs.work_avg_pace_sec_per_km IS NOT NULL
   ORDER BY rs.work_avg_pace_sec_per_km ASC LIMIT 1)

  UNION ALL

  (SELECT 'longest_ride', 'Longest ride', cs.total_distance_m, 'm', cs.id, cs.session_date, cs.title
   FROM cross_sessions cs
   WHERE cs.activity_type = 'ride' AND cs.total_distance_m IS NOT NULL
   ORDER BY cs.total_distance_m DESC LIMIT 1)

  UNION ALL

  (SELECT 'longest_swim', 'Longest swim', cs.moving_time_s, 'sec', cs.id, cs.session_date, cs.title
   FROM cross_sessions cs
   WHERE cs.activity_type = 'swim' AND cs.moving_time_s IS NOT NULL
   ORDER BY cs.moving_time_s DESC LIMIT 1)

  UNION ALL

  (SELECT 'longest_gym', 'Longest gym session', cs.moving_time_s, 'sec', cs.id, cs.session_date, cs.title
   FROM cross_sessions cs
   WHERE cs.activity_type = 'gym' AND cs.moving_time_s IS NOT NULL
   ORDER BY cs.moving_time_s DESC LIMIT 1)

  UNION ALL

  (SELECT 'highest_weekly_cross_volume', 'Highest weekly cross-training volume', wc.total_s, 'sec', NULL::uuid, wc.week_start, NULL::text
   FROM weekly_cross wc
   ORDER BY wc.total_s DESC LIMIT 1);
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_athlete_speed_economy_curve(_athlete_id uuid, _limit integer DEFAULT 200, _zone text DEFAULT NULL::text)
RETURNS TABLE(pace_bucket_center_sec_per_km numeric, avg_biomechanical_score numeric, session_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_z1 numeric;
  v_z2 numeric;
  v_z3 numeric;
  v_z4 numeric;
  v_z5 numeric;
BEGIN
  IF NOT public.can_access_athlete(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'not authorized for this athlete';
  END IF;

  IF _zone IS NOT NULL AND _zone NOT IN ('z1', 'z2', 'z3', 'z4', 'z5', 'z6') THEN
    RAISE EXCEPTION 'invalid zone: %', _zone;
  END IF;

  SELECT azp.pace_z1_max_sec_per_km, azp.pace_z2_max_sec_per_km, azp.pace_z3_max_sec_per_km,
         azp.pace_z4_max_sec_per_km, azp.pace_z5_max_sec_per_km
    INTO v_z1, v_z2, v_z3, v_z4, v_z5
    FROM public.athlete_zone_profiles azp
    WHERE azp.athlete_id = _athlete_id;

  RETURN QUERY
  WITH scored AS (
    SELECT
      bt.biomechanical_score AS sc_score,
      s.work_avg_pace_sec_per_km AS sc_pace,
      CASE
        WHEN v_z1 IS NULL THEN NULL
        WHEN s.work_avg_pace_sec_per_km >= v_z1 THEN 'z1'
        WHEN v_z2 IS NOT NULL AND s.work_avg_pace_sec_per_km >= v_z2 THEN 'z2'
        WHEN v_z3 IS NOT NULL AND s.work_avg_pace_sec_per_km >= v_z3 THEN 'z3'
        WHEN v_z4 IS NOT NULL AND s.work_avg_pace_sec_per_km >= v_z4 THEN 'z4'
        WHEN v_z5 IS NOT NULL AND s.work_avg_pace_sec_per_km >= v_z5 THEN 'z5'
        ELSE 'z6'
      END AS sc_zone
    FROM public.get_athlete_biomechanics_trend(_athlete_id, _limit, NULL) bt
    JOIN public.sessions s ON s.id = bt.session_id
    WHERE bt.biomechanical_score IS NOT NULL
      AND s.work_avg_pace_sec_per_km IS NOT NULL
      AND s.work_avg_pace_sec_per_km > 0
  ),
  filtered AS (
    SELECT sc.sc_score, sc.sc_pace
    FROM scored sc
    WHERE _zone IS NULL OR sc.sc_zone = _zone
  ),
  bucketed AS (
    SELECT
      ROUND(f.sc_pace / 15) * 15 AS bk_center,
      f.sc_score AS bk_score
    FROM filtered f
  )
  SELECT
    bk.bk_center,
    ROUND(AVG(bk.bk_score), 1),
    COUNT(*)::int
  FROM bucketed bk
  GROUP BY bk.bk_center
  HAVING COUNT(*) >= 2
  ORDER BY bk.bk_center DESC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.notify_plan_delivery(_athlete_id uuid, _title text, _body text, _link text, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_uid uuid;
BEGIN
  IF NOT public.is_coach_of(auth.uid(), _athlete_id) THEN
    RAISE EXCEPTION 'Not authorized to notify this athlete';
  END IF;

  SELECT user_id INTO target_uid FROM public.athletes WHERE id = _athlete_id;
  IF target_uid IS NULL THEN
    RETURN; -- no app login on file — nothing to notify, not an error
  END IF;

  INSERT INTO public.notifications(user_id, kind, title, body, link, data)
  VALUES (target_uid, 'plan_delivered', _title, _body, _link, COALESCE(_data, '{}'::jsonb));
END;
$function$;


CREATE OR REPLACE FUNCTION public.purge_account_activity_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.account_activity_log WHERE created_at < now() - interval '4 months';
END $function$;


CREATE OR REPLACE FUNCTION public.submit_coach_inquiry(p_slug text, p_name text, p_email text, p_discipline text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_coach_user_id uuid;
begin
  select coach_user_id into v_coach_user_id
  from coach_profiles
  where slug = p_slug;

  if v_coach_user_id is null then
    raise exception 'Coach not found';
  end if;

  insert into coach_inquiries (coach_user_id, name, email, discipline, message)
  values (v_coach_user_id, p_name, p_email, p_discipline, p_message);

  insert into notifications (user_id, kind, title, body, link)
  values (
    v_coach_user_id,
    'coach_inquiry',
    'New inquiry from ' || p_name,
    coalesce(p_message, 'via your coach page'),
    '/app/coach/' || p_slug
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.toggle_coach_athlete_visibility(p_coach_athlete_id uuid, p_visible boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update coach_athletes
  set visible_on_coach_page = p_visible
  where id = p_coach_athlete_id
    and coach_user_id = auth.uid();

  if not found then
    raise exception 'Not found or not permitted';
  end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.trg_notify_niggle_reported()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE coach_uid uuid; athlete_name text; sess_title text; sess_date text;
BEGIN
  IF NEW.niggles IS NOT NULL AND btrim(NEW.niggles) <> ''
     AND (TG_OP = 'INSERT' OR OLD.niggles IS DISTINCT FROM NEW.niggles) THEN
    SELECT name INTO athlete_name FROM public.athletes WHERE id = NEW.athlete_id;
    SELECT title, session_date::text INTO sess_title, sess_date FROM public.sessions WHERE id = NEW.session_id;
    FOR coach_uid IN SELECT coach_user_id FROM public.coach_athletes WHERE athlete_id = NEW.athlete_id LOOP
      INSERT INTO public.notifications(user_id, kind, title, body, link, data)
      VALUES (coach_uid, 'niggle_reported',
              COALESCE(athlete_name, 'Athlete') || ' reported a niggle',
              LEFT(NEW.niggles, 240) || ' — ' || COALESCE(sess_title, 'session') || COALESCE(' on ' || sess_date, ''),
              '/app/sessions/' || NEW.session_id::text,
              jsonb_build_object('session_id', NEW.session_id, 'athlete_id', NEW.athlete_id));
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.trg_notify_session_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE athlete_uid uuid; author_name text; coach_uid uuid;
BEGIN
  SELECT full_name INTO author_name FROM public.profiles WHERE id = NEW.author_id;
  SELECT user_id INTO athlete_uid FROM public.athletes WHERE id = NEW.athlete_id;

  IF athlete_uid IS NOT NULL AND athlete_uid = NEW.author_id THEN
    FOR coach_uid IN SELECT coach_user_id FROM public.coach_athletes WHERE athlete_id = NEW.athlete_id LOOP
      INSERT INTO public.notifications(user_id, kind, title, body, link, data)
      VALUES (coach_uid, 'session_comment',
              COALESCE(author_name, 'Athlete') || ' commented on a session',
              LEFT(NEW.body, 240),
              '/app/sessions/' || NEW.session_id::text,
              jsonb_build_object('session_id', NEW.session_id, 'comment_id', NEW.id, 'athlete_id', NEW.athlete_id));
    END LOOP;
  ELSIF athlete_uid IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, kind, title, body, link, data)
    VALUES (athlete_uid, 'session_comment',
            COALESCE(author_name, 'Your coach') || ' commented on a session',
            LEFT(NEW.body, 240),
            '/app/sessions/' || NEW.session_id::text,
            jsonb_build_object('session_id', NEW.session_id, 'comment_id', NEW.id, 'athlete_id', NEW.athlete_id));
  END IF;
  RETURN NEW;
END $function$;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- This closes the original 9 Aug 2026 tracking audit completely — all 64
-- tables (Batches 1-12) and all 35 functions (Batches 6, 13, 14, 15) are
-- now captured in GitHub. One real security fix also shipped separately
-- (20260809150000, the coach_profiles insert policy). Two real findings
-- worth remembering: the recompute_readiness EWMA fix (Batch 14) and the
-- person_contact_details unscoped coach-read policy (Batch 12, still open,
-- your call).
-- ============================================================================
