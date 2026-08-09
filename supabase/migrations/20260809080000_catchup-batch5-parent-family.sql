-- ============================================================================
-- Migration tracking catch-up — Batch 5: Parent/Family Accounts
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 5 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- SHAPE OF THIS FEATURE: a coach invites a parent via parent_invites
-- (email + random token, generated server-side via gen_random_bytes — not
-- a client-guessable value). Acceptance creates a parent_athlete_links row
-- (the actual granted relationship) and a parent_consent_records row
-- (a timestamped, versioned consent-text acceptance — kept even if the
-- link is later revoked, as a compliance record). family_contact_sharing
-- and athlete_credentials are smaller, independent per-athlete tables —
-- opt-in contact details and club/federation registration info
-- respectively.
--
-- OBSERVATION, NOT A FIX (pure capture only): family_contact_sharing's
-- "opted-in rows readable by other squad parents" policy is scoped only to
-- `share_contact = true` — the name implies squad-mate scoping, but the
-- actual condition doesn't check that the reader is in the same squad at
-- all. Reproduced exactly as live; flagging for awareness, not correcting
-- it here.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. parent_invites ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parent_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id     uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  email          text NOT NULL,
  token          text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parent_invites_token_key UNIQUE (token)
);

ALTER TABLE public.parent_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach manages own parent invites" ON public.parent_invites;
CREATE POLICY "coach manages own parent invites" ON public.parent_invites
  FOR ALL USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());

DROP POLICY IF EXISTS "invitee reads parent invite by email" ON public.parent_invites;
CREATE POLICY "invitee reads parent invite by email" ON public.parent_invites
  FOR SELECT USING (
    email = (SELECT users.email FROM auth.users WHERE users.id = auth.uid())::text
  );


-- ── 2. parent_athlete_links ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parent_athlete_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id            uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  invited_by_coach_id   uuid NOT NULL REFERENCES auth.users(id),
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parent_athlete_links_parent_user_id_athlete_id_key UNIQUE (parent_user_id, athlete_id)
);

DO $$ BEGIN
  ALTER TABLE public.parent_athlete_links
    ADD CONSTRAINT parent_athlete_links_status_check
      CHECK (status = ANY (ARRAY['pending','active','revoked']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.parent_athlete_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent sees own links" ON public.parent_athlete_links;
CREATE POLICY "parent sees own links" ON public.parent_athlete_links
  FOR SELECT USING (parent_user_id = auth.uid() OR public.is_coach_of(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "coach revokes parent links for their athletes" ON public.parent_athlete_links;
CREATE POLICY "coach revokes parent links for their athletes" ON public.parent_athlete_links
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id));


-- ── 3. parent_consent_records ────────────────────────────────────────────────
-- No FK from invite_token back to parent_invites.token — reproduced exactly
-- as found (a plain text column, not constrained). Kept as a standing
-- compliance record independent of whether the originating invite/link is
-- later revoked or deleted.
CREATE TABLE IF NOT EXISTS public.parent_consent_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_token           text NOT NULL,
  parent_user_id         uuid NOT NULL,
  consent_text_version   text NOT NULL,
  accepted_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parent_consent_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own consent records" ON public.parent_consent_records;
CREATE POLICY "Users can view their own consent records" ON public.parent_consent_records
  FOR SELECT USING (auth.uid() = parent_user_id);

DROP POLICY IF EXISTS "Users can record their own consent" ON public.parent_consent_records;
CREATE POLICY "Users can record their own consent" ON public.parent_consent_records
  FOR INSERT WITH CHECK (auth.uid() = parent_user_id);


-- ── 4. family_contact_sharing ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_contact_sharing (
  athlete_id      uuid PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  share_contact   boolean NOT NULL DEFAULT false,
  phone           text,
  email           text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_contact_sharing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family manages own sharing row" ON public.family_contact_sharing;
CREATE POLICY "family manages own sharing row" ON public.family_contact_sharing
  FOR ALL
  USING (
    public.is_parent_of(auth.uid(), athlete_id)
    OR public.is_coach_of(auth.uid(), athlete_id)
    OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = family_contact_sharing.athlete_id AND a.user_id = auth.uid())
  )
  WITH CHECK (
    public.is_parent_of(auth.uid(), athlete_id)
    OR public.is_coach_of(auth.uid(), athlete_id)
    OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = family_contact_sharing.athlete_id AND a.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "opted-in rows readable by other squad parents" ON public.family_contact_sharing;
CREATE POLICY "opted-in rows readable by other squad parents" ON public.family_contact_sharing
  FOR SELECT USING (share_contact = true);


-- ── 5. athlete_credentials ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_credentials (
  athlete_id            uuid PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  club_name             text,
  membership_number     text,
  federation_id         text,
  registration_status   text,
  registration_expiry   date,
  notes                 text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_credentials
    ADD CONSTRAINT athlete_credentials_registration_status_check
      CHECK (registration_status IS NULL OR registration_status = ANY (ARRAY['active','expired','pending']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credentials access via athlete" ON public.athlete_credentials;
CREATE POLICY "credentials access via athlete" ON public.athlete_credentials
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- FUNCTIONS in this same feature area were already found untracked in the
-- original audit — not yet captured, still need their own functions batch:
--   claim_parent_invite, create_parent_invite, get_parent_invite_by_token,
--   is_parent_of, leave_parent_role, is_athlete_self
-- (is_parent_of and is_athlete_self are both called by the policies above —
-- captured correctly as references, but their own bodies are still open.)
-- ============================================================================
