CREATE OR REPLACE FUNCTION public.get_public_match_history(p_player_id uuid)
RETURNS TABLE (
  result text,
  level text,
  moves integer,
  date text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT entry.item ->> 'result',
         entry.item ->> 'level',
         CASE
           WHEN entry.item ->> 'moves' ~ '^[0-9]+$'
           THEN (entry.item ->> 'moves')::integer
           ELSE 0
         END,
         entry.item ->> 'date'
  FROM public.profiles p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(p.history) = 'array' THEN p.history
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS entry(item, position)
  WHERE p.id = p_player_id
    AND entry.item ->> 'level' IN ('online', 'impossible', 'khaled')
  ORDER BY entry.position DESC
  LIMIT 10
$$;

REVOKE ALL ON FUNCTION public.get_public_match_history(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_match_history(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
