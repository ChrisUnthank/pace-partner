-- ============================================================================
-- Tapers measured in DAYS, and the same per-athlete treatment for base and
-- build that taper depth already got.
--
-- ---------------------------------------------------------------------------
-- 1. TAPERS IN DAYS
-- ---------------------------------------------------------------------------
-- Coaches taper in days — "ten days out", "five days easy" — and weeks were
-- forcing that onto a Monday grid. The cost was visible: a one-week taper into
-- a Thursday race gave eleven reduced days, into a Sunday race fourteen, and
-- neither matched what the setting said.
--
-- The fix is NOT to store days instead of weeks. Weeks stay the unit for
-- storage and display, because that is how a season is read and how the
-- sessions that fill a block are organised. Instead the taper START is a date
-- — race_date minus taper_days — and each week's load is the average across
-- its seven days, with each day placed on the taper curve individually.
--
-- A 10-day taper then produces genuinely different weeks depending on where
-- the race falls:
--
--     Thursday race    week of 16 Nov  97%    week of 23 Nov  64%
--     Sunday race      week of 16 Nov 110%    week of 23 Nov  73%
--
-- Same ten days of tapering in both; the weeks differ because the days do.
--
-- taper_weeks is kept and still used when taper_days is null, so existing
-- campaigns are unaffected.
--
-- ---------------------------------------------------------------------------
-- 2. BASE AND BUILD PROFILES
-- ---------------------------------------------------------------------------
-- Taper depth became a setting because athletes differ. The same is true
-- further back: some athletes want base held flat at a sustainable figure with
-- a light touch every fourth week, others want it climbing. Hardcoding a ramp
-- asserted one coaching philosophy.
--
--   *_progression   'progressive' ramps across the block (the previous, and
--                   still default, behaviour)
--                   'flat' holds the block's top figure throughout, so the
--                   deload weeks provide all the variation
--
-- ---------------------------------------------------------------------------
-- 3. INTENSITY DENSITY
-- ---------------------------------------------------------------------------
-- load_pct is volume and says nothing about quality work. "Does base carry a
-- VO2 session every fortnight, and build one every week?" is a real planning
-- decision that the campaign currently cannot express, so it lives only in
-- whatever fills the block — invisible at season level.
--
-- Stored as sessions per week, allowing halves so "every second week" is
-- expressible as 0.5. Deliberately a COUNT, not a prescription: it says how
-- often quality appears, not what it is. What the session actually is remains
-- the job of the template that fills the week.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS taper_days integer
    CHECK (taper_days IS NULL OR taper_days BETWEEN 3 AND 35),
  ADD COLUMN IF NOT EXISTS key_taper_days integer
    CHECK (key_taper_days IS NULL OR key_taper_days BETWEEN 2 AND 21),
  ADD COLUMN IF NOT EXISTS base_progression text NOT NULL DEFAULT 'progressive'
    CHECK (base_progression IN ('progressive', 'flat')),
  ADD COLUMN IF NOT EXISTS build_progression text NOT NULL DEFAULT 'progressive'
    CHECK (build_progression IN ('progressive', 'flat')),
  ADD COLUMN IF NOT EXISTS base_quality_per_week numeric NOT NULL DEFAULT 0.5
    CHECK (base_quality_per_week >= 0 AND base_quality_per_week <= 4),
  ADD COLUMN IF NOT EXISTS build_quality_per_week numeric NOT NULL DEFAULT 2
    CHECK (build_quality_per_week >= 0 AND build_quality_per_week <= 4);

COMMENT ON COLUMN public.campaigns.taper_days IS
  'Taper length in DAYS before a peak race. When set, overrides taper_weeks — the taper starts race_date minus this many days, and each week''s load is averaged across its own days.';
COMMENT ON COLUMN public.campaigns.base_progression IS
  'progressive = load climbs across the block. flat = holds the top figure, with deloads providing the variation.';
COMMENT ON COLUMN public.campaigns.base_quality_per_week IS
  'How often quality work appears in base, as sessions per week. 0.5 means every second week. A count, not a prescription — what the session IS belongs to the template that fills the week.';

-- Per-week quality count, so a coach can override the phase default on any
-- single week without changing the whole block.
ALTER TABLE public.campaign_weeks
  ADD COLUMN IF NOT EXISTS quality_sessions numeric
    CHECK (quality_sessions IS NULL OR (quality_sessions >= 0 AND quality_sessions <= 5));

COMMENT ON COLUMN public.campaign_weeks.quality_sessions IS
  'Quality sessions planned this week. NULL inherits the phase default from the campaign.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, taper_weeks, taper_days, base_progression, build_progression,
--        base_quality_per_week, build_quality_per_week
-- FROM public.campaigns ORDER BY starts_on DESC;
