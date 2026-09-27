CREATE TABLE IF NOT EXISTS public.game_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_code text NOT NULL CHECK (room_code ~ '^[0-9]{5}$'),
  watch_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS game_invites_recipient_pending_idx
  ON public.game_invites (recipient_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_invites FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_game_invite(
  p_friend_code text,
  p_room_code text,
  p_watch_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
  invite_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF p_room_code !~ '^[0-9]{5}$' OR length(p_watch_key) < 32 THEN
    RAISE EXCEPTION 'بيانات الروم غير صالحة';
  END IF;

  SELECT id INTO target_id
  FROM public.profiles
  WHERE friend_code = trim(p_friend_code);

  IF target_id IS NULL OR target_id = auth.uid() THEN
    RAISE EXCEPTION 'الصديق غير موجود';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE user_id = auth.uid() AND friend_id = target_id
  ) THEN
    RAISE EXCEPTION 'يمكنك دعوة أصدقائك المقبولين فقط';
  END IF;

  INSERT INTO public.game_invites (
    sender_id,
    recipient_id,
    room_code,
    watch_key
  )
  VALUES (
    auth.uid(),
    target_id,
    p_room_code,
    p_watch_key
  )
  RETURNING id INTO invite_id;

  RETURN invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_game_invites()
RETURNS TABLE (
  invite_id uuid,
  sender_name text,
  sender_code text,
  room_code text,
  watch_key text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id,
         coalesce(p.name, 'لاعب'),
         p.friend_code,
         i.room_code,
         i.watch_key,
         i.created_at,
         i.expires_at
  FROM public.game_invites i
  JOIN public.profiles p ON p.id = i.sender_id
  WHERE i.recipient_id = auth.uid()
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.respond_game_invite(
  p_invite_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_row public.game_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite_row
  FROM public.game_invites
  WHERE id = p_invite_id
    AND recipient_id = auth.uid()
    AND status = 'pending'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'انتهت صلاحية الدعوة أو لم تعد متاحة';
  END IF;

  UPDATE public.game_invites
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE id = p_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_game_invite(text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_pending_game_invites() FROM public, anon;
REVOKE ALL ON FUNCTION public.respond_game_invite(uuid, boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.send_game_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_game_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invite(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
