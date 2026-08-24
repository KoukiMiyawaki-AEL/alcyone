import { expect, test } from "@playwright/test";

import { PASSWORD, signIn, signOut, signUp } from "./helpers";

/**
 * These cover the seams that neither vitest project can see. The worker tests
 * call `app.request()` and never run the client; the component tests render
 * components and never touch the API. Every bug found by hand during the auth
 * work lived exactly in between, which is why this file exists.
 */
test.describe("authentication", () => {
  test("signing in navigates away from the login screen", async ({ page }) => {
    // Regression: the submit handler used to navigate before the session hook
    // had refetched, so the destination's guard bounced straight back here.
    const email = await signUp(page);
    await signOut(page);
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, email);

    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("signing out redirects to login without looping", async ({ page }) => {
    // Regression: two guards plus an imperative navigate used to redirect each
    // other until the router gave up with "Too many redirects".
    await signUp(page);
    await signOut(page);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Too many redirects")).toBeHidden();
  });

  test("an unauthenticated deep link returns you to it after signing in", async ({ page }) => {
    const email = await signUp(page);
    await createProjectAndOpen(page);
    const projectUrl = page.url();
    await signOut(page);

    await page.goto(projectUrl);
    await expect(page).toHaveURL(/\/login\?redirect=/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(projectUrl);
  });

  test("a protected page is not reachable while signed out", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    // Regression: the loader used to swallow its own redirect in a catch and
    // render the generic error card instead.
    await expect(page.getByText("プロジェクトの取得に失敗しました。")).toBeHidden();
  });

  test("rejects a wrong password without leaving the form", async ({ page }) => {
    const email = await signUp(page);
    await signOut(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely not the password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

async function createProjectAndOpen(page: import("@playwright/test").Page) {
  await page.getByLabel("New project name").fill("Deep link target");
  await page.getByRole("button", { name: "Add Project" }).click();
  await page.getByRole("link", { name: /Deep link target/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deep link target" })).toBeVisible();
}
