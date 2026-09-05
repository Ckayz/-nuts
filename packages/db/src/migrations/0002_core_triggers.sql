CREATE OR REPLACE FUNCTION public.enforce_thesis_creator_position()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  thesis_row public.theses%ROWTYPE;
  position_row public.positions%ROWTYPE;
  creator_user public.users%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'theses' THEN
    thesis_row := NEW;
    IF thesis_row.creator_position_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT * INTO creator_user FROM public.users WHERE id = thesis_row.creator_user_id;
    SELECT * INTO position_row FROM public.positions WHERE id = thesis_row.creator_position_id;
    IF NOT FOUND
      OR position_row.thesis_id <> thesis_row.id
      OR position_row.user_id <> thesis_row.creator_user_id
      OR position_row.wallet_address IS DISTINCT FROM creator_user.wallet_address
      OR position_row.role <> 'creator'
      OR position_row.chain_id <> 8453
      OR position_row.status NOT IN ('confirmed', 'indexed', 'expired', 'settled')
      OR position_row.confirmed_at IS NULL
    THEN
      RAISE EXCEPTION 'invalid creator position for thesis %', thesis_row.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  FOR thesis_row IN SELECT * FROM public.theses WHERE creator_position_id = OLD.id LOOP
    SELECT * INTO creator_user FROM public.users WHERE id = thesis_row.creator_user_id;
    IF TG_OP = 'DELETE'
      OR NEW.thesis_id <> thesis_row.id
      OR NEW.user_id <> thesis_row.creator_user_id
      OR NEW.wallet_address IS DISTINCT FROM creator_user.wallet_address
      OR NEW.role <> 'creator'
      OR NEW.chain_id <> 8453
      OR NEW.status NOT IN ('confirmed', 'indexed', 'expired', 'settled')
      OR NEW.confirmed_at IS NULL
    THEN
      RAISE EXCEPTION 'position % violates creator invariant for thesis %', OLD.id, thesis_row.id USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_public_creator_wallet_unchanged()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.wallet_address IS DISTINCT FROM OLD.wallet_address
    AND EXISTS (SELECT 1 FROM public.theses WHERE creator_user_id = NEW.id AND status IN ('open', 'expired', 'settled'))
  THEN
    RAISE EXCEPTION 'cannot change wallet of a public thesis creator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_order_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'theses' THEN
    IF NEW.creator_order_snapshot IS DISTINCT FROM OLD.creator_order_snapshot THEN
      RAISE EXCEPTION 'creator order snapshot is immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.order_snapshot IS DISTINCT FROM OLD.order_snapshot THEN
      RAISE EXCEPTION 'position order snapshot is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER theses_creator_position_invariant
AFTER INSERT OR UPDATE ON theses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_thesis_creator_position();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER positions_creator_position_invariant
AFTER UPDATE OR DELETE ON positions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_thesis_creator_position();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER users_public_creator_wallet_invariant
AFTER UPDATE OF wallet_address ON public.users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_public_creator_wallet_unchanged();
--> statement-breakpoint
CREATE TRIGGER theses_order_snapshot_immutable
BEFORE UPDATE ON public.theses
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_snapshot_immutable();
--> statement-breakpoint
CREATE TRIGGER positions_order_snapshot_immutable
BEFORE UPDATE ON public.positions
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_snapshot_immutable();
