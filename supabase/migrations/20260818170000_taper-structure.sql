-- ============================================================================
-- Taper structure as TWO dimensions, not one choice.
--
-- taper_frequency_mode was binary — fewer days, or same days shortened. Real
-- tapers combine both independently:
--
--     one day off  + moderate session cut   ~64% of a normal week
--     one day off  + large session cut      ~47%
--     two days off + minimal session cut    ~64%
--     no days off  + large session cut      ~55%
--
-- Three of those reach a similar depth by different routes, and the route
-- matters: an athlete who needs a full day off is not served by the same
-- prescription as one who needs every day but shorter. A single flag could
-- not express the difference.
--
--   taper_rest_days_added     extra non-training days in a taper week, 0-3
--   taper_session_reduction   how much each remaining session shortens
--
-- These do NOT drive load_pct. Volume stays governed by taper_floor_pct and
-- taper_shape — deriving it from these two would double-count, since the
-- coach has already said how deep the taper goes. They describe how the week
-- is BUILT, which is the half a percentage can't carry.
--
-- What they do enable is a consistency check: if a coach asks for two days
-- off and minimal session reduction but sets the floor at 35%, those two
-- statements disagree, and it's worth saying so rather than silently
-- following one.
--
-- taper_frequency_mode is left in place. Dropping a column that a running
-- build might still read is a needless risk, and it costs nothing to leave.
-- ============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS taper_rest_days_added integer NOT NULL DEFAULT 1
    CHECK (taper_rest_days_added BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS taper_session_reduction text NOT NULL DEFAULT 'moderate'
    CHECK (taper_session_reduction IN ('minimal', 'moderate', 'large'));

COMMENT ON COLUMN public.campaigns.taper_rest_days_added IS
  'Extra non-training days in a taper week, on top of the athlete''s normal rest. 0 = same number of training days as usual.';
COMMENT ON COLUMN public.campaigns.taper_session_reduction IS
  'How much each remaining session shortens. minimal = barely; moderate = noticeably shorter; large = substantially cut.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT name, taper_strategy, taper_days, taper_floor_pct,
--        taper_rest_days_added, taper_session_reduction, taper_neuromuscular
-- FROM public.campaigns ORDER BY starts_on DESC;
