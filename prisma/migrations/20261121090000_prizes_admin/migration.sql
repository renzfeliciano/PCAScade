ALTER TABLE "import_row" ADD COLUMN "prize_id" UUID;

ALTER TABLE "import_row" ADD CONSTRAINT "import_row_single_target" CHECK ("participant_id" IS NULL OR "prize_id" IS NULL);

ALTER TABLE "prize" ADD CONSTRAINT "prize_code_format" CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$');

ALTER TABLE "prize" ADD CONSTRAINT "prize_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 120);

ALTER TABLE "prize" ADD CONSTRAINT "prize_quantity_limit" CHECK ("quantity" <= 1000);

ALTER TABLE "prize" ADD CONSTRAINT "prize_draw_order_positive" CHECK ("draw_order" > 0);

CREATE UNIQUE INDEX "prize_event_code_ci_key" ON "prize"("event_id", lower("code"));

ALTER TABLE "prize_category" ADD CONSTRAINT "prize_category_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 60);

CREATE UNIQUE INDEX "prize_category_event_name_ci_key" ON "prize_category"("event_id", lower("name"));
