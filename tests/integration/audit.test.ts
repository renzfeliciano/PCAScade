import { afterAll, describe, expect, it } from "vitest";
import { appendAudit, recordAudit, verifyAuditChain } from "@/modules/audit/server/audit-log";
import { databaseRefusal, testDb } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

class Rollback extends Error {}

async function inRolledBackTransaction(work: (tx: Parameters<Parameters<typeof database.$transaction>[0]>[0]) => Promise<void>) {
  await expect(
    database.$transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

describe("audit chain in PostgreSQL", () => {
  it("stays a single unbroken chain when 40 writers append at once", async () => {
    const before = await database.auditLog.count();
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => recordAudit(database, { actor: "system", action: "test.concurrent", entityType: "test", entityId: String(index), payload: { index } })),
    );
    expect(await database.auditLog.count()).toBe(before + 40);
    const verification = await verifyAuditChain(database);
    expect(verification).toMatchObject({ ok: true, checked: before + 40 });
  });

  it("refuses updates, deletes and truncation", async () => {
    await recordAudit(database, { actor: "system", action: "test.immutable", entityType: "test" });
    const latest = await database.auditLog.findFirstOrThrow({ orderBy: { seq: "desc" } });
    expect(await databaseRefusal(database.auditLog.update({ where: { seq: latest.seq }, data: { payload: "{}" } }))).toMatch(/append-only/);
    expect(await databaseRefusal(database.auditLog.delete({ where: { seq: latest.seq } }))).toMatch(/append-only/);
    expect(await databaseRefusal(database.$executeRawUnsafe("TRUNCATE audit_log"))).toMatch(/append-only/);
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });

  it("rolls the audit entry back together with a failed business change", async () => {
    const before = await database.auditLog.count();
    await expect(
      database.$transaction(async (tx) => {
        await appendAudit(tx, { actor: "admin", action: "test.rolled_back", entityType: "test" });
        throw new Error("business change failed");
      }),
    ).rejects.toThrow("business change failed");
    expect(await database.auditLog.count()).toBe(before);
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });

  it("pinpoints an entry edited by someone with direct database access", async () => {
    await recordAudit(database, { actor: "admin", action: "test.target", entityType: "test", payload: { amount: 1 } });
    const target = await database.auditLog.findFirstOrThrow({ where: { action: "test.target" }, orderBy: { seq: "desc" } });
    await inRolledBackTransaction(async (tx) => {
      await tx.$executeRawUnsafe("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete");
      await tx.$executeRaw`UPDATE audit_log SET payload = '{"amount":1000}' WHERE seq = ${target.seq}`;
      expect(await verifyAuditChain(tx)).toMatchObject({ ok: false, brokenAtSeq: target.seq, reason: "HASH_MISMATCH" });
    });
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });

  it("pinpoints a deleted entry", async () => {
    await recordAudit(database, { actor: "admin", action: "test.delete_me", entityType: "test" });
    await recordAudit(database, { actor: "admin", action: "test.after_deleted", entityType: "test" });
    const victim = await database.auditLog.findFirstOrThrow({ where: { action: "test.delete_me" }, orderBy: { seq: "desc" } });
    const next = await database.auditLog.findFirstOrThrow({ where: { seq: { gt: victim.seq } }, orderBy: { seq: "asc" } });
    await inRolledBackTransaction(async (tx) => {
      await tx.$executeRawUnsafe("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete");
      await tx.$executeRaw`DELETE FROM audit_log WHERE seq = ${victim.seq}`;
      expect(await verifyAuditChain(tx)).toMatchObject({ ok: false, brokenAtSeq: next.seq, reason: "PREV_HASH_MISMATCH" });
    });
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });
});
