import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // Compiles every route before the first timed assertion. See the file.
  globalSetup: "./test/e2e/warm-up.ts",
  // These drive one shared database, so they cannot run concurrently.
  workers: 1,
  fullyParallel: false,
  // Five seconds — Playwright's default — turned out to be smaller than a Vite
  // dev server's first navigation to a route on a busy machine, which made the
  // first test of each spec file fail while the rest of the file passed in
  // about a second. The warm-up below removes most of that cost; this covers
  // what it cannot, and it is a property of the dev server rather than of the
  // application. A genuine failure now takes longer to report, which is the
  // price of not reporting failures that are not there.
  expect: { timeout: 15_000 },
  // Longer than the 30s default. Creating a project needs an administrator now
  // (ADR 0039), and `signUpAdmin` signs up, signs the owner in over its own
  // request context, grants the role and reloads — so the tests that were
  // already the longest started running out of budget in the middle of a
  // helper, which reads as the app hanging rather than as the test doing more.
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E=1 makes vite.config.ts point the Worker at .wrangler/e2e-state, so a
    // run never touches the database used for local development.
    command: "E2E=1 pnpm dev",
    url: BASE_URL,
    // Deliberately not reusing: an already-running dev server has the real
    // local database, which is the one thing these tests must not write to.
    // Better to fail on a taken port than to silently run against it.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
