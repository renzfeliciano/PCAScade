import { execFileSync } from "node:child_process";
import { type Page, type Response, expect, test } from "@playwright/test";

type Seeded = { eventId: string; slug: string; preparationId: string; prizeId: string; drawId: string; winnerName: string };

const COUNTDOWN_MS = 4000;
const SCENE_MS = 7000;

function director<T = unknown>(command: string, input: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/e2e/director.mts", command, JSON.stringify(input)], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").at(-1) ?? "null") as T;
}

let seeded: Seeded;

test.beforeAll(() => {
  seeded = director<Seeded>("seed", { countdownSeconds: COUNTDOWN_MS / 1000 });
});

function watchState(page: Page) {
  const bodies: string[] = [];
  page.on("response", async (response: Response) => {
    if (!response.url().includes("/api/presentation/") || response.status() !== 200) return;
    bodies.push(await response.text().catch(() => ""));
  });
  return bodies;
}

async function progress(page: Page) {
  return Number(await page.getByTestId("reveal-scene").getAttribute("data-progress"));
}

test("a refresh during the reveal resumes at the same point and never shows the winner early", async ({ page }) => {
  const ids = { eventId: seeded.eventId, preparationId: seeded.preparationId, prizeId: seeded.prizeId, drawId: seeded.drawId };
  const stateBodies = watchState(page);
  await page.goto(`/presentation/${seeded.slug}`);
  await expect(page.getByTestId("screen-lobby")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Reveal Night");

  director("screen", { ...ids, screen: "DRAW" });
  await expect(page).toHaveURL(new RegExp(`/presentation/${seeded.slug}/draw/${seeded.prizeId}$`));
  await expect(page.getByTestId("screen-draw")).toHaveAttribute("data-phase", "IDLE");

  director("begin", ids);
  await expect(page.getByTestId("screen-draw")).toHaveAttribute("data-phase", "DRAWING");
  director("committed", ids);
  await expect(page.getByTestId("screen-draw")).toHaveAttribute("data-phase", "READY");
  await expect(page.getByTestId("draw-status")).toHaveText("The winner is locked in. Get ready.");
  await page.reload();
  await expect(page.getByTestId("screen-draw")).toHaveAttribute("data-phase", "READY");
  expect(await page.content()).not.toContain(seeded.winnerName);
  expect(stateBodies.length).toBeGreaterThan(0);
  expect(stateBodies.some((body) => body.includes(seeded.winnerName))).toBe(false);

  director("reveal", ids);
  const revealedAt = Date.now();
  await expect(page.getByTestId("reveal-countdown")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("screen-draw")).toHaveAttribute("data-phase", "REVEALING");
  await expect(page.getByTestId("reveal-scene")).toBeVisible({ timeout: COUNTDOWN_MS + 10_000 });
  await page.waitForTimeout(Math.round(SCENE_MS * 0.35));
  const beforeRefresh = await progress(page);
  expect(beforeRefresh).toBeGreaterThan(0.1);

  await page.reload();
  await expect(page.getByTestId("reveal-scene")).toBeVisible();
  const afterRefresh = await progress(page);
  expect(afterRefresh).toBeGreaterThanOrEqual(beforeRefresh);
  expect(afterRefresh).toBeLessThan(1);

  await expect(page.getByTestId("reveal-final")).toBeVisible({ timeout: SCENE_MS + 10_000 });
  expect(Date.now() - revealedAt).toBeLessThan(COUNTDOWN_MS + SCENE_MS + 4000);
  await expect(page.getByTestId("winner-name")).toHaveText(seeded.winnerName);

  await page.reload();
  await expect(page.getByTestId("reveal-final")).toBeVisible();
  await expect(page.getByTestId("reveal-countdown")).toHaveCount(0);
  await expect(page.getByTestId("winner-name")).toHaveText(seeded.winnerName);
});

test("the winner wall follows resets, and the screen shows when it loses the server", async ({ page }) => {
  const ids = { eventId: seeded.eventId, preparationId: seeded.preparationId, prizeId: seeded.prizeId, drawId: seeded.drawId };
  director("screen", { ...ids, screen: "WINNER_WALL" });
  await page.goto(`/presentation/${seeded.slug}`);
  await expect(page).toHaveURL(new RegExp(`/presentation/${seeded.slug}/winner-wall$`));
  await expect(page.getByTestId("screen-winner-wall")).toContainText(seeded.winnerName);

  await page.route("**/api/presentation/**", (route) => route.abort());
  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  await expect(page.getByTestId("screen-winner-wall")).toContainText(seeded.winnerName);
  await page.unroute("**/api/presentation/**");
  await expect(page.getByRole("status")).toHaveCount(0);

  director("reset", ids);
  await expect(page.getByTestId("screen-winner-wall")).not.toContainText(seeded.winnerName);
  await expect(page.getByTestId("screen-winner-wall")).toContainText("Winners appear here as they are revealed.");

  await page.goto(`/presentation/${seeded.slug}/recap?follow=0`);
  await expect(page.getByTestId("screen-recap")).toContainText(`/verify/${seeded.preparationId}`);
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/recap\?follow=0$/);
});
