import { chromium, type FullConfig } from "@playwright/test";

/**
 * Visits each route once before the suite starts.
 *
 * `webServer.url` only waits for the dev server to answer on `/`, but Vite
 * compiles route modules on first request, and TanStack Router fetches a
 * route's chunk only when something navigates to it. So the first test to
 * touch a screen paid the transform cost inside a timed assertion, and on a
 * loaded machine that ran past the 5s expect timeout — which is why the first
 * test of each spec file failed while the rest of the file passed in a second.
 *
 * Paying it here instead turns a flaky suite into a slower start.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Unauthenticated, so the guarded ones bounce to /login — but not before the
  // router has fetched and Vite has compiled their chunks, which is the point.
  for (const path of ["/login", "/", "/projects/1", "/account"]) {
    await page.goto(new URL(path, baseURL).href).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  await browser.close();
}
