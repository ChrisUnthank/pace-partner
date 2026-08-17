-- ============================================================================
-- Campaign: a 'key' race tier, configurable load levels, and the down period
-- moved to the START of the campaign.
--
-- WHY EACH CHANGE
--
-- 1. 'key' priority. Between tune_up and peak. An AU track season typically
--    has one or two races before Christmas that matter, then State
--    Championships and several others, before a single true peak at
--    Nationals. Those middle races earn a short taper — not the full one a
--    peak gets, and considerably more than a tune-up. Without the tier they
--    were being forced into one or the other.
--
-- 2. Load levels as SETTINGS, not constants. Three of my defaults have
--    already turned out wrong in conversation: race weeks were dropping to
--    85-95% when a coach might only take 10-20% off, and deload was applied
--    on a fixed fourth-week rhythm when plenty of coaches don't deload that
--    way at all. Every number the generator emits is now a column with a
--    default, so a coach can disagree with it and the campaign still
--    regenerates to their shape rather than back to mine.
--
-- 3. The down period moves to the START. A season is a loop — XCR winter,
--    track spring and summer, Nationals, a short down period, then XCR again.
--    Treating the down weeks as the tail of the finished campaign makes them
--    an afterthought planned when the goal is already behind you. Putting
--    them at the head of the NEXT campaign means recovery is planned with the
--    next build in view, which is when it actually matters.
--
--    transition_weeks is kept and defaulted to 0 rather than dropped, so any
--    campaign already created keeps its meaning.
-- ============================================================================

-- ---- 1. the 'key' tier ----------------------------------------------------
ALTER TABLE public.campaign_targets DROP CONSTRAINT IF EXISTS campaign_targets_priority_check;
ALTER TABLE public.campaign_targets
  ADD CONSTRAINT campaign_targets_priority_check
  CHECK (priority IN ('peak', 'key', 'tune_up', 'training'));

COMMENT ON COLUMN public.campaign_targets.priority IS
  'peak = full taper, the season''s target. key = short taper, races that matter (State champs and similar). tune_up = a few days easier, no taper week. training = raced through, volume held, sessions adjusted away from lactic work.';

-- ---- 2. the down period at the front --------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS reset_weeks integer NOT NULL DEFAULT 2 CHECK (reset_weeks BETWEEN 0 AND 8);

COMMENT ON COLUMN public.campaigns.reset_weeks IS
  'Down weeks at the START of the campaign — the break after the previous season, planned as part of what follows it rather than as the tail of what preceded it.';

ALTER TABLE public.campaigns ALTER COLUMN transition_weeks SET DEFAULT 0;

-- 'reset' joins the phase vocabulary. Distinct from 'transition' so a
-- campaign that has both reads correctly.
ALTER TABLE public.campaign_blocks DROP CONSTRAINT IF EXISTS campaign_blocks_phase_check;
ALTER TABLE public.campaign_blocks
  ADD CONSTRAINT campaign_blocks_phase_check
  CHECK (phase IN ('reset', 'base', 'build', 'peak', 'taper', 'transition', 'race_week'));

-- ---- 3. load levels, configurable -----------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS load_deload_pct        integer NOT NULL DEFAULT 70  CHECK (load_deload_pct BETWEEN 30 AND 100),
  -- Race weeks are NOT deloads. A coach might take only 10-20% off for a
  -- club race while a deload is a genuine 30% cut, so they get separate
  -- settings rather than sharing one scale.
  ADD COLUMN IF NOT EXISTS race_week_reduction_pct integer NOT NULL DEFAULT 15 CHECK (race_week_reduction_pct BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS load_peak_pct          integer NOT NULL DEFAULT 115 CHECK (load_peak_pct BETWEEN 100 AND 150),
  ADD COLUMN IF NOT EXISTS load_base_start_pct    integer NOT NULL DEFAULT 85  CHECK (load_base_start_pct BETWEEN 40 AND 120),
  ADD COLUMN IF NOT EXISTS load_base_top_pct      integer NOT NULL DEFAULT 100 CHECK (load_base_top_pct BETWEEN 40 AND 130),
  ADD COLUMN IF NOT EXISTS load_build_start_pct   integer NOT NULL DEFAULT 95  CHECK (load_build_start_pct BETWEEN 40 AND 130),
  ADD COLUMN IF NOT EXISTS load_build_top_pct     integer NOT NULL DEFAULT 110 CHECK (load_build_top_pct BETWEEN 40 AND 140),
  ADD COLUMN IF NOT EXISTS load_reset_pct         integer NOT NULL DEFAULT 50  CHECK (load_reset_pct BETWEEN 0 AND 90),
  -- Taper length for a 'key' race. Shorter than a peak's by design.
  ADD COLUMN IF NOT EXISTS key_taper_weeks        integer NOT NULL DEFAULT 1  CHECK (key_taper_weeks BETWEEN 0 AND 3),
  -- Recovery after a peak race before normal training resumes. Zero is
  -- legitimate for an athlete who races into the next block.
  ADD COLUMN IF NOT EXISTS post_peak_recovery_weeks integer NOT NULL DEFAULT 1 CHECK (post_peak_recovery_weeks BETWEEN 0 AND 3),
  -- Deloads on a fixed rhythm suit some coaches and not others. Off means
  -- loading runs continuously and the coach inserts recovery by hand.
  ADD COLUMN IF NOT EXISTS deloads_enabled        boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.campaigns.race_week_reduction_pct IS
  'How much volume comes off a non-taper race week. A training race often keeps its volume entirely and only changes session TYPE — the reduction is the coach''s call, not the generator''s.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT column_name, column_default FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='campaigns' AND column_name LIKE 'load%'
--    OR (table_name='campaigns' AND column_name IN ('reset_weeks','key_taper_weeks','deloads_enabled','race_week_reduction_pct'))
-- ORDER BY column_name;
