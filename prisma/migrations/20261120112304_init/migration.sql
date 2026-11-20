-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PARTICIPANT_PHOTO', 'PRIZE_PHOTO', 'EVENT_COVER', 'EVENT_LOGO');

-- CreateEnum
CREATE TYPE "PreparationStatus" AS ENUM ('DRAFT', 'FROZEN', 'DRAWING', 'COMPLETED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DrawStatus" AS ENUM ('PENDING_BEACON', 'COMMITTED', 'FAILED', 'VOIDED');

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "department" TEXT,
    "job_title" TEXT,
    "bio" TEXT,
    "email" TEXT,
    "custom_values" JSONB NOT NULL DEFAULT '{}',
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "photo_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_blob" (
    "asset_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "media_blob_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "prize" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "draw_order" INTEGER NOT NULL,
    "eligibility_rule" JSONB NOT NULL DEFAULT '{}',
    "photo_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffle_preparation" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PreparationStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "participants_sha256" BYTEA,
    "prizes_sha256" BYTEA,
    "rules_sha256" BYTEA,
    "seed_commitment" BYTEA,
    "algorithm_version" TEXT NOT NULL,
    "frozen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raffle_preparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw" (
    "id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "prize_id" UUID NOT NULL,
    "slot_number" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "DrawStatus" NOT NULL,
    "beacon_round" BIGINT,
    "beacon_signature" BYTEA,
    "candidate_count" INTEGER,
    "candidate_list_sha256" BYTEA,
    "selected_index" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(3),

    CONSTRAINT "draw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner" (
    "id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "exclusivity_key" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_slug_key" ON "event"("slug");

-- CreateIndex
CREATE INDEX "participant_event_id_eligible_status_idx" ON "participant"("event_id", "eligible", "status");

-- CreateIndex
CREATE UNIQUE INDEX "participant_event_id_external_id_key" ON "participant"("event_id", "external_id");

-- CreateIndex
CREATE INDEX "media_asset_event_id_kind_idx" ON "media_asset"("event_id", "kind");

-- CreateIndex
CREATE INDEX "prize_event_id_draw_order_idx" ON "prize"("event_id", "draw_order");

-- CreateIndex
CREATE UNIQUE INDEX "prize_event_id_code_key" ON "prize"("event_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "raffle_preparation_event_id_version_key" ON "raffle_preparation"("event_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "draw_idempotency_key_key" ON "draw"("idempotency_key");

-- CreateIndex
CREATE INDEX "draw_preparation_id_prize_id_idx" ON "draw"("preparation_id", "prize_id");

-- CreateIndex
CREATE UNIQUE INDEX "draw_preparation_id_sequence_key" ON "draw"("preparation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "winner_draw_id_key" ON "winner"("draw_id");

-- CreateIndex
CREATE INDEX "winner_preparation_id_idx" ON "winner"("preparation_id");

-- AddForeignKey
ALTER TABLE "participant" ADD CONSTRAINT "participant_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant" ADD CONSTRAINT "participant_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_blob" ADD CONSTRAINT "media_blob_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize" ADD CONSTRAINT "prize_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize" ADD CONSTRAINT "prize_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_preparation" ADD CONSTRAINT "raffle_preparation_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner" ADD CONSTRAINT "winner_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner" ADD CONSTRAINT "winner_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner" ADD CONSTRAINT "winner_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "draw_active_slot_key" ON "draw"("preparation_id", "prize_id", "slot_number") WHERE "status" <> 'VOIDED';

CREATE UNIQUE INDEX "winner_active_exclusivity_key" ON "winner"("preparation_id", "exclusivity_key") WHERE "voided_at" IS NULL AND "exclusivity_key" IS NOT NULL;

CREATE UNIQUE INDEX "raffle_preparation_active_event_key" ON "raffle_preparation"("event_id") WHERE "status" IN ('FROZEN', 'DRAWING');

ALTER TABLE "prize" ADD CONSTRAINT "prize_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "draw" ADD CONSTRAINT "draw_slot_positive" CHECK ("slot_number" > 0);

ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_dimensions_positive" CHECK ("width" > 0 AND "height" > 0 AND "byte_size" > 0);
