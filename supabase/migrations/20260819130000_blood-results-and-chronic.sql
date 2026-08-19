-- ============================================================================
-- BLOOD RESULTS, plus the missing illness categories.
--
-- Two unrelated things in one migration because they arrive from the same
-- conversation and both touch how an athlete's health is recorded. They are
-- separated below.
-- ============================================================================


-- ============================================================================
-- PART 1 — illness categories, and chronic conditions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Asthma and allergies added, plus a generic respiratory catch-all.
--
-- The existing respiratory_upper / respiratory_lower stay: the distinction
-- between a head cold and a chest infection changes a training decision, and
-- collapsing them into one "respiratory" would lose that. The generic option
-- is for the entry where nobody knows which it is yet.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries DROP CONSTRAINT IF EXISTS injuries_illness_type_check;

ALTER TABLE public.injuries
  ADD CONSTRAINT injuries_illness_type_check
    CHECK (illness_type IS NULL OR illness_type = ANY (ARRAY[
      'respiratory_upper','respiratory_lower','respiratory_other',
      'asthma','allergies',
      'gastrointestinal','fever','viral','other'
    ]::text[]));


-- ---------------------------------------------------------------------------
-- Chronic conditions are a different shape from an illness.
--
-- Asthma and allergies are not episodes an athlete recovers from — they are
-- standing facts about the athlete that flare and settle. The existing
-- active/monitoring/resolved status cannot express that: an asthma record
-- would sit in "Active" forever alongside an acute calf strain, which is both
-- noise in the current-problems list and wrong.
--
-- Flagged rather than given a separate table, for the same reason illness
-- shares this table: anything asking "what is going on with this athlete"
-- wants chronic conditions in the answer, and a second table means every
-- reader has to remember to union it.
--
-- Seasonal hay fever that genuinely does resolve each year can still be
-- logged as an ordinary illness — this is a flag, not a category.
-- ---------------------------------------------------------------------------
ALTER TABLE public.injuries
  ADD COLUMN IF NOT EXISTS is_chronic boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.injuries.is_chronic IS
  'An ongoing condition rather than an episode — asthma, allergies. Shown separately from current problems, since it never resolves and would otherwise sit in the active list permanently.';


-- ============================================================================
-- PART 2 — blood results
--
-- WHY A SEPARATE TABLE AND NOT MORE COLUMNS ON injuries
--
-- A blood result is not a problem someone has; it is a measurement taken on a
-- date. It has a value, a unit, a reference range, and its meaning comes from
-- its trend rather than its status. Low ferritin might CAUSE an illness record
-- or might sit quietly below range for a year while the athlete trains
-- normally. Modelling it as an injury would force an onset date and a
-- resolution onto something that has neither.
--
-- TWO TABLES, NOT ONE
--
-- Results arrive as a pathology report: one draw, one date, one lab, many
-- markers. Panels preserve that grouping, which matters for reading a report
-- back as it was issued. Markers hang off it for trending one value over time,
-- which is the other thing a coach actually does with this.
--
-- REFERENCE RANGES ARE STORED PER RESULT, AS THE LAB REPORTED THEM
--
-- Not hardcoded. Ranges differ by lab, by assay, by sex and by age, and a
-- range baked into this schema would be silently wrong for some athletes
-- forever. The lab printed a range on the report; that is the one that applies
-- to that measurement.
--
-- This matters especially for iron. Population reference ranges for ferritin
-- commonly start around 30 ug/L, and a good deal of sports-medicine practice
-- treats endurance athletes as wanting considerably more than that. Those are
-- contested clinical opinions, not facts, and this schema deliberately does
-- not encode any of them — it stores what the lab said and leaves the
-- interpretation to whoever is qualified to make it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.blood_panels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,

  -- The date of the DRAW, not of entry. Trends are meaningless otherwise, and
  -- results are routinely entered days after the blood was taken.
  taken_on     date NOT NULL,

  lab_name     text,
  ordered_by   text,
  -- Why it was taken: routine screening, chasing fatigue, post-illness. The
  -- reason changes how a borderline number should be read.
  reason       text,
  notes        text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT auth.uid(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blood_panels_athlete_date_idx
  ON public.blood_panels (athlete_id, taken_on DESC);

COMMENT ON TABLE public.blood_panels IS
  'One blood draw. Groups the markers measured together so a report can be read back as it was issued.';


CREATE TABLE IF NOT EXISTS public.blood_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id     uuid NOT NULL REFERENCES public.blood_panels(id) ON DELETE CASCADE,

  -- Denormalized from the panel so RLS and per-marker trend queries do not
  -- need the join. Kept in step by the app, which writes both together.
  athlete_id   uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,

  -- Free text against a curated suggestion list in the UI rather than an enum.
  -- A CHECK here would reject the first marker a lab reports that nobody
  -- anticipated, and losing a real measurement is worse than an untidy name.
  marker       text NOT NULL,
  value        numeric NOT NULL,
  unit         text NOT NULL,

  -- As printed on the report. Either may be absent — plenty of markers are
  -- reported as "< 5" or with an upper bound only.
  ref_low      numeric,
  ref_high     numeric,

  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blood_results_panel_idx
  ON public.blood_results (panel_id);
CREATE INDEX IF NOT EXISTS blood_results_athlete_marker_idx
  ON public.blood_results (athlete_id, marker);

COMMENT ON COLUMN public.blood_results.ref_low IS
  'Lower reference bound AS REPORTED BY THE LAB. Never a value from this schema — ranges vary by lab, assay, sex and age, and a hardcoded one would be silently wrong for some athletes indefinitely.';


-- ---------------------------------------------------------------------------
-- RLS — same access rule as every other athlete-owned health record.
--
-- can_access_athlete() is called rather than reimplemented; copying an access
-- rule is what previously missed the manager role on the gear-media policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.blood_panels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blood_panels  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blood_results TO authenticated;

DROP POLICY IF EXISTS "blood panels access via athlete" ON public.blood_panels;
CREATE POLICY "blood panels access via athlete" ON public.blood_panels
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

DROP POLICY IF EXISTS "blood results access via athlete" ON public.blood_results;
CREATE POLICY "blood results access via athlete" ON public.blood_results
  FOR ALL TO authenticated
  USING (public.can_access_athlete(auth.uid(), athlete_id))
  WITH CHECK (public.can_access_athlete(auth.uid(), athlete_id));

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFY — run separately.
-- ============================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename IN ('blood_panels','blood_results');
-- Expect: one ALL policy per table.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='injuries' AND column_name='is_chronic';
-- Expect: one row.
