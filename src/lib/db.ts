import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";

export type Db = PrismaClient;

export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForDb = globalThis as unknown as { pcascadeDb?: Db };

export function db(): Db {
  globalForDb.pcascadeDb ??= createDb(serverEnv().DATABASE_URL);
  return globalForDb.pcascadeDb;
}
