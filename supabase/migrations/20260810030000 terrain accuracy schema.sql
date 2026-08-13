-- ============================================================================
-- Terrain accuracy — Phase 1: schema (step-level terrain + location surrounds)
-- ============================================================================
--
-- THE PROBLEM: sessions.terrain is one value for the whole session. A track
-- session's warmup/cooldown (almost always run on grass/road/path around
-- the actual track, not the track surface itself) gets silently counted as
-- "track" time in any terrain-based analytics — inflating track time and
-- hiding whatever the warmup/cooldown genuinely was.
--
-- THIS MIGRATION adds the two columns needed to fix that automatically,
-- with no reliance on manual per-step tagging:
--
--   1. steps.terrain — same free-text-but-controlled-vocabulary convention
--      as sessions.terrain (track/road/trail/path/grass/treadmill/mixed).
--      Work steps get this from the EXISTING looksLikeTrackSession()
--      distance-consistency detector (already built, already correctly
--      scoped to work-lap data — this migration doesn't touch that logic,
--      just gives it somewhere step-level to write its answer). Warmup/
--      cooldown steps get this from the session's matched location's
--      surrounding_terrain below.
--
--   2. training_locations.surrounding_terrain — the general terrain AROUND
--      a saved location, distinct from that location's own primary
--      surface. A "Home Track" location's surface is 'track', but the
--      park around it — where warmup/cooldown actually happens — might be
--      'grass' or 'path'. This is what warmup/cooldown steps
--      automatically inherit once a session is matched to a location.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS terrain text;

COMMENT ON COLUMN public.steps.terrain IS
  'Same controlled vocabulary as sessions.terrain (track/road/trail/path/grass/treadmill/mixed). Auto-derived where possible — see rebuildSessionFromAllFiles in session-files.functions.ts — not manually required.';

ALTER TABLE public.training_locations
  ADD COLUMN IF NOT EXISTS surrounding_terrain text;

COMMENT ON COLUMN public.training_locations.surrounding_terrain IS
  'General terrain of the area AROUND this location, distinct from its own primary surface column — e.g. a track facility''s surface is "track" but its surrounding_terrain (where warmup/cooldown happens) might be "grass" or "path". Used to auto-populate warmup/cooldown step terrain for any session matched to this location.';

NOTIFY pgrst, 'reload schema';
