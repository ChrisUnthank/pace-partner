-- ============================================================================
-- CAMPAIGN — the season structure above the week.
--
-- Strider already plans at the WEEK level: plan_templates, plan_progression's
-- volume scaling, copy-period-forward. What it has never had is the layer
-- above — where the phases sit, how long each block runs, where the peak
-- lands, how long the taper is. Coaches hold that in their head or in a
-- spreadsheet.
--
-- A campaign is that layer, and DELIBERATELY NOTHING ELSE. It produces weeks
-- with a phase, a relative load target and a deload flag. It does not produce
-- sessions.
--
-- WHY THE SPLIT MATTERS
--
-- Coaches work two different ways: some build a whole season of sessions up
-- front and adjust as they go, others sketch the structure and fill it a
-- block at a time. Making generation produce sessions would force a choice
-- between them. Keeping the campaign to structure, with "fill this block" as
-- a separate action, serves both — and the filling half already exists in
-- plan_progression + plan_templates.
--
-- WHY NOT ONE GOAL DATE
--
-- The obvious design counts back from a single race, which suits a marathon
-- build. Middle-distance track season isn't shaped that way: a dozen races
-- across a season, most of them stepping stones, with the real peak reserved
-- for one or two. campaign_targets therefore holds MANY races with a
-- priority, and phases are laid out around them — not around one date.
--
-- athlete_goals already carries is_primary, priority and target_date, so a
-- campaign target can point at an existing goal rather than duplicating it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The campaign itself
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  name              text NOT NULL,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,

  -- The loading rhythm, as chosen at generation time and kept so the campaign
  -- can be regenerated identically or explained later.
  load_weeks        integer NOT NULL DEFAULT 3 CHECK (load_weeks BETWEEN 1 AND 6),
  deload_weeks      integer NOT NULL DEFAULT 1 CHECK (deload_weeks BETWEEN 0 AND 2),
  taper_weeks       integer NOT NULL DEFAULT 2 CHECK (taper_weeks BETWEEN 0 AND 4),
  transition_weeks  integer NOT NULL DEFAULT 2 CHECK (transition_weeks BETWEEN 0 AND 6),

  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'complete', 'abandoned')),
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_dates_ordered CHECK (ends_on > starts_on)
);

COMMENT ON TABLE public.campaigns IS
  'Season-level structure: phases, blocks and weekly load targets. Produces no sessions — filling a block is a separate action using plan templates.';

CREATE INDEX IF NOT EXISTS campaigns_athlete_idx ON public.campaigns (athlete_id, starts_on DESC);

-- Only one campaign can be active per athlete at a time. Two overlapping
-- active campaigns would give a week two different phases, and nothing
-- downstream could resolve which applies.
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_active_idx
  ON public.campaigns (athlete_id) WHERE status = 'active';


-- ---------------------------------------------------------------------------
-- Races the campaign is built around
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,

  -- Points at an existing goal where there is one, rather than duplicating
  -- its date and distance. Nullable so a coach can pencil in a race that
  -- isn't yet a formal goal.
  athlete_goal_id uuid REFERENCES public.athlete_goals(id) ON DELETE SET NULL,

  race_date     date NOT NULL,
  name          text,
  distance_m    numeric,

  -- What this race is FOR. Only 'peak' races get a full taper and the
  -- campaign's highest load; 'tune_up' gets a short freshening; 'training'
  -- races are run through with no taper at all. This is the field that makes
  -- a track season expressible.
  priority      text NOT NULL DEFAULT 'tune_up'
                CHECK (priority IN ('peak', 'tune_up', 'training')),

  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.campaign_targets.priority IS
  'peak = full taper and highest load; tune_up = short freshening; training = run through, no taper. A season can have several peaks.';

CREATE INDEX IF NOT EXISTS campaign_targets_campaign_idx ON public.campaign_targets (campaign_id, race_date);


-- ---------------------------------------------------------------------------
-- Blocks — a run of weeks with one purpose
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_blocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  block_order   integer NOT NULL,

  phase         text NOT NULL
                CHECK (phase IN ('base', 'build', 'peak', 'taper', 'transition', 'race_week')),
  label         text,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,

  -- Set when a coach has filled this block from a template. Used to leave it
  -- alone on regeneration — see the note on campaign_weeks.is_locked.
  filled_from_template_id uuid REFERENCES public.plan_templates(id) ON DELETE SET NULL,
  filled_at     timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_blocks_dates_ordered CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS campaign_blocks_campaign_idx ON public.campaign_blocks (campaign_id, block_order);


-- ---------------------------------------------------------------------------
-- Weeks — what the campaign actually asserts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_weeks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  block_id      uuid REFERENCES public.campaign_blocks(id) ON DELETE CASCADE,

  week_number   integer NOT NULL,
  week_start    date NOT NULL,

  -- Relative load, not absolute volume. A campaign shouldn't claim to know
  -- an athlete's kilometres — that depends on history the campaign doesn't
  -- see. 100 = the athlete's normal loading week; a peak week might be 115,
  -- a deload 70. Whoever fills the block turns that into real numbers.
  load_pct      numeric NOT NULL DEFAULT 100 CHECK (load_pct BETWEEN 30 AND 150),
  is_deload     boolean NOT NULL DEFAULT false,

  -- THE RULE THAT MAKES REGENERATION SAFE.
  --
  -- Set true the moment a human edits this week or sessions are created
  -- against it. Regeneration then re-proposes only unlocked weeks and reports
  -- what it left alone. Without this, moving the peak by a week would
  -- silently rewrite blocks a coach had already built — the single failure
  -- most likely to make someone stop trusting the feature permanently.
  is_locked     boolean NOT NULL DEFAULT false,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_weeks_unique UNIQUE (campaign_id, week_number)
);

COMMENT ON COLUMN public.campaign_weeks.load_pct IS
  'Relative load where 100 = the athlete''s normal loading week. Deliberately not absolute volume — the campaign does not know the athlete''s kilometres.';
COMMENT ON COLUMN public.campaign_weeks.is_locked IS
  'A human has touched this week. Regeneration skips it and says so.';

CREATE INDEX IF NOT EXISTS campaign_weeks_campaign_idx ON public.campaign_weeks (campaign_id, week_number);
CREATE INDEX IF NOT EXISTS campaign_weeks_start_idx ON public.campaign_weeks (week_start);


-- ---------------------------------------------------------------------------
-- Row level security — mirrors the athlete-access model used elsewhere
-- ---------------------------------------------------------------------------
ALTER TABLE public.campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_weeks   ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_blocks  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_weeks   TO authenticated;

-- can_access_athlete() is the same helper every other athlete-scoped table
-- uses. Reimplementing the rule here is what silently missed the manager role
-- on the gear-media storage policies, so it is called rather than copied.
DROP POLICY IF EXISTS "campaigns access" ON public.campaigns;
CREATE POLICY "campaigns access" ON public.campaigns
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

-- Children inherit access from the campaign rather than carrying their own
-- athlete_id: one place for the rule, and no way for a child row to disagree
-- with its parent about who may see it.
DROP POLICY IF EXISTS "campaign targets access" ON public.campaign_targets;
CREATE POLICY "campaign targets access" ON public.campaign_targets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c
                 WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)));

DROP POLICY IF EXISTS "campaign blocks access" ON public.campaign_blocks;
CREATE POLICY "campaign blocks access" ON public.campaign_blocks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c
                 WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)));

DROP POLICY IF EXISTS "campaign weeks access" ON public.campaign_weeks;
CREATE POLICY "campaign weeks access" ON public.campaign_weeks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaigns c
                 WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campaigns c
                      WHERE c.id = campaign_id AND public.can_access_athlete(auth.uid(), c.athlete_id)));


-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS campaigns_touch ON public.campaigns;
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS campaign_weeks_touch ON public.campaign_weeks;
CREATE TRIGGER campaign_weeks_touch BEFORE UPDATE ON public.campaign_weeks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Any manual edit to a week locks it, so regeneration can never quietly undo
-- a coach's change. Done in a trigger rather than in application code because
-- a week can be edited from more than one place, and one missed call site
-- would reintroduce exactly the failure this prevents.
CREATE OR REPLACE FUNCTION public.campaign_week_lock_on_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.load_pct IS DISTINCT FROM OLD.load_pct)
     OR (NEW.is_deload IS DISTINCT FROM OLD.is_deload)
     OR (NEW.notes IS DISTINCT FROM OLD.notes) THEN
    NEW.is_locked := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS campaign_weeks_lock ON public.campaign_weeks;
CREATE TRIGGER campaign_weeks_lock BEFORE UPDATE ON public.campaign_weeks
  FOR EACH ROW EXECUTE FUNCTION public.campaign_week_lock_on_edit();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'campaign%';
--
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename LIKE 'campaign%' ORDER BY tablename;
