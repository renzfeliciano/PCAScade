import { readFileSync } from "node:fs";
import { type CheckResult, verifyBundle } from "../../src/modules/raffle/domain/verify";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run verify:bundle -- <bundle.json>");
  process.exit(2);
}

function show(check: CheckResult): string {
  if (check.ok === true) return "PASS";
  if (check.ok === false) return `FAIL  ${check.reason}`;
  return `SKIP  ${check.reason}`;
}

const report = verifyBundle(JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")));
console.log(`snapshots  ${show(report.snapshots)}`);
console.log(`manifest   ${show(report.manifest)}`);
console.log(`seed       ${show(report.seed)}`);
for (const draw of report.draws) {
  console.log(`draw #${draw.sequence} ${draw.status.toLowerCase()} slot ${draw.slotNumber}`);
  console.log(`  beacon      ${show(draw.beacon)}`);
  console.log(`  candidates  ${show(draw.candidates)}`);
  console.log(`  winner      ${show(draw.result)}`);
}
console.log(report.ok ? (report.complete ? "RESULT: every draw reproduced" : "RESULT: no problems found; winners need the revealed seed") : "RESULT: problems found");
process.exitCode = report.ok ? 0 : 1;
