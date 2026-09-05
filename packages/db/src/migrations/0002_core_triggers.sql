CREATE OR REPLACE FUNCTION public.enforce_thesis_creator_position()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  thesis_row public.theses%ROWTYPE;
  position_row public.positions%ROWTYPE;
  current_position public.positions%ROWTYPE;
  position_exists boolean;
  creator_user public.users%ROWTYPE;
BEGIN
  -- Explicit validation locks always follow users -> positions -> theses.
  -- DML/FK locks already held by the caller can still cause deadlocks; callers
  -- must retry the whole transaction on 40P01 or 40001.
  IF TG_TABLE_NAME = 'theses' THEN
    -- Discover keys without locking, then re-read the current row under lock
    -- below. Queued NEW may refer to a link already cleared in this transaction.
    SELECT * INTO thesis_row FROM public.theses WHERE id = NEW.id;
    IF NOT FOUND OR thesis_row.creator_position_id IS NULL THEN
      RETURN NEW;
    END IF;
    -- Take the guard-write lock mode up front, avoiding upgrades after theses.
    SELECT * INTO creator_user FROM public.users WHERE id = thesis_row.creator_user_id FOR NO KEY UPDATE;
    SELECT * INTO position_row FROM public.positions WHERE id = thesis_row.creator_position_id FOR NO KEY UPDATE;
    position_exists := FOUND;
    SELECT * INTO thesis_row FROM public.theses WHERE id = NEW.id FOR SHARE;
    IF NOT FOUND OR thesis_row.creator_position_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF NOT position_exists
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
    -- Guard-row writes make stale REPEATABLE READ writers fail with 40001,
    -- even when their snapshot cannot see the newly published thesis.
    -- Conflict touch, not a data change: self-assignment still executes UPDATE, creating an MVCC tuple version (PostgreSQL 17 docs: mvcc-intro.html; transaction-iso.html, "Repeatable Read").
    UPDATE public.users SET updated_at = now() WHERE id = creator_user.id;
    UPDATE public.positions SET status = status WHERE id = position_row.id;
    -- Recursion terminates: the queued positions branch only reads, never
    -- touches rows. The users trigger is UPDATE OF wallet_address, so this
    -- updated_at-only write does not queue it. Neither write updates theses.
    RETURN NEW;
  END IF;

  -- Deferred events can describe an intermediate state, including a delete
  -- followed by reinsertion. Validate the row that exists at execution time.
  PERFORM u.id FROM public.users u
    WHERE u.id IN (SELECT t.creator_user_id FROM public.theses t WHERE t.creator_position_id = OLD.id)
    ORDER BY u.id FOR SHARE;
  SELECT * INTO current_position FROM public.positions WHERE id = OLD.id FOR SHARE;
  position_exists := FOUND;
  FOR thesis_row IN SELECT * FROM public.theses WHERE creator_position_id = OLD.id ORDER BY id FOR SHARE LOOP
    -- The user rows were locked before the position and thesis rows.
    SELECT * INTO creator_user FROM public.users WHERE id = thesis_row.creator_user_id;
    IF NOT position_exists
      OR current_position.thesis_id <> thesis_row.id
      OR current_position.user_id <> thesis_row.creator_user_id
      OR current_position.wallet_address IS DISTINCT FROM creator_user.wallet_address
      OR current_position.role <> 'creator'
      OR current_position.chain_id <> 8453
      OR current_position.status NOT IN ('confirmed', 'indexed', 'expired', 'settled')
      OR current_position.confirmed_at IS NULL
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
      WHERE t.creator_user_id = OLD.id AND t.status IN ('open', 'expired', 'settled'))
    ORDER BY p.id FOR SHARE;
  PERFORM t.id FROM public.theses t
    WHERE t.creator_user_id = OLD.id AND t.status IN ('open', 'expired', 'settled')
    ORDER BY t.id FOR SHARE;
  PERFORM 1 FROM public.theses t
    LEFT JOIN public.positions p ON p.id = t.creator_position_id
    WHERE t.creator_user_id = OLD.id AND t.status IN ('open', 'expired', 'settled')
      AND (current_creator_user.id IS NULL OR p.id IS NULL
           OR p.wallet_address IS DISTINCT FROM current_creator_user.wallet_address);
  IF FOUND THEN
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
