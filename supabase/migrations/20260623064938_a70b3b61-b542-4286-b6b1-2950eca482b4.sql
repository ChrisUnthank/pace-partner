CREATE OR REPLACE FUNCTION public.request_athlete_join_by_email(
  _email text,
  _athlete_name text DEFAULT NULL,
  _message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  target_uid uuid;
  ath_id uuid;
  req_id uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT public.has_role(uid, 'coach') AND NOT public.has_role(uid, 'manager') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_coach');
  END IF;

  SELECT id INTO target_uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF target_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_account');
  END IF;

  -- Reuse linked athlete row if it already exists
  SELECT id INTO ath_id FROM public.athletes WHERE user_id = target_uid LIMIT 1;
  IF ath_id IS NULL THEN
    INSERT INTO public.athletes (name, user_id, created_by)
    VALUES (COALESCE(_athlete_name, _email), target_uid, uid)
    RETURNING id INTO ath_id;
  END IF;

  -- If already linked to this coach, nothing to do
  IF EXISTS (SELECT 1 FROM public.coach_athletes
              WHERE coach_user_id = uid AND athlete_id = ath_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_linked', true, 'athlete_id', ath_id);
  END IF;

  INSERT INTO public.athlete_join_requests
    (coach_user_id, athlete_id, target_user_id, message, status)
  VALUES (uid, ath_id, target_uid, _message, 'pending')
  ON CONFLICT (coach_user_id, athlete_id, target_user_id)
    WHERE status = 'pending'
  DO UPDATE SET message = EXCLUDED.message
  RETURNING id INTO req_id;

  RETURN jsonb_build_object('ok', true, 'request_id', req_id, 'athlete_id', ath_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_athlete_join_by_email(text, text, text) TO authenticated;