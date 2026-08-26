import { chromium, type FullConfig } from "@playwright/test";

import { ADMIN_EMAIL, PASSWORD } from "./helpers";

/**
 * Visits each route once before the suite starts.
 *
 * `webServer.url` only waits for the dev server to answer on `/`, but Vite
 * compiles route modules on first request, and TanStack Router fetches a
 * route's chunk only when something navigates to it. So the first test to
 * touch a screen paid the transform cost inside a timed assertion, and on a
 * loaded machine that ran past the 5s expect timeout — which is why the
 * failures cluster at the head of each spec file rather than anywhere
 * interesting.
 *
 * It signs in first, because the guarded routes redirect before their chunk is
 * ever requested: warming them anonymously compiles the login screen four
 * times and nothing else.
 *
 * That account is no longer inert. Being the first to exist makes it the
 * administrator (ADR 0032), which is what keeps every account a test signs up
 * an ordinary member — so creating it is a precondition, not a warm-up, and it
 * happens outside the forgiving block below.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    // The auth endpoints are rate limited by IP, and this address is used
    // nowhere else in the suite.
    extraHTTPHeaders: { "CF-Connecting-IP": "203.0.113.253" },
  });

  const url = (path: string) => new URL(path, baseURL).href;

  try {
    await page.goto(url("/login"));
    await page.getByRole("button", { name: "アカウントを作る" }).click();
    await page.getByLabel("Name").fill("Warm up");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
  } catch (error) {
    // Unlike the compilation below, this one has to stop the run: without it
    // whichever test signs up first becomes the administrator, and the suite
    // goes green having tested a different application.
    await browser.close();
    throw new Error(
      `[warm-up] could not create the administrator: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    // `/projects/1` almost certainly does not exist; the route's module still
    // compiles, which is the whole point. Same for the rest.
    for (const path of ["/projects/1", "/search", "/account", "/s/warmup"]) {
      await page.goto(url(path)).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    console.log("[warm-up] routes compiled");
  } catch (error) {
    // A failed warm-up must not stop the suite — it only makes the first test
    // slow again, which is the situation this exists to improve, not a
    // precondition for running at all. It does have to say so, though: a
    // silent one looks exactly like a working one.
    console.log(`[warm-up] gave up: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
  }
}
