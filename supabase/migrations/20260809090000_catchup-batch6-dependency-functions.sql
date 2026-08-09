-- ============================================================================
-- Migration tracking catch-up — Batch 6: dependency functions
-- ============================================================================
--
-- PURE CAPTURE. Every function body below is reproduced verbatim from
-- pg_get_functiondef on 9 Aug 2026. Zero behavioural change. This closes
-- out every "still open" dependency flagged in Batches 3 (race calendar
-- access helpers) and 5 (parent/family account functions).
--
-- ORDERING: the three simple SQL boolean helpers first (is_athlete_self,
-- is_parent_of, owns_race_calendar), since can_access_race_calendar calls
-- owns_race_calendar internally — then the composite/action functions.
--
-- OBSERVATIONS (not fixes — pure capture):
--   - has_race_event_access depends on performances.race_event_access, a
--     column not otherwise touched anywhere in this catch-up effort so
--     far — noting the dependency exists, not verifying it further here.
--   - The 30-day parent-invite expiry window is hardcoded independently in
--     BOTH claim_parent_invite and get_parent_invite_by_token (each has
--     its own `expiry_days int := 30`), not defined once centrally.
--     Consistent today; would need updating in two places if it ever
--     changes.
--   - claim_parent_invite already has its own good defensive comment about
--     avoiding ON CONFLICT since the unique constraint on
--     parent_athlete_links wasn't confirmed at the time it was written —
--     Batch 5 confirms that constraint DOES exist
--     (parent_athlete_links_parent_user_id_athlete_id_key), so the
--     explicit existence-check here is now provably unnecessary, just not
--     harmful. Not changed here since this migration is pure capture.
--
-- SAFE TO RE-RUN.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.is_athlete_self(_user_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = _athlete_id AND a.user_id = _user_id)
$function$;


CREATE OR REPLACE FUNCTION public.is_parent_of(_user_id uuid, _athlete_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_athlete_links
    WHERE parent_user_id = _user_id AND athlete_id = _athlete_id AND status = 'active'
  )
$function$;


CREATE OR REPLACE FUNCTION public.owns_race_calendar(_user_id uuid, _calendar_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.race_calendars c WHERE c.id = _calendar_id AND c.created_by = _user_id)
$function$;


CREATE OR REPLACE FUNCTION public.can_access_race_calendar(_user_id uuid, _calendar_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.owns_race_calendar(_user_id, _calendar_id)
  OR EXISTS (
    SELECT 1 FROM public.race_calendar_groups cg
    JOIN public.training_group_members m ON m.group_id = cg.training_group_id
    JOIN public.athletes a ON a.id = m.athlete_id
    WHERE cg.calendar_id = _calendar_id AND (a.user_id = _user_id OR a.created_by = _user_id)
  )
$function$;


CREATE OR REPLACE FUNCTION public.has_race_event_access(_user_id uuid, _race_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.performances p
    JOIN public.athletes a ON a.id = p.athlete_id
    WHERE p.race_event_id = _race_event_id
      AND p.race_event_access = true
      AND (a.user_id = _user_id OR a.created_by = _user_id)
  )
$function$;


CREATE OR REPLACE FUNCTION public.create_parent_invite(_athlete_id uuid, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_own_athlete boolean;
  linked_coach_user_id uuid;
  new_token text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF _email IS NULL OR trim(_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_required');
  END IF;

  -- Authorized to invite a parent for this athlete if the caller IS this
  -- athlete, or coaches this athlete. Nothing else qualifies.
  SELECT EXISTS (
    SELECT 1 FROM public.athletes a WHERE a.id = _athlete_id AND a.user_id = uid
  ) INTO is_own_athlete;

  SELECT ca.coach_user_id INTO linked_coach_user_id
    FROM public.coach_athletes ca
   WHERE ca.athlete_id = _athlete_id AND ca.coach_user_id = uid
   LIMIT 1;

  IF NOT is_own_athlete AND linked_coach_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- coach_user_id on the row itself: the coach's own uid when a coach is
  -- the one sending it; when the athlete sends it themselves, their
  -- linked coach if they have one (informational — the claim page shows
  -- "X invited you" — an athlete-sent invite just won't show a name),
  -- otherwise NULL.
  IF linked_coach_user_id IS NOT NULL THEN
    -- Caller is the coach.
    NULL; -- linked_coach_user_id already holds the right value
  ELSIF is_own_athlete THEN
    SELECT ca.coach_user_id INTO linked_coach_user_id
      FROM public.coach_athletes ca
     WHERE ca.athlete_id = _athlete_id
     LIMIT 1;
  END IF;

  INSERT INTO public.parent_invites (athlete_id, email, coach_user_id)
  VALUES (_athlete_id, trim(_email), linked_coach_user_id)
  RETURNING token INTO new_token;

  RETURN jsonb_build_object('ok', true, 'token', new_token);
END;
$function$;


CREATE OR REPLACE FUNCTION public.claim_parent_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  inv record;
  expiry_days int := 30;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  SELECT * INTO inv FROM public.parent_invites WHERE token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claimed');
  END IF;
  IF inv.created_at < (now() - (expiry_days || ' days')::interval) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF lower(uemail) <> lower(inv.email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch', 'invited_email', inv.email);
  END IF;

  -- Link this athlete to the parent's account — additively. A parent
  -- claiming a second, third, etc. invite (possibly from a different
  -- coach, for a different child) just adds another row here; nothing
  -- about an existing link is touched or replaced. Checked explicitly
  -- rather than relying on ON CONFLICT, since this migration can't
  -- confirm a unique constraint exists on (parent_user_id, athlete_id)
  -- without seeing the table's original definition.
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_athlete_links
     WHERE parent_user_id = uid AND athlete_id = inv.athlete_id
  ) THEN
    INSERT INTO public.parent_athlete_links (parent_user_id, athlete_id, status)
    VALUES (uid, inv.athlete_id, 'active');
  ELSE
    UPDATE public.parent_athlete_links
       SET status = 'active'
     WHERE parent_user_id = uid AND athlete_id = inv.athlete_id;
  END IF;

  -- Ensure parent role — additive alongside any existing athlete/coach/
  -- manager roles this account already has, same ON CONFLICT pattern the
  -- athlete claim function already uses.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'parent')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Mark accepted
  UPDATE public.parent_invites
     SET accepted_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'athlete_id', inv.athlete_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_parent_invite_by_token(_token text)
RETURNS TABLE(status text, athlete_name text, invited_email text, coach_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inv record;
  expiry_days int := 30;
BEGIN
  SELECT i.email, i.accepted_at, i.created_at, i.athlete_id, i.coach_user_id
    INTO inv
    FROM public.parent_invites i
   WHERE i.token = _token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF inv.accepted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF inv.created_at < (now() - (expiry_days || ' days')::interval) THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'valid'::text,
         (SELECT a.name FROM public.athletes a WHERE a.id = inv.athlete_id),
         inv.email,
         (SELECT p.full_name FROM public.profiles p WHERE p.id = inv.coach_user_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.leave_parent_role()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.parent_athlete_links
    SET status = 'revoked'
    WHERE parent_user_id = uid AND status = 'active';

  DELETE FROM public.user_roles WHERE user_id = uid AND role = 'parent';

  RETURN jsonb_build_object('ok', true);
END;
$function$;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- This closes every dependency flagged in Batches 3 and 5. Remaining
-- untracked functions from the original audit (unrelated to any table
-- batch so far): apply_starting_fitness, compute_continuous_fatigue,
-- recompute_athlete_pbs, recompute_session_intent,
-- recompute_readiness_range(_all), recompute_fit_import_session_dates(_for_all...),
-- set_pace_auto_method, trg_performances_recompute_pb,
-- trg_athlete_seasons_recompute_pb, submit_coach_inquiry,
-- toggle_coach_athlete_visibility, notify_plan_delivery,
-- trg_notify_niggle_reported, trg_notify_session_comment,
-- purge_account_activity_log, athlete_profiles_set_updated_at,
-- coach_blog_posts_set_updated_at, get_athlete_speed_economy_curve.
-- ============================================================================
