import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // These drive one shared database, so they cannot run concurrently.
  workers: 1,
  fullyParallel: false,
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
