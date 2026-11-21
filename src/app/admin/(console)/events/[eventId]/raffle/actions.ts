"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { BeaconUnavailableError } from "@/modules/beacon/drand";
import { raffleRulesSchema } from "@/modules/raffle/domain/snapshot";
import { DrawError, type DrawErrorCode } from "@/modules/raffle/server/draw";
import {
  CORRECTION_REASONS,
  RaffleError,
  cancelPreparation,
  completePreparation,
  createPreparation,
  freezePreparation,
  freshStart,
  resetDraw,
  updateDraft,
} from "@/modules/raffle/server/preparations";
import { finishPendingDraw, runDraw } from "@/modules/raffle/server/run-draw";
import { decryptSeed, seedKeyFromBase64 } from "@/modules/raffle/server/seed-vault";

export type RaffleActionState = { error?: string; message?: string };

const uuid = z.uuid();

function validIds(...ids: string[]) {
  return ids.every((id) => uuid.safeParse(id).success);
}

function seedKey(): Uint8Array {
  return seedKeyFromBase64(serverEnv().RAFFLE_SEED_ENCRYPTION_KEY);
}

const DRAW_MESSAGES: Record<DrawErrorCode, string> = {
  PREPARATION_NOT_FOUND: "This raffle no longer exists.",
  PREPARATION_NOT_ACTIVE: "This raffle is not open for drawing.",
  PREPARATION_NOT_SEALED: "This raffle was never sealed.",
  SNAPSHOT_CORRUPT: "The frozen snapshot no longer matches its hash. Stop and investigate before drawing.",
  PRIZE_NOT_FOUND: "That prize is not part of this raffle.",
  PRIZE_EXHAUSTED: "Every winner for that prize has been drawn.",
  STALE_REQUEST: "The console was out of date. It has been refreshed; check the slot and draw again.",
  NO_ELIGIBLE_PARTICIPANTS: "Nobody is left who can win that prize under the rules.",
  ROSTER_CHANGED_SINCE_FREEZE: "The participant list was changed outside the app after the freeze. Stop and investigate before drawing.",
  DRAW_IN_PROGRESS: "Another draw is still waiting for its beacon round.",
  IDEMPOTENCY_CONFLICT: "That request was already used for a different prize.",
  DRAW_NOT_FOUND: "That draw no longer exists.",
  DRAW_NOT_PENDING: "That draw is no longer waiting for a beacon.",
  BEACON_CHAIN_MISMATCH: "The beacon came from the wrong drand network.",
  BEACON_ROUND_MISMATCH: "The beacon round does not match the one committed for this draw.",
  SEED_COMMITMENT_MISMATCH: "The stored seed does not match its commitment. Stop and investigate before drawing.",
};

function failure(error: unknown): RaffleActionState {
  if (error instanceof RaffleError) return { error: error.message };
  if (error instanceof DrawError) return { error: DRAW_MESSAGES[error.code] };
  if (error instanceof BeaconUnavailableError) {
    return { error: "The drand beacon could not be reached. The draw is saved and waiting; press Retry beacon when the network is back. The result cannot change." };
  }
  throw error;
}

function refresh(eventId: string, preparationId?: string) {
  revalidatePath(`/admin/events/${eventId}/raffle`);
  if (preparationId) {
    revalidatePath(`/admin/events/${eventId}/raffle/${preparationId}`);
    revalidatePath(`/admin/events/${eventId}/raffle/${preparationId}/console`);
  }
}

function readRules(formData: FormData) {
  return raffleRulesSchema.safeParse({ repeatWinners: formData.get("repeatWinners"), voidedWinnerRedraw: formData.get("voidedWinnerRedraw") });
}

export async function prepareRaffleAction(eventId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId)) return { error: "This event no longer exists." };
  const rules = readRules(formData);
  if (!rules.success) return { error: "Choose the winner rules." };
  let preparationId: string;
  try {
    preparationId = (await createPreparation(db(), { eventId, rules: rules.data, seedKey: seedKey() })).id;
  } catch (error) {
    return failure(error);
  }
  refresh(eventId);
  redirect(`/admin/events/${eventId}/raffle/${preparationId}`);
}

export async function updateRulesAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  const rules = readRules(formData);
  if (!rules.success) return { error: "Choose the winner rules." };
  try {
    await updateDraft(db(), { preparationId, rules: rules.data });
  } catch (error) {
    return failure(error);
  }
  refresh(eventId, preparationId);
  return { message: "Rules saved and snapshots refreshed. Review the new manifest before freezing." };
}

export async function freezeAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  if (formData.get("confirm") !== "yes") return { error: "Confirm that you have recorded the manifest hash." };
  const expected = String(formData.get("manifest") ?? "");
  try {
    const result = await freezePreparation(db(), { preparationId, expectedManifestSha256: expected });
    refresh(eventId, preparationId);
    if (!result.frozen) {
      return {
        error:
          result.reason === "DATA_CHANGED"
            ? "Participants, prizes or rules changed since this draft was prepared. The snapshots were refreshed. Review the new manifest hash and freeze again."
            : "The manifest changed after you opened this page. Review the current manifest hash and freeze again.",
      };
    }
  } catch (error) {
    return failure(error);
  }
  return { message: "Frozen. Participants and prizes are now locked." };
}

export async function cancelAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  try {
    await cancelPreparation(db(), { preparationId, reason: String(formData.get("reason") ?? "").slice(0, 600), seedKey: seedKey() });
  } catch (error) {
    return failure(error);
  }
  refresh(eventId, preparationId);
  return { message: "Cancelled." };
}

export async function completeAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  if (formData.get("confirm") !== "yes") return { error: "Confirm that the raffle is over." };
  try {
    await completePreparation(db(), { preparationId, seedKey: seedKey() });
  } catch (error) {
    return failure(error);
  }
  refresh(eventId, preparationId);
  return { message: "Completed. The server seed is now public, so anyone can reproduce every draw." };
}

export async function freshStartAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  let successorId: string;
  try {
    successorId = (await freshStart(db(), { preparationId, reason: String(formData.get("reason") ?? "").slice(0, 600), seedKey: seedKey() })).id;
  } catch (error) {
    return failure(error);
  }
  refresh(eventId, preparationId);
  redirect(`/admin/events/${eventId}/raffle/${successorId}`);
}

const drawSchema = z.object({ prizeId: z.uuid(), slot: z.coerce.number().int().min(1).max(1000), generation: z.coerce.number().int().min(0).max(100_000) });

export async function drawAction(eventId: string, preparationId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId)) return { error: "This raffle no longer exists." };
  const parsed = drawSchema.safeParse({ prizeId: formData.get("prizeId"), slot: formData.get("slot"), generation: formData.get("generation") });
  if (!parsed.success) return { error: "Refresh the console and try again." };
  const database = db();
  const env = serverEnv();
  try {
    const preparation = await database.rafflePreparation.findUnique({ where: { id: preparationId }, select: { eventId: true, seedCiphertext: true } });
    if (!preparation || preparation.eventId !== eventId || !preparation.seedCiphertext) return { error: "This raffle is not open for drawing." };
    const serverSeed = decryptSeed(seedKey(), preparationId, new Uint8Array(preparation.seedCiphertext));
    const { prizeId, slot, generation } = parsed.data;
    const result = await runDraw(database, {
      preparationId,
      prizeId,
      slotNumber: slot,
      idempotencyKey: `console:${preparationId}:${prizeId}:${slot}:${generation}`,
      serverSeed,
      relays: env.DRAND_RELAYS,
    });
    refresh(eventId, preparationId);
    return { message: `Slot ${result.slotNumber} drawn from ${result.candidateCount} ${result.candidateCount === 1 ? "candidate" : "candidates"} (beacon round ${result.targetRound}).` };
  } catch (error) {
    refresh(eventId, preparationId);
    return failure(error);
  }
}

export async function finishDrawAction(eventId: string, preparationId: string, drawId: string, _previous: RaffleActionState): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId, drawId)) return { error: "That draw no longer exists." };
  const database = db();
  try {
    const preparation = await database.rafflePreparation.findUnique({ where: { id: preparationId }, select: { eventId: true, seedCiphertext: true } });
    if (!preparation || preparation.eventId !== eventId || !preparation.seedCiphertext) return { error: "This raffle is not open for drawing." };
    const serverSeed = decryptSeed(seedKey(), preparationId, new Uint8Array(preparation.seedCiphertext));
    await finishPendingDraw(database, drawId, { serverSeed, relays: serverEnv().DRAND_RELAYS });
    refresh(eventId, preparationId);
    return { message: "Beacon received and the draw is committed." };
  } catch (error) {
    refresh(eventId, preparationId);
    return failure(error);
  }
}

const reasonKeys = CORRECTION_REASONS.map((reason) => reason.key) as [string, ...string[]];
const resetSchema = z.object({ category: z.enum(reasonKeys), reason: z.string().max(600) });

export async function resetDrawAction(eventId: string, preparationId: string, drawId: string, _previous: RaffleActionState, formData: FormData): Promise<RaffleActionState> {
  await requireAdmin();
  if (!validIds(eventId, preparationId, drawId)) return { error: "That draw no longer exists." };
  const parsed = resetSchema.safeParse({ category: formData.get("category"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "Choose a reason category and describe what happened." };
  try {
    const owner = await db().draw.findUnique({ where: { id: drawId }, select: { preparationId: true } });
    if (owner?.preparationId !== preparationId) return { error: "That draw is not part of this raffle." };
    await resetDraw(db(), { drawId, category: parsed.data.category as (typeof CORRECTION_REASONS)[number]["key"], reason: parsed.data.reason });
  } catch (error) {
    return failure(error);
  }
  refresh(eventId, preparationId);
  return { message: "Reset recorded. The slot is open for a new draw." };
}
