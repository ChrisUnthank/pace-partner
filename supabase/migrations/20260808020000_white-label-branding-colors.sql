-- ============================================================================
-- White-label branding — Phase 1b: secondary + danger colours
-- ============================================================================
--
-- Additive follow-up to 20260808010000_white-label-branding.sql. Run that one
-- first; this assumes coach_branding already exists.
--
-- WHY danger_color EXISTS AT ALL
-- Phase 1 hardcoded "--destructive always stays Strider red", on the reasoning
-- that a delete button must read as danger regardless of the brand colour.
-- That reasoning holds, but the conclusion was wrong: if the COACH'S BRAND is
-- red (or red-adjacent — crimson, maroon, orange), a fixed red destructive is
-- now indistinguishable from ordinary branded chrome, which is the exact
-- failure the hardcoding was meant to prevent. The right answer is that danger
-- must be *distinguishable from the brand*, not *specifically red* — so it
-- becomes a deliberate choice, defaulting to Strider red, with the editor
-- warning when the chosen danger colour sits too close to the brand colour.
--
-- WHY secondary_color IS NOT MAPPED TO --secondary
-- `--secondary` in this design system is shadcn's MUTED SURFACE token (the
-- grey behind secondary buttons and badges), not an accent. Pointing a bright
-- brand colour at it would repaint every secondary button in the app a solid
-- colour. The new colour gets its own `--brand-secondary` token in styles.css
-- and additionally drives `--chart-2`, which is the actual "second series"
-- slot.
--
-- NOTE: this migration is reconstructed and verified against live database
-- state on 9 Aug 2026 — the original file was lost when this session's
-- workspace reset. The get_effective_branding body below is reproduced
-- byte-for-byte from pg_get_functiondef on the live function, and the
-- coach_branding column list is cross-checked against live
-- information_schema.columns output — not recalled from memory alone.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.coach_branding
  ADD COLUMN IF NOT EXISTS secondary_color text,
  ADD COLUMN IF NOT EXISTS danger_color    text;

COMMENT ON COLUMN public.coach_branding.secondary_color IS
  'Optional accent colour. Drives --brand-secondary and --chart-2. Deliberately NOT mapped to --secondary, which is the muted surface token.';

COMMENT ON COLUMN public.coach_branding.danger_color IS
  'Colour for destructive/danger actions. NULL falls back to Strider red. Exists so a coach whose brand IS red can keep delete actions visually distinct.';

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_secondary_color_check
      CHECK (secondary_color IS NULL OR secondary_color ~* '^#[0-9a-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_branding
    ADD CONSTRAINT coach_branding_danger_color_check
      CHECK (danger_color IS NULL OR danger_color ~* '^#[0-9a-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Resolver, updated to return the two new colours ─────────────────────────
-- Full CREATE OR REPLACE rather than a patch: per the standing rule, never
-- assume the live function matches project knowledge. If you've changed this
-- function since Phase 1, extract the live version first with
--   SELECT pg_get_functiondef('public.get_effective_branding'::regproc);
-- and merge by hand instead of running this block blind.
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

  -- 2. Athlete → their coach. Coaches are excluded: a dual-role user must
  --    never inherit a rival coach's brand into their own workspace.
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

  IF NOT COALESCE((SELECT p.white_label_active FROM public.profiles p WHERE p.id = v_coach), false) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'coachUserId',    v_row.coach_user_id,
    'appName',        v_row.app_name,
    'logoUrl',        v_row.logo_url,
    'logoMarkUrl',    v_row.logo_mark_url,
    'logoInitials',   v_row.logo_initials,
    'brandColor',     v_row.brand_color,
    'secondaryColor', v_row.secondary_color,
    'dangerColor',    v_row.danger_color,
    'defaultTheme',   v_row.default_theme,
    'forceTheme',     v_row.force_theme,
    'supportEmail',   v_row.support_email,
    'isOwner',        (v_row.coach_user_id = v_uid)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_effective_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_branding() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- DIAGNOSTIC BLOCK — run manually if branding still won't save.
-- The "toggle flips back off" symptom in the first build was a CLIENT bug
-- (the form loaded before auth resolved and then locked itself to empty), not
-- an RLS failure — but these confirm the DB side is healthy either way.
-- ============================================================================
--
-- -- 1. Does the row exist, and what's actually stored?
-- SELECT * FROM public.coach_branding;
--
-- -- 2. Is the entitlement granted?
-- SELECT id, email, white_label_active FROM public.profiles WHERE white_label_active;
--
-- -- 3. Does the caller hold the coach role the INSERT/UPDATE policies require?
-- --    (run while logged in as that coach, e.g. via the API, not the SQL editor —
-- --     the SQL editor runs as the service role and bypasses RLS entirely)
-- SELECT public.has_role(auth.uid(), 'coach'), public.has_role(auth.uid(), 'manager');
--
-- -- 4. What does the resolver hand back?
-- SELECT public.get_effective_branding();
-- ============================================================================
