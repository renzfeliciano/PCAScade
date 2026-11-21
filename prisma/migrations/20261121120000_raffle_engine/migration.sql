CREATE TYPE "CorrectionReason" AS ENUM ('WINNER_ABSENT', 'INELIGIBLE', 'DATA_ERROR', 'TECHNICAL_ISSUE', 'OTHER');

ALTER TABLE "raffle_preparation"
  ADD COLUMN "participants_json" TEXT,
  ADD COLUMN "prizes_json" TEXT,
  ADD COLUMN "rules_json" TEXT,
  ADD COLUMN "manifest_sha256" BYTEA,
  ADD COLUMN "seed_ciphertext" BYTEA,
  ADD COLUMN "revealed_seed" BYTEA,
  ADD COLUMN "participant_count" INTEGER,
  ADD COLUMN "slot_count" INTEGER,
  ADD COLUMN "status_reason" TEXT,
  ADD COLUMN "closed_at" TIMESTAMPTZ(3),
  ADD COLUMN "superseded_by_id" UUID;

ALTER TABLE "raffle_preparation" ADD CONSTRAINT "raffle_preparation_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raffle_preparation" ADD CONSTRAINT "raffle_preparation_status_reason_length" CHECK ("status_reason" IS NULL OR length(btrim("status_reason")) BETWEEN 3 AND 500);

DROP INDEX "raffle_preparation_active_event_key";
CREATE UNIQUE INDEX "raffle_preparation_open_event_key" ON "raffle_preparation"("event_id") WHERE "status" IN ('DRAFT', 'FROZEN', 'DRAWING');
CREATE UNIQUE INDEX "raffle_preparation_superseded_by_id_key" ON "raffle_preparation"("superseded_by_id");

CREATE TABLE "winner_correction" (
    "id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "winner_id" UUID,
    "after_sequence" INTEGER NOT NULL,
    "reason_category" "CorrectionReason" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_correction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "winner_correction_reason_length" CHECK (length(btrim("reason_text")) BETWEEN 3 AND 500),
    CONSTRAINT "winner_correction_after_sequence_positive" CHECK ("after_sequence" > 0)
);

CREATE UNIQUE INDEX "winner_correction_draw_id_key" ON "winner_correction"("draw_id");
CREATE UNIQUE INDEX "winner_correction_winner_id_key" ON "winner_correction"("winner_id");
CREATE INDEX "winner_correction_preparation_id_idx" ON "winner_correction"("preparation_id");

ALTER TABLE "winner_correction" ADD CONSTRAINT "winner_correction_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_correction" ADD CONSTRAINT "winner_correction_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winner_correction" ADD CONSTRAINT "winner_correction_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "winner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "pcascade_purge_allowed"() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('pcascade.allow_purge', true), '') = 'on'
$$;

CREATE FUNCTION "pcascade_raffle_no_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "pcascade_purge_allowed"() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are part of the raffle record and cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
END
$$;

CREATE FUNCTION "pcascade_correction_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND "pcascade_purge_allowed"() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'winner_correction rows are append-only' USING ERRCODE = 'P0001';
END
$$;

CREATE FUNCTION "pcascade_preparation_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."event_id", NEW."version", NEW."created_at") IS DISTINCT FROM (OLD."id", OLD."event_id", OLD."version", OLD."created_at") THEN
    RAISE EXCEPTION 'preparation identity cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'SUPERSEDED' AND OLD."superseded_by_id" IS NULL AND NEW."superseded_by_id" IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_by_id') = (to_jsonb(OLD) - 'superseded_by_id') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('COMPLETED', 'CANCELLED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'a % preparation cannot change', lower(OLD."status"::text) USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."participants_json", NEW."prizes_json", NEW."rules_json", NEW."rules",
    NEW."participants_sha256", NEW."prizes_sha256", NEW."rules_sha256", NEW."manifest_sha256",
    NEW."seed_commitment", NEW."seed_ciphertext", NEW."algorithm_version",
    NEW."participant_count", NEW."slot_count", NEW."frozen_at"
  ) IS DISTINCT FROM (
    OLD."participants_json", OLD."prizes_json", OLD."rules_json", OLD."rules",
    OLD."participants_sha256", OLD."prizes_sha256", OLD."rules_sha256", OLD."manifest_sha256",
    OLD."seed_commitment", OLD."seed_ciphertext", OLD."algorithm_version",
    OLD."participant_count", OLD."slot_count", OLD."frozen_at"
  ) THEN
    RAISE EXCEPTION 'snapshots of a frozen preparation cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."revealed_seed" IS NOT NULL AND NEW."revealed_seed" IS DISTINCT FROM OLD."revealed_seed" THEN
    RAISE EXCEPTION 'a revealed seed cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('FROZEN', 'CANCELLED')) OR
    (OLD."status" = 'FROZEN' AND NEW."status" IN ('DRAWING', 'CANCELLED', 'SUPERSEDED')) OR
    (OLD."status" = 'DRAWING' AND NEW."status" IN ('COMPLETED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'a preparation cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "pcascade_draw_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('VOIDED', 'FAILED') THEN
    RAISE EXCEPTION 'a % draw cannot change', lower(OLD."status"::text) USING ERRCODE = 'P0001';
  END IF;
  IF (NEW."id", NEW."preparation_id", NEW."prize_id", NEW."slot_number", NEW."sequence", NEW."idempotency_key", NEW."beacon_round", NEW."created_at")
     IS DISTINCT FROM (OLD."id", OLD."preparation_id", OLD."prize_id", OLD."slot_number", OLD."sequence", OLD."idempotency_key", OLD."beacon_round", OLD."created_at") THEN
    RAISE EXCEPTION 'draw identity and target round cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" = 'COMMITTED' THEN
    IF NEW."status" <> 'VOIDED' OR (NEW."beacon_signature", NEW."candidate_count", NEW."candidate_list_sha256", NEW."selected_index", NEW."committed_at")
       IS DISTINCT FROM (OLD."beacon_signature", OLD."candidate_count", OLD."candidate_list_sha256", OLD."selected_index", OLD."committed_at") THEN
      RAISE EXCEPTION 'a committed draw can only be voided' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW."status" = 'VOIDED' AND NOT EXISTS (SELECT 1 FROM "winner_correction" WHERE "draw_id" = OLD."id") THEN
    RAISE EXCEPTION 'voiding a draw needs a recorded correction' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "pcascade_winner_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."draw_id", NEW."preparation_id", NEW."participant_id", NEW."exclusivity_key", NEW."created_at")
     IS DISTINCT FROM (OLD."id", OLD."draw_id", OLD."preparation_id", OLD."participant_id", OLD."exclusivity_key", OLD."created_at") THEN
    RAISE EXCEPTION 'a winner record cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."voided_at" IS NOT NULL OR NEW."voided_at" IS NULL THEN
    RAISE EXCEPTION 'a winner can only be voided once' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "winner_correction" WHERE "draw_id" = OLD."draw_id") THEN
    RAISE EXCEPTION 'voiding a winner needs a recorded correction' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "raffle_preparation_guard" BEFORE UPDATE ON "raffle_preparation" FOR EACH ROW EXECUTE FUNCTION "pcascade_preparation_guard"();
CREATE TRIGGER "raffle_preparation_no_delete" BEFORE DELETE ON "raffle_preparation" FOR EACH ROW EXECUTE FUNCTION "pcascade_raffle_no_delete"();
CREATE TRIGGER "draw_guard" BEFORE UPDATE ON "draw" FOR EACH ROW EXECUTE FUNCTION "pcascade_draw_guard"();
CREATE TRIGGER "draw_no_delete" BEFORE DELETE ON "draw" FOR EACH ROW EXECUTE FUNCTION "pcascade_raffle_no_delete"();
CREATE TRIGGER "winner_guard" BEFORE UPDATE ON "winner" FOR EACH ROW EXECUTE FUNCTION "pcascade_winner_guard"();
CREATE TRIGGER "winner_no_delete" BEFORE DELETE ON "winner" FOR EACH ROW EXECUTE FUNCTION "pcascade_raffle_no_delete"();
CREATE TRIGGER "winner_correction_append_only" BEFORE UPDATE OR DELETE ON "winner_correction" FOR EACH ROW EXECUTE FUNCTION "pcascade_correction_append_only"();
