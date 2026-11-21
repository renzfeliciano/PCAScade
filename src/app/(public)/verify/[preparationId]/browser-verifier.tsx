"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BundleReport, CheckResult, VerificationBundle } from "@/modules/raffle/domain/verify";

function Mark({ check }: { check: CheckResult }) {
  if (check.ok === true) return <span className="font-semibold text-emerald-700">Pass</span>;
  if (check.ok === false) return <span className="font-semibold text-destructive">Fail: {check.reason}</span>;
  return <span className="text-muted-foreground">{check.reason}</span>;
}

export function BrowserVerifier({ bundle }: { bundle: VerificationBundle }) {
  const [report, setReport] = useState<BundleReport | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setProblem(null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const { verifyBundle } = await import("@/modules/raffle/domain/verify");
      setReport(verifyBundle(bundle));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The bundle could not be checked.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Check it yourself</h2>
      <p className="text-sm text-muted-foreground">
        This runs the same selection code as the server, in your browser: it re-hashes the snapshots, checks each drand signature against the published quicknet key and,
        once the seed is revealed, recomputes every winner.
      </p>
      <div>
        <Button type="button" onClick={run} disabled={running}>
          {running ? "Checking…" : report ? "Check again" : "Run verification"}
        </Button>
      </div>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      {report ? (
        <div className="grid gap-2 text-sm" role="status">
          <p className="font-semibold">
            {report.ok ? (report.complete ? "Every check passed. All draws were reproduced." : "No problems found. Winners can be recomputed once the seed is revealed.") : "Problems found."}
          </p>
          <ul className="grid gap-1">
            <li>
              Snapshots match their hashes: <Mark check={report.snapshots} />
            </li>
            <li>
              Manifest matches the snapshots: <Mark check={report.manifest} />
            </li>
            <li>
              Seed matches the commitment: <Mark check={report.seed} />
            </li>
          </ul>
          {report.draws.length > 0 ? (
            <ul className="grid gap-1 border-t border-border pt-2">
              {report.draws.map((draw) => (
                <li key={draw.drawId}>
                  Draw #{draw.sequence} ({draw.status.toLowerCase()}): beacon <Mark check={draw.beacon} />; candidates <Mark check={draw.candidates} />; winner <Mark check={draw.result} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
