import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { config } from "dotenv";
import { createDb } from "@/lib/db";
import { AuthError, bootstrapAdmin } from "@/modules/auth/server/admin";

config({ path: process.env.PCASCADE_ENV_FILE ?? ".env.local", quiet: true });

const args = new Set(process.argv.slice(2));
const reset = args.has("--reset");
const fromStdin = args.has("--password-stdin");

function ask(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "").replace(/\r?\n$/, "");
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set (see docs/setup/environment.md).");

  let password: string;
  if (fromStdin) {
    password = await readStdin();
  } else {
    password = await ask(reset ? "New administrator password: " : "Administrator password: ");
    const confirm = await ask("Repeat the password: ");
    if (password !== confirm) {
      console.error("The two passwords do not match. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
  }

  const database = createDb(url);
  try {
    const outcome = await bootstrapAdmin(database, password, { reset });
    console.log(outcome === "created" ? "Administrator account created." : "Administrator password reset. All sessions were signed out.");
  } catch (error) {
    if (error instanceof AuthError && error.code === "ADMIN_EXISTS") {
      console.error("An administrator already exists. Use --reset to replace its password. Nothing was changed.");
    } else if (error instanceof AuthError && error.code === "WEAK_PASSWORD") {
      console.error(`Password rejected: ${error.detail}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

void main();
