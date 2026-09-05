-- Preserve all non-NULL creator-link fences; unbacked posts are excluded.
CREATE OR REPLACE FUNCTION public.enforce_public_creator_wallet_unchanged()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_creator_user public.users%ROWTYPE;
BEGIN
  -- Compare the final wallet to the linked position, not queued OLD/NEW
  -- images: a wallet changed and then restored must pass every queued event.
  -- Same explicit lock order: users -> positions -> theses (IDs sorted within
  -- each table). The triggering UPDATE already holds its user row lock.
  SELECT * INTO current_creator_user FROM public.users WHERE id = OLD.id FOR SHARE;
  PERFORM p.id FROM public.positions p
    WHERE p.id IN (SELECT t.creator_position_id FROM public.theses t
      WHERE t.creator_user_id = OLD.id AND t.creator_position_id IS NOT NULL AND t.status IN ('open', 'expired', 'settled'))
    ORDER BY p.id FOR SHARE;
  PERFORM t.id FROM public.theses t
    WHERE t.creator_user_id = OLD.id AND t.creator_position_id IS NOT NULL AND t.status IN ('open', 'expired', 'settled')
    ORDER BY t.id FOR SHARE;
  PERFORM 1 FROM public.theses t
    LEFT JOIN public.positions p ON p.id = t.creator_position_id
    WHERE t.creator_user_id = OLD.id AND t.creator_position_id IS NOT NULL AND t.status IN ('open', 'expired', 'settled')
      AND (current_creator_user.id IS NULL OR p.id IS NULL
           OR p.wallet_address IS DISTINCT FROM current_creator_user.wallet_address);
  IF FOUND THEN
    RAISE EXCEPTION 'cannot change wallet of a public thesis creator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
