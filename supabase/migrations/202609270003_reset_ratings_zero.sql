UPDATE public.profiles
SET levels = jsonb_set(
  COALESCE(levels, '{}'::jsonb),
  '{progress}',
  COALESCE(levels -> 'progress', '{}'::jsonb) || jsonb_build_object('rating', 0),
  true
),
updated_at = now();
