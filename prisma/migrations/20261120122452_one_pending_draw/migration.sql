CREATE UNIQUE INDEX "draw_one_pending_per_preparation" ON "draw"("preparation_id") WHERE "status" = 'PENDING_BEACON';
