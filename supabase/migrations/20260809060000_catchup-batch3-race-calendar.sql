-- ============================================================================
-- Migration tracking catch-up — Batch 3: Race Calendar
-- ============================================================================
--
-- PURE CAPTURE. Every statement reproduces exactly what's already live,
-- verified against information_schema.columns, pg_constraint (via
-- pg_get_constraintdef — copied verbatim), and pg_policies on 9 Aug 2026.
-- Zero behavioural change. None of these 5 tables had any CREATE TABLE
-- anywhere in GitHub history.
--
-- SHAPE OF THIS FEATURE: race_calendars are SQUAD-level, not per-athlete —
-- a calendar gets linked to one or more training_groups via
-- race_calendar_groups (a many-to-many join, PK on the pair), and every
-- athlete in a linked group can read it. race_schedule_entries is the
-- actual list of races, and can hang off EITHER a training_group directly
-- OR a shared calendar (the owner_check constraint below requires at least
-- one). race_events is a separate, simpler thing — individual race records
-- tied to whoever created them, linked to real results via
-- performances.race_event_id.
--
-- DEPENDENCY NOT YET CLOSED: the RLS policies below call three functions —
-- owns_race_calendar(), can_access_race_calendar(), has_race_event_access()
-- — that are THEMSELVES still on the original untracked-functions list from
-- today's audit. This migration reproduces the table/policy structure that
-- CALLS them correctly, but their own bodies still need a separate
-- functions-batch capture — flagging so this isn't mistaken for complete.
--
-- SAFE TO RE-RUN.
-- ============================================================================


-- ── 1. race_calendars ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  season      text,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.race_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_calendars owner manage" ON public.race_calendars;
CREATE POLICY "race_calendars owner manage" ON public.race_calendars
  FOR ALL USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "race_calendars read via applied group" ON public.race_calendars;
CREATE POLICY "race_calendars read via applied group" ON public.race_calendars
  FOR SELECT USING (public.can_access_race_calendar(auth.uid(), id));


-- ── 2. race_calendar_groups (many-to-many: calendars ↔ training groups) ─────
CREATE TABLE IF NOT EXISTS public.race_calendar_groups (
  calendar_id        uuid NOT NULL REFERENCES public.race_calendars(id) ON DELETE CASCADE,
  training_group_id  uuid NOT NULL REFERENCES public.training_groups(id) ON DELETE CASCADE,
  applied_at         timestamptz NOT NULL DEFAULT now(),
  applied_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT race_calendar_groups_pkey PRIMARY KEY (calendar_id, training_group_id)
);

ALTER TABLE public.race_calendar_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_calendar_groups coach manage" ON public.race_calendar_groups;
CREATE POLICY "race_calendar_groups coach manage" ON public.race_calendar_groups
  FOR ALL
  USING (
    public.owns_race_calendar(auth.uid(), calendar_id)
    OR EXISTS (SELECT 1 FROM public.training_groups tg
               WHERE tg.id = race_calendar_groups.training_group_id AND tg.coach_user_id = auth.uid())
  )
  WITH CHECK (
    public.owns_race_calendar(auth.uid(), calendar_id)
    OR EXISTS (SELECT 1 FROM public.training_groups tg
               WHERE tg.id = race_calendar_groups.training_group_id AND tg.coach_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "race_calendar_groups athlete read" ON public.race_calendar_groups;
CREATE POLICY "race_calendar_groups athlete read" ON public.race_calendar_groups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.training_group_members m
      JOIN public.athletes a ON a.id = m.athlete_id
      WHERE m.group_id = race_calendar_groups.training_group_id
        AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
    )
  );


-- ── 3. race_entry_rules ──────────────────────────────────────────────────────
-- Reusable entry-window templates (e.g. "closes Thursday 5pm, opens 14 days
-- before") — referenced by race_schedule_entries.entry_rule_id, not tied to
-- one specific race.
CREATE TABLE IF NOT EXISTS public.race_entry_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  closes_weekday         smallint NOT NULL,
  closes_time            time NOT NULL,
  opens_weekday          smallint,
  opens_time             time,
  opens_min_days_before  smallint,
  notes                  text,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.race_entry_rules
    ADD CONSTRAINT race_entry_rules_closes_weekday_check CHECK (closes_weekday >= 0 AND closes_weekday <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_entry_rules
    ADD CONSTRAINT race_entry_rules_opens_weekday_check CHECK (opens_weekday >= 0 AND opens_weekday <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.race_entry_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_entry_rules readable by authenticated" ON public.race_entry_rules;
CREATE POLICY "race_entry_rules readable by authenticated" ON public.race_entry_rules
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "coaches can manage entry rules" ON public.race_entry_rules;
CREATE POLICY "coaches can manage entry rules" ON public.race_entry_rules
  FOR ALL
  USING (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'coach') OR public.has_role(auth.uid(), 'manager'));


-- ── 4. race_events ────────────────────────────────────────────────────────────
-- Individual race records, linked to real results via
-- performances.race_event_id (not reproduced here — that FK lives on the
-- performances table itself, already tracked elsewhere).
CREATE TABLE IF NOT EXISTS public.race_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  event_date   date,
  distance_m   integer,
  location     text,
  race_type    text,
  created_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.race_events
    ADD CONSTRAINT race_events_race_type_check
      CHECK (race_type = ANY (ARRAY['track','road','cross_country']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.race_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_events read" ON public.race_events;
CREATE POLICY "race_events read" ON public.race_events
  FOR SELECT USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.performances p
               WHERE p.race_event_id = race_events.id
                 AND public.can_access_athlete(auth.uid(), p.athlete_id))
  );

DROP POLICY IF EXISTS "race_events read via granted athlete access" ON public.race_events;
CREATE POLICY "race_events read via granted athlete access" ON public.race_events
  FOR SELECT USING (public.has_race_event_access(auth.uid(), id));

DROP POLICY IF EXISTS "race_events insert" ON public.race_events;
CREATE POLICY "race_events insert" ON public.race_events
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "race_events update own" ON public.race_events;
CREATE POLICY "race_events update own" ON public.race_events
  FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "race_events delete own" ON public.race_events;
CREATE POLICY "race_events delete own" ON public.race_events
  FOR DELETE USING (created_by = auth.uid());


-- ── 5. race_schedule_entries ──────────────────────────────────────────────────
-- The actual list of races an athlete/group might enter. Must belong to
-- EITHER a training_group directly OR a shared calendar (owner_check below)
-- — a schedule entry floating free of both isn't a valid state.
CREATE TABLE IF NOT EXISTS public.race_schedule_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_group_id   uuid REFERENCES public.training_groups(id) ON DELETE CASCADE,
  name                text NOT NULL,
  event_date          date NOT NULL,
  location            text,
  race_type           text,
  events_offered      text[] NOT NULL DEFAULT '{}'::text[],
  source              text NOT NULL DEFAULT 'manual',
  raw_text            text,
  created_by          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  location_id         uuid REFERENCES public.training_locations(id) ON DELETE SET NULL,
  calendar_id         uuid REFERENCES public.race_calendars(id) ON DELETE CASCADE,
  entry_opens         timestamptz,
  entry_closes        timestamptz,
  entry_url           text,
  entry_rule_id       uuid REFERENCES public.race_entry_rules(id) ON DELETE SET NULL
);

DO $$ BEGIN
  ALTER TABLE public.race_schedule_entries
    ADD CONSTRAINT race_schedule_entries_owner_check
      CHECK (training_group_id IS NOT NULL OR calendar_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_schedule_entries
    ADD CONSTRAINT race_schedule_entries_race_type_check
      CHECK (race_type = ANY (ARRAY['track','road','cross_country']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.race_schedule_entries
    ADD CONSTRAINT race_schedule_entries_source_check
      CHECK (source = ANY (ARRAY['manual','parsed']::text[]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.race_schedule_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_schedule_entries coach manage" ON public.race_schedule_entries;
CREATE POLICY "race_schedule_entries coach manage" ON public.race_schedule_entries
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.training_groups tg
                 WHERE tg.id = race_schedule_entries.training_group_id AND tg.coach_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.training_groups tg
                      WHERE tg.id = race_schedule_entries.training_group_id AND tg.coach_user_id = auth.uid()));

DROP POLICY IF EXISTS "race_schedule_entries coach manage via calendar" ON public.race_schedule_entries;
CREATE POLICY "race_schedule_entries coach manage via calendar" ON public.race_schedule_entries
  FOR ALL
  USING (public.owns_race_calendar(auth.uid(), calendar_id))
  WITH CHECK (public.owns_race_calendar(auth.uid(), calendar_id));

DROP POLICY IF EXISTS "race_schedule_entries athlete read" ON public.race_schedule_entries;
CREATE POLICY "race_schedule_entries athlete read" ON public.race_schedule_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.training_group_members m
      JOIN public.athletes a ON a.id = m.athlete_id
      WHERE m.group_id = race_schedule_entries.training_group_id
        AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "race_schedule_entries athlete read via calendar" ON public.race_schedule_entries;
CREATE POLICY "race_schedule_entries athlete read via calendar" ON public.race_schedule_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.race_calendar_groups cg
      JOIN public.training_group_members m ON m.group_id = cg.training_group_id
      JOIN public.athletes a ON a.id = m.athlete_id
      WHERE cg.calendar_id = race_schedule_entries.calendar_id
        AND (a.user_id = auth.uid() OR a.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "race_schedule_entries readable via own selection" ON public.race_schedule_entries;
CREATE POLICY "race_schedule_entries readable via own selection" ON public.race_schedule_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.athlete_race_selections s
            WHERE s.race_schedule_entry_id = race_schedule_entries.id
              AND public.can_access_athlete(auth.uid(), s.athlete_id))
  );


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- STILL OPEN: owns_race_calendar(), can_access_race_calendar(),
-- has_race_event_access() — referenced throughout the policies above, still
-- untracked themselves. Next functions-batch pull should include these
-- three specifically, since this migration's RLS depends on them existing
-- and behaving as their names imply, and that's currently unverified.
-- ============================================================================
