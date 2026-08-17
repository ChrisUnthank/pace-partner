-- ============================================================================
-- A weekly-volume baseline on the campaign, so loads can be read and edited
-- in KILOMETRES.
--
-- campaign_weeks.load_pct stays the stored value — 100 = a normal loading
-- week — because it survives an athlete's volume changing, and a campaign
-- written in absolute km would be wrong the moment they stepped up.
--
-- But coaches don't think in percentages. "Three weeks at 100km then three at
-- 110" is how the plan actually exists in someone's head, and asking them to
-- convert that to 91% and 100% is asking them to do arithmetic to describe
-- something they already know.
--
-- So: one baseline per campaign. km = load_pct x baseline / 100, and typing a
-- km figure back-computes the percentage. The percentage remains the source of
-- truth; kilometres are a lens onto it.
--
-- Nullable on purpose — a coach who hasn't set a baseline sees percentages,
-- which is exactly what happens today. Nothing is forced.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS baseline_weekly_km numeric
    CHECK (baseline_weekly_km IS NULL OR (baseline_weekly_km > 0 AND baseline_weekly_km <= 400));

COMMENT ON COLUMN public.campaigns.baseline_weekly_km IS
  'The athlete''s normal loading week in km, i.e. what load_pct = 100 means. Optional: without it the campaign displays percentages. Never used in calculation — only to convert load_pct for display and entry.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, baseline_weekly_km FROM public.campaigns ORDER BY starts_on DESC;
