
-- 1. Templates
CREATE TABLE public.session_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text NOT NULL,
  notes text,
  intent public.session_intent NOT NULL,
  structure public.session_structure NOT NULL,
  is_long_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_templates TO authenticated;
GRANT ALL ON public.session_templates TO service_role;

ALTER TABLE public.session_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own templates" ON public.session_templates
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "Owner can insert own templates" ON public.session_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can update own templates" ON public.session_templates
  FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can delete own templates" ON public.session_templates
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE TRIGGER session_templates_touch_updated_at
  BEFORE UPDATE ON public.session_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX session_templates_owner_idx ON public.session_templates(owner_user_id);

-- 2. Template steps — mirrors public.steps minus session_id / computed fields
CREATE TABLE public.template_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.session_templates(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  kind public.step_kind NOT NULL,
  reps int NOT NULL DEFAULT 1,
  set_count smallint NOT NULL DEFAULT 1,
  target_kind public.target_kind,
  target_distance_m numeric,
  target_time_seconds numeric,
  target_pace_sec_per_km numeric,
  is_ladder boolean NOT NULL DEFAULT false,
  counts_toward_distance boolean NOT NULL DEFAULT true,
  recovery_between_reps_seconds int,
  recovery_between_reps_mode text,
  recovery_between_sets_seconds int,
  recovery_between_sets_mode text,
  recovery_mode public.recovery_mode,
  recovery_target_kind public.target_kind,
  recovery_target_seconds numeric,
  recovery_target_distance_m numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_steps TO authenticated;
GRANT ALL ON public.template_steps TO service_role;

ALTER TABLE public.template_steps ENABLE ROW LEVEL SECURITY;

-- Access mirrors parent template ownership
CREATE POLICY "Owner can read own template steps" ON public.template_steps
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.session_templates t WHERE t.id = template_id AND t.owner_user_id = auth.uid())
  );
CREATE POLICY "Owner can insert own template steps" ON public.template_steps
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.session_templates t WHERE t.id = template_id AND t.owner_user_id = auth.uid())
  );
CREATE POLICY "Owner can update own template steps" ON public.template_steps
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.session_templates t WHERE t.id = template_id AND t.owner_user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.session_templates t WHERE t.id = template_id AND t.owner_user_id = auth.uid())
  );
CREATE POLICY "Owner can delete own template steps" ON public.template_steps
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.session_templates t WHERE t.id = template_id AND t.owner_user_id = auth.uid())
  );

CREATE UNIQUE INDEX template_steps_template_order_idx ON public.template_steps(template_id, step_order);

-- 3. Soft breadcrumb on sessions (no FK constraint by design)
ALTER TABLE public.sessions ADD COLUMN applied_from_template_id uuid;
