-- Custom SQL migration file, put your code below! --> statement-breakpoint
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "currencies_currencies_set_updated_at"
BEFORE UPDATE ON "currencies_currencies"
FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
