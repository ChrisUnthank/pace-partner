
CREATE POLICY "session-files athlete write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'session-files' AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.athletes WHERE user_id = auth.uid()));
CREATE POLICY "session-files athlete read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'session-files' AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.athletes WHERE user_id = auth.uid()));
CREATE POLICY "session-files athlete delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'session-files' AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.athletes WHERE user_id = auth.uid()));
CREATE POLICY "session-files coach read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'session-files' AND (storage.foldername(name))[1] IN (SELECT athlete_id::text FROM public.coach_athletes WHERE coach_user_id = auth.uid()));
