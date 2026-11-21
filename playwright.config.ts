import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test", quiet: true });

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//.test(databaseUrl)) {
  throw new Error("Browser tests run only against a localhost TEST_DATABASE_URL.");
}

const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/about`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, APP_URL: `http://localhost:${PORT}` },
  },
});
