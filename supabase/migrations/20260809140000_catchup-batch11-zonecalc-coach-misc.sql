-- ============================================================================
-- Migration tracking catch-up — Batch 11: Zone Calculator + Coach misc
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 4 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- ⚠ SECURITY FINDING, NOT FIXED HERE — coach_profiles has a policy named
-- "Allow insert coach (dev only)" with an unconditional `WITH CHECK (true)`.
-- It sits alongside the properly-scoped "Coaches can create their own
-- profile" policy (auth.uid() = coach_user_id) — but since permissive RLS
-- policies OR together, the wide-open one currently overrides the scoped
-- one. Any authenticated user can insert a coach_profiles row for ANY
-- coach_user_id right now, not just their own. This is reproduced exactly
-- as live below because this migration's job is pure capture — dropping
-- that policy is a real, separate decision, not something to fold in
-- silently. Flagged prominently, not buried in this comment alone.
--
-- Smaller observation, not a security issue: coach_profiles also has two
-- duplicate public-read SELECT policies ("Public read access for
-- coach_profiles" / "Allow public read coach pages") — harmless, same
-- redundancy pattern already seen in Batch 9.
--
-- NOTE: coach_inquiries has NO insert policy at all in this pull — makes
-- sense given create_parent_invite-style server-side functions exist
-- elsewhere in this app; submit_coach_inquiry (still on the original
-- untracked-functions list) is almost certainly a SECURITY DEFINER RPC
-- that handles the actual insert, bypassing the need for a client-facing
-- INSERT policy entirely. Not a gap — just means that function still needs
-- its own capture to see the real mechanism.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. athlete_zone_calculator_saves ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_zone_calculator_saves (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id                  uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label                       text NOT NULL,
  method                      text NOT NULL,
  basis                       text NOT NULL,
  threshold_pace_sec_per_km   numeric,
  threshold_hr_bpm            numeric,
  inputs                      jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_zone_calculator_saves
    ADD CONSTRAINT athlete_zone_calculator_saves_basis_check CHECK (basis = ANY (ARRAY['pace','hr']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_zone_calculator_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zone calculator saves access via athlete" ON public.athlete_zone_calculator_saves;
CREATE POLICY "zone calculator saves access via athlete" ON public.athlete_zone_calculator_saves
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "zone calculator saves insert via athlete" ON public.athlete_zone_calculator_saves;
CREATE POLICY "zone calculator saves insert via athlete" ON public.athlete_zone_calculator_saves
  FOR INSERT WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "zone calculator saves delete via athlete" ON public.athlete_zone_calculator_saves;
CREATE POLICY "zone calculator saves delete via athlete" ON public.athlete_zone_calculator_saves
  FOR DELETE USING (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 2. coach_inquiries ────────────────────────────────────────────────────────
-- No INSERT policy live — see header note (submit_coach_inquiry almost
-- certainly handles writes server-side).
CREATE TABLE IF NOT EXISTS public.coach_inquiries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  email          text NOT NULL,
  discipline     text,
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches can view their own inquiries" ON public.coach_inquiries;
CREATE POLICY "Coaches can view their own inquiries" ON public.coach_inquiries
  FOR SELECT USING (coach_user_id = auth.uid());


-- ── 3. coach_personal_calendar_entries ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_personal_calendar_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  category       text NOT NULL DEFAULT 'other',
  specific_date  date,
  day_of_week    integer,
  start_time     time,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.coach_personal_calendar_entries
    ADD CONSTRAINT coach_personal_calendar_entries_category_check
      CHECK (category = ANY (ARRAY['work_shift','appointment','personal','other']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_personal_calendar_entries
    ADD CONSTRAINT coach_personal_calendar_entries_check CHECK (specific_date IS NOT NULL OR day_of_week IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_personal_calendar_entries
    ADD CONSTRAINT coach_personal_calendar_entries_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.coach_personal_calendar_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach owns their diary entries" ON public.coach_personal_calendar_entries;
CREATE POLICY "coach owns their diary entries" ON public.coach_personal_calendar_entries
  FOR ALL USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());


-- ── 4. coach_profiles ─────────────────────────────────────────────────────────
-- The coach-facing counterpart to athlete_profiles from Batch 10 — same
-- public marketing page pattern, own set of extra fields (logo variants,
-- team_name, sample_sessions, plans, testimonials, location). Unlike
-- athlete_profiles, there is NO unique constraint on coach_user_id here —
-- reproduced exactly as found, not added; a coach could in principle end
-- up with more than one row, nothing in the schema itself prevents it.
CREATE TABLE IF NOT EXISTS public.coach_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                            text NOT NULL,
  name                            text NOT NULL,
  tagline                         text,
  brand_color                     text,
  theme                           text DEFAULT 'light',
  style                           text DEFAULT 'modern',
  nav                             text DEFAULT 'top',
  disciplines                     text[],
  bio                             text,
  certifications                  text[],
  hero_image_url                  text,
  stats                           jsonb,
  sample_sessions                 jsonb,
  gallery_images                  text[],
  plans                           jsonb,
  testimonials                    jsonb,
  location                        jsonb,
  contact                         jsonb,
  created_at                      timestamp without time zone DEFAULT now(),
  coach_user_id                   uuid REFERENCES public.profiles(id),
  logo_initials                   text,
  team_name                       text,
  logo_url                        text,
  logo_image_url                  text,
  coach_photo_url                 text,
  coaching_philosophy             text,
  achievements                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published                    boolean NOT NULL DEFAULT false,
  sections_enabled                jsonb NOT NULL DEFAULT '{"blog": true, "about": true, "plans": true, "stats": true, "gallery": true, "athletes": true, "sessions": true, "sponsors": true, "testimonials": true}'::jsonb,
  sponsors                        jsonb NOT NULL DEFAULT '[]'::jsonb,
  secondary_color                 text,
  hero_image_side                 text NOT NULL DEFAULT 'right',
  section_density                 text NOT NULL DEFAULT 'comfortable',
  section_order                   jsonb NOT NULL DEFAULT '["stats", "about", "sessions", "athletes", "gallery", "blog", "plans", "testimonials", "contact", "sponsors"]'::jsonb,
  alternate_section_backgrounds   boolean NOT NULL DEFAULT false,
  hero_image_position_x           numeric NOT NULL DEFAULT 50,
  hero_image_position_y           numeric NOT NULL DEFAULT 50,
  gallery_columns                 integer NOT NULL DEFAULT 3,
  gallery_aspect                  text NOT NULL DEFAULT 'square',
  gallery_image_positions         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT coach_profiles_slug_key UNIQUE (slug)
);

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_section_density_check
      CHECK (section_density = ANY (ARRAY['comfortable','compact']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_gallery_aspect_check
      CHECK (gallery_aspect = ANY (ARRAY['square','portrait','landscape','auto']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_gallery_columns_check CHECK (gallery_columns >= 2 AND gallery_columns <= 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_hero_image_position_x_check CHECK (hero_image_position_x >= 0 AND hero_image_position_x <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_hero_image_position_y_check CHECK (hero_image_position_y >= 0 AND hero_image_position_y <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.coach_profiles
    ADD CONSTRAINT coach_profiles_hero_image_side_check
      CHECK (hero_image_side = ANY (ARRAY['left','right']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for coach_profiles" ON public.coach_profiles;
CREATE POLICY "Public read access for coach_profiles" ON public.coach_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read coach pages" ON public.coach_profiles;
CREATE POLICY "Allow public read coach pages" ON public.coach_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Coaches can create their own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can create their own profile" ON public.coach_profiles
  FOR INSERT WITH CHECK (auth.uid() = coach_user_id);

-- ⚠ See header note — reproduced exactly as live, not a recommendation.
DROP POLICY IF EXISTS "Allow insert coach (dev only)" ON public.coach_profiles;
CREATE POLICY "Allow insert coach (dev only)" ON public.coach_profiles
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Coaches can update their own profile" ON public.coach_profiles;
CREATE POLICY "Coaches can update their own profile" ON public.coach_profiles
  FOR UPDATE USING (auth.uid() = coach_user_id) WITH CHECK (auth.uid() = coach_user_id);


NOTIFY pgrst, 'reload schema';
