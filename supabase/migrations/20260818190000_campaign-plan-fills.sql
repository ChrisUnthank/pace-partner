-- ============================================================================
-- LINKING PLANS TO CAMPAIGNS — filling a campaign's weeks from a plan template.
--
-- The campaign layer produces weeks with a phase, a relative load and a deload
-- flag, and deliberately no sessions. Plan templates produce sessions and
-- deliberately no season structure. This migration is the join between them.
--
-- WHY THE LINK HANGS OFF THE WEEK, NOT THE BLOCK
--
-- campaign_blocks.filled_from_template_id was added in the original campaign
-- schema in anticipation of exactly this feature, and it is NOT what this
-- migration uses. It is left in place and unused.
--
-- The reason is that blocks stopped being durable. Since campaign_weeks
-- .phase_override was added, the blocks a coach actually sees are DERIVED from
-- the weeks at render time (deriveBlocks() in campaign-generator.ts) so that
-- overriding a single week's phase resplits the blocks around it and clearing
-- the override merges them back. campaign_blocks rows still exist and are
-- rewritten on save, but they are only a fallback phase source; the displayed
-- block has no stable identity and its order and label shift whenever any
-- week's phase changes.
--
-- So a fill recorded against a block would survive right up until the coach
-- flagged one of its weeks as an overload — at which point "Base 2" becomes
-- two blocks and the fill points at something that no longer exists as shown.
--
-- The week is the durable unit: stable id, UNIQUE (campaign_id, week_number),
-- a real week_start date, and an is_locked flag that already means "a human
-- touched this". A fill is a fact about specific weeks, not about a rendering
-- of a run of them.
--
-- WHY ONE FILL PER WEEK
--
-- UNIQUE on campaign_week_id. A campaign week either has a plan behind it or
-- it does not. Refilling replaces rather than accumulating, because two plans
-- claiming the same week is not a state anything downstream could resolve —
-- the same reasoning behind campaigns_one_active_idx.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A plan can now know which campaign it was created to serve.
--
-- Nullable, because assigning a plan directly to an athlete with no campaign
-- at all remains a first-class flow — a coach working week to week rather than
-- season-first is a supported way to use this app, not a degraded one.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a season must not delete
-- the training that was actually prescribed under it. Those sessions happened.
-- ---------------------------------------------------------------------------
ALTER TABLE public.athlete_plans
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS athlete_plans_campaign_idx
  ON public.athlete_plans (campaign_id) WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN public.athlete_plans.campaign_id IS
  'The campaign this plan was assigned to fill, when it was. Null for a plan assigned directly with no campaign — a supported flow, not a degraded one.';


-- ---------------------------------------------------------------------------
-- Which template week landed on which campaign week
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_week_fills (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  campaign_week_id    uuid NOT NULL REFERENCES public.campaign_weeks(id) ON DELETE CASCADE,
  athlete_plan_id     uuid NOT NULL REFERENCES public.athlete_plans(id) ON DELETE CASCADE,

  -- Kept alongside athlete_plan_id rather than only reachable through it:
  -- athlete_plans.plan_template_id is ON DELETE SET NULL, so deleting a
  -- template would otherwise erase all record of what a week was filled from.
  -- Same nulling rule here for the FK, but template_name survives it.
  plan_template_id    uuid REFERENCES public.plan_templates(id) ON DELETE SET NULL,
  template_name       text,

  -- WHICH week of the template this campaign week received. Not derivable
  -- from position: a template shorter than the block repeats (week 5 of a
  -- 6-week block can be template week 1 again), and a tail-aligned fill
  -- starts partway in. Without this column an "unfill and refill differently"
  -- could not explain what changed.
  template_week_number integer NOT NULL CHECK (template_week_number > 0),

  -- True when this campaign week received a template week that had already
  -- been used earlier in the same fill. Stored rather than recomputed so the
  -- UI can mark repeats without re-deriving the whole mapping.
  is_repeat           boolean NOT NULL DEFAULT false,

  -- The load actually applied, as a percentage of the athlete's normal
  -- loading week — campaign_weeks.load_pct at fill time, or 100 when the
  -- coach chose to keep the template's own progression instead.
  --
  -- Snapshotted deliberately. campaign_weeks.load_pct can be edited after a
  -- fill, and when it is, the sessions on the ground still carry the OLD
  -- figure. Reading the current week load would misreport what was actually
  -- prescribed.
  load_pct_applied    numeric NOT NULL DEFAULT 100 CHECK (load_pct_applied BETWEEN 30 AND 150),

  filled_at           timestamptz NOT NULL DEFAULT now(),
  filled_by           uuid DEFAULT auth.uid(),

  CONSTRAINT campaign_week_fills_one_per_week UNIQUE (campaign_week_id)
);

COMMENT ON TABLE public.campaign_week_fills IS
  'Which plan-template week filled which campaign week. Hangs off the week, not the block — blocks are derived at render time and have no stable identity.';
COMMENT ON COLUMN public.campaign_week_fills.load_pct_applied IS
  'Snapshot of the load used at fill time. Not read live from campaign_weeks: editing a week''s load afterwards does not retroactively change the sessions already prescribed.';

CREATE INDEX IF NOT EXISTS campaign_week_fills_plan_idx
  ON public.campaign_week_fills (athlete_plan_id);


-- ---------------------------------------------------------------------------
-- Row level security — read with the campaign, write only if it is writable.
--
-- Routed through campaign_weeks to reach the campaign rather than carrying a
-- denormalized campaign_id. One extra join, and no way for this table to
-- disagree with campaign_weeks about which campaign a row belongs to.
--
-- can_write_campaign() is called, not reimplemented — copying an access rule
-- is what silently missed the manager role on the gear-media storage policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.campaign_week_fills ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_week_fills TO authenticated;

DROP POLICY IF EXISTS "campaign week fills select" ON public.campaign_week_fills;
CREATE POLICY "campaign week fills select" ON public.campaign_week_fills
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.campaign_weeks w
    JOIN public.campaigns c ON c.id = w.campaign_id
    WHERE w.id = campaign_week_id
      AND public.can_access_athlete(auth.uid(), c.athlete_id)
  ));

DROP POLICY IF EXISTS "campaign week fills write" ON public.campaign_week_fills;
CREATE POLICY "campaign week fills write" ON public.campaign_week_fills
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.campaign_weeks w
    WHERE w.id = campaign_week_id
      AND public.can_write_campaign(auth.uid(), w.campaign_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaign_weeks w
    WHERE w.id = campaign_week_id
      AND public.can_write_campaign(auth.uid(), w.campaign_id)
  ));


-- ---------------------------------------------------------------------------
-- Note on the column this migration deliberately does not use.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.campaign_blocks.filled_from_template_id IS
  'UNUSED. Predates campaign_weeks.phase_override, after which blocks became derived at render time and lost stable identity. Fills are recorded per week in campaign_week_fills instead. Left in place rather than dropped so no existing row is destroyed; do not read it.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='athlete_plans' AND column_name='campaign_id';
--
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='campaign_week_fills' ORDER BY cmd;
--
-- Expect: one row for the column, and two policies (SELECT, ALL).
