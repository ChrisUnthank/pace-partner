-- ============================================================================
-- Migration tracking catch-up — Batch 9: Blog/Content + Gear
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 5 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- RESOLVES AN OPEN QUESTION FROM EARLIER THIS SESSION: gear_items.shoe_category
-- has exactly four real values — 'track', 'road', 'everyday', 'off_road'.
-- There is NO "supershoe" category. Any future Supershoe Effect Score work
-- would need either a new category value added, or would have to infer
-- "supershoe" from is_spike + brand/model text matching — much less
-- reliable than a real category. Flagging this here since it directly
-- changes the feasibility picture discussed earlier.
--
-- OBSERVATION, NOT A FIX (pure capture only): both coach_blog_posts and
-- noticeboard_media have genuine DUPLICATE RLS policies — same logic,
-- different names/capitalization (e.g. "Coaches manage own blog posts" and
-- "coach manages own blog posts" both doing the exact same check).
-- Harmless functionally (duplicate permissive policies just OR together),
-- but real redundancy, almost certainly from the same SQL being run twice
-- live without realizing an equivalent policy already existed — which is
-- exactly the kind of thing that's easy to lose track of when nothing's in
-- source control. Reproduced exactly as found below, including the
-- duplicates; not cleaned up here.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. athlete_blog_posts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_blog_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  title             text NOT NULL DEFAULT ''::text,
  excerpt           text NOT NULL DEFAULT ''::text,
  content           text NOT NULL DEFAULT ''::text,
  cover_image_url   text,
  is_published      boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.athlete_blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public can read published athlete_blog_posts" ON public.athlete_blog_posts;
CREATE POLICY "public can read published athlete_blog_posts" ON public.athlete_blog_posts
  FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS "athlete or coach manages own athlete_blog_posts" ON public.athlete_blog_posts;
CREATE POLICY "athlete or coach manages own athlete_blog_posts" ON public.athlete_blog_posts
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.athletes a
            WHERE a.id = athlete_blog_posts.athlete_id
              AND (a.user_id = auth.uid() OR public.is_coach_of(auth.uid(), a.id)))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.athletes a
            WHERE a.id = athlete_blog_posts.athlete_id
              AND (a.user_id = auth.uid() OR public.is_coach_of(auth.uid(), a.id)))
  );


-- ── 2. coach_blog_posts ──────────────────────────────────────────────────────
-- Duplicate policies reproduced exactly as live — see header note.
CREATE TABLE IF NOT EXISTS public.coach_blog_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL DEFAULT ''::text,
  excerpt           text NOT NULL DEFAULT ''::text,
  content           text NOT NULL DEFAULT ''::text,
  cover_image_url   text,
  is_published      boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches manage own blog posts" ON public.coach_blog_posts;
CREATE POLICY "Coaches manage own blog posts" ON public.coach_blog_posts
  FOR ALL USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());

DROP POLICY IF EXISTS "coach manages own blog posts" ON public.coach_blog_posts;
CREATE POLICY "coach manages own blog posts" ON public.coach_blog_posts
  FOR ALL USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());

DROP POLICY IF EXISTS "Public can read published blog posts" ON public.coach_blog_posts;
CREATE POLICY "Public can read published blog posts" ON public.coach_blog_posts
  FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS "public can read published blog posts" ON public.coach_blog_posts;
CREATE POLICY "public can read published blog posts" ON public.coach_blog_posts
  FOR SELECT USING (is_published = true);


-- ── 3. noticeboard_media ─────────────────────────────────────────────────────
-- Duplicate policies reproduced exactly as live — see header note.
CREATE TABLE IF NOT EXISTS public.noticeboard_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_url     text NOT NULL,
  uploaded_by  uuid REFERENCES auth.users(id),
  created_at   timestamp without time zone DEFAULT now()
);

ALTER TABLE public.noticeboard_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read" ON public.noticeboard_media;
CREATE POLICY "Allow public read" ON public.noticeboard_media
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow read" ON public.noticeboard_media;
CREATE POLICY "allow read" ON public.noticeboard_media
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert" ON public.noticeboard_media;
CREATE POLICY "Allow authenticated insert" ON public.noticeboard_media
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "allow insert" ON public.noticeboard_media;
CREATE POLICY "allow insert" ON public.noticeboard_media
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete for owner" ON public.noticeboard_media;
CREATE POLICY "Allow delete for owner" ON public.noticeboard_media
  FOR DELETE USING (uploaded_by = auth.uid());


-- ── 4. gear_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gear_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id             uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  gear_type              text NOT NULL,
  shoe_category          text,
  is_spike               boolean NOT NULL DEFAULT false,
  brand                  text NOT NULL,
  model                  text NOT NULL,
  nickname               text,
  purchase_date          date,
  retirement_target_km   numeric,
  rating                 smallint,
  is_favourite           boolean NOT NULL DEFAULT false,
  is_retired             boolean NOT NULL DEFAULT false,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.gear_items
    ADD CONSTRAINT gear_items_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.gear_items
    ADD CONSTRAINT gear_items_gear_type_check
      CHECK (gear_type = ANY (ARRAY['shoe','bike','treadmill','other']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The four real categories — no "supershoe" tier. See header note.
DO $$ BEGIN
  ALTER TABLE public.gear_items
    ADD CONSTRAINT gear_items_shoe_category_check
      CHECK (shoe_category IS NULL OR shoe_category = ANY (ARRAY['track','road','everyday','off_road']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.gear_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gear access via athlete" ON public.gear_items;
CREATE POLICY "gear access via athlete" ON public.gear_items
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 5. session_gear (join: which gear was worn for which session) ──────────
CREATE TABLE IF NOT EXISTS public.session_gear (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  gear_id      uuid NOT NULL REFERENCES public.gear_items(id) ON DELETE CASCADE,
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_gear_session_id_gear_id_key UNIQUE (session_id, gear_id)
);

ALTER TABLE public.session_gear ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session gear access via athlete" ON public.session_gear;
CREATE POLICY "session gear access via athlete" ON public.session_gear
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));


NOTIFY pgrst, 'reload schema';
