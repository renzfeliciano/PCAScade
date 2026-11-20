-- AlterTable
ALTER TABLE "event" ADD COLUMN     "accent" TEXT NOT NULL DEFAULT 'safety-amber',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "venue" TEXT,
ADD COLUMN     "welcome_message" TEXT;

-- CreateTable
CREATE TABLE "admin_user" (
    "id" SMALLINT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" UUID NOT NULL,
    "admin_id" SMALLINT NOT NULL,
    "token_sha256" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" BIGSERIAL NOT NULL,
    "client_key" BYTEA NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" BIGSERIAL NOT NULL,
    "event_id" UUID,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "prev_hash" BYTEA NOT NULL,
    "hash" BYTEA NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_session_token_sha256_key" ON "admin_session"("token_sha256");

-- CreateIndex
CREATE INDEX "admin_session_expires_at_idx" ON "admin_session"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempt_client_key_created_at_idx" ON "login_attempt"("client_key", "created_at");

-- CreateIndex
CREATE INDEX "login_attempt_created_at_idx" ON "login_attempt"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_prev_hash_key" ON "audit_log"("prev_hash");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_hash_key" ON "audit_log"("hash");

-- CreateIndex
CREATE INDEX "audit_log_event_id_seq_idx" ON "audit_log"("event_id", "seq");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_single_row" CHECK ("id" = 1);

ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_token_length" CHECK (octet_length("token_sha256") = 32);

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_hash_length" CHECK (octet_length("hash") = 32 AND octet_length("prev_hash") = 32);

CREATE FUNCTION "pcascade_audit_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;

CREATE TRIGGER "audit_log_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION "pcascade_audit_log_append_only"();

CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION "pcascade_audit_log_append_only"();
