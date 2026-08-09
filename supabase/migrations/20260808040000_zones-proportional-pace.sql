-- ============================================================================
-- Zones — Phase 1: proportional pace-zone model
-- ============================================================================
--
-- MUST RUN AFTER 20260808030000_zones-baseline-capture.sql.
--
-- THE BUG THIS FIXES
-- zones_from_pace_threshold used flat SECOND offsets (+85/+45/+20/-5/-20/-35s
-- per km) regardless of the athlete's own threshold pace. Because Auto and
-- Manual both funnel through this one function, this affected every athlete
-- with a pace threshold, not just manually-configured ones.
--
-- The concrete, observed symptom this explains: a fast/fit athlete's easy
-- running lands overwhelmingly in Z1 (Recovery) with almost nothing in Z2/Z3.
-- A fixed 85-second gap is a much smaller PERCENTAGE of a fast athlete's
-- threshold pace than a slower athlete's, so proportionally more of a fast
-- athlete's actual training paces fall inside that wide absolute-second
-- Recovery band before crossing into Endurance/Tempo. Worked example, same
-- offsets applied to two different athletes:
--
--   Elite (3:20/km threshold, 200 sec/km):        Recovery edge = +42.5%
--   Recreational (6:40/km threshold, 400 sec/km): Recovery edge = +21.25%
--
-- The recreational athlete's zone was, proportionally, half as wide — purely
-- a side effect of flat seconds, nothing to do with their actual training.
--
-- THE FIX
-- Switch to a multiplier-of-threshold-pace model — the same 6-band structure
-- already documented (but never actually connected to the live DB) in
-- src/lib/zone-calculator.ts's PACE_BANDS. Each zone's cutoff scales with the
-- athlete's own threshold pace, so zone widths stay proportionally consistent
-- across abilities.
--
--   Zone (fast→slow)     Multiplier of threshold pace
--   z1 (Recovery edge)    1.50x
--   z2 (Endurance edge)   1.30x
--   z3 (Tempo edge)       1.04x
--   z4 (Threshold edge)   0.97x
--   z5 (VO2 Max edge)     0.90x
--   z6 (display ceiling)  0.80x  — same "open-ended fastest zone, display
--                                  only, never used in bucketing" role z6
--                                  already had; not a new concept.
--
-- HR zones are UNCHANGED in this migration — kept exactly as the live
-- 72/83/94/100/108% bands, per direct decision. Only the mislabeling (the
-- Threshold HR method's UI text calling these "Friel's published %LTHR
-- bands," which they are not) is corrected, in a separate small TSX change
-- delivered alongside this migration, not here.
--
-- WHO THIS AFFECTS
-- Every athlete with ANY pace threshold set — Auto or Manual alike, per the
-- direct decision that whatever's active should drive analysis. This is
-- most of the roster, not an edge case. See the backfill block at the
-- bottom, which must be run manually and is NOT automatic.
--
-- SAFE TO RE-RUN.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.zones_from_pace_threshold(_threshold_sec_per_km numeric)
RETURNS TABLE(z1_max numeric, z2_max numeric, z3_max numeric, z4_max numeric, z5_max numeric, z6_max numeric)
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT
    _threshold_sec_per_km * 1.50,
    _threshold_sec_per_km * 1.30,
    _threshold_sec_per_km * 1.04,
    _threshold_sec_per_km * 0.97,
    _threshold_sec_per_km * 0.90,
    -- z6: display-only fastest ceiling, same role the old flat-offset
    -- version's z6 played (never used in bucketing — recompute_session_zones
    -- treats anything faster than z5_max as z6 via its ELSE branch,
    -- regardless of this value). Anchored at the Anaerobic band's own fast
    -- edge for a sensible display number, not a real second boundary.
    _threshold_sec_per_km * 0.80
  WHERE _threshold_sec_per_km IS NOT NULL AND _threshold_sec_per_km > 0;
$function$;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- ONE-TIME MANUAL BACKFILL — run separately in the Supabase SQL Editor after
-- confirming the function above deployed correctly. Nothing above touches
-- any existing athlete's stored zones or any past session's recorded
-- classification — those only change when explicitly recomputed, which is
-- exactly what this block does, deliberately, for everyone with a pace
-- threshold set.
-- ============================================================================
--
-- Step 1 — recompute every affected athlete's stored zone boundaries.
-- recompute_athlete_zone_profile() is safe to call on a Manual-source
-- profile too: manual mode only skips recomputing the THRESHOLD VALUE
-- itself, but this step doesn't touch the threshold value — it re-derives
-- z1_max..z6_max from whatever threshold is already stored, via the
-- now-corrected zones_from_pace_threshold. So this is safe and necessary
-- for Auto and Manual athletes alike.
--
-- DO $$
-- DECLARE ath uuid;
-- BEGIN
--   FOR ath IN
--     SELECT athlete_id FROM public.athlete_zone_profiles
--     WHERE pace_threshold_sec_per_km IS NOT NULL
--   LOOP
--     PERFORM public.recompute_athlete_zone_profile(ath);
--   END LOOP;
-- END $$;
--
-- Step 2 — recompute every past session's stored zone-time for those same
-- athletes, so history reflects the corrected zones too, not just anything
-- logged from today onward. This can take a while on a large roster; run it
-- during a quiet period.
--
-- DO $$
-- DECLARE sess uuid;
-- BEGIN
--   FOR sess IN
--     SELECT s.id FROM public.sessions s
--     JOIN public.athlete_zone_profiles zp ON zp.athlete_id = s.athlete_id
--     WHERE zp.pace_threshold_sec_per_km IS NOT NULL
--   LOOP
--     PERFORM public.recompute_session_zones(sess);
--   END LOOP;
-- END $$;
--
-- Step 3 — sanity check on a specific athlete before/after, to confirm the
-- fix actually did something sensible:
--
-- SELECT athlete_id, pace_threshold_sec_per_km,
--        pace_z1_max_sec_per_km, pace_z2_max_sec_per_km, pace_z3_max_sec_per_km,
--        pace_z4_max_sec_per_km, pace_z5_max_sec_per_km, pace_z6_max_sec_per_km
-- FROM public.athlete_zone_profiles
-- WHERE athlete_id = '<ATHLETE_ID>';
-- ============================================================================
