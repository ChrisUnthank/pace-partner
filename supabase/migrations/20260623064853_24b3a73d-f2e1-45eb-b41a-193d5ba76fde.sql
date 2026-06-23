ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS units text NOT NULL DEFAULT 'metric',
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_units_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_units_check CHECK (units IN ('metric','imperial'));