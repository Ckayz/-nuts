ALTER TABLE "theses" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
-- Only slug changes. Avoid revalidating historically permitted linked drafts.
-- Drizzle runs this migration transactionally; the table DDL lock prevents writers.
ALTER TABLE "theses" DISABLE TRIGGER "theses_creator_position_invariant";
--> statement-breakpoint
DO $$
DECLARE
  row_record record;
  prefix text;
  hex_id text;
  candidate text;
  suffix_length integer;
BEGIN
  FOR row_record IN SELECT id, headline FROM public.theses ORDER BY id LOOP
    -- TODO-OWNER: placeholder prefix bounds = 6 words / 64 ASCII characters.
    -- ASCII translate + C collation deliberately avoid locale-sensitive lower().
    prefix := rtrim(left(array_to_string((string_to_array(
      trim(both '-' from regexp_replace(translate(row_record.headline,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') COLLATE "C",
        '[^a-z0-9]+', '-', 'g')), '-'))[1:6], '-'), 64), '-');
    hex_id := replace(row_record.id::text, '-', '');
    suffix_length := 4;
    candidate := CASE WHEN prefix = '' THEN hex_id ELSE prefix || '-' || left(hex_id, suffix_length) END;
    WHILE EXISTS (SELECT 1 FROM public.theses WHERE slug = candidate) LOOP
      IF prefix = '' OR suffix_length = 32 THEN
        RAISE EXCEPTION 'UUID slug already occupied for %', row_record.id;
      END IF;
      suffix_length := suffix_length + 1;
      candidate := prefix || '-' || left(hex_id, suffix_length);
    END LOOP;
    UPDATE public.theses SET slug = candidate WHERE id = row_record.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "theses" ENABLE TRIGGER "theses_creator_position_invariant";
--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "theses_slug_unique" ON "theses" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_unique" ON "users" USING btree ("handle");--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_slug_format" CHECK ("theses"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_format" CHECK ("users"."handle" ~ '^[a-z0-9_]+$');--> statement-breakpoint
-- TODO-OWNER: placeholder handle bounds = 1–32 characters; owner sets them.
ALTER TABLE "users" ADD CONSTRAINT "users_handle_length" CHECK (char_length("users"."handle") between 1 and 32);
