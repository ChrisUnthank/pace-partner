-- ============================================================================
-- White-label branding — Phase 1: data foundation + entitlement + resolver
-- ============================================================================
--
-- WHAT THIS IS
-- A coach on a premium plan can replace the Strider name, logo, and brand
-- colour inside the authenticated app. Per the decision recorded in Update 38:
-- an athlete is part of their coach's brand, so the branding CASCADES — when
-- that coach's athletes (and their linked parents) log in, they see the
-- coach's brand too, not Strider's.
--
-- WHY A NEW TABLE INSTEAD OF REUSING coach_profiles
-- coach_profiles is the coach's PUBLIC MARKETING PAGE config. It is readable
-- by anonymous visitors when published, its `theme`/`style`/`nav` axes mean
-- something completely different there (they drive the marketing page's own
-- scoped [data-coach-root] token system), and plenty of coaches will want an
-- in-app brand without ever building a public page. Overloading those columns
-- would mean one edit silently changing two unrelated surfaces. Separate
-- table, separate lifecycle.
--
-- HOW THE ENTITLEMENT IS ENFORCED
-- profiles.white_label_active — same lightweight boolean-flag pattern already
-- used for profiles.ai_subscription_active. Deliberately NOT a column on
-- coach_branding: the coach has write access to their own coach_branding row,
-- so an entitlement flag living there would be self-grantable. It lives on
-- profiles, which a coach can only read (never set) for the entitlement check,
-- and the check itself runs inside the SECURITY DEFINER resolver below rather
-- than in client code.
--
-- HOW BRANDING IS RESOLVED
-- public.get_effective_branding() — one SECURITY DEFINER call, returns the
-- branding the CALLING user should see, or NULL for plain Strider. It does the
-- coach-vs-athlete-vs-parent lookup server-side so the client never has to
-- read another user's row, which is why coach_branding's RLS only ever needs
-- to grant a coach access to their own row.
--
-- NOTE: this migration is reconstructed and verified against live database
-- state on 9 Aug 2026 — the original file was lost when this session's
-- workspace reset. Every table column, RLS policy, and function body below
-- was cross-checked against pg_get_functiondef / information_schema output
-- from the live database before being written here, not recalled from
-- memory alone. get_effective_branding as reproduced here reflects its
-- ORIGINAL form, before the Phase 1b colors migration added
-- secondary_color/danger_color — see 20260808020000 for that layer.
--
-- SAFE TO RE-RUN: every statement is IF NOT EXISTS / OR REPLACE / DROP-first.
-- ============================================================================


-- ── 1. Entitlement flag ─────────────────────────────────────────────────────
-- Defaults FALSE (unlike ai_subscription_active, which defaults true for
-- everyone) — this is a paid tier from day one, so nobody gets it implicitly.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS white_label_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.white_label_active IS
  'Premium entitlement: may this coach apply in-app white-label branding. Set by an admin/billing process only — never self-settable, and never checked client-side (see public.get_effective_branding).';


-- ── 2. Branding table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_branding (
  coach_user_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The coach's own on/off switch, separate from the entitlement above. Lets
  -- a coach set everything up, preview it, and flip it live when ready —
  -- rather than every keystroke immediately repainting their athletes' apps.
  enabled         boolean NOT NULL DEFAULT false,

  -- Displayed wherever "Strider" currently appears in the app chrome.
  app_name        text,
  -- Full/wide logo for the expanded sidebar. Public URL (coach-media bucket).
  logo_url        text,
  -- Square mark for the collapsed sidebar and the mobile header, where a wide
  -- logo can't fit. Falls back to logo_initials, then to the first letter of
  -- app_name, then to Strider's own mark.
  logo_mark_url   text,
  logo_initials   text,
  -- Hex, e.g. '#1D4ED8'. Overrides --accent-red/--primary/--ring/--chart-1 at
  -- runtime. NOTE: --destructive is deliberately NOT overridden anywhere —
  -- "delete/danger" must stay red even when the brand colour is red-adjacent
  -- or, worse, green.
  brand_color     text,

  -- Which appearance the brand defaults to for people who've never chosen one
  -- themselves. 'user' = leave them on the app default (dark).
  default_theme   text NOT NULL DEFAULT 'user',
  -- When true, the brand's theme wins even over a personal choice — for a
  -- squad that wants one consistent look. Off by default; a coach overriding
  -- an athlete's accessibility-driven preference should be a deliberate act.
  force_theme     boolean NOT NULL DEFAULT false,

  -- Optional "contact your coach" address surfaced in place of Strider support.
  support_email   text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coach_branding IS
  'Per-coach in-app white-label branding. Cascades to that coach''s athletes and their linked parents via get_effective_branding(). Distinct from coach_profiles, which is the public marketing page.';

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_brand_color_check
      CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_default_theme_check
      CHECK (default_theme IN ('user', 'dark', 'light'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_app_name_len_check
      CHECK (app_name IS NULL OR char_length(app_name) BETWEEN 1 AND 40);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_initials_len_check
      CHECK (logo_initials IS NULL OR char_length(logo_initials) BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_coach_branding_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_branding_touch_updated_at ON public.coach_branding;
CREATE TRIGGER coach_branding_touch_updated_at
  BEFORE UPDATE ON public.coach_branding
  FOR EACH ROW EXECUTE FUNCTION public.touch_coach_branding_updated_at();


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- Deliberately minimal: a coach reads/writes ONLY their own row. Athletes and
-- parents never SELECT this table directly — they get their branding through
-- get_effective_branding() below, which is SECURITY DEFINER. That keeps the
-- cascade logic (and the entitlement check) in exactly one place instead of
-- being half-expressed as a policy and half-expressed in client queries.
ALTER TABLE public.coach_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_branding read own" ON public.coach_branding;
CREATE POLICY "coach_branding read own" ON public.coach_branding
  FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid());

DROP POLICY IF EXISTS "coach_branding insert own" ON public.coach_branding;
CREATE POLICY "coach_branding insert own" ON public.coach_branding
  FOR INSERT TO authenticated
  WITH CHECK (
    coach_user_id = auth.uid()
    AND (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  );

DROP POLICY IF EXISTS "coach_branding update own" ON public.coach_branding;
CREATE POLICY "coach_branding update own" ON public.coach_branding
  FOR UPDATE TO authenticated
  USING (coach_user_id = auth.uid())
  WITH CHECK (
    coach_user_id = auth.uid()
    AND (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  );

DROP POLICY IF EXISTS "coach_branding delete own" ON public.coach_branding;
CREATE POLICY "coach_branding delete own" ON public.coach_branding
  FOR DELETE TO authenticated
  USING (coach_user_id = auth.uid());


-- ── 5. Resolver ─────────────────────────────────────────────────────────────
-- Returns the branding the CALLING user should see, or NULL for plain Strider.
--
-- Resolution order:
--   1. The caller's own branding row (they're the coach).
--   2. If the caller is NOT a coach: the coach of the athlete record they own.
--   3. If still nothing: the coach of a child they're an active parent of.
--
-- Step 2 is explicitly skipped for coaches. A dual-role user (a coach who also
-- trains under someone else) must never inherit a rival coach's brand into
-- their own coaching workspace — their own brand, or none.
--
-- Multi-coach athletes: most recent coach_athletes link wins. Arbitrary but
-- deterministic; the alternative (a per-athlete "primary coach" pointer)
-- doesn't exist yet and isn't worth inventing for this.
CREATE OR REPLACE FUNCTION public.get_effective_branding()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_coach boolean;
  v_coach    uuid;
  v_row      public.coach_branding%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_coach := public.has_role(v_uid, 'coach') OR public.has_role(v_uid, 'manager');

  -- 1. Own row.
  SELECT cb.coach_user_id INTO v_coach
  FROM public.coach_branding cb
  WHERE cb.coach_user_id = v_uid;

  -- 2. Athlete → their coach. Coaches are excluded (see note above).
  IF v_coach IS NULL AND NOT v_is_coach THEN
    SELECT ca.coach_user_id INTO v_coach
    FROM public.coach_athletes ca
    JOIN public.athletes a ON a.id = ca.athlete_id
    WHERE a.user_id = v_uid
    ORDER BY ca.created_at DESC
    LIMIT 1;
  END IF;

  -- 3. Parent → their child's coach.
  IF v_coach IS NULL AND NOT v_is_coach THEN
    SELECT ca.coach_user_id INTO v_coach
    FROM public.parent_athlete_links pal
    JOIN public.coach_athletes ca ON ca.athlete_id = pal.athlete_id
    WHERE pal.parent_user_id = v_uid
      AND pal.status = 'active'
    ORDER BY ca.created_at DESC
    LIMIT 1;
  END IF;

  IF v_coach IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM public.coach_branding WHERE coach_user_id = v_coach;
  IF NOT FOUND OR NOT v_row.enabled THEN
    RETURN NULL;
  END IF;

  -- Entitlement gate. Runs here, server-side, on the COACH's profile — not the
  -- caller's. An athlete of an unentitled coach simply gets plain Strider.
  IF NOT COALESCE((SELECT p.white_label_active FROM public.profiles p WHERE p.id = v_coach), false) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'coachUserId',   v_row.coach_user_id,
    'appName',       v_row.app_name,
    'logoUrl',       v_row.logo_url,
    'logoMarkUrl',   v_row.logo_mark_url,
    'logoInitials',  v_row.logo_initials,
    'brandColor',    v_row.brand_color,
    'defaultTheme',  v_row.default_theme,
    'forceTheme',    v_row.force_theme,
    'supportEmail',  v_row.support_email,
    'isOwner',       (v_row.coach_user_id = v_uid)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_effective_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_branding() TO authenticated;

COMMENT ON FUNCTION public.get_effective_branding() IS
  'Resolves in-app white-label branding for the calling user (own → coach''s → child''s coach''s), enforcing the profiles.white_label_active entitlement. Returns NULL for default Strider branding.';


NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- ONE-TIME MANUAL BLOCK — run separately in the Supabase SQL Editor.
-- Grants the entitlement to a specific coach so the feature can actually be
-- tested end-to-end. Nothing above turns white-labelling on for anyone.
-- ============================================================================
--
-- UPDATE public.profiles
--    SET white_label_active = true
--  WHERE id = '<COACH_AUTH_USER_ID>';
--
-- -- Sanity check: the coach's saved brand row.
-- -- SELECT * FROM public.coach_branding WHERE coach_user_id = '<COACH_AUTH_USER_ID>';
--
-- -- Sanity check: what the resolver returns for whoever is currently logged in.
-- -- SELECT public.get_effective_branding();
--
-- ============================================================================
-- STORAGE NOTE
-- Logo uploads reuse the existing PUBLIC `coach-media` bucket (the same one
-- the Coach Public Page image uploader already writes to), under the coach's
-- own `<uid>/` folder prefix. No new bucket or storage policy is needed. The
-- bucket being public is fine here and in fact required — a brand logo is
-- rendered in the app chrome on every page for every athlete, and signed URLs
-- would need refreshing.
-- ============================================================================
