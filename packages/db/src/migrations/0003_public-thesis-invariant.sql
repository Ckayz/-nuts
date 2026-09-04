CREATE OR REPLACE FUNCTION enforce_thesis_creator_position()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  thesis_row theses%ROWTYPE;
  position_row positions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'theses' THEN
    thesis_row := NEW;
    IF thesis_row.creator_position_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT * INTO position_row FROM positions WHERE id = thesis_row.creator_position_id;
    IF NOT FOUND
      OR position_row.thesis_id <> thesis_row.id
      OR position_row.user_id <> thesis_row.creator_user_id
      OR position_row.role <> 'creator'
      OR position_row.chain_id <> 8453
      OR position_row.status NOT IN ('confirmed', 'indexed', 'expired', 'settled')
      OR position_row.confirmed_at IS NULL
    THEN
      RAISE EXCEPTION 'invalid creator position for thesis %', thesis_row.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  FOR thesis_row IN SELECT * FROM theses WHERE creator_position_id = OLD.id LOOP
    IF TG_OP = 'DELETE'
      OR NEW.thesis_id <> thesis_row.id
      OR NEW.user_id <> thesis_row.creator_user_id
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
CREATE CONSTRAINT TRIGGER theses_creator_position_invariant
AFTER INSERT OR UPDATE ON theses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_thesis_creator_position();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER positions_creator_position_invariant
AFTER UPDATE OR DELETE ON positions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_thesis_creator_position();
