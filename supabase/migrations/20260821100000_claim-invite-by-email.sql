-- ============================================================================
-- SIGNUP DUPLICATE — claiming an invite without the token.
--
-- WHAT HAPPENS TODAY
--
-- A coach creates an athlete record with the real details (dob, sex, height,
-- primary event) and no user_id, then sends an invite. If the athlete opens
-- the /claim/{token} link, claim_athlete_invite() links the two correctly and
-- everything is fine.
--
-- If they instead go to the sign-up page and register with the invited email
-- — which is the obvious thing to do when you have been told to join — both
-- sign-up paths run this check:
--
--     SELECT id FROM athletes WHERE user_id = <new user id>
--     if not found: INSERT a new athlete
--
-- A coach-created athlete has user_id NULL until it is claimed, so that
-- lookup can never match it. A second athlete record is created every time.
-- It is not a race or a double-click; the logic guarantees it.
--
-- Meanwhile athlete_invites holds the email tying the two together, and
-- nothing in the sign-up path reads it.
--
-- Poppy Nivarovich: coach record 01:01, invite 01:32, sign-up 01:35 creating
-- the duplicate. The invite still reads accepted_at NULL today, because the
-- claim page it was waiting for was never opened.
--
--
-- WHY EMAIL MATCHING IS SAFE HERE
--
-- claim_athlete_invite(_token) already refuses unless the signed-in user's
-- email matches the invited email — the token alone was never sufficient. So
-- matching on the verified email is the same test with one less factor, and
-- the factor being dropped is the one the athlete does not have to hand when
-- they sign up normally.
--
-- The account must still exist and be signed in, which means whoever is
-- calling this controls that mailbox.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_athlete_invite_by_email()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  inv record;
  already uuid;
  expiry_days int := 30;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Already linked to an athlete: nothing to claim, and nothing to create.
  SELECT id INTO already FROM public.athletes WHERE user_id = uid LIMIT 1;
  IF already IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'athlete_id', already, 'claimed', false);
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  IF uemail IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_email');
  END IF;

  -- Most recent usable invite for this address. Ordered newest-first because
  -- a coach who re-invited after a typo leaves the older row behind, and the
  -- later one is the one they meant.
  SELECT * INTO inv
    FROM public.athlete_invites
   WHERE lower(email) = lower(uemail)
     AND accepted_at IS NULL
     AND created_at >= (now() - (expiry_days || ' days')::interval)
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    -- No invite. The caller should create a fresh athlete record as before —
    -- self-signup with no coach behind it is a legitimate path.
    RETURN jsonb_build_object('ok', true, 'athlete_id', NULL, 'claimed', false);
  END IF;

  -- Only if that record is still unclaimed. If a different user got there
  -- first this does nothing, and the caller falls through to creating their
  -- own record rather than hijacking someone else's.
  UPDATE public.athletes
     SET user_id = uid, updated_at = now()
   WHERE id = inv.athlete_id
     AND (user_id IS NULL OR user_id = uid);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'athlete_id', NULL, 'claimed', false,
                              'note', 'invite target already linked to another account');
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'athlete')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.coach_athletes (coach_user_id, athlete_id)
  VALUES (inv.coach_user_id, inv.athlete_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.athlete_invites SET accepted_at = now() WHERE id = inv.id;

  RETURN jsonb_build_object('ok', true, 'athlete_id', inv.athlete_id, 'claimed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_athlete_invite_by_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_athlete_invite_by_email() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND proname LIKE 'claim_athlete%';
-- Expect both claim_athlete_invite and claim_athlete_invite_by_email.
--
-- Pending invites that would now be picked up automatically:
-- SELECT i.email, a.name, i.created_at
--   FROM public.athlete_invites i JOIN public.athletes a ON a.id = i.athlete_id
--  WHERE i.accepted_at IS NULL ORDER BY i.created_at DESC;
