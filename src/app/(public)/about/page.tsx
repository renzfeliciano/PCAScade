import type { Metadata } from "next";
import { BRAND_ASSOCIATION } from "@/components/brand/brand-mark";

export const metadata: Metadata = { title: "About" };

const CONTROLS = [
  {
    title: "Frozen before drawing",
    body: "Before the first draw, the eligible roster, prize list and rules are locked and fingerprinted with SHA-256. Changing any of them afterwards requires a new, separately recorded preparation.",
  },
  {
    title: "Randomness nobody can pick",
    body: "Each draw commits to a drand round that has not been published yet. drand is a public randomness beacon run by the League of Entropy; its signed outputs can be checked by anyone.",
  },
  {
    title: "Decided on the server, shown on screen",
    body: "The server selects the winner with unbiased rejection sampling and records it before any animation starts. The animation only reveals that stored result.",
  },
  {
    title: "Tamper-evident history",
    body: "Every administrative action is written to an append-only audit log where each entry carries a hash of the one before it, so edits or deletions are detectable.",
  },
];

const LIMITS = [
  "The single administrator can reset a prize and draw it again. Every reset is recorded with its reason and shown publicly, so fairness depends on that history being reviewed.",
  "Whoever controls the database server could rewrite records. The pre-draw manifest, shared with witnesses before drawing, is what exposes such changes.",
  "drand is trusted not to have a majority of its operators colluding.",
];

export default function AboutPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-12 px-4 py-12 sm:px-6">
      <header className="grid gap-3">
        <h1 className="text-3xl font-extrabold">About PCASCADE</h1>
        <p className="max-w-[65ch] text-muted-foreground">
          PCASCADE is a raffle and winner-reveal platform for {BRAND_ASSOCIATION}. Each prize tier is revealed through a construction
          scene, from a single brick to a finished tower, while the draw itself stays verifiable.
        </p>
      </header>
      <section className="grid gap-6">
        <h2 className="text-2xl font-bold">What keeps a draw fair</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {CONTROLS.map((control) => (
            <article key={control.title} className="min-w-0 rounded-md border border-border bg-card p-5">
              <h3 className="mb-2 font-bold">{control.title}</h3>
              <p className="text-sm text-muted-foreground">{control.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="text-2xl font-bold">What it does not guarantee</h2>
        <ul className="grid max-w-[65ch] list-disc gap-2 pl-5 text-sm text-muted-foreground">
          {LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
