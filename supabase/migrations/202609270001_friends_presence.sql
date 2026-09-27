ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS friend_code text,
  ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen timestamptz,
  ADD COLUMN IF NOT EXISTS active_room text,
  ADD COLUMN IF NOT EXISTS active_watch_key text;

DO $$
DECLARE
  profile_row record;
  candidate text;
BEGIN
  FOR profile_row IN
    SELECT id FROM public.profiles WHERE friend_code IS NULL
  LOOP
    LOOP
      candidate := (10000 + floor(random() * 90000))::integer::text;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE friend_code = candidate
      );
    END LOOP;

    UPDATE public.profiles
    SET friend_code = candidate
    WHERE id = profile_row.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_friend_code_key
  ON public.profiles (friend_code);

CREATE OR REPLACE FUNCTION public.assign_profile_friend_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate text;
BEGIN
  IF NEW.friend_code IS NULL OR NEW.friend_code !~ '^[0-9]{5}$' THEN
    SELECT friend_code INTO candidate
    FROM public.profiles
    WHERE id = NEW.id;

    IF candidate IS NOT NULL AND candidate ~ '^[0-9]{5}$' THEN
      NEW.friend_code := candidate;
    ELSE
      LOOP
        candidate := (10000 + floor(random() * 90000))::integer::text;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.profiles WHERE friend_code = candidate
        );
      END LOOP;
      NEW.friend_code := candidate;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_friend_code ON public.profiles;
CREATE TRIGGER profiles_assign_friend_code
  BEFORE INSERT OR UPDATE OF friend_code ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_profile_friend_code();

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_key
  ON public.friend_requests (
    least(sender_id, recipient_id),
    greatest(sender_id, recipient_id)
  )
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.friendships (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

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

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.friend_requests FROM anon, authenticated;
REVOKE ALL ON public.friendships FROM anon, authenticated;
REVOKE ALL ON public.game_invites FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_friend_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_code text;
  candidate text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  SELECT friend_code INTO existing_code
  FROM public.profiles
  WHERE id = auth.uid();

  IF existing_code IS NOT NULL AND existing_code ~ '^[0-9]{5}$' THEN
    RETURN existing_code;
  END IF;

  LOOP
    candidate := (10000 + floor(random() * 90000))::integer::text;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE friend_code = candidate
    );
  END LOOP;

  UPDATE public.profiles
  SET friend_code = candidate
  WHERE id = auth.uid() AND friend_code IS NULL;

  SELECT friend_code INTO existing_code
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN existing_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_friend_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
  target_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  SELECT id, name INTO target_id, target_name
  FROM public.profiles
  WHERE friend_code = trim(p_friend_code);

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على هذا المعرّف';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكنك إضافة نفسك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.friendships
    WHERE user_id = auth.uid() AND friend_id = target_id
  ) THEN
    RAISE EXCEPTION 'هذا اللاعب موجود في قائمة أصدقائك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.friend_requests
    WHERE status = 'pending'
      AND ((sender_id = auth.uid() AND recipient_id = target_id)
        OR (sender_id = target_id AND recipient_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'يوجد طلب صداقة قائم بينكما';
  END IF;

  INSERT INTO public.friend_requests (sender_id, recipient_id)
  VALUES (auth.uid(), target_id);

  RETURN coalesce(target_name, 'لاعب');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_friend_requests()
RETURNS TABLE (
  request_id uuid,
  sender_id uuid,
  sender_name text,
  sender_code text,
  requested_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, p.id, coalesce(p.name, 'لاعب'), p.friend_code, r.created_at
  FROM public.friend_requests r
  JOIN public.profiles p ON p.id = r.sender_id
  WHERE r.recipient_id = auth.uid() AND r.status = 'pending'
  ORDER BY r.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(
  p_request_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.friend_requests%ROWTYPE;
BEGIN
  SELECT * INTO request_row
  FROM public.friend_requests
  WHERE id = p_request_id
    AND recipient_id = auth.uid()
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الصداقة غير متاح';
  END IF;

  UPDATE public.friend_requests
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      updated_at = now()
  WHERE id = p_request_id;

  IF p_accept THEN
    INSERT INTO public.friendships (user_id, friend_id)
    VALUES
      (request_row.sender_id, request_row.recipient_id),
      (request_row.recipient_id, request_row.sender_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_friends()
RETURNS TABLE (
  friend_id uuid,
  friend_name text,
  friend_code text,
  is_online boolean,
  last_seen timestamptz,
  active_room text,
  active_watch_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         coalesce(p.name, 'لاعب'),
         p.friend_code,
         coalesce(p.is_online AND p.last_seen > now() - interval '60 seconds', false),
         p.last_seen,
         CASE
           WHEN p.is_online AND p.last_seen > now() - interval '60 seconds'
           THEN p.active_room
         END,
         CASE
           WHEN p.is_online AND p.last_seen > now() - interval '60 seconds'
           THEN p.active_watch_key
         END
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.friend_id
  WHERE f.user_id = auth.uid()
  ORDER BY p.is_online DESC, p.name ASC
$$;

CREATE OR REPLACE FUNCTION public.set_my_presence(
  p_is_online boolean,
  p_active_room text DEFAULT NULL,
  p_active_watch_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  UPDATE public.profiles
  SET is_online = p_is_online,
      last_seen = now(),
      active_room = CASE WHEN p_is_online THEN p_active_room ELSE NULL END,
      active_watch_key = CASE WHEN p_is_online THEN p_active_watch_key ELSE NULL END,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;

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

REVOKE ALL ON FUNCTION public.get_my_friend_code() FROM public, anon;
REVOKE ALL ON FUNCTION public.send_friend_request(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_friend_requests() FROM public, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_my_friends() FROM public, anon;
REVOKE ALL ON FUNCTION public.set_my_presence(boolean, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.send_game_invite(text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_pending_game_invites() FROM public, anon;
REVOKE ALL ON FUNCTION public.respond_game_invite(uuid, boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.get_my_friend_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friend_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_friends() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_presence(boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_game_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_game_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invite(uuid, boolean) TO authenticated;
