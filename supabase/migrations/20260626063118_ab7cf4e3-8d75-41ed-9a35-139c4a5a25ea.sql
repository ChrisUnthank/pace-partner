ALTER TABLE public.raw_session_points
  ADD COLUMN IF NOT EXISTS distance_m numeric;

NOTIFY pgrst, 'reload schema';