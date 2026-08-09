-- ============================================================================
-- Migration tracking catch-up — Batch 12 (final): everything else
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), pg_policies, and pg_enum on
-- 9 Aug 2026. Zero behavioural change. None of these 9 tables had any
-- CREATE TABLE anywhere in GitHub history — this closes out the LAST of
-- the 64 tables flagged in the original tracking audit.
--
-- ⚠ SECOND SECURITY OBSERVATION THIS SESSION, NOT FIXED HERE —
-- person_contact_details's "coaches read contact details" policy checks
-- only that the reader HOLDS a coach or manager role — it does not scope
-- to the reader's own athletes/roster at all. Any coach or manager account
-- can currently read any user's email/phone/address, not just people they
-- actually coach. Less severe than the coach_profiles insert issue fixed
-- earlier today (this is read-only, not impersonation/write), but real.
-- Reproduced exactly as live below — flagging for a separate decision, not
-- silently tightening it here.
--
-- Two more genuinely nice/well-built things worth noting, not flaws:
--   - address_book_contacts_check enforces that the right identifying
--     field is present for whichever contact_kind is chosen (athlete_id
--     for 'athlete', parent_user_id for 'parent', name for 'other') — a
--     real data-integrity constraint, not just a loose free-for-all table.
--   - training_routes' read policy correctly allows both the athlete
--     themselves AND any coach of theirs to see a route, via two separate
--     EXISTS clauses — same access-breadth pattern used everywhere else in
--     this app, just spelled out inline here rather than going through
--     can_access_athlete().
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 0. Enum type this batch depends on ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.personal_entry_category AS ENUM ('work_shift', 'appointment', 'personal', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 1. account_activity_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  description  text NOT NULL,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users see own account activity log" ON public.account_activity_log;
CREATE POLICY "users see own account activity log" ON public.account_activity_log
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users log their own account activity" ON public.account_activity_log;
CREATE POLICY "users log their own account activity" ON public.account_activity_log
  FOR INSERT WITH CHECK (user_id = auth.uid());


-- ── 2. address_book_contacts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.address_book_contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_kind        text NOT NULL,
  athlete_id          uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  parent_user_id      uuid,
  name                text,
  role_label          text,
  organisation        text,
  email               text,
  phone               text,
  phone_alt           text,
  address             text,
  notes               text,
  linked_athlete_id   uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.address_book_contacts
    ADD CONSTRAINT address_book_contacts_contact_kind_check
      CHECK (contact_kind = ANY (ARRAY['athlete','parent','other']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Requires the right identifying field for whichever kind is chosen.
DO $$ BEGIN
  ALTER TABLE public.address_book_contacts
    ADD CONSTRAINT address_book_contacts_check
      CHECK (
        (contact_kind = 'athlete' AND athlete_id IS NOT NULL)
        OR (contact_kind = 'parent' AND parent_user_id IS NOT NULL)
        OR (contact_kind = 'other' AND name IS NOT NULL)
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.address_book_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach owns their address book" ON public.address_book_contacts;
CREATE POLICY "coach owns their address book" ON public.address_book_contacts
  FOR ALL USING (coach_user_id = auth.uid()) WITH CHECK (coach_user_id = auth.uid());


-- ── 3. ai_squad_reviews ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_squad_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_type   text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  athlete_ids   uuid[] NOT NULL,
  content_md    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.ai_squad_reviews
    ADD CONSTRAINT ai_squad_reviews_review_type_check
      CHECK (review_type = ANY (ARRAY['weekly','monthly','phase','yearly','custom']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.ai_squad_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_squad_reviews coach owns" ON public.ai_squad_reviews;
CREATE POLICY "ai_squad_reviews coach owns" ON public.ai_squad_reviews
  FOR ALL USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());


-- ── 4. athlete_personal_calendar_entries ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_personal_calendar_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id     uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  category       public.personal_entry_category NOT NULL DEFAULT 'personal',
  title          text NOT NULL,
  day_of_week    smallint,
  specific_date  date,
  start_time     time,
  end_time       time,
  location_text  text,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  injury_id      uuid REFERENCES public.injuries(id) ON DELETE SET NULL
);

DO $$ BEGIN
  ALTER TABLE public.athlete_personal_calendar_entries
    ADD CONSTRAINT athlete_personal_calendar_entries_check CHECK (day_of_week IS NOT NULL OR specific_date IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.athlete_personal_calendar_entries
    ADD CONSTRAINT athlete_personal_calendar_entries_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athlete_personal_calendar_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete or parent manage personal calendar" ON public.athlete_personal_calendar_entries;
CREATE POLICY "athlete or parent manage personal calendar" ON public.athlete_personal_calendar_entries
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_personal_calendar_entries.athlete_id AND a.user_id = auth.uid())
    OR public.is_parent_of(auth.uid(), athlete_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_personal_calendar_entries.athlete_id AND a.user_id = auth.uid())
    OR public.is_parent_of(auth.uid(), athlete_id)
  );


-- ── 5. dashboard_layouts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_role  text NOT NULL,
  widget_order    jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden_widgets  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_layouts_user_id_dashboard_role_key UNIQUE (user_id, dashboard_role)
);

DO $$ BEGIN
  ALTER TABLE public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_dashboard_role_check
      CHECK (dashboard_role = ANY (ARRAY['coach','athlete']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard layouts self" ON public.dashboard_layouts;
CREATE POLICY "dashboard layouts self" ON public.dashboard_layouts
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ── 6. event_entries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id                  uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  event_name                  text NOT NULL,
  event_date                  date,
  location                    text,
  entry_status                text,
  bib_number                  text,
  confirmation_number         text,
  checkin_notes               text,
  attachment_url              text,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  athlete_race_selection_id   uuid REFERENCES public.athlete_race_selections(id) ON DELETE SET NULL
);

DO $$ BEGIN
  ALTER TABLE public.event_entries
    ADD CONSTRAINT event_entries_entry_status_check
      CHECK (entry_status IS NULL OR entry_status = ANY (ARRAY['registered','confirmed','waitlisted','cancelled']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.event_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event entries access via athlete" ON public.event_entries;
CREATE POLICY "event entries access via athlete" ON public.event_entries
  FOR ALL
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "event_entries coach read" ON public.event_entries;
CREATE POLICY "event_entries coach read" ON public.event_entries
  FOR SELECT USING (public.can_access_athlete(auth.uid(), athlete_id));


-- ── 7. person_contact_details ─────────────────────────────────────────────────
-- ⚠ See header note — "coaches read contact details" is unscoped to the
-- reader's own roster. Reproduced exactly as live.
CREATE TABLE IF NOT EXISTS public.person_contact_details (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text,
  phone        text,
  phone_alt    text,
  address      text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.person_contact_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own contact details full access" ON public.person_contact_details;
CREATE POLICY "own contact details full access" ON public.person_contact_details
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "coaches read contact details" ON public.person_contact_details;
CREATE POLICY "coaches read contact details" ON public.person_contact_details
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role::text = ANY (ARRAY['coach','manager']::text[]))
  );


-- ── 8. report_runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  run_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type   text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.report_runs
    ADD CONSTRAINT report_runs_report_type_check
      CHECK (report_type = ANY (ARRAY['athlete_weekly','coach_roster']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_runs read" ON public.report_runs;
CREATE POLICY "report_runs read" ON public.report_runs
  FOR SELECT USING (
    run_by = auth.uid()
    OR athlete_id IN (SELECT athletes.id FROM public.athletes WHERE athletes.user_id = auth.uid())
    OR athlete_id IN (SELECT coach_athletes.athlete_id FROM public.coach_athletes WHERE coach_athletes.coach_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "report_runs insert" ON public.report_runs;
CREATE POLICY "report_runs insert" ON public.report_runs
  FOR INSERT WITH CHECK (run_by = auth.uid());


-- ── 9. training_routes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_routes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id          uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  source_session_id   uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  name                text NOT NULL,
  location_name       text,
  distance_m          numeric,
  elevation_gain_m    numeric,
  start_lat           double precision,
  start_lng           double precision,
  path                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  location_id         uuid REFERENCES public.training_locations(id) ON DELETE SET NULL
);

ALTER TABLE public.training_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_routes read" ON public.training_routes;
CREATE POLICY "training_routes read" ON public.training_routes
  FOR SELECT USING (
    created_by = auth.uid()
    OR (athlete_id IS NOT NULL AND athlete_id IN (SELECT athletes.id FROM public.athletes WHERE athletes.user_id = auth.uid()))
    OR (athlete_id IS NOT NULL AND athlete_id IN (SELECT coach_athletes.athlete_id FROM public.coach_athletes WHERE coach_athletes.coach_user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "training_routes insert" ON public.training_routes;
CREATE POLICY "training_routes insert" ON public.training_routes
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "training_routes modify" ON public.training_routes;
CREATE POLICY "training_routes modify" ON public.training_routes
  FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "training_routes delete" ON public.training_routes;
CREATE POLICY "training_routes delete" ON public.training_routes
  FOR DELETE USING (created_by = auth.uid());


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- This closes the last of the 64 tables flagged in the original 9 Aug 2026
-- tracking audit. All tables now captured. Remaining open work from that
-- same audit: 26 still-untracked functions, headlined by the core recompute
-- engines (recompute_athlete_pbs, recompute_session_intent,
-- recompute_readiness_range, apply_starting_fitness,
-- compute_continuous_fatigue) plus assorted notification/utility functions.
-- ============================================================================
