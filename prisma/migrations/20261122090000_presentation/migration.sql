CREATE TYPE "PresentationScreen" AS ENUM ('LOBBY', 'PRIZES', 'DRAW', 'WINNER_WALL', 'RECAP');
CREATE TYPE "RevealPhase" AS ENUM ('IDLE', 'DRAWING', 'READY', 'REVEALING');

ALTER TABLE "event" ADD COLUMN "presentation" JSONB NOT NULL DEFAULT '{"countdownSeconds":5}';

CREATE TABLE "presentation_cursor" (
    "event_id" UUID NOT NULL,
    "preparation_id" UUID,
    "screen" "PresentationScreen" NOT NULL DEFAULT 'LOBBY',
    "prize_id" UUID,
    "draw_id" UUID,
    "phase" "RevealPhase" NOT NULL DEFAULT 'IDLE',
    "phase_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countdown_ms" INTEGER NOT NULL DEFAULT 0,
    "scene_ms" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "presentation_cursor_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "presentation_cursor_draw_screen_has_prize" CHECK ("screen" <> 'DRAW' OR "prize_id" IS NOT NULL),
    CONSTRAINT "presentation_cursor_phase_needs_draw_screen" CHECK ("phase" = 'IDLE' OR "screen" = 'DRAW'),
    CONSTRAINT "presentation_cursor_reveal_needs_draw" CHECK ("phase" NOT IN ('READY', 'REVEALING') OR "draw_id" IS NOT NULL),
    CONSTRAINT "presentation_cursor_timings" CHECK ("countdown_ms" BETWEEN 0 AND 60000 AND "scene_ms" BETWEEN 0 AND 600000)
);

ALTER TABLE "presentation_cursor" ADD CONSTRAINT "presentation_cursor_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "presentation_cursor" ADD CONSTRAINT "presentation_cursor_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "presentation_cursor" ADD CONSTRAINT "presentation_cursor_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prize"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "presentation_cursor" ADD CONSTRAINT "presentation_cursor_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "draw_reveal" (
    "draw_id" UUID NOT NULL,
    "preparation_id" UUID NOT NULL,
    "revealed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "draw_reveal_pkey" PRIMARY KEY ("draw_id"),
    CONSTRAINT "draw_reveal_visible_after_reveal" CHECK ("visible_at" >= "revealed_at")
);

CREATE INDEX "draw_reveal_preparation_id_visible_at_idx" ON "draw_reveal"("preparation_id", "visible_at");

ALTER TABLE "draw_reveal" ADD CONSTRAINT "draw_reveal_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "draw_reveal" ADD CONSTRAINT "draw_reveal_preparation_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "raffle_preparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "pcascade_draw_reveal_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "pcascade_purge_allowed"() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'draw_reveal rows are append-only' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'draw_reveal rows are append-only' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "draw" WHERE "id" = NEW."draw_id" AND "preparation_id" = NEW."preparation_id" AND "status" = 'COMMITTED') THEN
    RAISE EXCEPTION 'only a committed draw of this preparation can be revealed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "draw_reveal_guard" BEFORE INSERT OR UPDATE OR DELETE ON "draw_reveal" FOR EACH ROW EXECUTE FUNCTION "pcascade_draw_reveal_guard"();
