-- ============================================================================
-- Terrain accuracy — Phase 2: sessions can link to a saved route directly
-- ============================================================================
--
-- Found immediately after Phase 1 shipped: the location picker only ever
-- queried training_locations — a saved training_routes entry (a specific
-- GPS path, not a single point) had nowhere to go. sessions had no route
-- link at all, only location_id.
--
-- THE FIX: a real route_id column, not just quietly resolving a picked
-- route down to its location_id. A route carries its own identity (name,
-- distance, elevation) worth keeping on the session, not just borrowed
-- terrain data. Terrain auto-population still works when a route is
-- picked — the app resolves location_id from the route's own location_id
-- at selection time — this column is purely for keeping the route's own
-- identity attached to the session.
--
-- SAFE TO RE-RUN.
-- ============================================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.training_routes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sessions.route_id IS
  'Optional link to a saved training_routes entry. Distinct from location_id (which drives terrain auto-population) — a route may or may not have its own location_id set; when it does, picking a route also sets location_id from it.';

NOTIFY pgrst, 'reload schema';
