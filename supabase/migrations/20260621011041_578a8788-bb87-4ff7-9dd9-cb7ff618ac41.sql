
-- Public read function for the claim page (returns only safe fields)
CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token text)
RETURNS TABLE (
  status text,
  athlete_name text,
  invited_email text,
  coach_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  expiry_days int := 30;
BEGIN
  SELECT i.email, i.accepted_at, i.created_at, i.athlete_id, i.coach_user_id
    INTO inv
    FROM public.athlete_invites i
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
$$;

REVOKE ALL ON FUNCTION public.get_invite_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;

-- Authenticated claim function: links the signed-in user to the invited athlete
CREATE OR REPLACE FUNCTION public.claim_athlete_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO inv FROM public.athlete_invites WHERE token = _token LIMIT 1;
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

  -- Link athlete to the user (only if not already linked to someone else)
  UPDATE public.athletes
     SET user_id = uid, updated_at = now()
   WHERE id = inv.athlete_id
     AND (user_id IS NULL OR user_id = uid);

  -- Ensure athlete role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'athlete')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Ensure coach link exists
  INSERT INTO public.coach_athletes (coach_user_id, athlete_id)
  VALUES (inv.coach_user_id, inv.athlete_id)
  ON CONFLICT DO NOTHING;

  -- Mark accepted
  UPDATE public.athlete_invites
     SET accepted_at = now()
   WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'athlete_id', inv.athlete_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_athlete_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_athlete_invite(text) TO authenticated;
