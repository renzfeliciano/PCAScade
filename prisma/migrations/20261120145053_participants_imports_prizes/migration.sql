-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('STAGED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ParticipantFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('PARTICIPANTS', 'PRIZES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('STAGED', 'VALIDATED', 'COMMITTED', 'CANCELLED', 'REVERTED');

-- CreateEnum
CREATE TYPE "DuplicateMode" AS ENUM ('SKIP', 'UPDATE', 'REJECT');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'INVALID');

-- CreateEnum
CREATE TYPE "PrizeStatus" AS ENUM ('AVAILABLE', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "participant_display" JSONB NOT NULL DEFAULT '{"department":true,"jobTitle":true,"bio":false,"photo":true}';

-- AlterTable
ALTER TABLE "media_asset" ADD COLUMN     "import_batch_id" UUID,
ADD COLUMN     "original_name" TEXT,
ADD COLUMN     "status" "MediaStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "prize" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "status" "PrizeStatus" NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE "participant_field" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ParticipantFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'STAGED',
    "duplicate_mode" "DuplicateMode" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" BYTEA NOT NULL,
    "sheet_name" TEXT,
    "column_mapping" JSONB NOT NULL,
    "photo_rule" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "create_count" INTEGER NOT NULL DEFAULT 0,
    "update_count" INTEGER NOT NULL DEFAULT 0,
    "skip_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMPTZ(3),
    "committed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "reverted_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "action" "ImportRowAction",
    "participant_id" UUID,
    "photo_ref" TEXT,
    "photo_asset_id" UUID,
    "before_image" JSONB,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prize_category" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "scene_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prize_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "participant_field_event_id_key_key" ON "participant_field"("event_id", "key");

-- CreateIndex
CREATE INDEX "import_batch_event_id_created_at_idx" ON "import_batch"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "import_row_batch_id_action_idx" ON "import_row"("batch_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_batch_id_row_number_key" ON "import_row"("batch_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "prize_category_event_id_slug_key" ON "prize_category"("event_id", "slug");

-- CreateIndex
CREATE INDEX "media_asset_import_batch_id_idx" ON "media_asset"("import_batch_id");

-- CreateIndex
CREATE INDEX "participant_event_id_full_name_idx" ON "participant"("event_id", "full_name");

-- AddForeignKey
ALTER TABLE "participant_field" ADD CONSTRAINT "participant_field_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_category" ADD CONSTRAINT "prize_category_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize" ADD CONSTRAINT "prize_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "prize_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "prize_category_event_id_id_key" ON "prize_category"("event_id", "id");

ALTER TABLE "prize" ADD CONSTRAINT "prize_category_same_event_fkey" FOREIGN KEY ("event_id", "category_id") REFERENCES "prize_category"("event_id", "id") ON DELETE RESTRICT;

ALTER TABLE "participant_field" ADD CONSTRAINT "participant_field_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');

ALTER TABLE "participant_field" ADD CONSTRAINT "participant_field_key_reserved" CHECK ("key" NOT IN ('external_id', 'full_name', 'department', 'job_title', 'bio', 'email', 'eligible', 'photo_filename'));

ALTER TABLE "import_row" ADD CONSTRAINT "import_row_invalid_has_errors" CHECK ("action" IS DISTINCT FROM 'INVALID' OR jsonb_array_length("errors") > 0);

ALTER TABLE "prize_category" ADD CONSTRAINT "prize_category_scene_key" CHECK ("scene_key" IN ('brick-by-brick', 'build-it-up', 'big-lift', 'grand-finale'));
