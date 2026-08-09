-- ============================================================================
-- Migration tracking catch-up — Batch 10: Athlete Profile / Season Data
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 5 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- NOTE ON athlete_profiles: this is the athlete-facing equivalent of
-- coach_profiles — the athlete's own public marketing page (same
-- theme/style/nav/brand_color axes, same is_published gate, same
-- [data-*-root]-scoped theming concept). It's a much bigger table than the
-- rest of this batch (28 columns, several JSONB defaults) — the two JSONB
-- defaults below (sections_enabled, section_order) were reconstructed
-- carefully from the live column_default output, not approximated.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. athlete_profiles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id                      uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  slug                            text NOT NULL,
  tagline                         text,
  bio                             text,
  disciplines                     text[] NOT NULL DEFAULT '{}'::text[],
  achievements                    text[] NOT NULL DEFAULT '{}'::text[],
  theme                           text NOT NULL DEFAULT 'light',
  style                           text NOT NULL DEFAULT 'modern',
  nav                             text NOT NULL DEFAULT 'top',
  brand_color                     text NOT NULL DEFAULT '#BD4130',
  secondary_color                 text,
  hero_image_side                 text NOT NULL DEFAULT 'right',
  section_density                 text NOT NULL DEFAULT 'comfortable',
  alternate_section_backgrounds   boolean NOT NULL DEFAULT false,
  hero_image_url                  text,
  gallery_images                  text[] NOT NULL DEFAULT '{}'::text[],
  sponsors                        jsonb NOT NULL DEFAULT '[]'::jsonb,
  donate_label                    text,
  donate_url                      text,
  training_partners_added         jsonb NOT NULL DEFAULT '[]'::jsonb,
  training_partners_hidden_ids    uuid[] NOT NULL DEFAULT '{}'::uuid[],
  contact                         jsonb,
  is_published                    boolean NOT NULL DEFAULT false,
  sections_enabled                jsonb NOT NULL DEFAULT '{"blog": true, "goal": true, "about": true, "stats": true, "donate": true, "contact": true, "gallery": true, "results": true, "sponsors": true, "trainingPartners": true}'::jsonb,
  section_order                   jsonb NOT NULL DEFAULT '["stats", "about", "goal", "results", "trainingPartners", "gallery", "blog", "sponsors", "donate", "contact"]'::jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  stats                           jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_image_position_x           numeric NOT NULL DEFAULT 50,
  hero_image_position_y           numeric NOT NULL DEFAULT 50,
  gallery_columns                 integer NOT NULL DEFAULT 3,
  gallery_aspect                  text NOT NULL DEFAULT 'square',
  gallery_image_positions         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT athlete_profiles_athlete_id_key UNIQUE (athlete_id),
  CONSTRAINT athlete_profiles_slug_key UNIQUE (slug)
);

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_hero_image_position_x_check CHECK (hero_image_position_x >= 0 AND hero_image_position_x <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_hero_image_position_y_check CHECK (hero_image_position_y >= 0 AND hero_image_position_y <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_gallery_columns_check CHECK (gallery_columns >= 2 AND gallery_columns <= 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_gallery_aspect_check
      CHECK (gallery_aspect = ANY (ARRAY['square','portrait','landscape','auto']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_hero_image_side_check
      CHECK (hero_image_side = ANY (ARRAY['left','right']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_nav_check CHECK (nav = ANY (ARRAY['top','sidebar']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_section_density_check
      CHECK (section_density = ANY (ARRAY['comfortable','compact']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_style_check CHECK (style = ANY (ARRAY['modern','traditional']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_profiles
    ADD CONSTRAINT athlete_profiles_theme_check CHECK (theme = ANY (ARRAY['light','dark']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public can read published athlete_profiles" ON public.athlete_profiles;
CREATE POLICY "public can read published athlete_profiles" ON public.athlete_profiles
  FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS "athlete or coach manages own athlete_profiles" ON public.athlete_profiles;
CREATE POLICY "athlete or coach manages own athlete_profiles" ON public.athlete_profiles
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.athletes a
            WHERE a.id = athlete_profiles.athlete_id
              AND (a.user_id = auth.uid() OR public.is_coach_of(auth.uid(), a.id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.athletes a
            WHERE a.id = athlete_profiles.athlete_id
              AND (a.user_id = auth.uid() OR public.is_coach_of(auth.uid(), a.id)))
  );


-- ── 2. athlete_goals ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_by            uuid REFERENCES auth.users(id),
  goal_type             text NOT NULL,
  title                 text NOT NULL,
  notes                 text,
  race_date             date,
  distance_m            numeric,
  race_type             text,
  target_time_seconds   numeric,
  priority              text,
  target_date           date,
  is_primary            boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'active',
  performance_id        uuid REFERENCES public.performances(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_goals
    ADD CONSTRAINT athlete_goals_priority_check CHECK (priority = ANY (ARRAY['A','B','C']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_goals
    ADD CONSTRAINT athlete_goals_race_fields_check
      CHECK (goal_type = 'freeform' OR (goal_type = 'race' AND distance_m IS NOT NULL AND race_date IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_goals
    ADD CONSTRAINT athlete_goals_race_type_check
      CHECK (race_type = ANY (ARRAY['track','road','cross_country']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_goals
    ADD CONSTRAINT athlete_goals_goal_type_check CHECK (goal_type = ANY (ARRAY['race','freeform']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_goals
    ADD CONSTRAINT athlete_goals_status_check
      CHECK (status = ANY (ARRAY['active','achieved','missed','abandoned']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goal read athlete/coach" ON public.athlete_goals;
CREATE POLICY "goal read athlete/coach" ON public.athlete_goals
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "public can read primary goal of published athletes" ON public.athlete_goals;
CREATE POLICY "public can read primary goal of published athletes" ON public.athlete_goals
  FOR SELECT USING (
    is_primary = true AND status = 'active'
    AND EXISTS (SELECT 1 FROM public.athlete_profiles ap
                WHERE ap.athlete_id = athlete_goals.athlete_id AND ap.is_published = true)
  );

DROP POLICY IF EXISTS "goal insert athlete/coach" ON public.athlete_goals;
CREATE POLICY "goal insert athlete/coach" ON public.athlete_goals
  FOR INSERT WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "goal update athlete/coach" ON public.athlete_goals;
CREATE POLICY "goal update athlete/coach" ON public.athlete_goals
  FOR UPDATE
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "goal delete athlete/coach" ON public.athlete_goals;
CREATE POLICY "goal delete athlete/coach" ON public.athlete_goals
  FOR DELETE USING (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 3. athlete_seasons ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_seasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  season_type  text NOT NULL,
  label        text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_seasons
    ADD CONSTRAINT athlete_seasons_check CHECK (end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_seasons
    ADD CONSTRAINT athlete_seasons_season_type_check
      CHECK (season_type = ANY (ARRAY['indoor','outdoor','cross_country']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete seasons access" ON public.athlete_seasons;
CREATE POLICY "athlete seasons access" ON public.athlete_seasons
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 4. athlete_race_observations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_race_observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id      uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  observation     text NOT NULL,
  source_type     text NOT NULL,
  performance_id  uuid REFERENCES public.performances(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.athlete_race_observations
    ADD CONSTRAINT race_obs_source_type_check
      CHECK (source_type = ANY (ARRAY['coach','athlete','data_derived','ai_suggestion']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_race_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_obs_read" ON public.athlete_race_observations;
CREATE POLICY "race_obs_read" ON public.athlete_race_observations
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "race_obs_insert" ON public.athlete_race_observations;
CREATE POLICY "race_obs_insert" ON public.athlete_race_observations
  FOR INSERT WITH CHECK (
    public.is_coach_of(auth.uid(), athlete_id)
    OR (source_type = 'athlete' AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_race_observations.athlete_id AND a.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "race_obs_update" ON public.athlete_race_observations;
CREATE POLICY "race_obs_update" ON public.athlete_race_observations
  FOR UPDATE
  USING (public.is_coach_of(auth.uid(), athlete_id) OR created_by = auth.uid())
  WITH CHECK (public.is_coach_of(auth.uid(), athlete_id) OR created_by = auth.uid());

DROP POLICY IF EXISTS "race_obs_delete" ON public.athlete_race_observations;
CREATE POLICY "race_obs_delete" ON public.athlete_race_observations
  FOR DELETE USING (public.is_coach_of(auth.uid(), athlete_id) OR created_by = auth.uid());


-- ── 5. athlete_race_selections ───────────────────────────────────────────────
-- An athlete's chosen event out of a race_schedule_entries row (e.g. "I'm
-- doing the 1500m, not the 800m, at this meet").
CREATE TABLE IF NOT EXISTS public.athlete_race_selections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_schedule_entry_id   uuid NOT NULL REFERENCES public.race_schedule_entries(id) ON DELETE CASCADE,
  athlete_id               uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  selected_event           text,
  status                   text NOT NULL DEFAULT 'planned',
  session_id               uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  assigned_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athlete_race_selections_race_schedule_entry_id_athlete_id_key UNIQUE (race_schedule_entry_id, athlete_id)
);

DO $$ BEGIN
  ALTER TABLE public.athlete_race_selections
    ADD CONSTRAINT athlete_race_selections_status_check
      CHECK (status = ANY (ARRAY['planned','confirmed','declined']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_race_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_race_selections access" ON public.athlete_race_selections;
CREATE POLICY "athlete_race_selections access" ON public.athlete_race_selections
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


NOTIFY pgrst, 'reload schema';
