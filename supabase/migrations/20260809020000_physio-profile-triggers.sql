-- ============================================================================
-- Physio Profile — Phase 1: automatic recompute triggers
-- ============================================================================
--
-- THE PROBLEM
-- recompute_physio_profile() is well-built — proper least-squares PB
-- regression, genuine age/training-age adjustment, careful archetype/
-- coaching-note generation. But nothing ever calls it automatically. Every
-- call site in the app (athlete-detail page, Strengths & Development card,
-- Performance Curve card) is a manual "Refresh" button handler. No database
-- trigger existed at all. A new PB, a birthday, an updated training-age
-- value — none of it reaches the stored profile until someone remembers to
-- click Refresh on that specific athlete's page.
--
-- Since athlete_dna_ratings already has its own trigger reacting to changes
-- on athlete_physio_profile (trg_recompute_dna_from_physio, confirmed live),
-- fixing the staleness here also fixes DNA's Endurance/Anaerobic Capacity
-- staleness for free — no DNA code needs to change.
--
-- THE FIX
-- Two triggers, same pattern already proven for Zones
-- (trg_recompute_zones_from_perf / trg_recompute_zones_from_athlete):
--
--   1. Any performances change (new PB, correction, deletion) for an
--      athlete → recompute their physio profile.
--   2. Any change to an athlete's dob or training_age_years → recompute,
--      since both feed the age_shift/ta_shift adjustment directly.
--
-- Same honesty note as the Zones baseline migration: no trigger existed
-- under any name for this function (confirmed via a live pg_trigger search
-- before writing this), but the discover-and-drop-by-function-binding
-- pattern is used anyway rather than a plain CREATE TRIGGER, purely as
-- cheap insurance against ever creating a duplicate if this migration is
-- ever re-run after some other trigger gets added by hand later.
--
-- SAFE TO RE-RUN.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_recompute_physio_from_perf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recompute_physio_profile(COALESCE(NEW.athlete_id, OLD.athlete_id));
  RETURN NULL;
END
$function$;

DO $$
DECLARE trg record;
BEGIN
  FOR trg IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'performances' AND c.relnamespace = 'public'::regnamespace
      AND p.proname = 'trg_recompute_physio_from_perf' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.performances', trg.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_recompute_physio_from_perf_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_physio_from_perf();


CREATE OR REPLACE FUNCTION public.trg_recompute_physio_from_athlete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.dob IS DISTINCT FROM OLD.dob
     OR NEW.training_age_years IS DISTINCT FROM OLD.training_age_years THEN
    PERFORM public.recompute_physio_profile(NEW.id);
  END IF;
  RETURN NULL;
END
$function$;

DO $$
DECLARE trg record;
BEGIN
  FOR trg IN
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'athletes' AND c.relnamespace = 'public'::regnamespace
      AND p.proname = 'trg_recompute_physio_from_athlete' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.athletes', trg.tgname);
  END LOOP;
END $$;
CREATE TRIGGER trg_recompute_physio_from_athlete_after_update
  AFTER UPDATE ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_physio_from_athlete();


-- SAFETY CHECK — run after deploying, should show exactly one trigger per
-- function:
--
-- SELECT c.relname, p.proname, count(*)
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_proc p ON p.oid = t.tgfoid
-- WHERE p.proname IN ('trg_recompute_physio_from_perf', 'trg_recompute_physio_from_athlete')
--   AND NOT t.tgisinternal
-- GROUP BY 1, 2;

-- ============================================================================
-- ONE-TIME BACKFILL — run manually after deploying. The triggers only catch
-- FUTURE changes; every athlete's existing profile is still whatever it was
-- the last time someone happened to click Refresh. This recomputes everyone
-- once so the whole roster starts from a current baseline.
-- ============================================================================
--
-- DO $$
-- DECLARE ath uuid;
-- BEGIN
--   FOR ath IN SELECT id FROM public.athletes
--   LOOP
--     PERFORM public.recompute_physio_profile(ath);
--   END LOOP;
-- END $$;
-- ============================================================================
